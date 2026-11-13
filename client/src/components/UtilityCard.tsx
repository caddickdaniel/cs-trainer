import { UTILITY_ICON } from '../lib/constants';
import type { GrenadeCounts, Loadout, Phase, PlayerRef, PlayerUtility } from '../lib/types';
import { GRENADES, GRENADE_LABEL, describeCounts, refKey, utilityPlan } from '../lib/utility';

function Counts({ counts, label }: { counts: GrenadeCounts; label: string }) {
  return (
    <div className="my-buy" aria-label={label}>
      {GRENADES.map((g) => (
        <span key={g} className={`count${counts[g] ? '' : ' none'}`} title={`${counts[g]} ${GRENADE_LABEL[g][counts[g] === 1 ? 0 : 1]}`}>
          <img src={UTILITY_ICON[g]} alt="" width="18" height="18" /> {counts[g]}
        </span>
      ))}
    </div>
  );
}

// A player's buy list (at round start) or the utility they have at the start
// of the current phase, plus the bomb / defuse kit.
export function UtilityCard({ u, phaseIndex }: { u: PlayerUtility; phaseIndex: number }) {
  const extras = (
    <>
      {u.bomb ? <p className="call-utility"><img src="/icons/bomb.png" alt="" width="14" height="18" /> <strong>You carry the bomb.</strong></p> : null}
      {u.kit ? <p className="call-utility"><strong>Buy a defuse kit.</strong></p> : null}
    </>
  );
  return (
    <div className="utility-card">
      {phaseIndex === 0 ? (
        <>
          <h2 className="lineup-heading">Your buy</h2>
          <Counts counts={u.buy} label="Buy list" />
          {!describeCounts(u.buy) ? <p className="muted small">No grenades to buy.</p> : null}
        </>
      ) : (
        <>
          <h2 className="lineup-heading">Your utility now</h2>
          <Counts counts={u.available} label="Utility available at the start of this phase" />
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

// IGL overview: everyone's utility at the start of the current phase.
export function TeamUtility({ list, name }: { list: PlayerUtility[]; name: (u: PlayerUtility) => string }) {
  if (!list.length) return <p className="muted small">This tactic has no buy lists.</p>;
  return (
    <table className="table compact utility-table">
      <thead><tr><th>Player</th>{GRENADES.map((g) => <th key={g} title={GRENADE_LABEL[g][1]}><img src={UTILITY_ICON[g]} alt={GRENADE_LABEL[g][1]} width="16" height="16" /></th>)}<th /></tr></thead>
      <tbody>
        {list.map((u) => (
          <tr key={`${u.user_id ?? 's'}${u.slot ?? ''}`} className={u.over.length ? 'over' : ''}>
            <td>{name(u)}</td>
            {GRENADES.map((g) => <td key={g}>{u.available[g]}{u.planned[g] ? <span className="muted"> (−{u.planned[g]})</span> : null}</td>)}
            <td>{u.bomb ? <img src="/icons/bomb.png" alt="Bomb" title="Carries the bomb" width="12" height="16" /> : null}{u.kit ? ' Kit' : ''}{u.over.length ? <span className="error-text"> over plan</span> : null}</td>
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
              <td>{describeCounts(p.buy) || '—'}{side === 'CT' && p.kit ? ', kit' : ''}</td>
              <td>{at ? (phaseIndex === 0 ? describeCounts(at.used) : describeCounts(at.start)) || '—' : '—'}
                {over.length ? <span className="error-text"> · plans more than they have</span> : null}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
