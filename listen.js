const app = require('./app');
const config = require('./config/env');
const demoJobs = require('./services/demoJobs');

app.listen(config.port, () => console.log(`listening on ${config.port}`));

// Demo Review: parse uploaded demos in the background (child processes).
if (config.demoWorker) demoJobs.start();

// Replay Inspector: capture worker driving a local CS2 (CAPTURE_WORKER=on).
require('./services/captures').start().catch((e) => console.error('capture worker:', e.message));
