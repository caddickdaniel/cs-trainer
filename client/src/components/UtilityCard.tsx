import { Fragment, useState } from 'react';
import { KIT_ICON } from '../lib/constants';
import { UtilityIcon } from './UtilityIcon';
import type { GrenadeCounts, Loadout, Phase, PlayerRef, PlayerUtility } from '../lib/types';
import { GRENADES, GRENADE_LABEL, PRICES, describeCounts, issueText, itemLabel, money, priceOf, refKey, utilityPlan, type PlayerPlan } from '../lib/utility';

// The CT defuse kit (a loadout item, never drawn on the radar). The text
// label always goes with it so it reads at small sizes. Uses, in order: CS2's
// own pliers icon extracted from the local game install (npm run cs2:assets),
// the transparent kit PNG (client/public/icons/defuse-kit.png), then an olive
// pliers outline so the item is still marked.
const KIT_SOURCES = ['/assets/cs2/equipment/defuser.svg', KIT_ICON];
export function KitIcon({ size = 16 }: { size?: number }) {
  const [attempt, setAttempt] = useState(0);
  if (attempt >= KIT_SOURCES.length) {
    return (
      <svg className="kit-icon fallback" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#9aa05a" strokeWidth={2.2}
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-kit-fallback="">
        <path d="M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.1 7.9L20 20M8.1 16.1L20 4" />
      </svg>
    );
  }
  return <img className="kit-icon" src={KIT_SOURCES[attempt]} alt="" width={size} height={size} onError={() => setAttempt((n) => n + 1)} />;
}

function Counts({ counts, label, side }: { counts: GrenadeCounts; label: string; side?: string | null }) {
  return (
    <div className="my-buy" aria-label={label}>
      {GRENADES.map((g) => (
        <span key={g} className={`count${counts[g] ? '' : ' none'}`} title={`${counts[g]} ${GRENADE_LABEL[g][counts[g] === 1 ? 0 : 1]}`}>
          <UtilityIcon kind={g} side={side} size={18} label="" /> {counts[g]}
        </span>
      ))}
    </div>
  );
}

// A player's buy list (at round start) or the utility they have at the start
// of the current phase, plus the bomb / defuse kit.
export function UtilityCard({ u, phaseIndex, side }: { u: PlayerUtility; phaseIndex: number; side?: string | null }) {
  const extras = (
    <>
      {u.bomb ? <p className="call-utility"><UtilityIcon kind="c4" size={18} label="" /> <strong>You carry the bomb.</strong></p> : null}
      {u.kit ? <p className="call-utility"><KitIcon size={18} /> <strong>Buy a defuse kit.</strong></p> : null}
    </>
  );
  return (
    <div className="utility-card">
      {phaseIndex === 0 ? (
        <>
          <h2 className="lineup-heading">Your buy</h2>
          <Counts counts={u.buy} label="Buy list" side={side} />
          {!describeCounts(u.buy) ? <p className="muted small">No grenades to buy.</p> : null}
        </>
      ) : (
        <>
          <h2 className="lineup-heading">Your utility now</h2>
          <Counts counts={u.available} label="Utility available at the start of this phase" side={side} />
          <p className="muted small">Bought {describeCounts(u.buy) || 'no grenades'}
            {GRENADES.some((g) => u.available[g] < u.buy[g]) ? `; earlier phases used ${describeCounts(Object.fromEntries(GRENADES.map((g) => [g, Math.max(0, u.buy[g] - u.available[g])])) as GrenadeCounts)}` : ''}.</p>
        </>
      )}
      {describeCounts(u.planned) ? <p className="call-utility"><strong>Throw this phase:</strong> {describeCounts(u.planned)}</p> : null}
      {u.over.map((o, i) => (
        <p key={`${o.kind}${i}`} className="error-text small">{o.type ? issueText({ ...o, type: o.type, id: o.id ?? '' }, side) : `The plan has you throw ${o.planned} ${GRENADE_LABEL[o.kind][o.planned === 1 ? 0 : 1]} but you only have ${o.available}.`} Tell your IGL.</p>
      ))}
      {extras}
    </div>
  );
}

// Team buy: everyone's utility at the start of the current phase, with the
// CS2 icons. Fire is a molotov for T and an incendiary for CT; the C4 column
// is T only and the defuse kit column CT only.
export function TeamUtility({ list, name, side }: { list: PlayerUtility[]; name: (u: PlayerUtility) => string; side?: string | null }) {
  if (!list.length) return <p className="muted small">This tactic has no buy lists.</p>;
  const isT = side === 'T';
  const isCT = side === 'CT';
  const showKit = !isT && list.some((u) => u.kit);
  const showBomb = !isCT && list.some((u) => u.bomb);
  return (
    <table className="table compact utility-table team-utility">
      <thead><tr><th>Player</th>{GRENADES.map((g) => <th key={g} title={GRENADE_LABEL[g][1]}><UtilityIcon kind={g} side={side} size={18} /></th>)}
        {showBomb ? <th title="C4 (T)"><UtilityIcon kind="c4" size={18} /></th> : null}
        {showKit ? <th title="Defuse kit (CT)"><KitIcon size={18} /><span className="sr-only">Defuse kit</span></th> : null}<th /></tr></thead>
      <tbody>
        {list.map((u) => (
          <tr key={`${u.user_id ?? 's'}${u.slot ?? ''}`} className={u.over.length ? 'over' : ''}>
            <td>{name(u)}</td>
            {GRENADES.map((g) => <td key={g}>{u.available[g]}{u.planned[g] ? <span className="muted"> (−{u.planned[g]})</span> : null}</td>)}
            {showBomb ? <td>{u.bomb ? <span className="kit-label" title="Carries the bomb"><UtilityIcon kind="c4" size={16} label="" /> Bomb</span> : null}</td> : null}
            {showKit ? <td>{u.kit ? <span className="kit-label" title="Buys a defuse kit"><KitIcon size={16} /> Kit</span> : null}</td> : null}
            <td>{u.over.length ? <span className="error-text">over plan</span> : null}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// "2 × Flash $200 = $400 …" for a buy list's cost tooltip.
export function buyBreakdown(p: Pick<PlayerPlan, 'buy' | 'kit'>, side: string | null) {
  const parts = GRENADES.filter((g) => p.buy[g]).map((g) => `${p.buy[g]} × ${itemLabel(g, side)} ${money(priceOf(g, side))}`);
  if (side === 'CT' && p.kit) parts.push(`Defuse kit ${money(PRICES.kit)}`);
  return parts.join(' + ') || 'Nothing to buy';
}

// Phase overview (viewer and shared preview): one row per player with a
// fixed-width column per grenade, the icon in the header and the count the
// player carries at the start of the phase shown (the buy list in phase 1),
// with this phase's throws (−), drops (↓) and route pickups (+) beneath it.
// A dash marks an item the player doesn't have. Cost is the starting buy.
export function BuyListSummary({ loadouts, bomb, phases, phaseIndex, side, name, plan: given, map }: {
  loadouts: Loadout[]; bomb: PlayerRef | null | undefined; phases: Phase[]; phaseIndex: number; side: string | null;
  name: (r: PlayerRef) => string; plan?: Map<string, PlayerPlan>; map?: string | null;
}) {
  const plan = given ?? utilityPlan(loadouts, phases, side, map, side === 'T' ? bomb : null);
  const owners: PlayerPlan[] = [...plan.values()].filter((p) => p.phases.some((x) => grenadeTotalOf(x.start) || grenadeTotalOf(x.used) || grenadeTotalOf(x.picked)) || p.cost || p.kit || p.over.length || refKey(bomb) === p.key);
  const bombKey = side === 'T' ? refKey(bomb) : null;
  if (!owners.length) return <p className="muted small">No buy lists yet.</p>;
  const refOf = (key: string): PlayerRef => (key.startsWith('u') ? { user_id: Number(key.slice(1)), slot: null } : { user_id: null, slot: Number(key.slice(1)) });
  const showKit = side === 'CT' && owners.some((p) => p.kit);
  const label = phaseIndex === 0 ? 'bought' : 'carried at the start of this phase';
  return (
    <div className="utility-table-wrap">
      <table className="table compact utility-table phase-utility">
        <colgroup>
          <col className="col-player" />
          {GRENADES.map((g) => <col key={g} className="col-nade" />)}
          {showKit ? <col className="col-nade" /> : null}
          <col className="col-cost" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Player</th>
            {GRENADES.map((g) => <th key={g} scope="col" className="nade" title={itemLabel(g, side, true)}><UtilityIcon kind={g} side={side} size={18} label={itemLabel(g, side, true)} /></th>)}
            {showKit ? <th scope="col" className="nade" title="Defuse kit"><KitIcon size={18} /><span className="sr-only">Defuse kit</span></th> : null}
            <th scope="col" className="num">Cost</th>
          </tr>
        </thead>
        <tbody>
          {owners.map((p) => {
            const at = p.phases[phaseIndex];
            const over = p.over.filter((o) => o.phase === phaseIndex);
            const who = name(refOf(p.key));
            return (
              <Fragment key={p.key}>
                <tr className={over.length ? 'over' : ''} data-utility-row={p.key}>
                  <th scope="row" className="player">{who}{bombKey === p.key ? <> <img src="/icons/bomb.png" alt="Bomb" title="Carries the bomb" width="12" height="16" /></> : null}</th>
                  {GRENADES.map((g) => {
                    const has = at ? at.start[g] : p.buy[g];
                    const used = at?.used[g] ?? 0;
                    const dropped = at?.dropped[g] ?? 0;
                    const picked = at?.picked[g] ?? 0;
                    const item = itemLabel(g, side, has !== 1).toLowerCase();
                    return (
                      <td key={g} className={`nade${has || picked ? '' : ' none'}`} aria-label={`${who}: ${has || 'no'} ${item} ${label}${used ? `, throws ${used}` : ''}${dropped ? `, drops ${dropped}` : ''}${picked ? `, picks up ${picked}` : ''}`}>
                        <span className="nade-count">{has || '—'}</span>
                        {used || dropped || picked ? (
                          <span className="nade-delta">
                            {used ? <span title={`Throws ${used} this phase`}>−{used}</span> : null}
                            {dropped ? <span title={`Drops ${dropped} this phase`}>↓{dropped}</span> : null}
                            {picked ? <span className="ok-text" title={`Picks up ${picked} on their route this phase`}>+{picked}</span> : null}
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                  {showKit ? <td className={`nade${p.kit ? '' : ' none'}`}>{p.kit ? <span title="Buys a defuse kit">✓</span> : <span className="nade-count">—</span>}</td> : null}
                  <td className="num" title={buyBreakdown(p, side)}>{money(p.cost)}</td>
                </tr>
                {over.length ? (
                  <tr className="over issue-row"><td colSpan={GRENADES.length + (showKit ? 3 : 2)} className="error-text small">{over.map((o) => issueText(o, side)).join(' ')}</td></tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">{phaseIndex === 0 ? 'Counts are each player’s buy list.' : 'Counts are what each player carries when this phase starts.'} −&nbsp;thrown, ↓&nbsp;dropped, +&nbsp;picked up this phase.</p>
    </div>
  );
}

const grenadeTotalOf = (c: GrenadeCounts) => GRENADES.reduce((n, g) => n + (c[g] || 0), 0);
