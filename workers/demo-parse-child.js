// Child process that parses one demo. Started by services/demoJobs.js so the
// native, synchronous parser never blocks the web server's event loop.
const { parseDemoFile } = require('../services/demoParse');

process.once('message', ({ file }) => {
  try {
    const result = parseDemoFile(file);
    process.send({ ok: true, result }, () => process.exit(0));
  } catch (err) {
    process.send({ ok: false, code: err.code || 'parse_failed', message: err.message || String(err) }, () => process.exit(0));
  }
});
