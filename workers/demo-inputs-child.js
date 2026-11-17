// Reads recorded player input (usercmd button state) for tick ranges of a
// demo, in a child process so the native parse doesn't block the API.
// Message in: { file, ranges: [{ key, name, start, end }] }
// Message out: { ok, ranges: { key: { start, bits: [int|null per tick] } } } | { ok: false, error }
process.on('message', ({ file, ranges }) => {
  try {
    const parser = require('@laihoe/demoparser2');
    const ticks = new Set();
    for (const r of ranges) for (let t = r.start; t <= r.end; t += 1) ticks.add(t);
    const rows = ticks.size ? parser.parseTicks(file, ['usercmd_buttonstate_1', 'is_alive'], [...ticks].sort((a, b) => a - b)) : [];
    const byKey = new Map(rows.map((r) => [`${r.name}\u0000${r.tick}`, r]));
    const out = {};
    for (const r of ranges) {
      const bits = [];
      for (let t = r.start; t <= r.end; t += 1) {
        const row = byKey.get(`${r.name}\u0000${t}`);
        const v = row && row.is_alive && row.usercmd_buttonstate_1 != null ? Number(BigInt(row.usercmd_buttonstate_1) & 0xFFFFFFFFn) : null;
        bits.push(v);
      }
      out[r.key] = { start: r.start, bits };
    }
    process.send({ ok: true, ranges: out });
  } catch (err) {
    process.send({ ok: false, error: err.message || String(err) });
  }
});
