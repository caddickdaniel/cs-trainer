// Runs the API (nodemon) and the Vite dev server together.
const { spawn } = require('child_process');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = ['dev:server', 'dev:client'].map((script) =>
  spawn(npm, ['run', script], { stdio: 'inherit', env: process.env })
);

const stop = () => children.forEach((child) => child.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((child) =>
  child.on('exit', (code) => {
    if (code) {
      stop();
      process.exitCode = code;
    }
  })
);
