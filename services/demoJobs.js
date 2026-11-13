// Background demo processing. Uploads are queued in the `demos` table; this
// runner claims one at a time (SKIP LOCKED, so several processes can share
// the queue) and parses it in a child process with a time limit.
const path = require('path');
const zlib = require('zlib');
const { fork } = require('child_process');
const db = require('../db/connection');
const config = require('../config/env');

const fs = require('fs');
const CHILD = path.join(__dirname, '..', 'workers', 'demo-parse-child.js');
const FETCH_CHILD = path.join(__dirname, '..', 'workers', 'demo-fetch-child.js');
const MAX_ATTEMPTS = 2;

const storagePath = (key) => path.join(config.demoStorageDir, key);
const { STATS_VERSION, REPLAY_VERSION } = require('./demoParse');
const FACEIT_MATCH_ID = /1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Saves a demo's match and per-player totals. Idempotent: the match is keyed
// by a fingerprint of its content, so importing the same match again (or a
// second recording of it) replaces rather than adds.
async function importDemoStats(trx, demo, stats) {
  if (!stats || !stats.players || !stats.players.length) {
    await trx('demos').where('demo_id', demo.demo_id).update({ stats_version: STATS_VERSION });
    return null;
  }
  const faceit = (demo.original_name.match(FACEIT_MATCH_ID) || [null])[0];
  const [match] = await trx('matches')
    .insert({
      source: 'demo', source_key: stats.fingerprint, map: demo.map || null, played_at: demo.created_at,
      rounds: stats.rounds, score_a: stats.score_a, score_b: stats.score_b, faceit_match_id: faceit,
    })
    .onConflict(['source', 'source_key'])
    .merge({ rounds: stats.rounds, score_a: stats.score_a, score_b: stats.score_b, updated_at: trx.fn.now() })
    .returning('match_id');
  await trx('match_players').where('match_id', match.match_id).del();
  await trx('match_players').insert(stats.players.map((p) => ({
    match_id: match.match_id, steamid64: p.steamid64, name: (p.name || '').slice(0, 64), team: p.team, result: p.result,
    kills: p.kills, deaths: p.deaths, assists: p.assists, headshot_kills: p.headshot_kills, damage: p.damage, rounds_played: p.rounds_played,
  })));
  await trx('demo_matches').insert({ demo_id: demo.demo_id, match_id: match.match_id }).onConflict('demo_id').merge();
  await trx('demos').where('demo_id', demo.demo_id).update({ stats_version: STATS_VERSION });
  return match.match_id;
}

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

// Downloads (and decompresses) a replay into `file` in a child process.
function fetchInChild(url, file, timeoutMs = 15 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = fork(FETCH_CHILD, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(reject, { code: 'timeout', message: 'Downloading the replay took too long and was stopped.' }); }, timeoutMs);
    child.on('message', (msg) => (msg.ok ? finish(resolve, msg) : finish(reject, { code: msg.code, message: msg.message })));
    child.on('exit', (code, signal) => finish(reject, { code: 'download_failed', message: `The download stopped unexpectedly (${signal || `exit ${code}`}).` }));
    child.send({ url, file, maxBytes: config.demoMaxBytes });
  });
}

// Share-code imports have no file until the replay is fetched through the
// replay provider; uploads already have theirs.
async function ensureFile(demo, { locate, download }) {
  const file = storagePath(demo.storage_key);
  if (demo.source !== 'share_code' || fs.existsSync(file)) return file;
  const { decodeShareCode } = require('./shareCode');
  const url = await locate(decodeShareCode(demo.share_code));
  fs.mkdirSync(config.demoStorageDir, { recursive: true });
  const { size } = await download(url, file);
  await db('demos').where('demo_id', demo.demo_id).update({ byte_size: size });
  return file;
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
    const demo = await trx('demos').where('demo_id', demoId).first();
    await importDemoStats(trx, { ...demo, map: result.map }, result.stats);
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
      replay_version: REPLAY_VERSION,
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
async function processNext({ parse = parseInChild, locate = (ids) => require('./replayProvider').locateReplay(ids), download = fetchInChild } = {}) {
  const demo = await claimNext();
  if (!demo) return null;
  try {
    const file = await ensureFile(demo, { locate, download });
    const result = await parse(file);
    await saveResult(demo.demo_id, result);
    return { demo_id: demo.demo_id, status: 'ready' };
  } catch (err) {
    await markFailed(demo.demo_id, err.code || 'parse_failed', err.message || String(err));
    return { demo_id: demo.demo_id, status: 'failed', code: err.code };
  }
}

// Replaces each round's replay data in place (matched by round number).
// Annotations and reviews reference the demo and round number, never the
// round rows, so they are untouched. If the new parse finds a different set
// of rounds (it shouldn't: detection is deterministic) the old data is kept.
async function refreshReplay(trx, demo, result) {
  const existing = await trx('demo_rounds').where('demo_id', demo.demo_id).orderBy('round_number').pluck('round_number');
  const rounds = result.rounds || [];
  const fresh = rounds.map((r) => r.round_number);
  if (existing.length !== fresh.length || existing.some((n, i) => n !== fresh[i])) {
    await trx('demos').where('demo_id', demo.demo_id).update({ replay_version: REPLAY_VERSION });
    return false;
  }
  for (const r of rounds) {
    await trx('demo_rounds').where({ demo_id: demo.demo_id, round_number: r.round_number })
      .update({ data: zlib.gzipSync(JSON.stringify(r.data)) });
  }
  await trx('demos').where('demo_id', demo.demo_id).update({ replay_version: REPLAY_VERSION, ...(result.meta ? { meta: JSON.stringify(result.meta) } : {}) });
  return true;
}

// Re-parses one ready demo that was processed by an older version, to fill in
// Player Stats and/or the newer replay data (recorded utility).
async function upgradeDemo(demo, { parse = parseInChild } = {}) {
  try {
    const result = await parse(storagePath(demo.storage_key));
    let replaced = false;
    await db.transaction(async (trx) => {
      if (demo.stats_version < STATS_VERSION) await importDemoStats(trx, demo, result.stats);
      if (demo.replay_version < REPLAY_VERSION) replaced = await refreshReplay(trx, demo, result);
    });
    return { demo_id: demo.demo_id, status: demo.stats_version < STATS_VERSION ? 'stats_ready' : 'replay_ready', replay: replaced };
  } catch (err) {
    // Missing file or parse failure: don't retry forever.
    await db('demos').where('demo_id', demo.demo_id).update({ stats_version: STATS_VERSION, replay_version: REPLAY_VERSION });
    return { demo_id: demo.demo_id, status: 'upgrade_failed', code: err.code, message: err.message };
  }
}

// Background: one outdated demo per worker tick.
async function backfillNext({ parse = parseInChild } = {}) {
  const demo = await db('demos').where('status', 'ready')
    .where((q) => q.where('stats_version', '<', STATS_VERSION).orWhere('replay_version', '<', REPLAY_VERSION))
    .orderBy('created_at').first();
  if (!demo) return null;
  return upgradeDemo(demo, { parse });
}
const backfillNextStats = backfillNext;

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
    await backfillNext();
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

module.exports = { fetchInChild, importDemoStats, backfillNextStats, backfillNext, upgradeDemo, refreshReplay, start, stop, processNext, parseInChild, recoverStale, notifyQueued, storagePath };
