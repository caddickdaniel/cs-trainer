// Tactic editor (Phase 15): each player's utility order for a phase, shown
// in their Player Instructions. Throws (their utility markers) and drops
// (placed with the Drop tool on the map) run in this order during Play Phase,
// 0.5 s apart. Reordering only changes `seq`, so each marker keeps its
// player and throw path (and shared tactics keep the order by slot). Route
// pickups and problems found by the plan are listed under the order.
import type { Board, BoardAction, PlayerRef, RosterEntry } from '../lib/types';
import { THROWN, issueText, itemWord, phaseSteps, refKey, type Grenade, type GroundItem, type PhaseSim, type PlayerPlan } from '../lib/utility';
import { newId } from './MapBoard';
import { UtilityIcon } from './UtilityIcon';

export function PlayerUtilityOrder({ who, board, earlier, side, plan, sim, ground = [], phaseIndex, roster, onBoard }: {
  who: PlayerRef; board: Board; earlier: Set<string>; side: string; plan?: PlayerPlan; sim?: PhaseSim | null; ground?: GroundItem[];
  phaseIndex: number; roster: RosterEntry[]; onBoard: (b: Board) => void;
}) {
  const key = refKey(who);
  const mine = phaseSteps(board, new Set(earlier)).filter((s) => s.key === key);
  const ids = mine.map((s) => s.id);
  const actions = board.actions ?? [];
  const nameOf = (k: string) => (k.startsWith('u') ? roster.find((r) => `u${r.user_id}` === k)?.user_name ?? 'Former player' : `Player ${k.slice(1)}`);
  const reorder = (next: string[]) => {
    const seq = new Map(next.map((id, i) => [id, i]));
    onBoard({
      ...board,
      markers: board.markers.map((m) => (seq.has(m.id) && refKey(m) === key ? { ...m, seq: seq.get(m.id) } : m)),
      actions: actions.map((a) => (seq.has(a.id) && refKey(a) === key ? { ...a, seq: seq.get(a.id) } : a)),
    });
  };
  const describe = (id: string, type: string) => {
    const kind = (type === 'throw' ? board.markers.find((x) => x.id === id)?.kind : actions.find((x) => x.id === id)?.kind) as Grenade | undefined;
    const label = kind ? itemWord(kind, side) : 'item';
    return <>{kind ? <UtilityIcon kind={kind} side={side} size={16} label="" /> : null} {type === 'throw' ? `Throw ${label}` : `Drop ${label}`}</>;
  };
  const issues = (plan?.over ?? []).filter((o) => o.phase === phaseIndex);
  const picks = (sim?.pickups ?? []).filter((p) => p.key === key);
  const blocked = (sim?.blocked ?? []).filter((p) => p.key === key && !picks.some((x) => x.id === p.id));
  const dropper = (id: string) => sim?.steps.find((s) => s.id === id)?.key ?? ground.find((g) => g.id === id)?.key;
  const earlierPhase = (id: string) => ground.some((g) => g.id === id);
  return (
    <div className="order-list" data-utility-order={key ?? ''}>
      <span className="field-label">Utility order <span className="muted">(Play Phase runs it top to bottom, 0.5 s apart)</span></span>
      {mine.length ? (
        <ol>
          {mine.map((s, i) => (
            <li key={s.id} data-order-item={s.id}>
              <span className="order-num" aria-hidden="true">{i + 1}</span>
              <span className="order-item">{describe(s.id, s.type)}</span>
              <button type="button" className="btn ghost small" aria-label={`Move ${i + 1} earlier`} disabled={i === 0}
                onClick={() => { const n = [...ids]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; reorder(n); }}>↑</button>
              <button type="button" className="btn ghost small" aria-label={`Move ${i + 1} later`} disabled={i === mine.length - 1}
                onClick={() => { const n = [...ids]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; reorder(n); }}>↓</button>
              {s.type === 'drop' ? (
                <button type="button" className="btn ghost small danger" aria-label="Remove drop"
                  onClick={() => onBoard({ ...board, actions: actions.filter((a) => a.id !== s.id) })}>✕</button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : <p className="muted small">No throws or drops for this player in this phase. Place utility or use the Drop tool on the map.</p>}
      {picks.map((p) => (
        <p key={p.id} className="small ok-text"><UtilityIcon kind={p.kind} side={side} size={14} label="" /> Picks up the {itemWord(p.kind, side)}
          {dropper(p.id) ? ` dropped by ${nameOf(dropper(p.id)!)}` : ' left on the ground'}{earlierPhase(p.id) ? ' in an earlier phase' : ''} on their route ({p.t.toFixed(1)} s).</p>
      ))}
      {blocked.map((p) => (
        <p key={`b${p.id}`} className="small muted">Passes the dropped {itemWord(p.kind, side)} but can&apos;t carry it then; it stays on the ground.</p>
      ))}
      {issues.map((o, i) => <p key={i} className="error-text small" role="alert">{issueText(o, side)}</p>)}
    </div>
  );
}

// A drop placed with the Drop tool, last in the player's order.
export function placeDrop(board: Board, who: PlayerRef, kind: Grenade, at: { x: number; y: number }, level: string): Board {
  const action: BoardAction = { id: newId('a'), type: 'drop', user_id: who.user_id ?? null, slot: who.user_id != null ? null : who.slot ?? null, kind, x: at.x, y: at.y, level: level as BoardAction['level'], seq: ownerSeq(board, who) };
  return { ...board, actions: [...(board.actions ?? []), action] };
}

// The next order position for a player's new throw or drop.
export const ownerSeq = (board: Board, who: PlayerRef) => {
  const key = refKey(who);
  const seqs = [...board.markers.filter((m) => (THROWN as readonly string[]).includes(m.kind) && refKey(m) === key), ...(board.actions ?? []).filter((a) => refKey(a) === key)];
  return seqs.length ? Math.max(seqs.length - 1, ...seqs.map((x) => x.seq ?? -1)) + 1 : 0;
};
