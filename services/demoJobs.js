// Background demo processing. Uploads are queued in the `demos` table; this
// runner claims one at a time (SKIP LOCKED, so several processes can share
// the queue) and parses it in a child process with a time limit.
const path = require('path');
const zlib = require('zlib');
const { fork } = require('child_process');
const db = require('../db/connection');
const config = require('../config/env');

const CHILD = path.join(__dirname, '..', 'workers', 'demo-parse-child.js');
const MAX_ATTEMPTS = 2;

const storagePath = (key) => path.join(config.demoStorageDir, key);

// Runs the parser in a child process. Resolves with the replay result or
// rejects with { code, message }.
function parseInChild(file, timeoutMs = config.demoParseTimeoutMs) {
  return new Promise((resolve, reject) => {
    const child = fork(CHILD, [], { serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let stderr = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, { code: 'timeout', message: `Processing took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped.` });
    }, timeoutMs);
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    child.on('message', (msg) => {
      if (msg.ok) finish(resolve, msg.result);
      else finish(reject, { code: msg.code, message: msg.message });
    });
    child.on('exit', (code, signal) => {
      finish(reject, { code: 'parser_crashed', message: `The parser stopped unexpectedly (${signal || `exit ${code}`}). ${stderr.trim()}`.trim() });
    });
    child.send({ file });
  });
}

async function claimNext() {
  return db.transaction(async (trx) => {
    const row = await trx('demos').where('status', 'queued').orderBy('created_at').forUpdate().skipLocked().first();
    if (!row) return null;
    const [claimed] = await trx('demos').where('demo_id', row.demo_id)
      .update({ status: 'processing', processing_started_at: trx.fn.now(), attempts: row.attempts + 1 })
      .returning('*');
    return claimed;
  });
}

// Stores parsed rounds and marks the demo ready (or failed).
async function saveResult(demoId, result) {
  await db.transaction(async (trx) => {
    await trx('demo_rounds').where('demo_id', demoId).del();
    for (const r of result.rounds) {
      await trx('demo_rounds').insert({
        demo_id: demoId,
        round_number: r.round_number,
        start_tick: r.start_tick,
        freeze_end_tick: r.freeze_end_tick,
        end_tick: r.end_tick,
        winner: r.winner,
        reason: r.reason,
        ct_score: r.ct_score,
        t_score: r.t_score,
        data: zlib.gzipSync(JSON.stringify(r.data)),
      });
    }
    await trx('demos').where('demo_id', demoId).update({
      status: 'ready',
      map: result.map,
      tickrate: result.tickrate,
      round_count: result.rounds.length,
      meta: JSON.stringify(result.meta),
      error_code: null,
      error_message: null,
      processed_at: trx.fn.now(),
    });
  });
}

async function markFailed(demoId, code, message) {
  await db('demos').where('demo_id', demoId).update({
    status: 'failed', error_code: String(code).slice(0, 40), error_message: message, processed_at: db.fn.now(),
  });
}

// Processes one queued demo. `parse` is injectable for tests.
async function processNext({ parse = parseInChild } = {}) {
  const demo = await claimNext();
  if (!demo) return null;
  try {
    const result = await parse(storagePath(demo.storage_key));
    await saveResult(demo.demo_id, result);
    return { demo_id: demo.demo_id, status: 'ready' };
  } catch (err) {
    await markFailed(demo.demo_id, err.code || 'parse_failed', err.message || String(err));
    return { demo_id: demo.demo_id, status: 'failed', code: err.code };
  }
}

// Demos left "processing" by a stopped server are retried once, then failed.
async function recoverStale() {
  await db('demos').where('status', 'processing').where('attempts', '<', MAX_ATTEMPTS).update({ status: 'queued' });
  await db('demos').where('status', 'processing').update({
    status: 'failed', error_code: 'interrupted', error_message: 'Processing was interrupted. Delete the demo and upload it again.',
    processed_at: db.fn.now(),
  });
}

let timer = null;
let running = false;
let wake = null;

async function tick() {
  if (running) return;
  running = true;
  try {
    while (await processNext()) { /* drain the queue */ }
  } catch (err) {
    console.error('[demo worker]', err);
  } finally {
    running = false;
  }
}

function start({ intervalMs = 3000 } = {}) {
  if (timer) return;
  recoverStale().catch((err) => console.error('[demo worker] recovery failed', err)).finally(() => tick());
  timer = setInterval(tick, intervalMs);
  timer.unref();
  wake = () => setImmediate(tick);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  wake = null;
}

// Called after an upload so processing starts without waiting for the poll.
function notifyQueued() {
  if (wake) wake();
}

module.exports = { start, stop, processNext, parseInChild, recoverStale, notifyQueued, storagePath };
