const app = require('./app');
const config = require('./config/env');
const demoJobs = require('./services/demoJobs');

app.listen(config.port, () => console.log(`listening on ${config.port}`));

// Demo Review: parse uploaded demos in the background (child processes).
if (config.demoWorker) demoJobs.start();
