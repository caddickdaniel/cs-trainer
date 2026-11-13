// Re-parses ready demos so they get the current replay data (recorded
// utility, plants and defusals) and Player Stats, without deleting them.
// Round data is replaced in place; annotations and reviews are kept.
//
//   npm run demos:reprocess            all demos older than the current version
//   npm run demos:reprocess -- --all   every ready demo
//   npm run demos:reprocess -- 4 7     only these demo ids
//
// The web server's demo worker does the same in the background, one demo at
// a time; this script is for doing it now.
const db = require('../db/connection');
const { upgradeDemo } = require('../services/demoJobs');
const { REPLAY_VERSION, STATS_VERSION } = require('../services/demoParse');

async function main() {
  const args = process.argv.slice(2);
  const ids = args.filter((a) => /^\d+$/.test(a)).map(Number);
  let q = db('demos').where('status', 'ready').orderBy('demo_id');
  if (ids.length) q = q.whereIn('demo_id', ids);
  else if (!args.includes('--all')) q = q.where((w) => w.where('replay_version', '<', REPLAY_VERSION).orWhere('stats_version', '<', STATS_VERSION));
  const demos = await q;
  if (!demos.length) console.log('Nothing to reprocess: every ready demo is up to date.');
  for (const d of demos) {
    // --all / explicit ids: force a refresh of the replay data.
    const target = ids.length || args.includes('--all') ? { ...d, replay_version: 0 } : d;
    const started = Date.now();
    const res = await upgradeDemo(target);
    const annotations = (await db('demo_annotations').where('demo_id', d.demo_id).count({ n: '*' }).first()).n;
    console.log(`demo ${d.demo_id} (${d.title}): ${res.status}${res.replay === false ? ' (rounds differ; old replay kept)' : ''}`
      + `${res.message ? ` - ${res.message}` : ''} in ${((Date.now() - started) / 1000).toFixed(1)} s; ${annotations} annotation(s) kept`);
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => db.destroy());
