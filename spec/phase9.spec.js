// Phase 9: CS2 kill feed, scoreboard order, bomb detonation and damage data,
// CS2 asset mapping, and (when built) the extracted asset set itself.
const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const { buildReplay, REPLAY_VERSION } = require('../services/demoParse');

const client = (file) => import(path.join(__dirname, '../client/src/lib', file));
const steam = (n) => `7656119000000000${n}`;

// Round with a flash-assisted wallbang headshot, a team kill, a suicide, two
// kills on the same tick, a plant, a detonation and a bomb kill.
function bombDemo() {
  const at = (x, y) => ({ user_X: x, user_Y: y, user_Z: 0 });
  const events = [
    { event_name: 'round_start', tick: 100 },
    { event_name: 'round_freeze_end', tick: 164 },
    { event_name: 'player_death', tick: 300, user_steamid: steam(3), attacker_steamid: steam(1), assister_steamid: steam(2), assistedflash: true,
      penetrated: 1, noscope: false, thrusmoke: true, attackerblind: false, attackerinair: false, headshot: true, weapon: 'ak47', ...at(-1500, 0) },
    { event_name: 'player_death', tick: 400, user_steamid: steam(2), attacker_steamid: steam(1), weapon: 'glock', ...at(-1400, 0) },
    { event_name: 'player_death', tick: 400, user_steamid: steam(4), attacker_steamid: steam(4), weapon: 'hegrenade', ...at(-1300, 0) },
    { event_name: 'bomb_planted', tick: 500, user_steamid: steam(1), ...at(-1000, 0) },
    { event_name: 'bomb_exploded', tick: 500 + 40 * 64, user_steamid: steam(1), ...at(9999, 9999) },
    { event_name: 'player_hurt', tick: 500 + 40 * 64 + 20, user_steamid: steam(5), weapon: 'planted_c4', dmg_health: 139, dmg_armor: 0, health: 0 },
    { event_name: 'player_death', tick: 500 + 40 * 64 + 20, user_steamid: steam(5), weapon: 'planted_c4', ...at(-900, 0) },
    { event_name: 'player_hurt', tick: 500 + 40 * 64 + 40, user_steamid: steam(6), weapon: 'planted_c4', dmg_health: 9, dmg_armor: 2, health: 17 },
    { event_name: 'round_end', tick: 500 + 40 * 64 + 10, winner: 'T', reason: 'bomb_exploded', total_rounds_played: 1 },
  ];
  const ticks = [];
  for (let t = 96; t <= 3400; t += 8) {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      ticks.push({ tick: t, steamid: steam(n), name: `p${n}`, X: -1000, Y: 0, Z: 0, yaw: 0, is_alive: true, health: 100, team_num: n <= 2 ? 2 : 3,
        balance: 800, armor_value: 100, has_helmet: true, has_defuser: false, active_weapon_name: 'Glock-18', inventory: ['Knife', 'Glock-18', 'AK-47', 'Flashbang'], score: n });
    }
  }
  return { header: { map_name: 'de_mirage' }, events, ticks };
}

describe('phase 9', () => {
  const replay = buildReplay(bombDemo());
  const round = replay.rounds[0].data;
  const idx = (name) => replay.meta.players.find((p) => p.name === name).index;

  describe('replay data (version 5)', () => {
    it('records kill feed details exactly as the death events give them', () => {
      expect(REPLAY_VERSION).to.be.at.least(5);
      const kills = round.events.filter((e) => e.type === 'kill');
      expect(kills[0]).to.include({ attacker: idx('p1'), victim: idx('p3'), assister: idx('p2'), flash_assist: true, penetrated: true, through_smoke: true,
        noscope: false, attacker_blind: false, in_air: false, headshot: true, weapon: 'ak47' });
      // No assister recorded: no assist fields invented.
      expect(kills[1]).to.not.have.property('assister');
      // The bomb kill has no attacker.
      const bombKill = kills.find((k) => k.weapon === 'planted_c4');
      expect(bombKill).to.include({ attacker: null, victim: idx('p5') });
    });

    it('records the bomb damage players actually took, the best weapon, score and the radar scale', () => {
      expect(round.bomb_damage).to.deep.equal([
        { tick: 3080, player: idx('p5'), damage: 139, armor: 0, health: 0 },
        { tick: 3100, player: idx('p6'), damage: 9, armor: 2, health: 17 },
      ]);
      expect(round.state[0][0]).to.include({ best: 'AK-47' });
      expect(round.state.map((s) => s[0].score).sort()).to.deep.equal([1, 2, 3, 4, 5, 6]);
      expect(round.units_per_radar).to.be.closeTo(5.0 * 1024, 1);
    });
  });

  describe('timeline helpers (derived from the tick alone)', () => {
    let h;
    before(async () => { h = await client('replay.ts'); });

    it('shows each kill for 5 s of demo time, fading over the last second, oldest first, including same-tick kills', () => {
      const ev = round.events;
      expect(h.killFeedAt(ev, 299, 64)).to.deep.equal([]);
      expect(h.killFeedAt(ev, 400, 64).map((k) => k.event.tick)).to.deep.equal([300, 400, 400]);
      const fading = h.killFeedAt(ev, 300 + 4.5 * 64, 64)[0];
      expect(fading.event.tick).to.equal(300);
      expect(fading.opacity).to.be.closeTo(0.5, 1e-9);
      expect(h.killFeedAt(ev, 300 + 5 * 64, 64).map((k) => k.event.tick)).to.deep.equal([400, 400]);
      // Seeking backwards removes later kills.
      expect(h.killFeedAt(ev, 350, 64).map((k) => k.event.tick)).to.deep.equal([300]);
    });

    it('starts the shockwave only from the recorded detonation, at the plant, and ends it after 1.5 s', () => {
      const boom = 500 + 40 * 64;
      expect(h.detonationAt(round.events, boom - 1, 64)).to.equal(null);
      const d = h.detonationAt(round.events, boom + 32, 64);
      const plant = round.events.find((e) => e.type === 'plant');
      expect(d).to.include({ x: plant.x, y: plant.y, elapsed: 0.5 });
      expect(h.shockwaveFrame(0.1).flash).to.be.closeTo(0.5, 1e-9);
      expect(h.shockwaveFrame(1.0).ring).to.equal(1);
      expect(h.shockwaveFrame(1.5)).to.equal(null);
      expect(h.shockwaveFrame(-0.1)).to.equal(null);
      // No detonation when the bomb was defused instead.
      expect(h.detonationAt([{ tick: 10, type: 'plant', x: 0.5, y: 0.5 }, { tick: 900, type: 'defuse' }], 5000, 64)).to.equal(null);
    });

    it('labels the damage estimate as the CS:GO formula and keeps recorded damage separate', () => {
      expect(h.estimatedBombDamage(0)).to.equal(500);
      expect(h.estimatedBombDamage(1750)).to.be.below(6);
      expect(h.estimatedBombDamage(h.estimatedRadiusFor(100))).to.be.closeTo(100, 1e-6);
      const r = { ...round };
      expect(h.bombDamageAt(r, 3079)).to.have.length(0);
      expect(h.bombDamageAt(r, 3100).map((x) => x.damage)).to.deep.equal([139, 9]);
    });

    it('orders the scoreboard like CS2 competitive: damage, kills, assists, fewest deaths', () => {
      const s = (damage, kills, assists, deaths) => ({ damage, kills, assists, deaths, headshots: 0 });
      const rows = [s(100, 1, 0, 1), s(253, 3, 0, 0), s(100, 2, 0, 1), s(100, 2, 1, 1), s(100, 2, 1, 0)];
      expect(rows.sort(h.scoreboardOrder)).to.deep.equal([s(253, 3, 0, 0), s(100, 2, 1, 0), s(100, 2, 1, 1), s(100, 2, 0, 1), s(100, 1, 0, 1)]);
    });
  });

  describe('CS2 asset mapping', () => {
    let a;
    before(async () => { a = await client('cs2Assets.ts'); });

    it('maps demo weapon ids and inventory names to kill feed and inventory icons, with text for unknown ids', () => {
      expect(a.killfeedIcon('ak47')).to.equal('/assets/cs2/killfeed/weapons/ak47.svg');
      expect(a.killfeedIcon('weapon_m4a1_silencer_off')).to.equal('/assets/cs2/killfeed/weapons/m4a1_silencer.svg');
      expect(a.killfeedIcon('planted_c4')).to.equal('/assets/cs2/killfeed/weapons/planted_c4.svg');
      expect(a.killfeedIcon('inferno')).to.equal('/assets/cs2/killfeed/weapons/inferno.svg');
      expect(a.killfeedIcon('knife_karambit')).to.equal('/assets/cs2/killfeed/weapons/knife_karambit.svg');
      expect(a.killfeedIcon('world')).to.equal(null);
      expect(a.killfeedIcon('laser_cannon')).to.equal(null);
      expect(a.weaponLabel('laser_cannon')).to.equal('laser cannon');
      expect(a.weaponLabel('planted_c4')).to.equal('C4');
      expect(a.inventoryIcon(a.weaponIdFromName('AK-47'))).to.equal('/assets/cs2/weapons/rifles/ak47.svg');
      expect(a.inventoryIcon(a.weaponIdFromName('M4A4'))).to.equal('/assets/cs2/weapons/rifles/m4a1.svg');
      expect(a.weaponIdFromName('Butterfly Knife')).to.equal('knife');
    });

    // The extracted set is built per machine from the local CS2 install (npm run cs2:assets).
    const manifestPath = path.join(__dirname, '../client/public/assets/cs2/manifest.json');
    (fs.existsSync(manifestPath) ? it : it.skip)('has every mapped icon and manifest file on disk (built CS2 asset set)', () => {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const pub = path.join(__dirname, '../client/public');
      expect(manifest.validation.problems).to.deep.equal([]);
      for (const e of Object.values(manifest.assets)) {
        for (const f of ['png', 'png_white', 'png_black', 'svg']) if (e[f]) expect(fs.existsSync(path.join(pub, e[f])), e[f]).to.equal(true);
      }
      for (const w of Object.keys(manifest.weapons)) {
        const id = w.replace(/^weapon_/, '');
        for (const p of [a.killfeedIcon(id), a.inventoryIcon(id)]) expect(fs.existsSync(path.join(pub, p)), p).to.equal(true);
      }
      for (const p of Object.values(a.KILLFEED_INDICATOR)) expect(fs.existsSync(path.join(pub, p)), p).to.equal(true);
    });
  });
});
