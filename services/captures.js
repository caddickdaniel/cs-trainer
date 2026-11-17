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

const UTILITY = ['smoke', 'flash', 'he', 'fire'];
const SELECTIONS = ['all', 'kill', 'utility'];
// Bump when capture output changes so old cached media isn't reused.
const CAPTURE_VERSION = 1;
const SCRIPT = path.join(__dirname, '..', 'tools', 'cs2-capture', 'capture.py');
const INPUTS_CHILD = path.join(__dirname, '..', 'workers', 'demo-inputs-child.js');
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
    const child = spawn('python3', ['-I', SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
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
  const child = spawn('python3', ['-I', SCRIPT, 'session'], { stdio: ['pipe', 'pipe', 'pipe'] });
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

const pythonDriver = {
  check: () => runPython(['status'], 15000),
  open: openPythonSession,
  inputs: readInputs,
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
  if (!c || c.error) return { ready: false, reason: `The capture tool could not run${c && c.error ? ` (${c.error})` : ''}.` };
  if (!c.cs2_installed || !c.runtime) return { ready: false, reason: 'CS2 (and the Steam Linux Runtime) must be installed on this machine to capture.' };
  if (!c.uinput) return { ready: false, reason: 'The capture tool needs access to /dev/uinput (Steam\'s input rules grant it) to control CS2.' };
  if (!c.encoder) return { ready: false, reason: 'GStreamer\'s VP8 encoder (vp8enc) is needed to encode clips.' };
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

// Two seconds centred on `tick`, clamped to the round.
function window2s(round, tick, tickrate) {
  const lo = round.start_tick ?? round.first_tick;
  const hi = round.end_tick ?? Number.MAX_SAFE_INTEGER;
  return { start: Math.max(lo, Math.round(tick - tickrate)), end: Math.min(hi, Math.round(tick + tickrate)) };
}

// The capture job for one event. Players are identified by their in-demo
// names; nothing here comes from the client.
function buildJob(demo, round, ev, kind, dir) {
  const players = (demo.meta && demo.meta.players) || [];
  const nameOf = (i) => (i == null ? null : (players.find((p) => p.index === i) || {}).name || null);
  const tickrate = demo.tickrate || 64;
  if (kind === 'kill') {
    const { start, end } = window2s(round, ev.tick, tickrate);
    const killer = ev.attacker != null && ev.attacker !== ev.victim ? nameOf(ev.attacker) : null;
    const victim = nameOf(ev.victim);
    const vt = victimLastAliveTick(round, ev.victim, ev.tick);
    const povs = {};
    if (killer) povs.killer = { player: killer, clip_file: path.join(dir, 'killer.webm'), still_file: path.join(dir, 'killer.jpg'), still_tick: ev.tick };
    if (victim) povs.victim = { player: victim, clip_file: path.join(dir, 'victim.webm'), ...(vt != null ? { still_file: path.join(dir, 'victim.jpg'), still_tick: vt } : {}) };
    if (!Object.keys(povs).length) return null;
    // Flash or smoke decided the kill: X-ray on (and labelled) so the players
    // can be seen at all; the plain view would only show white or grey.
    const xray = !!(ev.attacker_blind || ev.flash_assist || ev.through_smoke);
    return { op: 'kill', tickrate, start, end, xray, povs };
  }
  const thrower = nameOf(ev.player);
  if (!thrower) return null;
  const center = ev.throw_tick != null ? ev.throw_tick : ev.tick;
  const { start, end } = window2s(round, center, tickrate);
  return {
    op: 'utility', tickrate, start, end, player: thrower, clip_file: path.join(dir, 'replay.webm'),
    // Lineup: the thrower's view the tick before the grenade leaves the hand,
    // at the window's own resolution (lineup_width 0).
    ...(ev.throw_tick != null ? { lineup_file: path.join(dir, 'lineup.jpg'), lineup_tick: ev.throw_tick - 1, lineup_width: 0 } : {}),
  };
}

function mediaFromReply(job, reply, attempt, inputs) {
  const base = (m) => ({ ...m, file: path.basename(m.file), attempt });
  const out = [];
  if (job.op === 'kill') {
    for (const role of ['killer', 'victim']) {
      const p = reply.povs && reply.povs[role];
      if (!p) continue;
      if (p.clip) out.push({ ...base(p.clip), role: `${role}_clip`, type: 'video', mime: 'video/webm' });
      if (p.still) out.push({ ...base(p.still), role: `${role}_still`, type: 'image', mime: 'image/jpeg' });
    }
  } else {
    if (reply.clip) out.push({ ...base(reply.clip), role: 'replay', type: 'video', mime: 'video/webm', ...(inputs ? { inputs } : {}) });
    if (reply.lineup) out.push({ ...base(reply.lineup), role: 'lineup', type: 'image', mime: 'image/jpeg' });
  }
  return out;
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
  const proc = driver.open(onStage);
  let failed = 0;
  let completed = 0;
  try {
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
    const loaded = await proc.call({ op: 'load', demo: demoFile });
    timings.load = loaded.timings;
    if (!loaded.ok) {
      await failRest(loaded.code, loaded.error);
      return await finish({ status: 'failed', error_code: loaded.code, error: loaded.error, failed: items.length });
    }
    // Recorded input for every utility clip in this session, in one parse.
    const prepared = [];
    const roundsCache = new Map();
    for (const it of items) {
      if (!roundsCache.has(it.round_number)) roundsCache.set(it.round_number, await roundData(s.demo_id, it.round_number).catch(() => null));
      const round = roundsCache.get(it.round_number);
      prepared.push({ it, round, ev: round && round.events[it.event_index] });
    }
    const ranges = [];
    const players = (demo.meta && demo.meta.players) || [];
    for (const p of prepared) {
      if (p.it.kind !== 'utility' || !p.ev) continue;
      const name = (players.find((x) => x.index === p.ev.player) || {}).name;
      const w = window2s(p.round, p.ev.throw_tick ?? p.ev.tick, demo.tickrate || 64);
      if (name) ranges.push({ key: String(p.it.capture_id), name, start: w.start, end: w.end });
    }
    const ti = Date.now();
    const inputs = await driver.inputs(demoFile, ranges);
    timings.inputs_parse = (Date.now() - ti) / 1000;

    for (let i = 0; i < prepared.length; i += 1) {
      const { it, round, ev } = prepared[i];
      onStage(`Capturing ${it.kind === 'kill' ? 'kill' : 'utility'} ${i + 1} of ${prepared.length} (round ${it.round_number})`);
      const attempt = (it.attempt || 0) + 1;
      await db('demo_captures').where('capture_id', it.capture_id).update({ status: 'running', attempts: db.raw('attempts + 1'), updated_at: db.fn.now() });
      const fail = async (code, message) => {
        failed += 1;
        await db('demo_captures').where('capture_id', it.capture_id).update({ status: 'failed', error_code: code, error: message, updated_at: db.fn.now() });
        await setSession(s.session_id, { failed });
      };
      if (!ev) { await fail('event_missing', 'The event is no longer in this round.'); continue; }
      const dir = captureDir(s.demo_id, it.capture_id, attempt);
      await fsp.rm(dir, { recursive: true, force: true });
      await fsp.mkdir(dir, { recursive: true });
      const job = buildJob(demo, round, ev, it.kind, dir);
      if (!job) { await fail('nothing_to_capture', 'There is no player view to capture for this event (no known killer, victim or thrower).'); continue; }
      const te = Date.now();
      const reply = await proc.call(job);
      if (!reply.ok) {
        await fsp.rm(dir, { recursive: true, force: true });
        await fail(reply.code || 'capture_failed', reply.error || 'Capture failed.');
        if (FATAL.has(reply.code)) {
          await failRest(reply.code, `Not captured: ${reply.error}`, i + 1);
          failed += prepared.length - i - 1;
          return await finish({ status: 'failed', error_code: reply.code, error: reply.error, failed, completed });
        }
        continue;
      }
      const inp = inputs[String(it.capture_id)];
      const media = mediaFromReply(job, reply, attempt, inp ? { start: inp.start, bits: inp.bits, tickrate: demo.tickrate || 64, map: INPUT_BITS } : null);
      const old = it.attempt;
      await db('demo_captures').where('capture_id', it.capture_id).update({
        status: 'ready', media: JSON.stringify(media), attempt, error: null, error_code: null,
        timings: JSON.stringify({ ...reply.timings, total: (Date.now() - te) / 1000 }), updated_at: db.fn.now(),
      });
      // The replaced media is removed only now that the new media exists.
      if (old) await fsp.rm(captureDir(s.demo_id, it.capture_id, old), { recursive: true, force: true });
      else {
        for (const m of it.media || []) await fsp.rm(path.join(captureDir(s.demo_id, it.capture_id), m.file), { force: true });
      }
      completed += 1;
      await setSession(s.session_id, { completed });
    }
    return await finish({
      status: failed && !completed ? 'failed' : 'done', completed, failed,
      total: prepared.length,
      stage: failed ? `${completed} captured, ${failed} failed.` : `${completed} captured.`,
    });
  } catch (e) {
    await failRest('capture_failed', `Capture failed: ${e.message}`);
    return await finish({ status: 'failed', error_code: 'capture_failed', error: e.message, completed, failed: items.length - completed });
  } finally {
    // Closes the CS2 this session launched (also after a failure); a watch
    // session leaves it open.
    const closed = await proc.close();
    timings.close = closed && closed.timings;
    timings.total = (Date.now() - t0) / 1000;
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
  victimLastAliveTick, buildJob, selectEvents,
  // Tests: swap the CS2 driver and enable the queue without a real game.
  _test: {
    setDriver(d) { driver = d ? { ...pythonDriver, ...d } : pythonDriver; lastCheck = { at: 0, checks: null }; },
    setEnabled(on) { enabled = on; lastCheck = { at: 0, checks: null }; },
    runOnce,
  },
};
