// Turns a CS2 demo into replay data for the 2D viewer.
//
// parseDemoFile() uses LaihoE's demoparser2 (MIT, native module) and must run
// outside the web process (see services/demoJobs.js); it is synchronous and
// CPU heavy. buildReplay() is pure and is unit tested with synthetic input.
//
// Coordinates are converted to the existing radar images using the same
// position/scale values as CS Demo Manager (MIT), which produced the radars:
// px = (x - pos_x) / scale, py = (pos_y - y) / scale on a 1024px radar, then
// normalised to 0..1 like the tactics board. Multi-level maps put positions
// below a height threshold on the lower radar.
const C = require('../domain/constants');

// CS2 servers run at 64 ticks per second; demos record every tick.
const TICKRATE = 64;
// Positions are sampled every STEP ticks (8 per second) and interpolated by the viewer.
const STEP = 8;
const POST_ROUND_TICKS = 3 * TICKRATE;
const DEMO_MAGIC = 'PBDEMS2\0';
const CSGO_MAGIC = 'HL2DEMO\0';

class DemoError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const round4 = (n) => Math.round(n * 10000) / 10000;

function radarTransform(map) {
  const t = C.RADAR_TRANSFORMS[map];
  if (!t) return null;
  return (x, y, z) => ({
    x: round4((x - t.pos_x) / t.scale / C.RADAR_SIZE),
    y: round4((t.pos_y - y) / t.scale / C.RADAR_SIZE),
    level: t.lowerBelowZ != null && z < t.lowerBelowZ ? 'lower' : 'main',
  });
}

// Checks the first bytes of an upload.
function checkMagic(buf) {
  const head = buf.toString('latin1', 0, 8);
  if (head === DEMO_MAGIC) return;
  if (head === CSGO_MAGIC) throw new DemoError('csgo_demo', 'This is a CS:GO demo. Only Counter-Strike 2 demos (.dem) are supported.');
  throw new DemoError('not_a_demo', "This file isn't a Counter-Strike 2 demo (.dem).");
}

const sideOf = (teamNum) => (teamNum === 2 ? 'T' : teamNum === 3 ? 'CT' : null);

// Groups events into rounds. Restarted rounds (e.g. after a technical pause
// or a match restart) are replaced by their last occurrence.
function findRounds(events) {
  const byName = (n) => events.filter((e) => e.event_name === n).sort((a, b) => a.tick - b.tick);
  const ends = byName('round_end').filter((e) => e.winner === 'T' || e.winner === 'CT' || e.winner === 2 || e.winner === 3);
  const starts = byName('round_start').filter((e) => !e.is_warmup_period);
  const freezes = byName('round_freeze_end').filter((e) => !e.is_warmup_period);
  const rounds = [];
  let prevEnd = 0;
  for (const end of ends) {
    const start = [...starts].reverse().find((s) => s.tick > prevEnd && s.tick <= end.tick);
    const startTick = start ? start.tick : prevEnd;
    const freeze = freezes.find((f) => f.tick >= startTick && f.tick < end.tick);
    rounds.push({
      start_tick: startTick,
      freeze_end_tick: freeze ? freeze.tick : null,
      end_tick: end.tick,
      winner: typeof end.winner === 'number' ? sideOf(end.winner) : end.winner,
      reason: end.reason != null ? String(end.reason) : null,
      // Rounds played so far including this one, as recorded by the server.
      played: Number.isInteger(end.total_rounds_played) ? end.total_rounds_played : null,
    });
    prevEnd = end.tick;
  }
  // A round replayed after a backup restore or match restart replaces the
  // earlier attempt(s): drop kept rounds whose recorded number is not lower.
  const kept = [];
  for (const r of rounds) {
    while (kept.length && r.played != null && kept[kept.length - 1].played != null && kept[kept.length - 1].played >= r.played) kept.pop();
    kept.push(r);
  }
  return kept.map(({ played, ...r }, i, list) => ({
    ...r,
    round_number: i + 1,
    // Show a few seconds after the round ends, but never into the next round.
    end_tick: Math.min(r.end_tick + POST_ROUND_TICKS, list[i + 1] ? list[i + 1].start_tick - 1 : Infinity),
    result_tick: r.end_tick,
  }));
}

// Pure: builds the demo summary and per-round replay data.
// header: { map_name, server_name }, events: parseEvents output,
// ticks: parseTicks output rows ({ tick, steamid, name, X, Y, Z, yaw, is_alive, health, team_num }).
function buildReplay({ header, events, ticks }) {
  const map = header.map_name;
  const toRadar = radarTransform(map);
  if (!toRadar) {
    const supported = Object.keys(C.RADAR_TRANSFORMS).join(', ');
    throw new DemoError('unsupported_map', `${map || 'This map'} isn't supported for 2D replay yet. Supported maps: ${supported}.`);
  }
  const rounds = findRounds(events);
  if (!rounds.length) throw new DemoError('no_rounds', 'No completed rounds were found in this demo.');

  // Players across the whole demo, by Steam id (ids stay server-side).
  const players = new Map();
  for (const row of ticks) {
    if (!row.steamid || row.steamid === '0') continue;
    if (!players.has(row.steamid)) players.set(row.steamid, { index: players.size, name: row.name || `Player ${players.size + 1}` });
  }
  const playerIndex = (steamid) => (players.has(steamid) ? players.get(steamid).index : null);

  const byTick = new Map();
  for (const row of ticks) {
    if (!players.has(row.steamid)) continue;
    if (!byTick.has(row.tick)) byTick.set(row.tick, []);
    byTick.get(row.tick).push(row);
  }

  const roundData = rounds.map((r) => {
    const first = Math.ceil(r.start_tick / STEP) * STEP;
    const sampleTicks = [];
    for (let t = first; t <= r.end_tick; t += STEP) sampleTicks.push(t);
    // Who played this round, and on which side.
    const sides = new Map();
    for (const t of sampleTicks) {
      for (const row of byTick.get(t) || []) {
        const side = sideOf(row.team_num);
        if (side && !sides.has(row.steamid)) sides.set(row.steamid, side);
      }
    }
    const roster = [...sides.entries()].map(([steamid, side]) => ({ player: playerIndex(steamid), side }))
      .sort((a, b) => (a.side === b.side ? a.player - b.player : a.side === 'CT' ? -1 : 1));
    // Frames: for each roster player, flat arrays of x, y, level(0/1), yaw, hp (hp 0 = dead).
    const tracks = roster.map(() => ({ x: [], y: [], l: [], yaw: [], hp: [] }));
    const slot = new Map(roster.map((p, i) => [p.player, i]));
    let last = roster.map(() => null);
    for (const t of sampleTicks) {
      const seen = new Set();
      for (const row of byTick.get(t) || []) {
        const i = slot.get(playerIndex(row.steamid));
        if (i === undefined) continue;
        seen.add(i);
        const pos = toRadar(row.X, row.Y, row.Z);
        const hp = row.is_alive ? Math.max(1, Math.round(row.health || 0)) : 0;
        last[i] = { x: pos.x, y: pos.y, l: pos.level === 'lower' ? 1 : 0, yaw: Math.round(row.yaw || 0), hp };
      }
      tracks.forEach((track, i) => {
        const v = seen.has(i) ? last[i] : (last[i] ? { ...last[i], hp: 0 } : { x: 0, y: 0, l: 0, yaw: 0, hp: 0 });
        track.x.push(v.x); track.y.push(v.y); track.l.push(v.l); track.yaw.push(v.yaw); track.hp.push(v.hp);
      });
    }
    last = null;

    const inRound = (e) => e.tick >= r.start_tick && e.tick <= r.end_tick;
    const place = (e, prefix) => {
      const x = e[`${prefix}_X`];
      if (x == null) return {};
      const p = toRadar(x, e[`${prefix}_Y`], e[`${prefix}_Z`]);
      return { x: p.x, y: p.y, level: p.level };
    };
    const timeline = [];
    for (const e of events) {
      if (!inRound(e)) continue;
      if (e.event_name === 'player_death') {
        timeline.push({
          tick: e.tick, type: 'kill',
          attacker: e.attacker_steamid ? playerIndex(e.attacker_steamid) : null,
          victim: playerIndex(e.user_steamid),
          weapon: e.weapon || null, headshot: Boolean(e.headshot),
          ...place(e, 'user'),
        });
      } else if (e.event_name === 'bomb_planted') {
        timeline.push({ tick: e.tick, type: 'plant', player: playerIndex(e.user_steamid), ...place(e, 'user') });
      } else if (e.event_name === 'bomb_defused') {
        timeline.push({ tick: e.tick, type: 'defuse', player: playerIndex(e.user_steamid), ...place(e, 'user') });
      } else if (e.event_name === 'bomb_exploded') {
        timeline.push({ tick: e.tick, type: 'explode' });
      }
    }
    timeline.push({ tick: r.result_tick, type: 'round_end', winner: r.winner, reason: r.reason });
    timeline.sort((a, b) => a.tick - b.tick);

    return {
      round_number: r.round_number,
      start_tick: r.start_tick,
      freeze_end_tick: r.freeze_end_tick,
      end_tick: r.end_tick,
      winner: r.winner,
      reason: r.reason,
      data: {
        round_number: r.round_number,
        tickrate: TICKRATE,
        step: STEP,
        first_tick: first,
        start_tick: r.start_tick,
        freeze_end_tick: r.freeze_end_tick,
        end_tick: r.end_tick,
        roster,
        tracks,
        events: timeline,
      },
    };
  });

  // Running score per team (teams swap sides at half time): a player's team is
  // the side they first played on; each round's CT team is the majority team
  // of that round's CT players. ct_score/t_score are the scores of the teams
  // on CT and T in that round, after it.
  const teamOf = new Map();
  for (const r of roundData) {
    for (const p of r.data.roster) if (!teamOf.has(p.player)) teamOf.set(p.player, p.side === 'CT' ? 'A' : 'B');
  }
  const score = { A: 0, B: 0 };
  for (const r of roundData) {
    const ctVotes = r.data.roster.filter((p) => p.side === 'CT').map((p) => teamOf.get(p.player));
    const ctTeam = ctVotes.filter((x) => x === 'A').length >= ctVotes.filter((x) => x === 'B').length ? 'A' : 'B';
    const tTeam = ctTeam === 'A' ? 'B' : 'A';
    if (r.winner === 'CT') score[ctTeam] += 1;
    if (r.winner === 'T') score[tTeam] += 1;
    r.ct_score = score[ctTeam];
    r.t_score = score[tTeam];
    r.data.ct_score = r.ct_score;
    r.data.t_score = r.t_score;
  }

  return {
    map,
    tickrate: TICKRATE,
    meta: {
      server_name: header.server_name || null,
      patch_version: header.patch_version || null,
      players: [...players.values()].map((p) => ({ index: p.index, name: p.name })),
      parser: 'demoparser2',
    },
    rounds: roundData,
  };
}

const EVENT_NAMES = ['round_start', 'round_freeze_end', 'round_end', 'player_death', 'bomb_planted', 'bomb_defused', 'bomb_exploded'];

// Native parse of one file (runs in the worker process).
function parseDemoFile(file) {
  let parser;
  try {
    parser = require('@laihoe/demoparser2');
  } catch (err) {
    throw new DemoError('parser_unavailable', `The demo parser isn't available on this server (${process.platform}-${process.arch}): ${err.message}`);
  }
  let header;
  try {
    header = parser.parseHeader(file);
  } catch (err) {
    throw new DemoError('corrupt_demo', `This demo couldn't be read (${err.message || err}).`);
  }
  const events = parser.parseEvents(file, EVENT_NAMES, ['X', 'Y', 'Z'], ['is_warmup_period', 'total_rounds_played']);
  const rounds = findRounds(events);
  const wanted = [];
  for (const r of rounds) {
    for (let tk = Math.ceil(r.start_tick / STEP) * STEP; tk <= r.end_tick; tk += STEP) wanted.push(tk);
  }
  const ticks = wanted.length
    ? parser.parseTicks(file, ['X', 'Y', 'Z', 'yaw', 'is_alive', 'health', 'team_num'], wanted)
    : [];
  return buildReplay({ header, events, ticks });
}

module.exports = { buildReplay, findRounds, parseDemoFile, radarTransform, checkMagic, DemoError, TICKRATE, STEP };
