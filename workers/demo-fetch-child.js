// Child process that downloads a replay (usually .dem.bz2 from a Valve replay
// server), decompresses it and writes the .dem file, enforcing the size limit
// and checking the CS2 demo signature. Decompression is CPU heavy, so it runs
// outside the web process (see services/demoJobs.js).
const fs = require('fs');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const bunzip2 = require('unbzip2-stream');
const { checkMagic } = require('../services/demoParse');

process.once('message', async ({ url, file, maxBytes }) => {
  const fail = (code, message) => process.send({ ok: false, code, message }, () => process.exit(0));
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (res.status === 404 || res.status === 410) return fail('replay_unavailable', 'The replay file is no longer available on Valve\'s server (replays expire after a few weeks).');
    if (!res.ok || !res.body) return fail('download_failed', `Downloading the replay failed (HTTP ${res.status}).`);
    let first = null;
    let size = 0;
    // Sniff the first bytes: bzip2 ("BZh") is decompressed, a plain demo is kept.
    const source = Readable.fromWeb(res.body);
    const chunks = source[Symbol.asyncIterator]();
    const head = await chunks.next();
    if (head.done) return fail('download_failed', 'The replay download was empty.');
    first = Buffer.from(head.value);
    const rest = Readable.from((async function* gen() { yield first; for (;;) { const n = await chunks.next(); if (n.done) return; yield n.value; } })());
    const compressed = first.subarray(0, 3).toString('latin1') === 'BZh';
    let magic = Buffer.alloc(0);
    const limit = new Transform({
      transform(chunk, _enc, cb) {
        size += chunk.length;
        if (size > maxBytes) return cb(Object.assign(new Error(`The demo is larger than ${Math.round(maxBytes / 1048576)} MB.`), { code: 'demo_too_large' }));
        if (magic.length < 8) {
          magic = Buffer.concat([magic, Buffer.from(chunk)]).subarray(0, 8);
          if (magic.length === 8) {
            try { checkMagic(magic); } catch (err) { return cb(err); }
          }
        }
        return cb(null, chunk);
      },
    });
    await pipeline(rest, ...(compressed ? [bunzip2()] : []), limit, fs.createWriteStream(file, { flags: 'w' }));
    process.send({ ok: true, size }, () => process.exit(0));
  } catch (err) {
    fs.rmSync(file, { force: true });
    fail(err.code || 'download_failed', err.code ? err.message : `Downloading the replay failed (${err.message}).`);
  }
});
