// Runs tools/cs2-asset-extraction/build_assets.py with its venv's Python,
// which lives in Scripts\python.exe on Windows and bin/python elsewhere.
//   npm run cs2:assets [-- --extract]
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const tool = path.join(__dirname, '..', 'tools', 'cs2-asset-extraction');
const python = process.platform === 'win32'
  ? path.join(tool, 'work', 'venv', 'Scripts', 'python.exe')
  : path.join(tool, 'work', 'venv', 'bin', 'python');

if (!fs.existsSync(python)) {
  console.error(`Missing ${python}. See the README ("Phase 9") to create the venv with CairoSVG and Pillow.`);
  process.exit(1);
}
const r = spawnSync(python, [path.join(tool, 'build_assets.py'), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status == null ? 1 : r.status);
