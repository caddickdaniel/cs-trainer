// Runs the API (nodemon) and the Vite dev server together.
const { spawn } = require('child_process');

const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';
// Node >= 20.12 refuses to spawn .cmd files without a shell on Windows (EINVAL).
const shell = isWindows;
// The API always listens on API_PORT (default 9090) and Vite proxies /api to
// it, so a PORT variable meant for the dev server cannot make them collide.
const apiPort = process.env.API_PORT || '9090';
const env = { ...process.env, API_PORT: apiPort };
delete env.PORT;
const children = [
  spawn(npm, ['run', 'dev:server'], { stdio: 'inherit', env: { ...env, PORT: apiPort }, cwd: __dirname + '/..', shell }),
  spawn(npm, ['run', 'dev:client'], { stdio: 'inherit', env, cwd: __dirname + '/..', shell }),
];

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
