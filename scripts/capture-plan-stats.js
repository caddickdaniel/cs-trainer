// Local development: builds the full capture plan for a demo without CS2 and
// compares the batch schedules on the same requested outputs
// (`node scripts/capture-plan-stats.js <demo_id> [selection] [round]`).
// Prints, per schedule: segments, stills taken from recordings, POV
// switches, seeks and the planned time from capturePlan.COSTS.
const path = require('path');
const db = require('../db/connection');
const config = require('../config/env');
const captures = require('../services/captures');
const P = require('../services/capturePlan');

async function main() {
  const [demoId, selection = 'all', round] = process.argv.slice(2);
  const demo = await db('demos').where('demo_id', Number(demoId)).first();
  if (!demo) throw new Error('No such demo');
  const events = await captures.selectEvents(demo.demo_id, selection, { round: round ? Number(round) : null });
  const items = events.map((e, i) => ({ ...e, capture_id: i + 1 }));
  const timings = {};
  const prepared = await captures.prepareItems(demo, items, path.join(config.demoStorageDir, demo.storage_key), timings);
  const plan = P.planWindows(demo, prepared.map((p) => ({
    capture_id: p.it.capture_id, kind: p.it.kind, round_number: p.it.round_number, event_index: p.it.event_index, round: p.round, ev: p.ev, dir: `/c${p.it.capture_id}`, setup: p.setup,
  })));
  const opts = { timescale: config.captureTimescale, killTimescale: config.captureKillTimescale };
  const out = { demo_id: demo.demo_id, events: events.length, kills: events.filter((e) => e.kind === 'kill').length, windows: plan.windows.length, lineups: plan.lineups.length, setup_parse_s: timings.setup_parse, schedules: {} };
  for (const mode of ['hybrid', 'match_player', 'round_player']) {
    const steps = P.schedule(plan, mode, opts);
    out.schedules[mode] = { ...P.scheduleStats(steps), planned: P.estimate(steps) };
  }
  console.log(JSON.stringify(out, null, 1));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
