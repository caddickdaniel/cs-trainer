// Local development only: runs one real capture session (CS2 on this PC)
// through the capture worker and writes a report, for comparing schedules
// on the same requested outputs (Phase 16 benchmarks).
//
//   CAPTURE_STORAGE_DIR=... CAPTURE_SCHEDULE=match_player \
//   node scripts/bench-capture-session.js <demo_id> <user_id> <selection> <round|all> <report.json>
//
// The session is queued like a website batch (same selection rules), run
// by the worker in this process, and reported with its timings, every
// capture's status and media, and launch → all-media-ready wall-clock time.
// Kept-output state from earlier runs is cleared first so every run
// captures the same outputs.
const fs = require('fs');
const db = require('../db/connection');
const config = require('../config/env');
const captures = require('../services/captures');

async function main() {
  if (config.isProduction) throw new Error('Local development only.');
  const [demoId, userId, selection, round, out] = process.argv.slice(2);
  const roundNumber = round === 'all' ? null : Number(round);
  await db('demo_captures').where('demo_id', Number(demoId)).update({ timings: JSON.stringify({}) });
  // Queued with the worker off (no automatic start), then run here.
  captures._test.setEnabled(false);
  const t0 = Date.now();
  const s = await captures.queueBatch(Number(demoId), Number(userId), selection, { round: roundNumber });
  captures._test.setEnabled(true);
  await captures._test.runOnce();
  const wall = (Date.now() - t0) / 1000;
  const session = await db('capture_sessions').where('session_id', s.session_id).first();
  const rows = await db('demo_captures').where('session_id', s.session_id).orderBy('moment_tick');
  const report = {
    session_id: s.session_id, demo_id: Number(demoId), schedule: config.captureSchedule, kill_timescale: config.captureKillTimescale, storage: config.captureStorageDir,
    selection, round: roundNumber, wall_s: wall,
    ready_s: (new Date(session.finished_at) - new Date(session.started_at)) / 1000,
    status: session.status, total: rows.length, ready: rows.filter((r) => r.status === 'ready').length,
    failed: rows.filter((r) => r.status !== 'ready').map((r) => ({ capture_id: r.capture_id, round: r.round_number, event_index: r.event_index, kind: r.kind, code: r.error_code, error: r.error })),
    timings: session.timings,
    captures: rows.map((r) => ({ capture_id: r.capture_id, round: r.round_number, event_index: r.event_index, kind: r.kind, status: r.status, attempt: r.attempt, media: r.media })),
  };
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ wall_s: wall, ready_s: report.ready_s, status: report.status, ready: report.ready, total: report.total }));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.stack); process.exit(1); });
