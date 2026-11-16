// Replay Inspector captures (Phase 11): real first-person frames from CS2.
//
// How it works (tools/cs2-capture/capture.py): CS2 runs on this machine,
// started with -condebug -console. The worker types console commands into it
// through a uinput virtual keyboard (only while the CS2 window has focus),
// confirms each step from CS2's own console log (demo loaded, seek finished
// at the exact tick, which player is being watched), and reads the rendered
// frames from the CS2 window through XWayland. Clips are frames sampled while
// the demo plays at 0.2× and encoded to WebM with GStreamer.
//
// Earlier attempts that failed (16 Nov 2026, GNOME on Wayland): no
// -netconport / VConsole listener; +playdemo at launch is dropped; XTest
// keystrokes never reach the game. uinput is what works.
//
// Nothing is faked: media exists only when CS2 rendered it for that tick and
// player. Requests queue in demo_captures and a single worker processes them
// one at a time (there is one CS2). Without the worker (CAPTURE_WORKER=on),
// requests are refused with the reason.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { httpError, badRequest, notFound, conflict } = require('../errors');
const { loadDemo } = require('./demos');
const db = require('../db/connection');
const config = require('../config/env');

const UTILITY = ['smoke', 'flash', 'he', 'fire'];
// Bump when capture output changes so old cached media isn't reused.
const CAPTURE_VERSION = 1;
const SCRIPT = path.join(__dirname, '..', 'tools', 'cs2-capture', 'capture.py');
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const MEDIA_NAME = /^[a-z]+\.(jpg|webm)$/;

const captureDir = (demoId, captureId) => path.join(config.captureStorageDir, String(demoId), ...(captureId ? [String(captureId)] : []));

// ---- Driver (the Python tool); replaceable in tests ---------------------

function runPython(args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-I', SCRIPT, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', () => {
      clearTimeout(timer);
      const line = out.trim().split('\n').pop();
      try {
        resolve(JSON.parse(line));
      } catch {
        reject(new Error(`capture tool gave no result${err ? `: ${err.trim().split('\n').pop()}` : ''}`));
      }
    });
    child.stdin.end(input ? JSON.stringify(input) : '');
  });
}

const pythonDriver = {
  check: () => runPython(['status'], null, 15000),
  run: (job) => runPython(['run'], job, RUN_TIMEOUT_MS),
};

let driver = pythonDriver;
let enabled = config.captureWorker;

// ---- Readiness ------------------------------------------------------------

let lastCheck = { at: 0, checks: null };
async function checks(maxAgeMs = 3000) {
  if (Date.now() - lastCheck.at > maxAgeMs) {
    let c;
    try {
      c = await driver.check();
    } catch (e) {
      c = { error: e.message };
    }
    lastCheck = { at: Date.now(), checks: c };
  }
  return lastCheck.checks;
}

function readiness(c) {
  if (!enabled) {
    return { ready: false, reason: 'First-person capture is turned off on this server. It runs on a machine with CS2 installed, with CAPTURE_WORKER=on.' };
  }
  if (!c || c.error) return { ready: false, reason: `The capture tool could not run${c && c.error ? ` (${c.error})` : ''}.` };
  if (!c.uinput) return { ready: false, reason: 'The capture tool needs access to /dev/uinput (Steam\'s input rules grant it) to type into CS2.' };
  if (!c.cs2_running || !c.window) return { ready: false, reason: 'Start CS2 (with the launch options -condebug -console) to capture. Queued requests will run once it is open and focused.' };
  if (!c.console_log) return { ready: false, reason: 'CS2 is running without -condebug, so capture steps can\'t be confirmed. Restart it with -condebug -console.' };
  if (!c.focused) return { ready: false, reason: 'Click inside the CS2 window and leave it focused: captures type into its console only while it has focus.' };
  return { ready: true, reason: 'CS2 is ready. Captures take about 20–60 seconds each.' };
}

async function status() {
  const c = enabled ? await checks() : null;
  const r = readiness(c);
  return { enabled, available: r.ready, reason: r.reason, checks: c, encoder: 'gstreamer-webm' };
}

// ---- Requests -------------------------------------------------------------

const present = (row) => ({
  capture_id: row.capture_id,
  round_number: row.round_number,
  event_index: row.event_index,
  kind: row.kind,
  status: row.status,
  error: row.error,
  error_code: row.error_code,
  // ?v changes when a capture is redone, so a cached older image isn't shown.
  media: (row.media || []).map((m) => ({ ...m, url: `/api/demos/${row.demo_id}/captures/${row.capture_id}/media/${m.file}?v=${new Date(row.updated_at).getTime()}` })),
  updated_at: row.updated_at,
});

async function roundData(demoId, roundNumber) {
  const row = await db('demo_rounds').where({ demo_id: demoId, round_number: roundNumber }).first('data');
  if (!row) throw notFound('Round not found');
  return JSON.parse(zlib.gunzipSync(row.data));
}

function checkKind(kind, ev) {
  if (kind === 'kill' && ev.type !== 'kill') throw badRequest('That event is not a kill', 'wrong_event');
  if (kind === 'utility' && !(UTILITY.includes(ev.type) && ev.player != null)) throw badRequest('That event is not a utility throw', 'wrong_event');
}

async function list(demoId, userId) {
  await loadDemo(demoId, userId);
  const rows = await db('demo_captures').where({ demo_id: demoId, capture_version: CAPTURE_VERSION }).orderBy('capture_id');
  return { ...(await status()), captures: rows.map(present) };
}

// Validates the request against the demo the user can access and the
// recorded event, then queues it (or returns the existing capture).
async function request(demoId, userId, body) {
  const { demo } = await loadDemo(demoId, userId);
  if (demo.status !== 'ready') throw conflict('This demo is not ready yet', 'demo_not_ready');
  const data = await roundData(demoId, body.round_number);
  const ev = data.events[body.event_index];
  if (!ev) throw notFound('Event not found', 'event_not_found');
  checkKind(body.kind, ev);
  const st = await status();
  if (!enabled) throw httpError(503, st.reason, 'capture_unavailable', { status: st });
  const key = { demo_id: demoId, round_number: body.round_number, event_index: body.event_index, kind: body.kind, capture_version: CAPTURE_VERSION };
  let row = await db('demo_captures').where(key).first();
  if (!row) {
    [row] = await db('demo_captures').insert({ ...key, requested_by: userId }).onConflict(Object.keys(key)).ignore().returning('*');
    row = row || await db('demo_captures').where(key).first();
  } else if (row.status === 'failed' || (body.retry && row.status === 'ready')) {
    [row] = await db('demo_captures').where('capture_id', row.capture_id)
      .update({ status: 'queued', error: null, error_code: null, requested_by: userId, updated_at: db.fn.now() }).returning('*');
  }
  kick();
  return { ...st, capture: present(row) };
}

async function mediaFile(demoId, userId, captureId, name) {
  await loadDemo(demoId, userId);
  const row = await db('demo_captures').where({ demo_id: demoId, capture_id: captureId }).first();
  if (!row || row.status !== 'ready' || !MEDIA_NAME.test(name) || !(row.media || []).some((m) => m.file === name)) throw notFound('Capture not found');
  const file = path.join(captureDir(demoId, captureId), name);
  if (!fs.existsSync(file)) throw notFound('Capture file is missing');
  return file;
}

// ---- Job building ---------------------------------------------------------

// Same rule as client/src/lib/inspector.ts victimLastAliveTick: the victim's
// last sampled moment alive strictly before the kill.
function victimLastAliveTick(round, victim, killTick) {
  const slot = round.roster.findIndex((r) => r.player === victim);
  const track = round.tracks[slot];
  if (slot < 0 || !track) return null;
  for (let i = Math.min(track.hp.length - 1, Math.floor((killTick - round.first_tick) / round.step)); i >= 0; i -= 1) {
    const t = round.first_tick + i * round.step;
    if (t < killTick && track.hp[i] > 0) return t;
  }
  return null;
}

// The items to capture for one event; each item is a real frame or clip
// CS2 will render. Players are identified by their in-demo names.
function buildItems(demo, round, ev, kind, dir) {
  const players = (demo.meta && demo.meta.players) || [];
  const nameOf = (i) => (i == null ? null : (players.find((p) => p.index === i) || {}).name || null);
  const tickrate = demo.tickrate || 64;
  const items = [];
  if (kind === 'kill') {
    const killer = nameOf(ev.attacker);
    if (killer && ev.attacker !== ev.victim) items.push({ role: 'killer', type: 'shot', tick: ev.tick, player: killer, file: path.join(dir, 'killer.jpg') });
    const vt = victimLastAliveTick(round, ev.victim, ev.tick);
    const victim = nameOf(ev.victim);
    if (victim && vt != null) items.push({ role: 'victim', type: 'shot', tick: vt, player: victim, file: path.join(dir, 'victim.jpg') });
  } else {
    const thrower = nameOf(ev.player);
    if (!thrower) return items;
    const lo = round.start_tick ?? round.first_tick;
    const hi = round.end_tick ?? Infinity;
    const center = ev.throw_tick != null ? ev.throw_tick : ev.tick;
    const start = Math.max(lo, center - tickrate);
    const end = Math.min(hi, start + 2 * tickrate);
    items.push({ role: 'replay', type: 'clip', start, end, player: thrower, fps: 30, file: path.join(dir, 'replay.webm') });
    // Lineup: the thrower's view the tick before the grenade leaves the hand
    // (only when the release is known), at 2560 px for the crosshair zoom.
    if (ev.throw_tick != null) items.push({ role: 'lineup', type: 'shot', tick: ev.throw_tick - 1, player: thrower, width: 2560, file: path.join(dir, 'lineup.jpg') });
  }
  return items;
}

// ---- Worker ---------------------------------------------------------------

let busy = false;
let timer = null;

async function runOnce() {
  if (busy || !enabled) return false;
  const next = await db('demo_captures').where({ status: 'queued', capture_version: CAPTURE_VERSION }).orderBy('capture_id').first();
  if (!next) return false;
  if (!readiness(await checks(0)).ready) return false; // stays queued until CS2 is ready
  busy = true;
  try {
    const [row] = await db('demo_captures').where({ capture_id: next.capture_id, status: 'queued' })
      .update({ status: 'running', attempts: next.attempts + 1, updated_at: db.fn.now() }).returning('*');
    if (!row) return false;
    await process1(row);
    return true;
  } finally {
    busy = false;
  }
}

async function process1(row) {
  const fail = (code, message) => db('demo_captures').where('capture_id', row.capture_id)
    .update({ status: 'failed', error_code: code, error: message, updated_at: db.fn.now() });
  try {
    const demo = await db('demos').where('demo_id', row.demo_id).first();
    if (!demo || demo.status !== 'ready') return fail('demo_missing', 'The demo is no longer available.');
    const round = await roundData(row.demo_id, row.round_number);
    const ev = round.events[row.event_index];
    if (!ev) return fail('event_missing', 'The event is no longer in this round.');
    const dir = captureDir(row.demo_id, row.capture_id);
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(dir, { recursive: true });
    const items = buildItems(demo, round, ev, row.kind, dir);
    if (!items.length) return fail('nothing_to_capture', 'There is no player view to capture for this event (no known killer, victim or thrower).');
    const job = {
      demo: path.join(config.demoStorageDir, demo.storage_key),
      tickrate: demo.tickrate || 64,
      state: path.join(config.captureStorageDir, 'cs2-state.json'),
      focus_wait: 5,
      items: items.map(({ role, ...item }) => item),
    };
    const result = await driver.run(job);
    if (!result || !result.ok) return fail((result && result.code) || 'capture_failed', (result && result.error) || 'Capture failed.');
    const media = items.map((item, i) => {
      const r = result.items[i] || {};
      const { file, type, ...rest } = item;
      return {
        ...rest, ...r, file: path.basename(file), type: type === 'clip' ? 'video' : 'image',
        mime: type === 'clip' ? 'video/webm' : 'image/jpeg',
      };
    });
    await db('demo_captures').where('capture_id', row.capture_id)
      .update({ status: 'ready', media: JSON.stringify(media), error: null, error_code: null, updated_at: db.fn.now() });
  } catch (e) {
    await fail('capture_failed', `Capture failed: ${e.message}`);
  }
  return null;
}

function kick() {
  // Tests drive the queue with runOnce() themselves.
  if (enabled && !config.isTest) setImmediate(() => runOnce().catch((e) => console.error('capture worker:', e.message)));
}

async function start() {
  if (!enabled) return;
  await fsp.mkdir(config.captureStorageDir, { recursive: true });
  // A capture interrupted by a restart runs again.
  await db('demo_captures').where('status', 'running').update({ status: 'queued', updated_at: db.fn.now() });
  timer = setInterval(() => runOnce().catch((e) => console.error('capture worker:', e.message)), 3000);
  timer.unref();
}

module.exports = {
  CAPTURE_VERSION, status, list, request, mediaFile, start, victimLastAliveTick, buildItems,
  // Tests: swap the CS2 driver and enable the queue without a real game.
  _test: {
    setDriver(d) { driver = d || pythonDriver; lastCheck = { at: 0, checks: null }; },
    setEnabled(on) { enabled = on; lastCheck = { at: 0, checks: null }; },
    runOnce,
  },
};
