// Replay Inspector captures: real first-person frames and clips from CS2.
//
// How it works (tools/cs2-capture): a capture *session* is one run of CS2.
// The worker launches CS2 itself (windowed, with a temporary capture video
// profile), focuses its window, loads the demo once and captures the
// session's events in tick order. Commands are typed through a uinput
// virtual keyboard only while CS2 has focus; every step is confirmed from
// CS2's console log; frames are read from the CS2 window through XWayland
// and clips encoded to WebM with GStreamer. When the session ends the CS2
// it launched is closed (also on failure) and the player's settings are put
// back. "Watch this round" opens the demo at a round and leaves CS2 open.
//
// Nothing is faked: media exists only when CS2 rendered it for that tick and
// player. A failed attempt keeps the previous media. Requests queue in
// demo_captures / capture_sessions and one worker runs sessions one at a
// time (there is one CS2). Without the worker (CAPTURE_WORKER=on) capture
// requests are refused with the reason.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { spawn, fork } = require('child_process');
const { httpError, badRequest, notFound, conflict } = require('../errors');
const { loadDemo } = require('./demos');
const db = require('../db/connection');
const config = require('../config/env');
const estimates = require('./captureEstimates');
const capturePlan = require('./capturePlan');
const throwSetup = require('./throwSetup');

const UTILITY = ['smoke', 'flash', 'he', 'fire'];
const SELECTIONS = ['all', 'kill', 'utility'];
// Bump when capture output changes so old cached media isn't reused.
const CAPTURE_VERSION = 1;
const SCRIPT = path.join(__dirname, '..', 'tools', 'cs2-capture', 'capture.py');
// Windows installs Python as `python`; CAPTURE_PYTHON overrides either.
const PYTHON = process.env.CAPTURE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const IS_WINDOWS = process.platform === 'win32';
const INPUTS_CHILD = path.join(__dirname, '..', 'workers', 'demo-inputs-child.js');
const THROWS_CHILD = path.join(__dirname, '..', 'workers', 'demo-throws-child.js');
const MEDIA_NAME = /^[a-z_]+\.(jpg|webm)$/;
// Steps that end a session: CS2 is gone or can't be controlled.
const FATAL = new Set(['cs2_closed', 'focus', 'focus_lost', 'cs2_start', 'cs2_running', 'cs2_missing', 'internal', 'tool']);

// Recorded input (usercmd button bits) → conventional key labels. These are
// the actions the player's client sent (bound keys), not physical keys.
const INPUT_BITS = { W: 3, A: 9, S: 4, D: 10, Shift: 16, Ctrl: 2, Space: 1, LMB: 0, RMB: 11 };

const captureDir = (demoId, captureId, attempt) => path.join(config.captureStorageDir, String(demoId),
  ...(captureId ? [String(captureId)] : []), ...(attempt ? [String(attempt)] : []));
const stateDir = () => path.join(config.captureStorageDir, 'cs2-session');

// ---- Capture tool (Python) — replaceable in tests ------------------------

function runPython(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, ['-I', SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out.trim().split('\n').pop()));
      } catch {
        reject(new Error(`capture tool gave no result${err ? `: ${err.trim().split('\n').pop()}` : ''}`));
      }
    });
  });
}

// A running `capture.py session`: call(op) → reply; close() → closed info.
function openPythonSession(onStage) {
  const child = spawn(PYTHON, ['-I', SCRIPT, 'session'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 1;
  const waiting = new Map();
  let closed = null;
  let closedResolve;
  const closedP = new Promise((r) => { closedResolve = r; });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.stage) onStage(msg.stage);
    else if (msg.closed) closed = msg;
    else if (msg.id != null && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  });
  child.on('close', () => {
    for (const r of waiting.values()) r({ ok: false, code: 'tool', error: `The capture tool stopped${stderr ? `: ${stderr.trim().split('\n').pop()}` : ''}.` });
    waiting.clear();
    closedResolve(closed || { closed: true, timings: {} });
  });
  return {
    call(req, timeoutMs = 15 * 60 * 1000) {
      const id = nextId++;
      return new Promise((resolve) => {
        const timer = setTimeout(() => { waiting.delete(id); resolve({ ok: false, code: 'tool', error: 'The capture step timed out.' }); }, timeoutMs);
        waiting.set(id, (m) => { clearTimeout(timer); resolve(m); });
        child.stdin.write(`${JSON.stringify({ ...req, id })}\n`);
      });
    },
    async close() {
      try { child.stdin.write(`${JSON.stringify({ op: 'close' })}\n`); child.stdin.end(); } catch { /* already gone */ }
      const t = setTimeout(() => child.kill('SIGKILL'), 120000);
      const res = await closedP;
      clearTimeout(t);
      return res;
    },
  };
}

function readInputs(file, ranges, timeoutMs = 120000) {
  if (!ranges.length) return Promise.resolve({});
  return new Promise((resolve) => {
    const child = fork(INPUTS_CHILD, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({}); }, timeoutMs);
    child.on('message', (m) => { clearTimeout(timer); child.kill(); resolve(m.ok ? m.ranges : {}); });
    child.on('error', () => { clearTimeout(timer); resolve({}); });
    child.send({ file, ranges });
  });
}

// Per-tick movement before each release (lineup still timing).
function readThrows(file, throws, timeoutMs = 120000) {
  if (!throws.length) return Promise.resolve({});
  return new Promise((resolve) => {
    const child = fork(THROWS_CHILD, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({}); }, timeoutMs);
    child.on('message', (m) => { clearTimeout(timer); child.kill(); resolve(m.ok ? m.samples : {}); });
    child.on('error', () => { clearTimeout(timer); resolve({}); });
    child.send({ file, throws });
  });
}

const pythonDriver = {
  check: () => runPython(['status'], 15000),
  open: openPythonSession,
  inputs: readInputs,
  throws: readThrows,
};

let driver = pythonDriver;
let enabled = config.captureWorker;

// ---- Readiness ------------------------------------------------------------

let lastCheck = { at: 0, checks: null };
async function checks(maxAgeMs = 5000) {
  if (Date.now() - lastCheck.at > maxAgeMs) {
    let c;
    try { c = await driver.check(); } catch (e) { c = { error: e.message }; }
    lastCheck = { at: Date.now(), checks: c };
  }
  return lastCheck.checks;
}

function readiness(c) {
  if (!enabled) {
    return { ready: false, reason: 'First-person capture is turned off on this server. It runs on a machine with CS2 installed, with CAPTURE_WORKER=on.' };
  }
  if (!c || c.error) {
    const hint = IS_WINDOWS ? ' Install Python 3 with Pillow and psutil (`python -m pip install pillow psutil`).' : '';
    return { ready: false, reason: `The capture tool could not run${c && c.error ? ` (${c.error})` : ''}.${hint}` };
  }
  if (!c.cs2_installed || !c.runtime) {
    return { ready: false, reason: IS_WINDOWS ? 'CS2 must be installed in a Steam library on this PC to capture.' : 'CS2 (and the Steam Linux Runtime) must be installed on this machine to capture.' };
  }
  if (!c.uinput) return { ready: false, reason: 'The capture tool needs access to /dev/uinput (Steam\'s input rules grant it) to control CS2.' };
  if (!c.encoder) {
    return { ready: false, reason: IS_WINDOWS ? 'FFmpeg with the VP8 encoder (libvpx) is needed to encode clips (`winget install Gyan.FFmpeg`).' : 'GStreamer\'s VP8 encoder (vp8enc) is needed to encode clips.' };
  }
  if (c.cs2_running && !c.cs2_usable) return { ready: false, reason: 'CS2 is open without the console log, so capture can\'t confirm its steps. Close CS2: capture starts its own.' };
  return { ready: true, reason: 'Capture launches CS2 on this PC, takes control of its window and closes it when done.' };
}

async function status() {
  const c = enabled ? await checks() : null;
  const r = readiness(c);
  return { enabled, available: r.ready, reason: r.reason, checks: c, estimates: estimates.summary() };
}

// ---- Presenting -------------------------------------------------------------

const mediaUrl = (row, m) => `/api/demos/${row.demo_id}/captures/${row.capture_id}/media/${m.file}?v=${m.attempt ?? 0}-${new Date(row.updated_at).getTime()}`;
const present = (row) => ({
  capture_id: row.capture_id,
  round_number: row.round_number,
  event_index: row.event_index,
  kind: row.kind,
  status: row.status,
  error: row.error,
  error_code: row.error_code,
  session_id: row.session_id,
  media: (row.media || []).map((m) => ({ ...m, url: mediaUrl(row, m) })),
  timings: row.timings || {},
  updated_at: row.updated_at,
});

const presentSession = (s) => s && ({
  session_id: s.session_id,
  demo_id: s.demo_id,
  mode: s.mode,
  selection: s.selection,
  round_number: s.round_number,
  player_index: s.player_index ?? null,
  player_name: s.player_name ?? null,
  status: s.status,
  stage: s.stage,
  total: s.total,
  completed: s.completed,
  failed: s.failed,
  error: s.error,
  error_code: s.error_code,
  timings: s.timings || {},
  created_at: s.created_at,
  started_at: s.started_at,
  finished_at: s.finished_at,
  finished_ago: s.finished_at ? Math.round((Date.now() - new Date(s.finished_at).getTime()) / 1000) : null,
});

// ---- Event selection --------------------------------------------------------

async function roundData(demoId, roundNumber) {
  const row = await db('demo_rounds').where({ demo_id: demoId, round_number: roundNumber }).first('data');
  if (!row) throw notFound('Round not found');
  return JSON.parse(zlib.gunzipSync(row.data));
}

const isUtility = (ev) => UTILITY.includes(ev.type) && ev.player != null;
const isCapturableKill = (ev) => ev.type === 'kill' && (ev.attacker != null || ev.victim != null);
const momentOf = (ev) => (isUtility(ev) && ev.throw_tick != null ? ev.throw_tick : ev.tick);

function checkKind(kind, ev) {
  if (kind === 'kill' && ev.type !== 'kill') throw badRequest('That event is not a kill', 'wrong_event');
  if (kind === 'utility' && !isUtility(ev)) throw badRequest('That event is not a utility throw', 'wrong_event');
}

// The recorded events matching a selection, in tick order: optionally one
// round, and optionally one player (by parsed player index, so players with
// the same display name stay apart): kills they made, utility they threw.
async function selectEvents(demoId, selection, { round = null, player = null } = {}) {
  let q = db('demo_rounds').where('demo_id', demoId).orderBy('round_number').select('round_number', 'data');
  if (round != null) q = q.where('round_number', round);
  const rounds = await q;
  const out = [];
  for (const r of rounds) {
    const data = JSON.parse(zlib.gunzipSync(r.data));
    data.events.forEach((ev, i) => {
      const kind = isCapturableKill(ev) ? 'kill' : isUtility(ev) ? 'utility' : null;
      if (!kind || (selection !== 'all' && selection !== kind)) return;
      if (player != null && (kind === 'kill' ? ev.attacker : ev.player) !== player) return;
      out.push({ round_number: r.round_number, event_index: i, kind, moment_tick: momentOf(ev) });
    });
  }
  return out.sort((a, b) => a.moment_tick - b.moment_tick);
}

// ---- Requests -----------------------------------------------------------------

async function list(demoId, userId) {
  await loadDemo(demoId, userId);
  const rows = await db('demo_captures').where({ demo_id: demoId, capture_version: CAPTURE_VERSION }).orderBy('capture_id');
  const session = await db('capture_sessions').where({ demo_id: demoId }).orderBy('session_id', 'desc').first();
  return { ...(await status()), captures: rows.map(present), session: presentSession(session) };
}

async function requireEnabled() {
  const st = await status();
  if (!enabled) throw httpError(503, st.reason, 'capture_unavailable', { status: st });
  return st;
}

async function createSession(fields) {
  const [s] = await db('capture_sessions').insert(fields).returning('*');
  return s;
}

// Upserts a capture row and (re)queues it in a session. Media from an
// earlier success is kept until a new attempt succeeds.
async function queueCapture(demoId, userId, ev, sessionId) {
  const key = { demo_id: demoId, round_number: ev.round_number, event_index: ev.event_index, kind: ev.kind, capture_version: CAPTURE_VERSION };
  const fields = { status: 'queued', error: null, error_code: null, session_id: sessionId, requested_by: userId, moment_tick: ev.moment_tick, updated_at: db.fn.now() };
  const [row] = await db('demo_captures').insert({ ...key, ...fields }).onConflict(Object.keys(key)).merge(fields).returning('*');
  return row;
}

// Captures (or recaptures) one event: its own single-event session.
async function request(demoId, userId, body) {
  const { demo } = await loadDemo(demoId, userId);
  if (demo.status !== 'ready') throw conflict('This demo is not ready yet', 'demo_not_ready');
  const data = await roundData(demoId, body.round_number);
  const ev = data.events[body.event_index];
  if (!ev) throw notFound('Event not found', 'event_not_found');
  checkKind(body.kind, ev);
  const st = await requireEnabled();
  const existing = await db('demo_captures').where({ demo_id: demoId, round_number: body.round_number, event_index: body.event_index, kind: body.kind, capture_version: CAPTURE_VERSION }).first();
  if (existing && (existing.status === 'queued' || existing.status === 'running')) {
    const s = existing.session_id ? await db('capture_sessions').where('session_id', existing.session_id).first() : null;
    return { ...st, capture: present(existing), session: presentSession(s) };
  }
  let session = await createSession({ demo_id: demoId, requested_by: userId, mode: 'single', total: 1, status: 'preparing' });
  const row = await queueCapture(demoId, userId, { ...body, moment_tick: momentOf(ev) }, session.session_id);
  [session] = await db('capture_sessions').where('session_id', session.session_id).update({ status: 'queued' }).returning('*');
  kick();
  return { ...st, capture: present(row), session: presentSession(session) };
}

// Queues every recorded event matching a selection as one batch session.
async function queueBatch(demoId, userId, selection, { round = null, player = null, playerName = null } = {}) {
  if (!SELECTIONS.includes(selection)) throw badRequest('Unknown capture selection', 'bad_selection');
  const events = await selectEvents(demoId, selection, { round, player });
  // Built as 'preparing' and only queued once every event is attached, so
  // the worker can't start it with part of the batch.
  let session = await createSession({
    demo_id: demoId, requested_by: userId, mode: 'batch', selection, total: events.length, round_number: round,
    player_index: player, player_name: playerName,
    status: events.length ? 'preparing' : 'done', stage: events.length ? 'Queued' : 'No recorded events matched the selection.',
    finished_at: events.length ? null : db.fn.now(),
  });
  for (const ev of events) await queueCapture(demoId, userId, ev, session.session_id);
  if (events.length) [session] = await db('capture_sessions').where('session_id', session.session_id).update({ status: 'queued' }).returning('*');
  kick();
  return session;
}

// Called by the demo worker once a demo has parsed. An upload capture option
// stays pending until the uploader picks players (the roster only exists
// now), so nothing is queued and CS2 isn't launched yet.
async function onDemoReady(demoId) {
  const demo = await db('demos').where('demo_id', demoId).first();
  return demo && demo.capture_selection ? { pending: demo.capture_selection } : null;
}

const countBy = (events) => ({ total: events.length, kills: events.filter((e) => e.kind === 'kill').length, utility: events.filter((e) => e.kind === 'utility').length });

// Capture a scoped batch: a round (Capture this round) and/or one player
// (upload player filter). `dry_run` only counts, so the page can say "no
// matching events" before anything launches. Choosing for a pending upload
// option clears it.
async function requestBatch(demoId, userId, body) {
  const { demo } = await loadDemo(demoId, userId);
  if (demo.status !== 'ready') throw conflict('This demo is not ready yet', 'demo_not_ready');
  if (body.round_number != null && !(await db('demo_rounds').where({ demo_id: demoId, round_number: body.round_number }).first('round_number'))) {
    throw notFound('Round not found');
  }
  let playerName = null;
  if (body.player != null) {
    const p = ((demo.meta && demo.meta.players) || []).find((x) => x.index === body.player);
    if (!p) throw badRequest('That player is not in this demo', 'bad_player');
    playerName = p.name;
  }
  const events = await selectEvents(demoId, body.selection, { round: body.round_number ?? null, player: body.player ?? null });
  const counts = countBy(events);
  if (body.dry_run) return { ...counts, estimate_s: estimates.forCounts(counts.kills, counts.utility) };
  if (!events.length) throw conflict('No recorded events match that selection, so there is nothing to capture.', 'no_events', counts);
  if (body.pending && demo.uploaded_by !== userId) throw httpError(403, 'Only the uploader can choose players for their upload', 'forbidden');
  const st = await requireEnabled();
  if (body.pending) await db('demos').where('demo_id', demoId).update({ capture_selection: null });
  const session = await queueBatch(demoId, userId, body.selection, { round: body.round_number ?? null, player: body.player ?? null, playerName });
  return { ...st, ...counts, session: presentSession(session) };
}

// The uploader decides not to capture after all.
async function cancelPending(demoId, userId) {
  const { demo } = await loadDemo(demoId, userId);
  if (demo.uploaded_by !== userId) throw httpError(403, 'Only the uploader can change this', 'forbidden');
  await db('demos').where('demo_id', demoId).update({ capture_selection: null });
  return { cancelled: true };
}

// Requeues a finished session's failed events as one new batch (one CS2 run).
async function retryFailed(demoId, userId, sessionId) {
  await loadDemo(demoId, userId);
  const old = await db('capture_sessions').where({ session_id: sessionId, demo_id: demoId }).first();
  if (!old) throw notFound('Capture session not found');
  if (['preparing', 'queued', 'running'].includes(old.status)) throw conflict('That capture is still running', 'session_running');
  const failed = await db('demo_captures').where({ session_id: sessionId, status: 'failed' });
  if (!failed.length) throw badRequest('Nothing failed in that capture', 'nothing_to_retry');
  const st = await requireEnabled();
  let session = await createSession({ demo_id: demoId, requested_by: userId, mode: failed.length > 1 ? 'batch' : 'single', selection: old.selection, total: failed.length, status: 'preparing' });
  for (const row of failed) await queueCapture(demoId, userId, row, session.session_id);
  [session] = await db('capture_sessions').where('session_id', session.session_id).update({ status: 'queued' }).returning('*');
  kick();
  return { ...st, session: presentSession(session) };
}

async function watchRound(demoId, userId, roundNumber) {
  const { demo } = await loadDemo(demoId, userId);
  if (demo.status !== 'ready') throw conflict('This demo is not ready yet', 'demo_not_ready');
  const round = await db('demo_rounds').where({ demo_id: demoId, round_number: roundNumber }).first('start_tick');
  if (!round) throw notFound('Round not found');
  const st = await requireEnabled();
  const session = await createSession({ demo_id: demoId, requested_by: userId, mode: 'watch', round_number: roundNumber, total: 0 });
  kick();
  return { ...st, session: presentSession(session) };
}

// The user's most recent session (for the progress overlay); the overlay
// follows the job, so it survives a page refresh.
async function currentSession(userId) {
  const s = await db('capture_sessions').where('requested_by', userId).orderBy('session_id', 'desc').first();
  if (!s) return { session: null, items: [], capture: await status() };
  const items = s.mode === 'watch' ? [] : await db('demo_captures').where('session_id', s.session_id)
    .orderBy('moment_tick').select('capture_id', 'round_number', 'event_index', 'kind', 'status', 'error', 'error_code');
  return { session: presentSession(s), items, capture: await status() };
}

async function mediaFile(demoId, userId, captureId, name) {
  await loadDemo(demoId, userId);
  const row = await db('demo_captures').where({ demo_id: demoId, capture_id: captureId }).first();
  const m = row && MEDIA_NAME.test(name) && (row.media || []).find((x) => x.file === name);
  if (!m) throw notFound('Capture not found');
  const file = path.join(captureDir(demoId, captureId, m.attempt || 0), name);
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


// Each queued capture with its round, event and (throws) the setup analysis
// for its lineup still: the stable aim before the throw's setup movement,
// from the demo's per-tick samples (one parse for the whole batch).
async function prepareItems(demo, items, demoFile, timings = {}) {
  const prepared = [];
  const roundsCache = new Map();
  for (const it of items) {
    if (!roundsCache.has(it.round_number)) roundsCache.set(it.round_number, await roundData(demo.demo_id, it.round_number).catch(() => null));
    const round = roundsCache.get(it.round_number);
    prepared.push({ it, round, ev: round && round.events[it.event_index] });
  }
  const players = (demo.meta && demo.meta.players) || [];
  const tickrate = demo.tickrate || 64;
  const throwReqs = [];
  for (const p of prepared) {
    if (p.it.kind !== 'utility' || !p.ev || p.ev.throw_tick == null) continue;
    const name = (players.find((x) => x.index === p.ev.player) || {}).name;
    if (name) throwReqs.push({ key: String(p.it.capture_id), name, tick: p.ev.throw_tick, lookback: Math.round((throwSetup.LOOKBACK_S + 0.5) * tickrate) });
  }
  const ts = Date.now();
  const samples = await driver.throws(demoFile, throwReqs);
  timings.setup_parse = (Date.now() - ts) / 1000;
  const byKey = new Map(throwReqs.map((r) => [r.key, r]));
  for (const p of prepared) {
    const req = byKey.get(String(p.it.capture_id));
    if (req) p.setup = throwSetup.analyse(samples[req.key] || [], req.tick, tickrate);
  }
  return prepared;
}

// ---- Worker ---------------------------------------------------------------

let busy = false;
let timer = null;

const setSession = (id, fields) => db('capture_sessions').where('session_id', id).update(fields);

async function runOnce() {
  if (busy || !enabled) return false;
  const next = await db('capture_sessions').where('status', 'queued').orderBy('session_id').first();
  if (!next) return false;
  busy = true;
  try {
    const [s] = await db('capture_sessions').where({ session_id: next.session_id, status: 'queued' })
      .update({ status: 'running', started_at: db.fn.now(), stage: 'Starting' }).returning('*');
    if (s) await runSession(s);
    return !!s;
  } finally {
    busy = false;
  }
}

// Options for the pass schedules from config (see capturePlan.schedule).
const scheduleOpts = () => ({
  timescale: config.captureTimescale, killTimescale: config.captureKillTimescale,
  mergeGapS: config.captureMergeGapS, stillExtendS: config.captureStillExtendS,
});

// Every event's planned outputs: which recording (step) supplies each file.
function manifest(plan, steps) {
  const byFile = new Map();
  steps.forEach((st, i) => {
    if (st.op === 'segment') {
      for (const o of st.outputs) byFile.set(o.file, i);
      for (const l of st.stills || []) byFile.set(l.file, i);
    } else byFile.set(st.file, i);
  });
  const events = new Map();
  const add = (e, role, file, step, shared) => {
    const k = e.capture_id;
    if (!events.has(k)) events.set(k, { ...e, outputs: [] });
    events.get(k).outputs.push({ role, file: path.basename(file), step, ...(shared ? { shared_from: shared } : {}) });
  };
  for (const w of plan.windows) {
    add(w.events[0], w.role, w.file, byFile.get(w.file));
    for (const c of w.copies || []) add(w.events.find((e) => e.capture_id === c.capture_id), w.role, c.file, byFile.get(w.file), w.capture_id);
  }
  for (const l of plan.lineups) add(l.events[0], 'lineup', l.file, byFile.get(l.file));
  return { steps: steps.length, events: [...events.values()] };
}

// Console command trace (Phase 16): every command CS2 was sent, why, and how
// long it took to submit and confirm, appended to a JSON-lines file; the
// summary (counts, repeats, time) goes into the session's timings.
function traceLog(file) {
  const counts = {};
  const why = {};
  const repeats = {};
  let last = null;
  let n = 0;
  const totals = { console_s: 0, submit_s: 0, confirm_s: 0, console_opens: 0 };
  // A fresh file per session run (ids can repeat after a database reset).
  let pending = fsp.writeFile(file, '').catch(() => {});
  return {
    add(entries, ctx) {
      if (!entries || !entries.length) return pending;
      const lines = [];
      for (const e of entries) {
        lines.push(JSON.stringify({ ...ctx, ...e }));
        if (e.event === 'console_open') { totals.console_opens += 1; continue; }
        if (!e.cmd) { last = null; continue; }
        n += 1;
        const name = e.cmd.split(' ')[0];
        counts[name] = (counts[name] || 0) + 1;
        const wk = `${name}: ${e.why || ''}`;
        why[wk] = (why[wk] || 0) + 1;
        if (last === e.cmd) repeats[wk] = (repeats[wk] || 0) + 1;
        last = e.cmd;
        totals.console_s += e.console_s || 0;
        totals.submit_s += e.submit_s || 0;
        totals.confirm_s += e.confirm_s || 0;
      }
      pending = pending.then(() => fsp.appendFile(file, `${lines.join('\n')}\n`)).catch(() => {});
      return pending;
    },
    summary: () => ({
      total: n, by_command: counts, by_reason: why, repeated: repeats,
      ...Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v * 1000) / 1000])), file: path.basename(file),
    }),
  };
}

// A grouped clip is encoded once and hard-linked into each member capture
// (copied where links aren't possible), so every event keeps its own media
// that survives the others being recaptured.
async function linkInto(from, to) {
  await fsp.rm(to, { force: true });
  try { await fsp.link(from, to); } catch { await fsp.copyFile(from, to); }
}

async function runSession(s) {
  const timings = {};
  const stageUpdates = [];
  const onStage = (text) => { stageUpdates.push(setSession(s.session_id, { stage: text }).catch(() => {})); };
  const finish = async (fields) => {
    await Promise.all(stageUpdates);
    await setSession(s.session_id, { finished_at: db.fn.now(), ...fields });
  };
  const items = s.mode === 'watch' ? [] : await db('demo_captures').where({ session_id: s.session_id, status: 'queued' })
    .orderBy([{ column: 'moment_tick' }, { column: 'capture_id' }]);
  const failRest = async (code, message, from = 0) => {
    for (const it of items.slice(from)) {
      await db('demo_captures').where({ capture_id: it.capture_id }).whereIn('status', ['queued', 'running'])
        .update({ status: 'failed', error_code: code, error: message, updated_at: db.fn.now() });
    }
  };
  const demo = await db('demos').where('demo_id', s.demo_id).first();
  if (!demo || demo.status !== 'ready') {
    await failRest('demo_missing', 'The demo is no longer available.');
    return finish({ status: 'failed', error_code: 'demo_missing', error: 'The demo is no longer available.', failed: items.length });
  }
  const t0 = Date.now();
  const demoFile = path.join(config.demoStorageDir, demo.storage_key);
  await fsp.mkdir(stateDir(), { recursive: true });
  let failed = 0;
  let completed = 0;
  let proc = null;
  const mode = config.captureSchedule;
  const work = new Map(); // capture_id -> { it, attempt, dir, need: Set(file), media: Map(file -> media), failed }
  try {
    // ---- 1. The whole plan, before CS2 opens (Phase 16) -------------------
    let plan = null;
    let steps = [];
    let inputsP = Promise.resolve({});
    let manifestFile = null;
    if (s.mode !== 'watch') {
      onStage('Planning the capture');
      const tp = Date.now();
      const prepared = await prepareItems(demo, items, demoFile, timings);
      for (const p of prepared) {
        // Media kept from an earlier attempt that failed part-way: only the
        // missing outputs are captured again.
        const partial = (p.it.timings && p.it.timings.partial) || null;
        const attempt = Math.max(p.it.attempt || 0, (partial && partial.attempt) || 0) + 1;
        const dir = captureDir(s.demo_id, p.it.capture_id, attempt);
        await fsp.rm(dir, { recursive: true, force: true });
        await fsp.mkdir(dir, { recursive: true });
        p.dir = dir;
        const w = { it: p.it, attempt, dir, need: new Set(), media: new Map(), failed: null, oldDirs: [] };
        if (partial && Array.isArray(partial.media)) {
          const from = captureDir(s.demo_id, p.it.capture_id, partial.attempt);
          for (const m of partial.media) {
            try {
              await linkInto(path.join(from, m.file), path.join(dir, m.file));
              w.media.set(path.join(dir, m.file), { ...m, attempt, ready: true });
              w.need.add(path.join(dir, m.file));
            } catch { /* missing: captured again */ }
          }
          if (partial.attempt !== p.it.attempt) w.oldDirs.push(from);
        }
        p.have = [...w.media.values()].map((m) => m.role);
        work.set(p.it.capture_id, w);
        await db('demo_captures').where('capture_id', p.it.capture_id).update({ status: 'running', attempts: db.raw('attempts + 1'), updated_at: db.fn.now() });
      }
      plan = capturePlan.planWindows(demo, prepared.map((p) => ({
        capture_id: p.it.capture_id, kind: p.it.kind, round_number: p.it.round_number, event_index: p.it.event_index, round: p.round, ev: p.ev, dir: p.dir, setup: p.setup, have: p.have,
      })));
      for (const w of [...plan.windows, ...plan.lineups]) work.get(w.capture_id).need.add(w.file);
      for (const w of plan.windows) for (const c of w.copies || []) work.get(c.capture_id).need.add(c.file);
      steps = capturePlan.schedule(plan, mode, scheduleOpts());
      timings.schedule = { mode, ...capturePlan.scheduleStats(steps), planned: capturePlan.estimate(steps) };
      timings.plan_s = (Date.now() - tp) / 1000;
      // The event → output mapping, published with the session (and each
      // capture's media names its event).
      manifestFile = path.join(captureDir(s.demo_id), `session-${s.session_id}-plan.json`);
      await fsp.writeFile(manifestFile, JSON.stringify(manifest(plan, steps)));
      // Recorded input over every throw clip runs while CS2 starts.
      const ranges = plan.windows.filter((w) => w.role === 'replay').map((w) => ({ key: w.file, name: w.player, start: w.start, end: w.end }));
      const ti = Date.now();
      inputsP = driver.inputs(demoFile, ranges).then((r) => { timings.inputs_parse = (Date.now() - ti) / 1000; return r; });
    }

    // ---- 2. CS2 ---------------------------------------------------------
    proc = driver.open(onStage);
    const opened = await proc.call({
      op: 'open', state_dir: stateDir(), size: config.captureSize, profile: s.mode === 'watch' ? null : config.captureProfile,
      short_forward: config.captureShortForward, timescale: config.captureTimescale, nav: config.captureNav,
    }, 10 * 60 * 1000);
    timings.open = opened.timings;
    if (!opened.ok) {
      await failRest(opened.code, opened.error);
      return await finish({ status: 'failed', error_code: opened.code, error: opened.error, failed: items.length });
    }
    if (s.mode === 'watch') {
      const round = await db('demo_rounds').where({ demo_id: s.demo_id, round_number: s.round_number }).first('start_tick');
      onStage(`Opening round ${s.round_number}`);
      const r = await proc.call({ op: 'watch', demo: demoFile, tick: round.start_tick });
      timings.watch = r.timings;
      if (!r.ok) return await finish({ status: 'failed', error_code: r.code, error: r.error });
      // The tool confirms both from CS2's log: the demo file it is playing
      // and the tick the seek finished on.
      if (r.demo !== demoFile || r.tick !== round.start_tick) return await finish({ status: 'failed', error_code: 'seek', error: 'CS2 did not open this demo at the round start.' });
      return await finish({ status: 'done', stage: `Round ${s.round_number} is open in CS2, paused at the round start.` });
    }
    if (config.captureTuning) await proc.call({ op: 'set', ...config.captureTuning });
    const loaded = await proc.call({ op: 'load', demo: demoFile });
    timings.load = loaded.timings;
    if (!loaded.ok) {
      await failRest(loaded.code, loaded.error);
      return await finish({ status: 'failed', error_code: loaded.code, error: loaded.error, failed: items.length });
    }
    const inputs = await inputsP;
    const fileOwner = new Map([...plan.windows, ...plan.lineups].map((w) => [w.file, w]));
    const sums = {};
    const addTimings = (t) => {
      for (const [k, v] of Object.entries(t || {})) {
        if (k === 'fallback_worst_distinct') sums[k] = Math.min(sums[k] ?? 1, v);
        else if (k === 'fallback_worst_lag') sums[k] = Math.max(sums[k] ?? 0, v);
        else sums[k] = Math.round(((sums[k] || 0) + v) * 1000) / 1000;
      }
    };
    const trace = traceLog(path.join(captureDir(s.demo_id), `session-${s.session_id}-trace.jsonl`));

    const failCapture = async (id, code, message) => {
      const w = work.get(id);
      if (!w || w.failed || w.done) return;
      w.failed = { code, message };
      failed += 1;
      // Outputs that did succeed are kept: a retry captures only the rest.
      const kept = [...w.media.values()].filter((m) => m.ready).map(({ ready, ...m }) => m);
      if (!kept.length) await fsp.rm(w.dir, { recursive: true, force: true });
      await db('demo_captures').where('capture_id', id).update({
        status: 'failed', error_code: code, error: message, updated_at: db.fn.now(),
        timings: JSON.stringify(kept.length ? { partial: { attempt: w.attempt, media: kept } } : {}),
      });
      await setSession(s.session_id, { failed });
    };
    for (const sk of plan.skipped) {
      await failCapture(sk.capture_id, sk.code, sk.code === 'event_missing' ? 'The event is no longer in this round.'
        : 'There is no player view to capture for this event (no known killer, victim or thrower).');
    }
    // A capture is ready once all its clips are encoded and its still saved.
    const finalize = async (id) => {
      const w = work.get(id);
      if (!w || w.failed || w.done || [...w.need].some((f) => !w.media.has(f) || !w.media.get(f).ready)) return;
      w.done = true;
      const order = ['killer_clip', 'victim_clip', 'replay', 'lineup'];
      const media = [...w.media.values()].map(({ ready, ...m }) => m).sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
      const old = w.it.attempt;
      await db('demo_captures').where('capture_id', id).update({
        status: 'ready', media: JSON.stringify(media), attempt: w.attempt, error: null, error_code: null,
        timings: JSON.stringify({ schedule: mode }), updated_at: db.fn.now(),
      });
      // The replaced media is removed only now that the new media exists.
      if (old) await fsp.rm(captureDir(s.demo_id, id, old), { recursive: true, force: true });
      else for (const m of w.it.media || []) await fsp.rm(path.join(captureDir(s.demo_id, id), m.file), { force: true });
      for (const d of w.oldDirs) await fsp.rm(d, { recursive: true, force: true });
      completed += 1;
      await setSession(s.session_id, { completed });
    };
    for (const id of work.keys()) await finalize(id); // everything kept from an earlier attempt
    const settleEncoded = async (reply) => {
      for (const f of reply.encoded || []) {
        const owner = fileOwner.get(f);
        const m = owner && work.get(owner.capture_id).media.get(f);
        if (!m) continue;
        m.ready = true;
        for (const c of owner.copies || []) {
          const cw = work.get(c.capture_id);
          const cm = cw && cw.media.get(c.file);
          if (!cm || cw.failed) continue;
          try { await linkInto(f, c.file); cm.ready = true; await finalize(c.capture_id); } catch { await failCapture(c.capture_id, 'encode', 'Saving the grouped clip failed.'); }
        }
        await finalize(owner.capture_id);
      }
      for (const f of reply.encode_failed || []) {
        const owner = fileOwner.get(f);
        if (!owner) continue;
        await failCapture(owner.capture_id, 'encode', 'Encoding the clip failed.');
        for (const c of owner.copies || []) await failCapture(c.capture_id, 'encode', 'Encoding the grouped clip failed.');
      }
    };
    const inputMedia = (file) => {
      const inp = inputs[file];
      return inp ? { inputs: { start: inp.start, bits: inp.bits, tickrate: demo.tickrate || 64, map: INPUT_BITS } } : {};
    };
    const lineupMedia = (l, still, attempt) => ({
      ...still, file: path.basename(l.file), attempt, role: 'lineup', type: 'image', mime: 'image/jpeg', release_tick: l.release_tick, event: l.events[0],
      ...(l.setup ? { setup: { technique: l.setup.technique, reliable: l.setup.reliable, reason: l.setup.reason, setup_start: l.setup.setup_start, still_tick: l.setup.still_tick, note: throwSetup.describe(l.setup) } } : {}),
      ready: true,
    });
    const lastEvent = (o) => Math.max(...(o.events || []).map((e) => e.event_tick ?? -Infinity), o.event_tick ?? -Infinity);
    let console_ = null;
    let pasteFailures = [];
    let stepWall = 0;
    const retry = [];
    const lastErrors = new Map();
    let inRetry = false;
    // A second failure of the same output is final (a lineup still can
    // always fall back to a separate still once).
    const pushRetry = (x, code) => {
      if (!inRetry || (x.op === 'lineup' && !x.fallback)) { retry.push({ ...x, fallback: x.op === 'lineup' }); return; }
      for (const o of x.op === 'segment' ? x.outputs : [x]) lastErrors.set(o.capture_id, { code, error: code === 'pov' ? 'CS2 showed another player during this clip.' : `Capture failed (${code}).` });
    };
    const outstanding = (o) => { const w = work.get(o.capture_id); return w && !w.failed && !w.done && !(w.media.get(o.file) || {}).ready; };

    const runStep = async (st, label, isRetry) => {
      const outputs = st.op === 'segment' ? st.outputs.filter(outstanding) : [];
      const stills = st.op === 'segment' ? (st.stills || []).filter(outstanding) : [];
      if (st.op === 'segment' && !outputs.length && !stills.length) return true;
      if (st.op === 'lineup' && !outstanding(st)) return true;
      onStage(`${st.op === 'segment' ? `Recording ${st.player}` : `Lineup still for ${st.player}`} (${label}, round ${st.round}) · ${completed} of ${work.size} captured`);
      const req = st.op === 'segment'
        ? {
          op: 'segment', tickrate: st.tickrate, player: st.player, xray: st.xray, start: st.start, end: st.end, fps: 30,
          // Kill-only segments can use the faster kill speed; anything with a
          // throw clip records at the session speed.
          ...(outputs.every((o) => o.role === 'killer_clip' || o.role === 'victim_clip') && config.captureKillTimescale !== config.captureTimescale
            ? { timescale: config.captureKillTimescale } : {}),
          outputs: outputs.map((o) => ({ file: o.file, start: o.start, end: o.end, event_tick: lastEvent(o) })),
          stills: stills.map((l) => ({ file: l.file, tick: l.tick })),
        }
        : { op: 'lineup', player: st.player, tick: st.tick, file: st.file, width: 0 };
      if (st.op === 'segment' && isRetry) {
        // Only the missing outputs, so the recording can be shorter.
        req.start = Math.min(...outputs.map((o) => o.start), ...stills.map((l) => l.tick - capturePlan.STILL_LEAD_TICKS));
        req.end = Math.max(...outputs.map((o) => o.end), ...stills.map((l) => l.tick + 1));
      }
      const reply = await proc.call(req);
      addTimings(reply.timings);
      stepWall += (reply.timings && reply.timings.wall) || 0;
      if (reply.console) console_ = reply.console;
      if (reply.paste_failures) pasteFailures = reply.paste_failures;
      await trace.add(reply.trace, { step: label, op: st.op, player: st.player, ok: reply.ok, code: reply.code });
      if (!reply.ok) return reply;
      if (st.op === 'segment') {
        for (const out of reply.outputs) {
          const w = fileOwner.get(out.file);
          if (out.error) {
            // The demo ended before this clip started: there is no footage to
            // retry for. (A clip the end cut short is kept, stopped on the
            // demo's last tick: out.stopped_at_demo_end.)
            for (const id of [w.capture_id, ...(w.copies || []).map((c) => c.capture_id)]) {
              lastErrors.set(id, { code: out.error, error: 'The demo ends before this clip starts.' });
            }
            continue;
          }
          // Footage is accepted only from the right POV up to its event, and
          // without the console in its first frame.
          if (out.console_in_frame) {
            sums.console_rejected_count = (sums.console_rejected_count || 0) + 1;
            pushRetry({ ...st, op: 'segment', outputs: [w], stills: [], why: 'console' }, 'console');
            continue;
          }
          if (out.pov_left_at != null && out.pov_left_at <= lastEvent(w)) {
            sums.pov_rejected_count = (sums.pov_rejected_count || 0) + 1;
            pushRetry({ ...st, op: 'segment', outputs: [w], stills: [], why: 'pov' }, 'pov');
            continue;
          }
          const base = {
            ...out, role: w.role, type: 'video', mime: 'video/webm', event: w.events[0],
            ...(w.role === 'replay' ? inputMedia(w.file) : {}), ...(w.group ? { group: w.group } : {}), ready: false,
          };
          work.get(w.capture_id).media.set(out.file, { ...base, file: path.basename(out.file), attempt: work.get(w.capture_id).attempt, event_tick: w.event_tick });
          for (const c of w.copies || []) {
            const cw = work.get(c.capture_id);
            if (cw && !cw.failed) cw.media.set(c.file, { ...base, file: path.basename(c.file), attempt: cw.attempt, event_tick: c.event_tick, event: w.events.find((e) => e.capture_id === c.capture_id) || null });
          }
        }
        for (const sv of reply.stills || []) {
          const l = fileOwner.get(sv.file);
          if (sv.error) {
            // Not usable from the recording: a separate verified still.
            sums.still_fallback_count = (sums.still_fallback_count || 0) + 1;
            pushRetry({ op: 'lineup', ...l, why: sv.error }, 'still');
            continue;
          }
          work.get(l.capture_id).media.set(l.file, lineupMedia(l, sv, work.get(l.capture_id).attempt));
          await finalize(l.capture_id);
        }
      } else {
        const l = fileOwner.get(st.file);
        work.get(st.capture_id).media.set(st.file, lineupMedia(l, reply.still, work.get(st.capture_id).attempt));
        await finalize(st.capture_id);
      }
      await settleEncoded(reply);
      return reply;
    };
    const fatal = async (reply) => {
      for (const [id] of work) await failCapture(id, reply.code, `Not captured: ${reply.error}`);
      return finish({ status: 'failed', error_code: reply.code, error: reply.error, failed, completed });
    };

    // ---- 3. The schedule, then one retry of whatever is missing ---------
    for (let i = 0; i < steps.length; i += 1) {
      const st = steps[i];
      const reply = await runStep(st, `step ${i + 1} of ${steps.length}`, false);
      if (reply === true || reply.ok) continue;
      if (FATAL.has(reply.code)) return await fatal(reply);
      retry.push({ ...st, why: reply.code, error: reply.error });
    }
    timings.retried_steps = retry.length;
    inRetry = true;
    for (let i = 0; i < retry.length; i += 1) {
      const st = retry[i];
      const reply = await runStep(st, `retry ${i + 1} of ${retry.length}`, true);
      if (reply === true || reply.ok) continue;
      if (FATAL.has(reply.code)) return await fatal(reply);
      const ids = st.op === 'segment' ? [...st.outputs, ...(st.stills || [])].map((o) => o.capture_id) : [st.capture_id];
      for (const id of ids) lastErrors.set(id, reply);
    }
    const flushed = await proc.call({ op: 'flush' });
    addTimings(flushed.timings);
    if (flushed.console) console_ = flushed.console;
    if (flushed.paste_failures) pasteFailures = flushed.paste_failures;
    await trace.add(flushed.trace, { step: 'flush', op: 'flush' });
    await settleEncoded(flushed);
    for (const [id, w] of work) {
      if (w.done || w.failed) continue;
      const r = lastErrors.get(id);
      await failCapture(id, r ? r.code || 'capture_failed' : 'incomplete', r ? r.error || 'Capture failed.' : 'Not all of this event\'s views were captured.');
    }
    timings.steps = sums;
    timings.steps_wall = Math.round(stepWall * 1000) / 1000;
    timings.console = console_;
    timings.paste_failures = pasteFailures;
    timings.transitions = flushed.transitions || null;
    timings.commands = trace.summary();
    return await finish({
      status: failed && !completed ? 'failed' : 'done', completed, failed,
      total: work.size,
      stage: failed ? `${completed} captured, ${failed} failed.` : `${completed} captured.`,
    });
  } catch (e) {
    await failRest('capture_failed', `Capture failed: ${e.message}`);
    return await finish({ status: 'failed', error_code: 'capture_failed', error: e.message, completed, failed: items.length - completed });
  } finally {
    // Closes the CS2 this session launched (also after a failure); a watch
    // session leaves it open.
    const closed = proc ? await proc.close() : null;
    timings.close = closed && closed.timings;
    timings.total = (Date.now() - t0) / 1000;
    // Time not spent in planning or CS2 steps (startup, load, recording
    // steps, close): waits between steps and database writes.
    const busy = (timings.plan_s || 0) + ((timings.open && timings.open.menu) || 0)
      + ((timings.load && timings.load.demo_load) || 0) + (timings.steps_wall || 0) + ((timings.steps && timings.steps.encode_wait) || 0) + ((timings.close && timings.close.close) || 0);
    timings.idle = Math.max(0, Math.round((timings.total - busy) * 1000) / 1000);
    await setSession(s.session_id, { timings: JSON.stringify(timings) }).catch(() => {});
  }
}

function kick() {
  // Tests drive the queue with runOnce() themselves.
  if (enabled && !config.isTest) setImmediate(() => runOnce().catch((e) => console.error('capture worker:', e.message)));
}

async function start() {
  if (!enabled) return;
  await fsp.mkdir(config.captureStorageDir, { recursive: true });
  // Work interrupted by a restart: those sessions fail (their CS2 is gone)
  // and their unfinished captures can be retried.
  const stuck = await db('capture_sessions').where('status', 'running').select('session_id');
  for (const { session_id: id } of stuck) {
    await setSession(id, { status: 'failed', error_code: 'interrupted', error: 'The server restarted during capture.', finished_at: db.fn.now() });
    await db('demo_captures').where('session_id', id).whereIn('status', ['queued', 'running'])
      .update({ status: 'failed', error_code: 'interrupted', error: 'The server restarted during capture.' });
  }
  timer = setInterval(() => runOnce().catch((e) => console.error('capture worker:', e.message)), 3000);
  timer.unref();
}

module.exports = {
  CAPTURE_VERSION, INPUT_BITS, SELECTIONS, status, list, request, queueBatch, requestBatch, cancelPending, onDemoReady, watchRound, retryFailed, currentSession, mediaFile, start,
  victimLastAliveTick, selectEvents, prepareItems,
  // Tests: swap the CS2 driver and enable the queue without a real game.
  _test: {
    setDriver(d) { driver = d ? { ...pythonDriver, ...d } : pythonDriver; lastCheck = { at: 0, checks: null }; },
    setEnabled(on) { enabled = on; lastCheck = { at: 0, checks: null }; },
    runOnce,
  },
};
