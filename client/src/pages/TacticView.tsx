import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ECONOMY_LABEL, mapName, roleLabel } from '../lib/constants';
import { useDocumentTitle, useLoad } from '../lib/hooks';
import type { Marker, Phase, RosterEntry, TacticDocument } from '../lib/types';
import { describeCounts, issueText, itemWord, phasePlan, phaseSteps, refKey, type Grenade, type PhaseSim, type PlayerPlan } from '../lib/utility';
import { FlyingUtility, PlayPhaseBar, usePhasePlayback } from '../components/PhasePlayer';
import type { Level } from '../lib/constants';
import { Alert, Loading, Panel, SideBadge } from '../components/ui';
import { MapBoard } from '../components/MapBoard';
import { Icon } from '../components/Icons';
import { ShareDialog } from './SharedTactics';
import { PlayerColorsProvider, usePlayerColors } from '../lib/playerColors';
import { UtilityIcon } from '../components/UtilityIcon';
import { BuyListSummary } from '../components/UtilityCard';
import { LevelSwitch, LineupGallery, LineupLightbox, lineupMarkers, preferredLevel } from '../components/Lineups';

export interface DocumentResponse { tactic: TacticDocument; roster: RosterEntry[]; can_edit: boolean }

export function TacticViewPage() {
  const { tacticId } = useParams();
  const { user } = useAuth();
  const doc = useLoad(() => api.get<DocumentResponse>(`/tactics/${tacticId}/document`), [tacticId]);
  const [index, setIndex] = useState(0);
  const [levelChoice, setLevelChoice] = useState<{ phase: number; level: Level } | null>(null);
  const [open, setOpen] = useState<{ marker: Marker; index: number } | null>(null);
  const [sharing, setSharing] = useState(false);
  // Player cards: whose All instructions are open (kept across phases).
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());
  useDocumentTitle(doc.data?.tactic.tactic_name ?? 'Tactic');
  const phasesForPlan = doc.data?.tactic.phases;
  const tplan = useMemo(() => phasePlan(doc.data?.tactic.loadouts ?? [], phasesForPlan ?? [], doc.data?.tactic.side, doc.data?.tactic.map,
    doc.data?.tactic.side === 'T' ? doc.data?.tactic.bomb_carrier : null), [doc.data?.tactic.loadouts, phasesForPlan, doc.data?.tactic.side, doc.data?.tactic.map, doc.data?.tactic.bomb_carrier]);
  const plan = tplan.players;
  const pb = usePhasePlayback(phasesForPlan ?? [], Math.min(index, Math.max(0, (phasesForPlan?.length ?? 1) - 1)), tplan);

  if (doc.loading && !doc.data) return <Loading />;
  if (!doc.data) return <Panel title="Tactic"><Alert>{doc.error}</Alert><Link className="btn" to="/tactics">Back</Link></Panel>;
  const { tactic, roster, can_edit: canEdit } = doc.data;
  const phase = tactic.phases[Math.min(index, tactic.phases.length - 1)];
  const phaseIndex = Math.min(index, tactic.phases.length - 1);
  const map = tactic.map ?? 'practice_yard';
  const level = phase
    ? (levelChoice?.phase === phaseIndex ? levelChoice.level : preferredLevel(map, phase.board, user?.user_id))
    : 'main';
  const lineups = phase ? lineupMarkers(phase.board) : [];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{tactic.tactic_name}</h1>
          <p className="muted">
            <SideBadge side={tactic.side} /> {ECONOMY_LABEL[tactic.economy] ?? tactic.economy} · {mapName(tactic.map)} ·
            rev {tactic.revision}
          </p>
        </div>
        <div className="row">
          <Link className="btn ghost" to="/tactics">Library</Link>
          {canEdit ? <Link className="btn" to={`/tactics/${tactic.tactic_id}/edit`}>Edit</Link> : null}
          {canEdit && tactic.map && tactic.phases.length ? <button type="button" className="btn" onClick={() => setSharing(true)}><Icon name="share" /> Share</button> : null}
          {canEdit && tactic.phases.length ? <Link className="btn primary" to={`/game?tactic=${tactic.tactic_id}`}>Use in Game Mode</Link> : null}
        </div>
      </div>
      {tactic.phases.some((p) => [...p.board.markers, ...p.assignments].some((i) => i.user_id == null && i.slot))
        ? <Alert kind="info">This tactic still has unmapped Player slots. {canEdit ? <Link to={`/tactics/${tactic.tactic_id}/edit`}>Map them to your roster</Link> : 'Your owner or IGL can map them to the roster.'}</Alert> : null}
      {!tactic.phases.length ? <Alert kind="info">This tactic has no phases yet.</Alert> : (
        <>
          <div className="phase-tabs" role="tablist" aria-label="Phases">
            {tactic.phases.map((p, i) => (
              <button key={i} type="button" role="tab" aria-selected={i === index} className={i === index ? 'on' : ''} onClick={() => setIndex(i)}>
                {i + 1}. {p.name}
              </button>
            ))}
          </div>
          <PlayerColorsProvider colors={tactic.player_colors}>
          <div className="board-layout">
            <div className="stack">
              <LevelSwitch map={map} level={level} board={phase.board} onChange={(l) => setLevelChoice({ phase: phaseIndex, level: l })} />
              <PlayPhaseBar pb={pb} side={tactic.side}
                name={(key) => (key.startsWith('u') ? roster.find((r) => `u${r.user_id}` === key)?.user_name ?? 'Former player' : `Player ${key.slice(1)}`)} />
              <MapBoard board={pb.frame?.board ?? phase.board} map={map} level={level} players={roster} highlightUserId={user?.user_id ?? null} playing={pb.playing}
                onMarkerActivate={(m) => setOpen({ marker: m, index: 0 })} label={`Board for ${phase.name}`} bomb={tactic.side === 'T' ? tactic.bomb_carrier : null} side={tactic.side}
                ground={pb.frame ? pb.frame.ground : tplan.grounds[phaseIndex] ?? []} overlay={<FlyingUtility frame={pb.frame} side={tactic.side} />} />
            </div>
            <Panel title={phase.name}>
              {phase.notes ? <p>{phase.notes}</p> : null}
              <h3>Players</h3>
              <PlayerCards roster={roster} phases={tactic.phases} phaseIndex={phaseIndex} plan={plan} sim={tplan.sims[phaseIndex] ?? null} side={tactic.side}
                me={user?.user_id ?? null} open={openCards}
                onToggle={(k) => setOpenCards((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />
              <h3>Utility</h3>
              <BuyListSummary loadouts={tactic.loadouts ?? []} bomb={tactic.bomb_carrier} phases={tactic.phases} phaseIndex={phaseIndex} side={tactic.side} plan={plan}
                name={(r) => (r.user_id != null ? roster.find((x) => x.user_id === r.user_id)?.user_name ?? 'Former player' : `Player ${r.slot}`)} />
              {lineups.length ? (
                <>
                  <h3>Lineups</h3>
                  <LineupGallery markers={lineups} onOpen={(m, i) => setOpen({ marker: m, index: i })} />
                </>
              ) : null}
            </Panel>
          </div>
          </PlayerColorsProvider>
        </>
      )}
      <LineupLightbox marker={open?.marker ?? null} index={open?.index ?? 0}
        onIndex={(i) => setOpen((o) => (o ? { ...o, index: i } : o))} onClose={() => setOpen(null)} />
      {sharing ? <ShareDialog tacticId={tactic.tactic_id} onClose={() => setSharing(false)} /> : null}
    </div>
  );
}

// Phase overview: a card per player. Any team member can open a player's
// All instructions to read their role, instruction and utility for the phase
// shown (read only: no editing or Game Mode control). Open cards stay open
// when the phase changes.
function PlayerCards({ roster, phases, phaseIndex, plan, sim, side, me, open, onToggle }: {
  roster: RosterEntry[]; phases: Phase[]; phaseIndex: number; plan: Map<string, PlayerPlan>; sim: PhaseSim | null; side: string | null;
  me: number | null; open: Set<string>; onToggle: (key: string) => void;
}) {
  const colorOf = usePlayerColors();
  const phase = phases[phaseIndex];
  const slots = [...new Set(phases.flatMap((p) => [...p.board.markers, ...p.assignments, ...(p.board.actions ?? [])])
    .filter((i) => i.user_id == null && i.slot).map((i) => i.slot as number))].sort((a, b) => a - b);
  const former = phase.assignments.filter((a) => a.user_id != null && !roster.some((r) => r.user_id === a.user_id));
  const cards = [
    ...roster.map((r) => ({ key: `u${r.user_id}`, ref: { user_id: r.user_id, slot: null }, name: r.user_name, role: roleLabel(r.player_role) || 'No role set' })),
    ...former.map((a) => ({ key: `u${a.user_id}`, ref: { user_id: a.user_id, slot: null }, name: a.user_name ?? 'Former player', role: 'No longer on the team' })),
    ...slots.map((n) => ({ key: `s${n}`, ref: { user_id: null, slot: n }, name: `Player ${n}`, role: 'Unmapped player slot' })),
  ];
  if (!cards.length) return <p className="muted small">No players yet.</p>;
  const earlier = new Set(phases.slice(0, phaseIndex).flatMap((p) => p.board.markers.map((m) => m.id)));
  const steps = phaseSteps(phase.board, earlier);
  const kindOf = (id: string, type: string) => (type === 'throw' ? phase.board.markers.find((m) => m.id === id)?.kind : (phase.board.actions ?? []).find((a) => a.id === id)?.kind) as Grenade | undefined;
  return (
    <ul className="player-cards">
      {cards.map((c) => {
        const a = phase.assignments.find((x) => refKey(x) === c.key);
        const p = plan.get(c.key);
        const at = p?.phases[phaseIndex];
        const mine = steps.filter((s) => s.key === c.key);
        const picks = (sim?.pickups ?? []).filter((x) => x.key === c.key);
        const over = (p?.over ?? []).filter((o) => o.phase === phaseIndex);
        const isOpen = open.has(c.key);
        const id = `card-${c.key}`;
        return (
          <li key={c.key} className={`player-card${c.ref.user_id != null && c.ref.user_id === me ? ' mine' : ''}`} data-player-card={c.key}>
            <div className="player-card__head">
              <span className="dot" style={{ background: colorOf(c.ref) }} />
              <span className="player-card__name"><strong>{c.name}</strong><span className="muted small">{c.role}</span></span>
              <button type="button" className={`btn small${isOpen ? ' primary' : ' ghost'}`} aria-expanded={isOpen} aria-controls={id} onClick={() => onToggle(c.key)}>
                All instructions</button>
            </div>
            {!isOpen && a?.instruction ? <p className="player-card__peek small">{a.instruction}</p> : null}
            {isOpen ? (
              <div className="player-card__body" id={id} aria-live="polite">
                <p className="small"><span className="muted">Role:</span> {c.role}</p>
                {a && (a.instruction || a.utility) ? (
                  <>
                    {a.instruction ? <p>{a.instruction}</p> : null}
                    {a.utility ? <p className="muted">Utility note: {a.utility}</p> : null}
                  </>
                ) : <p className="muted">No instructions for {c.name} in {phase.name}.</p>}
                {mine.length ? (
                  <ol className="player-card__steps small" aria-label={`${c.name}'s utility in order`}>
                    {mine.map((s) => {
                      const k = kindOf(s.id, s.type);
                      return <li key={s.id}>{k ? <UtilityIcon kind={k} side={side} size={14} label="" /> : null} {s.type === 'throw' ? 'Throw' : 'Drop'} {k ? itemWord(k, side) : 'item'}</li>;
                    })}
                  </ol>
                ) : <p className="muted small">No utility to throw or drop in this phase.</p>}
                {picks.map((x) => <p key={x.id} className="small ok-text">Picks up a dropped {itemWord(x.kind, side)} on their route.</p>)}
                {at ? <p className="muted small">{phaseIndex === 0 ? 'Buys' : 'Carries at the start'}: {describeCounts(at.start, side) || 'no grenades'}.</p> : null}
                {over.map((o, i) => <p key={i} className="error-text small">{issueText(o, side)}</p>)}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
