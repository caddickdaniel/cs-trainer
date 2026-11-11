import type { Assignment } from '../lib/types';
import { playerColor } from './MapBoard';

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
        <li key={a.user_id} className={highlight === a.user_id ? 'mine' : ''}>
          <span className="dot" style={{ background: playerColor(a.user_id, players) }} />
          <div>
            <strong>{a.user_name ?? `Player ${a.user_id}`}</strong>
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
