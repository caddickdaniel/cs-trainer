// Reads per-tick movement before grenade releases (lineup still timing,
// services/throwSetup.js), in a child process so the native parse doesn't
// block the API.
// Message in: { file, throws: [{ key, name, tick, lookback }] }
// Message out: { ok, samples: { key: [{ tick, x, y, z, vx, vy, vz, buttons }] } } | { ok: false, error }
process.on('message', ({ file, throws }) => {
  try {
    const parser = require('@laihoe/demoparser2');
    const ticks = new Set();
    for (const t of throws) for (let k = t.tick - t.lookback; k <= t.tick; k += 1) if (k >= 0) ticks.add(k);
    const fields = ['X', 'Y', 'Z', 'velocity_X', 'velocity_Y', 'velocity_Z', 'usercmd_buttonstate_1', 'is_alive'];
    const rows = ticks.size ? parser.parseTicks(file, fields, [...ticks].sort((a, b) => a - b)) : [];
    const byKey = new Map(rows.map((r) => [`${r.name}\u0000${r.tick}`, r]));
    const out = {};
    for (const t of throws) {
      const list = [];
      for (let k = t.tick - t.lookback; k <= t.tick; k += 1) {
        const r = byKey.get(`${t.name}\u0000${k}`);
        if (!r || !r.is_alive) continue;
        list.push({
          tick: k, x: r.X, y: r.Y, z: r.Z, vx: r.velocity_X ?? 0, vy: r.velocity_Y ?? 0, vz: r.velocity_Z ?? 0,
          buttons: r.usercmd_buttonstate_1 != null ? Number(BigInt(r.usercmd_buttonstate_1) & 0xFFFFFFFFn) : 0,
        });
      }
      out[t.key] = list;
    }
    process.send({ ok: true, samples: out });
  } catch (err) {
    process.send({ ok: false, error: err.message || String(err) });
  }
});
