// Demo Review HUD, scoreboard and kill feed, styled after CS2's own Panorama
// files (hudteamcounter, scoreboard, huddeathnotice; values noted in
// styles.css) and drawn with the icons extracted from the local CS2 install
// (lib/cs2Assets). Every value comes from the replay data at the current tick
// (lib/replay); a field the demo doesn't carry shows "—". If the CS2 asset set
// hasn't been built, icons fall back to text or the app's own icons.
import { useState, type CSSProperties, type ReactNode } from 'react';
import { UTILITY_ICON } from '../lib/constants';
import { cs2, inventoryIcon, KILLFEED_INDICATOR, killfeedIcon, UTILITY_ASSET, weaponIdFromName, weaponLabel } from '../lib/cs2Assets';
import { bombAt, equipmentAt, flashAmount, frameAt, headshotPct, hudClock, hudScore, scoreboardOrder, totalsAt, type KillFeedEntry } from '../lib/replay';
import type { EquipmentEntry, ReplayEvent, ReplayRound } from '../lib/types';
import { Icon } from './Icons';

type Side = 'CT' | 'T';
const SIDES: Side[] = ['CT', 'T'];
const SIDE_NAME: Record<Side, string> = { CT: 'Counter-Terrorists', T: 'Terrorists' };
// CS2 shows money without separators ($3600).
const money = (n: number | null | undefined) => (n == null ? '—' : `$${n}`);
const UTILITY_LABEL: Record<string, string> = { he: 'HE grenade', flash: 'Flashbang', smoke: 'Smoke', molly: 'Molotov', inc: 'Incendiary', decoy: 'Decoy' };

// An extracted CS2 icon with a fallback when the asset set isn't present.
export function CsImg({ src, alt, fallback, className, height }: { src: string | null; alt: string; fallback?: ReactNode; className?: string; height?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <>{fallback ?? null}</>;
  return <img className={className} src={src} alt={alt} title={alt || undefined} height={height} onError={() => setFailed(src)} draggable={false} />;
}

export interface HudPlayer { slot: number; player: number; side: Side; name: string }
function rosterBySide(round: ReplayRound, name: (player: number) => string): Record<Side, HudPlayer[]> {
  const out: Record<Side, HudPlayer[]> = { CT: [], T: [] };
  round.roster.forEach((p, slot) => out[p.side].push({ slot, player: p.player, side: p.side, name: name(p.player) }));
  return out;
}

function Grenades({ eq }: { eq: EquipmentEntry }) {
  if (!eq.utility) return <span className="cs2-na" title="Not in this demo's data">—</span>;
  return (
    <>
      {eq.utility.map((u) => (
        <CsImg key={u} className="cs2-nade" src={cs2(`utility/${UTILITY_ASSET[u]}.svg`)} alt={UTILITY_LABEL[u]}
          fallback={UTILITY_ICON[u === 'inc' ? 'molly' : u] ? <img className="cs2-nade fallback" src={UTILITY_ICON[u === 'inc' ? 'molly' : u]} alt={UTILITY_LABEL[u]} /> : null} />
      ))}
    </>
  );
}

// One player in the team counter (CS2 "AvatarLargeSnippet" with equipment info).
function PlayerCard({ round, p, tick, highlighted }: { round: ReplayRound; p: HudPlayer; tick: number; highlighted: boolean }) {
  const f = frameAt(round, p.slot, tick);
  const alive = Boolean(f?.alive);
  const hp = alive ? f?.hp ?? 0 : 0;
  const eq = equipmentAt(round, p.slot, tick);
  const flashed = alive ? flashAmount(round, p.player, tick) : 0;
  const best = eq?.best ?? null;
  const label = `${p.name}, ${alive ? `${hp} health` : 'dead'}${eq ? `, ${money(eq.money)}` : ''}${alive && best ? `, ${best}` : ''}`;
  return (
    <li className={`cs2-card ${p.side.toLowerCase()}${alive ? '' : ' dead'}${flashed > 0 ? ' flashed' : ''}${highlighted ? ' highlighted' : ''}${hp > 0 && hp <= 20 ? ' critical' : ''}`}
      aria-label={label} data-player={p.player} style={{ ['--flash' as string]: flashed.toFixed(2) } as CSSProperties}>
      <div className="cs2-card__name" title={p.name}>{p.name}</div>
      <div className="cs2-card__health" aria-hidden="true">
        <span className="cs2-card__health-fill" style={{ width: `${hp}%` }} />
        <b>{alive ? hp : ''}</b>
        {!alive ? <CsImg className="cs2-card__skull" src={cs2('hud/scoreboard/elimination.svg')} alt="" fallback={<Icon name="skull" size={12} />} /> : null}
      </div>
      <div className="cs2-card__money">{money(eq?.money)}</div>
      <div className="cs2-card__row cs2-card__weapon">
        {alive && best ? <CsImg src={inventoryIcon(weaponIdFromName(best))} alt={best} fallback={<span className="cs2-card__weapon-text">{best}</span>} /> : null}
      </div>
      <div className="cs2-card__row cs2-card__nades">{alive && eq ? <Grenades eq={eq} /> : null}</div>
      <div className="cs2-card__row cs2-card__gear">
        {alive && eq?.armor ? (
          <CsImg src={cs2(`equipment/${eq.helmet ? 'hud_armor_helmet' : 'hud_armor'}.svg`)}
            alt={eq.helmet ? `Kevlar and helmet (${eq.armor})` : `Kevlar (${eq.armor})`} fallback={<Icon name={eq.helmet ? 'helmet' : 'shield'} size={12} />} />
        ) : null}
        {alive && p.side === 'CT' && eq?.kit ? <CsImg src={cs2('equipment/defuser_white.svg')} alt="Defuse kit" fallback={<Icon name="defuse" size={12} />} /> : null}
        {alive && p.side === 'T' && eq?.bomb ? <CsImg src={cs2('equipment/c4.svg')} alt="Carrying the bomb" fallback={<img src="/icons/bomb.png" alt="Carrying the bomb" width="9" height="12" />} /> : null}
      </div>
    </li>
  );
}

export function ReplayHud({ round, info, tick, tickrate, name, roundNumber, highlight }: {
  round: ReplayRound; info: { start_tick: number; freeze_end_tick: number | null }; tick: number; tickrate: number; name: (player: number) => string;
  roundNumber: number; highlight?: number[];
}) {
  const teams = rosterBySide(round, name);
  const clock = hudClock(info, round.events, tick, tickrate);
  const score = hudScore(round, tick);
  const bomb = bombAt(round.events, tick, tickrate);
  const defused = round.events.some((e) => e.type === 'defuse' && e.tick <= tick);
  const aliveCount = (side: Side) => teams[side].filter((p) => frameAt(round, p.slot, tick)?.alive).length;
  // CS2 pulses the planted-bomb icon faster as the timer runs down.
  const pulse = bomb ? (bomb.secondsLeft > 10 ? 'slow' : bomb.secondsLeft > 5 ? 'medium' : 'fast') : null;
  return (
    <div className="cs2-hud" role="region" aria-label="Match HUD">
      {bomb ? (
        <div className="hud-bomb" role="timer" aria-label={`Bomb planted: ${Math.ceil(bomb.secondsLeft)} seconds left`}
          style={{ ['--left' as string]: bomb.left.toFixed(4) } as CSSProperties} data-bomb-left={bomb.left.toFixed(3)} />
      ) : null}
      <ol className="cs2-team ct" aria-label={`${round.teams?.CT ?? 'CT'} players`}>
        {teams.CT.map((p) => <PlayerCard key={p.player} round={round} p={p} tick={tick} highlighted={Boolean(highlight?.includes(p.player))} />)}
      </ol>
      <div className="cs2-centre">
        <div className="cs2-centre__scores">
          <div className="cs2-score ct" title={round.teams?.CT ?? SIDE_NAME.CT}>{score ? score.ct : '—'}</div>
          <div className={`cs2-timer ${clock.kind}${pulse ? ` pulse-${pulse}` : ''}`} role="timer"
            aria-label={clock.kind === 'live' || clock.kind === 'freeze' ? `Round clock ${clock.text}` : bomb ? `Bomb planted, ${Math.ceil(bomb.secondsLeft)} seconds left` : clock.text}>
            {clock.kind === 'bomb' ? (
              defused ? <CsImg className="cs2-timer__bomb defused" src={cs2('hud/objectives/bomb_defused.svg')} alt="Bomb defused" fallback="DEF" />
                : <CsImg className="cs2-timer__bomb" src={cs2('hud/objectives/bomb_planted.svg')} alt="Bomb planted" fallback={<img src="/icons/bomb.png" alt="" width="14" height="18" />} />
            ) : clock.kind === 'over' ? 'END' : clock.text}
          </div>
          <div className="cs2-score t" title={round.teams?.T ?? SIDE_NAME.T}>{score ? score.t : '—'}</div>
        </div>
        <div className="cs2-centre__meta">
          <span className="ct" title="CT alive">{aliveCount('CT')}</span>
          <span className="cs2-round">R{roundNumber}{clock.kind === 'freeze' ? ' · freeze' : ''}</span>
          <span className="t" title="T alive">{aliveCount('T')}</span>
        </div>
        <div className="cs2-centre__teams"><span className="ct">{round.teams?.CT ?? 'CT'}</span><span className="t">{round.teams?.T ?? 'T'}</span></div>
      </div>
      <ol className="cs2-team t" aria-label={`${round.teams?.T ?? 'T'} players`}>
        {teams.T.map((p) => <PlayerCard key={p.player} round={round} p={p} tick={tick} highlighted={Boolean(highlight?.includes(p.player))} />)}
      </ol>
    </div>
  );
}

const NA = <span className="sb-na" title="Not in this demo's data">—</span>;

// CS2 Tab scoreboard: team panel (score, side, team, alive) beside the rows,
// columns Money · Kills · Deaths · Assists · HS% · DMG, rows in CS2's
// competitive order (damage, kills, assists, fewest deaths).
export function ReplayScoreboard({ round, tick, name, onClose }: { round: ReplayRound; tick: number; name: (player: number) => string; onClose: () => void }) {
  const teams = rosterBySide(round, name);
  const totals = totalsAt(round, tick);
  const score = hudScore(round, tick);
  return (
    <div className="cs2-scoreboard" role="region" aria-label="Scoreboard">
      <button type="button" className="btn ghost small sb-close" onClick={onClose} aria-label="Close scoreboard"><Icon name="close" size={14} /></button>
      {!round.state ? <p className="sb-note">This demo was processed before scoreboard data was available. It is being updated in the background; reopen it shortly.</p> : null}
      {SIDES.map((side) => {
        const list = [...teams[side]].sort((a, b) => (totals ? scoreboardOrder(totals[a.slot], totals[b.slot]) : 0) || a.player - b.player);
        const alive = list.filter((p) => frameAt(round, p.slot, tick)?.alive).length;
        return (
          <section key={side} className={`cs2-sb__team ${side.toLowerCase()}`} aria-label={`${SIDE_NAME[side]}${round.teams?.[side] ? ` (${round.teams[side]})` : ''}`}>
            <div className="cs2-sb__info">
              <div className="cs2-sb__score">{score ? score[side === 'CT' ? 'ct' : 't'] : '—'}</div>
              <div className="cs2-sb__side">{side === 'CT' ? 'Counter-\nTerrorists' : 'Terrorists'}</div>
              {round.teams?.[side] ? <div className="cs2-sb__clan">{round.teams[side]}</div> : null}
              <div className="cs2-sb__alive">Alive: {alive}/{list.length}</div>
            </div>
            <table className="cs2-sb__table">
              <colgroup><col /><col className="cs2-sb__col-money" /><col className="cs2-sb__col" /><col className="cs2-sb__col" /><col className="cs2-sb__col" /><col className="cs2-sb__col" /><col className="cs2-sb__col" /></colgroup>
              {/* Column labels shown once, above the first team (as in CS2); the other team's are for screen readers. */}
              <thead className={side === 'CT' ? 'cs2-sb__head' : 'sr-only'}>
                <tr><th scope="col"><span className="sr-only">Name</span></th><th scope="col">Money</th><th scope="col">Kills</th><th scope="col">Deaths</th><th scope="col">Assists</th>
                  <th scope="col">HS%</th><th scope="col" className="sortstat" aria-label="Damage">DMG</th></tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const t = totals?.[p.slot];
                  const eq = equipmentAt(round, p.slot, tick);
                  const dead = !frameAt(round, p.slot, tick)?.alive;
                  return (
                    <tr key={p.player} className={dead ? 'dead' : ''} data-player={p.player}>
                      <th scope="row">
                        <span className="cs2-sb__status">{dead ? <CsImg src={cs2('hud/scoreboard/elimination.svg')} alt="Dead" fallback={<Icon name="skull" size={12} title="Dead" />} /> : null}</span>
                        <span className="cs2-sb__name">{p.name}</span>
                      </th>
                      <td className="cs2-sb__money">{eq?.money != null ? money(eq.money) : NA}</td>
                      <td>{t ? t.kills : NA}</td>
                      <td>{t ? t.deaths : NA}</td>
                      <td>{t ? t.assists : NA}</td>
                      <td>{t ? headshotPct(t) : NA}</td>
                      <td className="sortstat">{t ? t.damage : NA}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
      <p className="cs2-sb__foot">Sorted like CS2's competitive scoreboard: damage, kills, assists, fewest deaths. Values at the current moment of the replay.</p>
    </div>
  );
}

// CS2 death notices (huddeathnotice): attacker, "+ assister", weapon and the
// recorded modifiers, victim. Clicking an entry seeks to that kill.
export function KillFeed({ entries, side, name, describe, onSelect, selected }: {
  entries: KillFeedEntry[]; side: (player: number | null | undefined) => Side | null; name: (player: number) => string;
  describe: (ev: ReplayEvent) => string; onSelect: (ev: ReplayEvent) => void; selected: ReplayEvent | null;
}) {
  if (!entries.length) return null;
  const nameEl = (player: number | null | undefined, cls: string) => (player == null ? null : (
    <span className={`cs2-kf__name ${cls} ${(side(player) ?? 'faded').toLowerCase()}`}>{name(player)}</span>
  ));
  return (
    <ol className="cs2-killfeed" aria-label="Kill feed">
      {entries.map(({ event: ev, index, opacity }) => {
        const suicide = ev.attacker != null && ev.attacker === ev.victim;
        const teamKill = !suicide && ev.attacker != null && side(ev.attacker) != null && side(ev.attacker) === side(ev.victim);
        const icon = killfeedIcon(ev.weapon);
        return (
          <li key={`${ev.tick}-${index}`} style={{ opacity }}>
            <button type="button" className={`cs2-kf${selected === ev ? ' selected' : ''}${teamKill ? ' teamkill' : ''}`} onClick={() => onSelect(ev)}
              aria-label={`${describe(ev)}${teamKill ? ' (team kill)' : ''}. Jump to this kill.`} title={describe(ev)} data-kill-tick={ev.tick}>
              {ev.attacker_blind ? <CsImg className="cs2-kf__icon" src={KILLFEED_INDICATOR.blind} alt="Attacker blind" /> : null}
              {!suicide ? nameEl(ev.attacker, 'attacker') : null}
              {ev.assister != null ? (
                <span className="cs2-kf__assist">
                  <span className="cs2-kf__plus">+</span>
                  {ev.flash_assist ? <CsImg className="cs2-kf__icon" src={KILLFEED_INDICATOR.flashAssist} alt="Flash assist" fallback="⚡" /> : null}
                  {nameEl(ev.assister, 'assister')}
                </span>
              ) : null}
              {ev.in_air ? <CsImg className="cs2-kf__icon" src={KILLFEED_INDICATOR.inair} alt="Attacker in the air" /> : null}
              {!suicide ? <CsImg className="cs2-kf__icon cs2-kf__weapon" src={icon} alt={weaponLabel(ev.weapon)}
                fallback={<span className="cs2-kf__weapon-text">{weaponLabel(ev.weapon)}</span>} /> : null}
              {ev.noscope ? <CsImg className="cs2-kf__icon" src={KILLFEED_INDICATOR.noscope} alt="No-scope" fallback="NS" /> : null}
              {ev.through_smoke ? <CsImg className="cs2-kf__icon" src={KILLFEED_INDICATOR.smoke} alt="Through smoke" fallback="SMK" /> : null}
              {ev.penetrated ? <CsImg className="cs2-kf__icon" src={KILLFEED_INDICATOR.penetrate} alt="Wallbang" fallback="WB" /> : null}
              {ev.headshot ? <CsImg className="cs2-kf__icon" src={KILLFEED_INDICATOR.headshot} alt="Headshot" fallback="HS" /> : null}
              {suicide ? <CsImg className="cs2-kf__icon" src={KILLFEED_INDICATOR.suicide} alt="Suicide" fallback="✝" /> : null}
              {nameEl(ev.victim, 'victim')}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
