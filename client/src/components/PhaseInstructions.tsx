import type { Assignment } from '../lib/types';
import { ownerColor, ownerKey } from './MapBoard';

// Read-only list of every player's instruction for one phase.
export function PhaseInstructions({ assignments, players, highlight }: {
  assignments: Assignment[];
  players: number[];
  highlight?: number | null;
}) {
  if (!assignments.length) return <p className="muted">No player instructions in this phase.</p>;
  return (
    <ul className="instructions">
      {assignments.map((a) => (
        <li key={ownerKey(a) ?? ''} className={a.user_id != null && highlight === a.user_id ? 'mine' : ''} data-players={players.length}>
          <span className="dot" style={{ background: ownerColor(a) }} />
          <div>
            <strong>{a.user_id == null ? `Player ${a.slot} (unmapped)` : a.user_name ?? `Player ${a.user_id}`}</strong>
            {a.is_member === false ? <span className="muted"> (no longer on the team)</span> : null}
            {a.instruction ? <p>{a.instruction}</p> : null}
            {a.utility ? <p className="muted">Utility: {a.utility}</p> : null}
            {a.reference_url && /^https?:\/\//i.test(a.reference_url)
              ? <p><a href={a.reference_url} target="_blank" rel="noreferrer noopener">Reference</a></p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
