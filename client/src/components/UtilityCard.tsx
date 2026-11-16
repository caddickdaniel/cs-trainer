import { useState } from 'react';
import { KIT_ICON } from '../lib/constants';
import { UtilityIcon } from './UtilityIcon';
import type { GrenadeCounts, Loadout, Phase, PlayerRef, PlayerUtility } from '../lib/types';
import { GRENADES, GRENADE_LABEL, describeCounts, refKey, utilityPlan } from '../lib/utility';

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
      {u.over.map((o) => (
        <p key={o.kind} className="error-text small">The plan has you throw {o.planned} {GRENADE_LABEL[o.kind][o.planned === 1 ? 0 : 1]} but you only have {o.available}. Tell your IGL.</p>
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

// Viewer / shared preview: each player's buy list and what they have at the
// start of the phase being shown (derived from earlier phases).
export function BuyListSummary({ loadouts, bomb, phases, phaseIndex, side, name }: {
  loadouts: Loadout[]; bomb: PlayerRef | null | undefined; phases: Phase[]; phaseIndex: number; side: string | null;
  name: (r: PlayerRef) => string;
}) {
  const plan = utilityPlan(loadouts, phases);
  const owners = [...plan.values()];
  const bombKey = side === 'T' ? refKey(bomb) : null;
  if (bombKey && !plan.has(bombKey) && bomb) owners.push({ key: bombKey, buy: { smoke: 0, flash: 0, molly: 0, he: 0 }, kit: false, phases: [], over: [] });
  if (!owners.length) return <p className="muted small">No buy lists yet.</p>;
  const refOf = (key: string): PlayerRef => (key.startsWith('u') ? { user_id: Number(key.slice(1)), slot: null } : { user_id: null, slot: Number(key.slice(1)) });
  return (
    <table className="table compact utility-table">
      <thead><tr><th>Player</th><th>Buys</th><th>{phaseIndex === 0 ? 'Throws now' : 'Has now'}</th></tr></thead>
      <tbody>
        {owners.map((p) => {
          const at = p.phases[phaseIndex];
          const over = p.over.filter((o) => o.phase === phaseIndex);
          return (
            <tr key={p.key} className={over.length ? 'over' : ''}>
              <td>{name(refOf(p.key))}{bombKey === p.key ? <> <img src="/icons/bomb.png" alt="Bomb" title="Carries the bomb" width="12" height="16" /></> : null}</td>
              <td>{describeCounts(p.buy) || '—'}{side === 'CT' && p.kit ? <span className="kit-label">, <KitIcon /> defuse kit</span> : null}</td>
              <td>{at ? (phaseIndex === 0 ? describeCounts(at.used) : describeCounts(at.start)) || '—' : '—'}
                {over.length ? <span className="error-text"> · plans more than they have</span> : null}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
