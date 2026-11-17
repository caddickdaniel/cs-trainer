// Tactic editor (Phase 14): a phase's drops and pickups, and each player's
// utility order (throws, drops and pickups in the order they happen; Play
// Phase follows it). Inventory problems and broken links are flagged here
// and the save path rejects broken links.
import { useState } from 'react';
import type { Board, BoardAction, Phase, PlayerRef, RosterEntry } from '../lib/types';
import { actionErrors, groundDrops, issueText, itemLabel, phaseSteps, refKey, THROWN, GRENADES, type Grenade, type PlayerPlan } from '../lib/utility';
import { newId } from './MapBoard';
import { UtilityIcon } from './UtilityIcon';

type Who = { user_id: number | null; slot: number | null };
const whoValue = (w: { user_id: number | null; slot?: number | null } | null) => (!w ? '' : w.user_id != null ? `u${w.user_id}` : w.slot ? `s${w.slot}` : '');
const parseWho = (v: string): Who => (v.startsWith('u') ? { user_id: Number(v.slice(1)), slot: null }
  : v.startsWith('s') ? { user_id: null, slot: Number(v.slice(1)) } : { user_id: null, slot: null });

export interface Placing { type: 'drop'; who: Who; kind: Grenade }

export function UtilityActions({ phases, index, roster, slots, side, plan, onBoard, placing, setPlacing }: {
  phases: Phase[]; index: number; roster: RosterEntry[]; slots: number[]; side: string;
  plan: Map<string, PlayerPlan>; onBoard: (b: Board) => void;
  placing: Placing | null; setPlacing: (p: Placing | null) => void;
}) {
  const phase = phases[index];
  const board = phase.board;
  const actions = board.actions ?? [];
  const nameOf = (r: { user_id: number | null; slot?: number | null }) => (r.user_id != null
    ? roster.find((x) => x.user_id === r.user_id)?.user_name ?? 'Former player' : `Player ${r.slot}`);
  const players: Who[] = [...roster.map((r) => ({ user_id: r.user_id, slot: null })), ...slots.map((n) => ({ user_id: null, slot: n }))];
  const [dropWho, setDropWho] = useState('');
  const [dropKind, setDropKind] = useState<Grenade>('flash');
  const [pickWho, setPickWho] = useState('');
  const [pickDrop, setPickDrop] = useState('');

  // Every action in this phase in its phase order (for the order lists).
  const steps = phaseSteps(board, new Set(phases.slice(0, index).flatMap((p) => p.board.markers.map((m) => m.id))));
  const owners = [...new Set(steps.map((s) => s.key))];
  // Drops a pickup can take: still on the ground from earlier phases, or
  // dropped in this phase and not picked up yet.
  // Drops already picked up in any phase can't be picked up again.
  const pickedHere = new Set(phases.flatMap((p) => (p.board.actions ?? []).filter((a) => a.type === 'pickup').map((a) => a.drop_id)));
  const available = [
    ...groundDrops(phases, index).filter((d) => !pickedHere.has(d.id)).map((d) => ({ ...d, label: `${itemLabel(d.kind, side)} dropped by ${nameOf(d.owner)} (phase ${d.phase + 1})` })),
    ...actions.filter((a) => a.type === 'drop' && !pickedHere.has(a.id)).map((a) => ({ id: a.id, kind: a.kind as Grenade, x: a.x, y: a.y, level: a.level ?? 'main', owner: a, label: `${itemLabel(a.kind as Grenade, side)} dropped by ${nameOf(a)} (this phase)` })),
  ];
  const errors = actionErrors(phases).filter((e) => e.phase === index);
  const issues = [...plan.values()].flatMap((p) => p.over.filter((o) => o.phase === index).map((o) => ({ who: p.key, o })));

  const setActions = (next: BoardAction[]) => onBoard({ ...board, actions: next });
  // Puts a player's items in the given order (seq 0..n) on markers and actions.
  const reorder = (key: string, ids: string[]) => {
    const seq = new Map(ids.map((id, i) => [id, i]));
    onBoard({
      ...board,
      markers: board.markers.map((m) => (seq.has(m.id) && refKey(m) === key ? { ...m, seq: seq.get(m.id) } : m)),
      actions: actions.map((a) => (seq.has(a.id) && refKey(a) === key ? { ...a, seq: seq.get(a.id) } : a)),
    });
  };
  const nextSeq = (who: Who) => steps.filter((s) => s.key === whoValue(who)).length;
  const describe = (id: string, type: string) => {
    if (type === 'throw') {
      const m = board.markers.find((x) => x.id === id);
      return m ? <><UtilityIcon kind={m.kind} side={side} size={16} label="" /> Throw {itemLabel(m.kind as Grenade, side).toLowerCase()}</> : 'Throw';
    }
    const a = actions.find((x) => x.id === id);
    if (!a) return type;
    if (a.type === 'drop') return <><UtilityIcon kind={a.kind ?? 'flash'} side={side} size={16} label="" /> Drop {itemLabel(a.kind as Grenade, side).toLowerCase()}</>;
    const d = available.find((x) => x.id === a.drop_id) ?? groundDrops(phases, index).find((x) => x.id === a.drop_id);
    const dk = (d?.kind ?? actions.find((x) => x.id === a.drop_id)?.kind) as Grenade | undefined;
    return <>{dk ? <UtilityIcon kind={dk} side={side} size={16} label="" /> : null} Pick up {dk ? itemLabel(dk, side).toLowerCase() : 'item'}</>;
  };

  return (
    <div className="stack utility-actions">
      <div className="action-row">
        <strong className="small">Drop</strong>
        <select aria-label="Player dropping" value={dropWho} onChange={(e) => setDropWho(e.target.value)}>
          <option value="">Player…</option>
          {players.map((w) => <option key={whoValue(w)} value={whoValue(w)}>{nameOf(w)}</option>)}
        </select>
        <select aria-label="Item to drop" value={dropKind} onChange={(e) => setDropKind(e.target.value as Grenade)}>
          {GRENADES.map((g) => <option key={g} value={g}>{itemLabel(g, side)}</option>)}
        </select>
        <button type="button" className={`btn small${placing ? ' primary' : ''}`} disabled={!dropWho || actions.length >= 30}
          onClick={() => setPlacing(placing ? null : { type: 'drop', who: parseWho(dropWho), kind: dropKind })}>
          {placing ? 'Click the map… (cancel)' : 'Place on map'}</button>
      </div>
      <div className="action-row">
        <strong className="small">Pick up</strong>
        <select aria-label="Player picking up" value={pickWho} onChange={(e) => setPickWho(e.target.value)}>
          <option value="">Player…</option>
          {players.map((w) => <option key={whoValue(w)} value={whoValue(w)}>{nameOf(w)}</option>)}
        </select>
        <select aria-label="Dropped item to pick up" value={pickDrop} onChange={(e) => setPickDrop(e.target.value)}>
          <option value="">{available.length ? 'Dropped item…' : 'No dropped items available'}</option>
          {available.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        <button type="button" className="btn small" disabled={!pickWho || !pickDrop || actions.length >= 30}
          onClick={() => {
            const d = available.find((x) => x.id === pickDrop);
            if (!d) return;
            const who = parseWho(pickWho);
            // After the drop when it is in this phase (pickups can't come first).
            const dropStep = steps.find((x) => x.id === d.id)?.step ?? -1;
            setActions([...actions, { id: newId('a'), type: 'pickup', ...who, drop_id: d.id, x: d.x, y: d.y, level: (d.level ?? 'main') as BoardAction['level'], seq: Math.max(nextSeq(who), dropStep + 1) }]);
            setPickDrop('');
          }}>Add pickup</button>
      </div>
      {errors.map((e) => <p key={e.id + e.message} className="error-text small" role="alert">{e.message}.</p>)}
      {issues.map(({ who, o }, i) => (
        <p key={`${who}${i}`} className="error-text small" role="alert">{nameOf(parseWho(who))}: {issueText(o, side)}</p>
      ))}
      {owners.length ? (
        <div className="stack tight">
          <span className="field-label">Utility order this phase <span className="muted">(Play Phase runs each player's list in order, 0.5 s apart)</span></span>
          {owners.map((key) => {
            const mine = steps.filter((s) => s.key === key);
            const ids = mine.map((s) => s.id);
            return (
              <div key={key} className="order-list">
                <span className="small"><strong>{nameOf(parseWho(key))}</strong></span>
                <ol>
                  {mine.map((s, i) => (
                    <li key={s.id}>
                      <span className="order-item">{describe(s.id, s.type)}</span>
                      <button type="button" className="btn ghost small" aria-label="Earlier" disabled={i === 0}
                        onClick={() => { const n = [...ids]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; reorder(key, n); }}>↑</button>
                      <button type="button" className="btn ghost small" aria-label="Later" disabled={i === mine.length - 1}
                        onClick={() => { const n = [...ids]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; reorder(key, n); }}>↓</button>
                      {s.type !== 'throw' ? (
                        <button type="button" className="btn ghost small danger" aria-label="Remove"
                          onClick={() => setActions(actions.filter((a) => a.id !== s.id && a.drop_id !== s.id))}>✕</button>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      ) : <p className="muted small">No throws, drops or pickups in this phase yet.</p>}
      <p className="muted small">Throws are the utility markers assigned to a player. {THROWN.length} grenade types can be thrown; decoys can be bought and dropped.</p>
    </div>
  );
}

// The drop being placed when the map is clicked.
export function placeDrop(board: Board, placing: Placing, at: { x: number; y: number }, level: string, seq: number): Board {
  const action: BoardAction = { id: newId('a'), type: 'drop', ...placing.who, kind: placing.kind, x: at.x, y: at.y, level: level as BoardAction['level'], seq };
  return { ...board, actions: [...(board.actions ?? []), action] };
}

export const ownerSeq = (board: Board, who: PlayerRef) => {
  const key = refKey(who);
  return [...board.markers.filter((m) => (THROWN as readonly string[]).includes(m.kind) && refKey(m) === key), ...(board.actions ?? []).filter((a) => refKey(a) === key)].length;
};
