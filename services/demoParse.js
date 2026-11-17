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
// Fallback effect lengths when the demo has no matching expiry event (for
// example the round ended first). CS2: smoke ~22 s, molotov/incendiary ~7 s.
const SMOKE_TICKS = 22 * TICKRATE;
const FIRE_TICKS = 7 * TICKRATE;
// Version of the replay data written to demo_rounds. Ready demos with an older
// version are re-parsed in the background (see demoJobs.backfillNext) and
// their round data is replaced in place, so annotations are kept.
// 1: positions, kills, plants/defusals. 2: recorded utility (smoke, flash,
// HE, molotov/incendiary) with effect durations, and the explosion position.
// 3: grenade flights (throw tick, thrower position, projectile trail).
// 4: HUD and scoreboard data (equipment and money changes, stat deltas and
// totals before the round, flashes, team names, score before the round).
// 5: kill feed details (assister, flash assist, wallbang, no-scope, through
// smoke, blind, in air, raw weapon id), recorded bomb damage, best weapon and
// in-game score per player, and the radar scale (game units per radar width).
const REPLAY_VERSION = 5;
// Player properties sampled for the HUD and scoreboard (version 4).
const HUD_PROPS = ['balance', 'armor_value', 'has_helmet', 'has_defuser', 'active_weapon_name', 'inventory', 'flash_duration', 'team_clan_name', 'score'];
// The team counter shows each player's best weapon: primary, else pistol.
const PRIMARY_NAMES = new Set(['AK-47', 'M4A4', 'M4A1-S', 'FAMAS', 'Galil AR', 'AUG', 'SG 553', 'AWP', 'SSG 08', 'SCAR-20', 'G3SG1', 'MAC-10', 'MP9', 'MP7',
  'MP5-SD', 'UMP-45', 'P90', 'PP-Bizon', 'Nova', 'XM1014', 'MAG-7', 'Sawed-Off', 'M249', 'Negev']);
const PISTOL_NAMES = new Set(['Glock-18', 'USP-S', 'P2000', 'P250', 'Five-SeveN', 'Tec-9', 'CZ75-Auto', 'Desert Eagle', 'R8 Revolver', 'Dual Berettas']);
// Inventory names (as demoparser2 reports them) for carried utility and the bomb.
const INVENTORY_CODE = {
  'Smoke Grenade': 'smoke', Flashbang: 'flash', 'High Explosive Grenade': 'he', Molotov: 'molly', 'Incendiary Grenade': 'inc', 'Decoy Grenade': 'decoy', 'C4 Explosive': 'c4',
};
const UTILITY_ORDER = ['he', 'flash', 'smoke', 'molly', 'inc', 'decoy'];
// Flash detection: flash_duration is compared just before and just after each
// flashbang detonation (the value is set within a tick of the blast and then
// left in place, so a later sample alone can't tell a new flash from an old one).
const FLASH_BEFORE = 1;
const FLASH_AFTER = 2;
// Projectile trail samples are kept every TRAIL_STEP ticks (16 per second),
// plus the exact detonation point.
const TRAIL_STEP = 4;
const PROJECTILE_TYPE = {
  CSmokeGrenadeProjectile: 'smoke', CFlashbangProjectile: 'flash', CHEGrenadeProjectile: 'he', CMolotovProjectile: 'fire',
};
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

// Groups parseGrenades(..., grenades=false) rows (one per projectile per
// tick) into flights. Entity ids are reused during a match, so a gap in ticks
// starts a new flight. Each flight keeps every sample until the projectile
// entity is removed (smokes and HEs outlive their detonation).
function groupFlights(rows) {
  const sorted = rows.filter((r) => PROJECTILE_TYPE[r.grenade_type] && r.x != null)
    .sort((a, b) => a.grenade_entity_id - b.grenade_entity_id || a.tick - b.tick);
  const flights = [];
  let cur = null;
  for (const r of sorted) {
    const type = PROJECTILE_TYPE[r.grenade_type];
    if (!cur || cur.entity !== r.grenade_entity_id || cur.type !== type || r.tick - cur.ticks[cur.ticks.length - 1] > 2) {
      cur = { entity: r.grenade_entity_id, type, steamid: r.steamid || null, ticks: [], x: [], y: [], z: [] };
      flights.push(cur);
    }
    cur.ticks.push(r.tick); cur.x.push(r.x); cur.y.push(r.y); cur.z.push(r.z);
  }
  return flights.sort((a, b) => a.ticks[0] - b.ticks[0]);
}

const inRoundTick = (r, tick) => tick >= r.start_tick && tick <= r.end_tick;

function equipmentOf(row) {
  const inv = Array.isArray(row.inventory) ? row.inventory : null;
  const codes = inv ? inv.map((n) => INVENTORY_CODE[n]).filter(Boolean) : [];
  const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v)));
  const bool = (v) => (v == null ? null : v ? 1 : 0);
  return {
    money: num(row.balance),
    armor: num(row.armor_value),
    helmet: bool(row.has_helmet),
    kit: bool(row.has_defuser),
    weapon: row.active_weapon_name ? String(row.active_weapon_name).slice(0, 40) : null,
    utility: inv ? UTILITY_ORDER.filter((u) => codes.includes(u)) : null,
    bomb: inv ? (codes.includes('c4') ? 1 : 0) : null,
    best: inv ? (inv.find((n) => PRIMARY_NAMES.has(n)) ?? inv.find((n) => PISTOL_NAMES.has(n)) ?? null) : null,
    score: num(row.score),
  };
}
const sameEquipment = (a, b) => a.money === b.money && a.armor === b.armor && a.helmet === b.helmet && a.kit === b.kit && a.weapon === b.weapon
  && a.bomb === b.bomb && String(a.utility) === String(b.utility) && a.best === b.best && a.score === b.score;

const EMPTY_TOTALS = Object.freeze({ kills: 0, deaths: 0, assists: 0, headshots: 0, damage: 0 });
// Scoreboard changes from one round's events, in tick order: kills (enemies
// only), headshot kills, deaths (all), assists (not flash-only, enemies only)
// and damage (health removed from enemies, capped at the victim's remaining
// health). Shared by the replay scoreboard and the match stats.
function statDeltas(inRound, idx, teamOf) {
  const out = [];
  const hp = new Map();
  const add = (tick, player, stat, n) => { if (player != null && n) out.push({ tick, player, stat, n }); };
  for (const e of inRound) {
    if (e.event_name === 'player_hurt') {
      const victim = idx(e.user_steamid);
      const attacker = idx(e.attacker_steamid);
      if (victim == null) continue;
      const before = hp.has(victim) ? hp.get(victim) : 100;
      const after = Math.max(0, Number(e.health) || 0);
      const dealt = Math.max(0, Math.min(Number(e.dmg_health) || 0, before - after > 0 ? before - after : before));
      hp.set(victim, after);
      if (attacker != null && attacker !== victim && teamOf.get(attacker) !== teamOf.get(victim)) add(e.tick, attacker, 'damage', dealt);
    } else if (e.event_name === 'player_death') {
      const victim = idx(e.user_steamid);
      const attacker = idx(e.attacker_steamid);
      if (victim != null) add(e.tick, victim, 'deaths', 1);
      if (attacker != null && victim != null && attacker !== victim && teamOf.get(attacker) !== teamOf.get(victim)) {
        add(e.tick, attacker, 'kills', 1);
        if (e.headshot) add(e.tick, attacker, 'headshots', 1);
      }
      const assister = idx(e.assister_steamid);
      if (assister != null && !e.assistedflash && victim != null && teamOf.get(assister) !== teamOf.get(victim)) add(e.tick, assister, 'assists', 1);
    }
  }
  return out;
}

// Pure: builds the demo summary and per-round replay data.
// header: { map_name, server_name }, events: parseEvents output,
// ticks: parseTicks output rows ({ tick, steamid, name, X, Y, Z, yaw, is_alive, health, team_num }).
// flights (optional): groupFlights output; without it grenades have no trail.
function buildReplay({ header, events, ticks, flights = [] }) {
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

    // Equipment and money (version 4): one entry per player whenever something
    // changes, sampled with the positions. Fields the demo doesn't carry stay null.
    const state = roster.map(() => []);
    for (const t of sampleTicks) {
      for (const row of byTick.get(t) || []) {
        const i = slot.get(playerIndex(row.steamid));
        if (i === undefined) continue;
        const v = equipmentOf(row);
        const prev = state[i][state[i].length - 1];
        if (!prev || !sameEquipment(prev, v)) state[i].push({ t, ...v });
      }
    }
    // Flashes: players whose flash_duration was set by a flashbang detonation.
    const flashes = [];
    for (const e of events) {
      if (e.event_name !== 'flashbang_detonate' || !inRoundTick(r, e.tick)) continue;
      const before = new Map((byTick.get(e.tick - FLASH_BEFORE) || []).map((x) => [x.steamid, Number(x.flash_duration) || 0]));
      for (const row of byTick.get(e.tick + FLASH_AFTER) || []) {
        const dur = Number(row.flash_duration);
        const i = slot.get(playerIndex(row.steamid));
        if (i === undefined || !(dur > 0) || !before.has(row.steamid) || Math.abs(dur - before.get(row.steamid)) < 1e-4) continue;
        flashes.push({ tick: e.tick, player: playerIndex(row.steamid), by: playerIndex(e.user_steamid), duration: Math.round(dur * TICKRATE) });
      }
    }
    // Team names (clan tags as the server knows them), by side for this round.
    const teams = {};
    for (const side of ['CT', 'T']) {
      const names = new Map();
      for (const t of sampleTicks.slice(0, 16)) {
        for (const row of byTick.get(t) || []) {
          if (sideOf(row.team_num) === side && row.team_clan_name) names.set(row.team_clan_name, (names.get(row.team_clan_name) || 0) + 1);
        }
      }
      const best = [...names.entries()].sort((a, b) => b[1] - a[1])[0];
      teams[side] = best ? String(best[0]).slice(0, 40) : null;
    }

    const inRound = (e) => e.tick >= r.start_tick && e.tick <= r.end_tick;
    const place = (e, prefix) => {
      const x = e[`${prefix}_X`];
      if (x == null) return {};
      const p = toRadar(x, e[`${prefix}_Y`], e[`${prefix}_Z`]);
      return { x: p.x, y: p.y, level: p.level };
    };
    // Grenade events carry the grenade's own position (x/y/z) and the
    // thrower (user_*); a smoke or fire is linked to its expiry by entityid.
    const grenadeAt = (e) => {
      if (e.x == null) return {};
      const p = toRadar(e.x, e.y, e.z);
      return { x: p.x, y: p.y, level: p.level };
    };
    const sideIn = new Map(roster.map((p) => [p.player, p.side]));
    // Grenade flights: smokes, flashes and HEs detonate as the same entity;
    // a fire starts as a new (inferno) entity, so it is matched to the
    // thrower's molotov whose flight ends as the fire starts.
    const roundFlights = flights.filter((f) => f.ticks[0] <= r.end_tick && f.ticks[f.ticks.length - 1] >= r.start_tick);
    const used = new Set();
    const flightFor = (type, e) => {
      const cands = roundFlights.filter((f) => !used.has(f) && f.type === type && f.ticks[0] <= e.tick + 2 && (type === 'fire'
        ? f.steamid === e.user_steamid && Math.abs(f.ticks[f.ticks.length - 1] - e.tick) <= 8
        : f.entity === e.entityid && e.tick <= f.ticks[f.ticks.length - 1] + 2));
      const f = cands.sort((a, b) => b.ticks[0] - a.ticks[0])[0];
      if (f) used.add(f);
      return f || null;
    };
    const sampleAt = (steamid, tick) => {
      // The thrower's sampled position at (or just before) the throw.
      for (let t = Math.floor(tick / STEP) * STEP; t >= tick - STEP * 2; t -= STEP) {
        const row = (byTick.get(t) || []).find((x) => x.steamid === steamid);
        if (row) return toRadar(row.X, row.Y, row.Z);
      }
      return null;
    };
    const flightData = (type, e) => {
      const f = flightFor(type, e);
      if (!f) return {};
      const trail = { t: [], x: [], y: [], l: [] };
      const add = (tick, x, y, z) => {
        const p = toRadar(x, y, z);
        trail.t.push(tick); trail.x.push(p.x); trail.y.push(p.y); trail.l.push(p.level === 'lower' ? 1 : 0);
      };
      const throwTick = f.ticks[0];
      for (let i = 0; i < f.ticks.length && f.ticks[i] < e.tick; i += 1) {
        if ((f.ticks[i] - throwTick) % TRAIL_STEP === 0) add(f.ticks[i], f.x[i], f.y[i], f.z[i]);
      }
      if (e.x != null) add(e.tick, e.x, e.y, e.z);
      const from = sampleAt(f.steamid, throwTick);
      return { throw_tick: throwTick, ...(from ? { from } : {}), trail };
    };
    const expiry = (name, e, fallback) => {
      const end = events.find((x) => x.event_name === name && x.entityid === e.entityid && x.tick >= e.tick);
      return Math.min(end ? end.tick : e.tick + fallback, r.end_tick);
    };
    let plantAt = null;
    const timeline = [];
    for (const e of events) {
      if (!inRound(e)) continue;
      if (e.event_name === 'smokegrenade_detonate') {
        timeline.push({ tick: e.tick, type: 'smoke', end_tick: expiry('smokegrenade_expired', e, SMOKE_TICKS), player: playerIndex(e.user_steamid), ...grenadeAt(e), ...flightData('smoke', e) });
        continue;
      }
      if (e.event_name === 'flashbang_detonate' || e.event_name === 'hegrenade_detonate') {
        const type = e.event_name === 'flashbang_detonate' ? 'flash' : 'he';
        timeline.push({ tick: e.tick, type, player: playerIndex(e.user_steamid), ...grenadeAt(e), ...flightData(type, e) });
        continue;
      }
      if (e.event_name === 'inferno_startburn') {
        const player = playerIndex(e.user_steamid);
        // CS2 only says "inferno": T sides throw molotovs, CT sides incendiaries.
        const variant = sideIn.get(player) === 'CT' ? 'incendiary' : 'molotov';
        timeline.push({ tick: e.tick, type: 'fire', variant, end_tick: expiry('inferno_expire', e, FIRE_TICKS), player, ...grenadeAt(e), ...flightData('fire', e) });
        continue;
      }
      if (e.event_name === 'player_death') {
        const assister = e.assister_steamid ? playerIndex(e.assister_steamid) : null;
        // Kill feed flags exactly as the event records them; absent ones are left out.
        const flags = {};
        for (const [from, to] of [['penetrated', 'penetrated'], ['noscope', 'noscope'], ['thrusmoke', 'through_smoke'], ['attackerblind', 'attacker_blind'], ['attackerinair', 'in_air']]) {
          if (e[from] != null) flags[to] = Number(e[from]) > 0 || e[from] === true;
        }
        timeline.push({
          tick: e.tick, type: 'kill',
          attacker: e.attacker_steamid ? playerIndex(e.attacker_steamid) : null,
          victim: playerIndex(e.user_steamid),
          weapon: e.weapon || null, headshot: Boolean(e.headshot),
          ...(assister != null ? { assister, flash_assist: Boolean(e.assistedflash) } : {}),
          ...flags,
          ...place(e, 'user'),
        });
      } else if (e.event_name === 'bomb_planted') {
        plantAt = place(e, 'user');
        timeline.push({ tick: e.tick, type: 'plant', player: playerIndex(e.user_steamid), ...plantAt });
      } else if (e.event_name === 'bomb_defused') {
        timeline.push({ tick: e.tick, type: 'defuse', player: playerIndex(e.user_steamid), ...place(e, 'user') });
      } else if (e.event_name === 'bomb_exploded') {
        // The event's "user" is just a player's current position, so the
        // explosion is placed where the bomb was planted (timeline only if
        // the plant is not in this round's data).
        timeline.push({ tick: e.tick, type: 'explode', ...(plantAt || {}) });
      }
    }
    timeline.push({ tick: r.result_tick, type: 'round_end', winner: r.winner, reason: r.reason });
    // Damage the bomb actually did (player_hurt with weapon planted_c4).
    const bombDamage = events.filter((e) => inRound(e) && e.event_name === 'player_hurt' && e.weapon === 'planted_c4' && playerIndex(e.user_steamid) != null)
      .map((e) => ({ tick: e.tick, player: playerIndex(e.user_steamid), damage: Math.max(0, Number(e.dmg_health) || 0), armor: Math.max(0, Number(e.dmg_armor) || 0), health: Math.max(0, Number(e.health) || 0) }))
      .sort((a, b) => a.tick - b.tick);
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
        state,
        flashes,
        teams,
        bomb_damage: bombDamage,
        // Game units across the full radar width, for distances on the board.
        units_per_radar: C.RADAR_TRANSFORMS[map].scale * C.RADAR_SIZE,
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
  // Scoreboard totals: each round carries every roster player's totals before
  // it and the changes during it (same definitions as the match stats below).
  const totals = new Map();
  const idxOf = (steamid) => playerIndex(steamid);
  roundData.forEach((r, ri) => {
    const round = rounds[ri];
    const inRound = events.filter((e) => e.tick >= round.start_tick && e.tick <= round.end_tick).sort((a, b) => a.tick - b.tick);
    const deltas = statDeltas(inRound, idxOf, teamOf);
    r.data.stats_before = r.data.roster.map((p) => ({ ...(totals.get(p.player) || EMPTY_TOTALS) }));
    r.data.stat_events = deltas;
    for (const d of deltas) {
      const cur = { ...(totals.get(d.player) || EMPTY_TOTALS) };
      cur[d.stat] += d.n;
      totals.set(d.player, cur);
    }
  });
  for (const r of roundData) {
    const ctVotes = r.data.roster.filter((p) => p.side === 'CT').map((p) => teamOf.get(p.player));
    const ctTeam = ctVotes.filter((x) => x === 'A').length >= ctVotes.filter((x) => x === 'B').length ? 'A' : 'B';
    const tTeam = ctTeam === 'A' ? 'B' : 'A';
    r.data.score_before = { ct: score[ctTeam], t: score[tTeam] };
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
    stats: summarise({ map, events, rounds, roundData, players, teamOf, score }),
    meta: {
      server_name: header.server_name || null,
      patch_version: header.patch_version || null,
      players: [...players.values()].map((p) => ({ index: p.index, name: p.name })),
      parser: 'demoparser2',
      replay_version: REPLAY_VERSION,
    },
    rounds: roundData,
  };
}

// Per-player match totals keyed by SteamID64 (see README "Player Stats" for
// the definitions). Only events inside detected rounds count, so warmup is
// excluded.
// - kills: enemy kills (team kills and suicides excluded); headshot_kills likewise
// - deaths: every death, including suicides and world damage
// - assists: kill assists (flash-only assists excluded)
// - damage: health removed from enemies, capped at the victim's remaining
//   health (overkill damage is not counted); team and self damage excluded
// - rounds_played: rounds the player was on a team's roster
// - result: W/L/D from the final team score
const STATS_VERSION = 1;

function summarise({ map, events, rounds, roundData, players, teamOf, score }) {
  const idx = (steamid) => (steamid && players.has(steamid) ? players.get(steamid).index : null);
  const steamOf = new Map([...players.entries()].map(([sid, p]) => [p.index, sid]));
  const rows = new Map();
  const row = (index) => {
    if (!rows.has(index)) {
      rows.set(index, { steamid64: steamOf.get(index), name: players.get(steamOf.get(index)).name, team: teamOf.get(index) || null,
        kills: 0, deaths: 0, assists: 0, headshot_kills: 0, damage: 0, rounds_played: 0 });
    }
    return rows.get(index);
  };
  rounds.forEach((r, i) => {
    for (const p of roundData[i].data.roster) row(p.player).rounds_played += 1;
    const inRound = events.filter((e) => e.tick >= r.start_tick && e.tick <= r.end_tick).sort((a, b) => a.tick - b.tick);
    for (const d of statDeltas(inRound, idx, teamOf)) {
      const key = { kills: 'kills', deaths: 'deaths', assists: 'assists', headshots: 'headshot_kills', damage: 'damage' }[d.stat];
      row(d.player)[key] += d.n;
    }
  });
  const result = (team) => (team == null ? null : score.A === score.B ? 'D' : (score[team] > score[team === 'A' ? 'B' : 'A'] ? 'W' : 'L'));
  const list = [...rows.values()].filter((r) => r.steamid64 && /^7656119\d{10}$/.test(r.steamid64)).map((r) => ({ ...r, result: result(r.team) }));
  // Stable identity for the match regardless of who uploaded which recording.
  const crypto = require('crypto');
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    map,
    players: list.map((r) => r.steamid64).sort(),
    rounds: roundData.map((r) => [r.winner, r.reason, r.data.events.filter((e) => e.type === 'kill').length]),
  })).digest('hex');
  return { version: STATS_VERSION, fingerprint, rounds: rounds.length, score_a: score.A, score_b: score.B, players: list };
}

const EVENT_NAMES = ['round_start', 'round_freeze_end', 'round_end', 'player_death', 'player_hurt', 'bomb_planted', 'bomb_defused', 'bomb_exploded'];
// Utility events are requested only when the demo lists them (round events
// above are partly synthesised by the parser and are not always listed).
const UTILITY_EVENT_NAMES = ['smokegrenade_detonate', 'smokegrenade_expired', 'flashbang_detonate', 'hegrenade_detonate', 'inferno_startburn', 'inferno_expire'];

// Version of the native binary actually loaded (package.json overrides pin
// the platform builds ahead of the wrapper package; see README).
function parserVersion() {
  const plat = { 'linux-x64': 'linux-x64-gnu', 'linux-arm64': 'linux-arm64-gnu', 'darwin-arm64': 'darwin-arm64', 'darwin-x64': 'darwin-x64', 'win32-x64': 'win32-x64-msvc' }[`${process.platform}-${process.arch}`];
  for (const name of [plat && `@laihoe/demoparser2-${plat}`, '@laihoe/demoparser2'].filter(Boolean)) {
    try { return require(`${name}/package.json`).version; } catch { /* try the next one */ }
  }
  return 'unknown';
}

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
  // A parser error after a readable header almost always means the demo was
  // recorded by a newer CS2 build than this parser version understands (for
  // example build 14197 needs demoparser2 0.42.2). Say so instead of passing
  // on the parser's internal error name.
  const incompatible = (err) => new DemoError('parser_incompatible',
    `This demo was recorded by a CS2 build (network protocol ${header.network_protocol || 'unknown'}) that this server's demo parser `
    + `(demoparser2 ${parserVersion()}) can't read yet: ${err.message || err}. Update the parser, then retry the demo.`);
  let events;
  try {
    // Only ask for events the demo actually contains.
    let present = null;
    try { present = new Set(parser.listGameEvents(file)); } catch { present = null; }
    const names = [...EVENT_NAMES, ...(present ? UTILITY_EVENT_NAMES.filter((n) => present.has(n)) : UTILITY_EVENT_NAMES)];
    events = parser.parseEvents(file, names, ['X', 'Y', 'Z'], ['is_warmup_period', 'total_rounds_played']);
  } catch (err) {
    throw incompatible(err);
  }
  const rounds = findRounds(events);
  const wanted = new Set();
  for (const r of rounds) {
    for (let tk = Math.ceil(r.start_tick / STEP) * STEP; tk <= r.end_tick; tk += STEP) wanted.add(tk);
  }
  // Flash detection reads flash_duration either side of each detonation.
  for (const e of events) {
    if (e.event_name === 'flashbang_detonate' && rounds.some((r) => inRoundTick(r, e.tick))) {
      wanted.add(e.tick - FLASH_BEFORE);
      wanted.add(e.tick + FLASH_AFTER);
    }
  }
  let ticks = [];
  try {
    if (wanted.size) ticks = parser.parseTicks(file, ['X', 'Y', 'Z', 'yaw', 'is_alive', 'health', 'team_num', ...HUD_PROPS], [...wanted].sort((a, b) => a - b));
  } catch (err) {
    throw incompatible(err);
  }
  // Projectile positions for grenade trails. Optional: a demo the parser
  // can't read them from still gets thrower and detonation data.
  let flights = [];
  try { flights = groupFlights(parser.parseGrenades(file, null, false)); } catch { flights = []; }
  return buildReplay({ header, events, ticks, flights });
}

module.exports = { statDeltas, equipmentOf, HUD_PROPS, parserVersion, STATS_VERSION, REPLAY_VERSION, SMOKE_TICKS, FIRE_TICKS, TRAIL_STEP, buildReplay, groupFlights, findRounds, parseDemoFile, radarTransform, checkMagic, DemoError, TICKRATE, STEP };
