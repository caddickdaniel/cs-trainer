import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ECONOMY_LABEL, mapName, roleLabel } from '../lib/constants';
import { useDocumentTitle, useLoad } from '../lib/hooks';
import type { Marker, Phase, RosterEntry, TacticDocument } from '../lib/types';
import { describeCounts, groundDrops, refKey, utilityPlan, type PlayerPlan } from '../lib/utility';
import { FlyingUtility, PlayPhaseBar, usePhasePlayback } from '../components/PhasePlayer';
import type { Level } from '../lib/constants';
import { Alert, Badge, Loading, Panel, SideBadge } from '../components/ui';
import { MapBoard } from '../components/MapBoard';
import { Icon } from '../components/Icons';
import { ShareDialog } from './SharedTactics';
import { PhaseInstructions } from '../components/PhaseInstructions';
import { PlayerColorsProvider } from '../lib/playerColors';
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
  // Player browser: the chosen player stays selected across phases.
  const [viewing, setViewing] = useState<number | null>(null);
  useDocumentTitle(doc.data?.tactic.tactic_name ?? 'Tactic');
  const phasesForPlan = doc.data?.tactic.phases;
  const plan = useMemo(() => utilityPlan(doc.data?.tactic.loadouts ?? [], phasesForPlan ?? [], doc.data?.tactic.side), [doc.data?.tactic.loadouts, phasesForPlan, doc.data?.tactic.side]);
  const pb = usePhasePlayback(phasesForPlan ?? [], Math.min(index, Math.max(0, (phasesForPlan?.length ?? 1) - 1)), doc.data?.tactic.map ?? 'practice_yard', plan);

  if (doc.loading && !doc.data) return <Loading />;
  if (!doc.data) return <Panel title="Tactic"><Alert>{doc.error}</Alert><Link className="btn" to="/tactics">Back</Link></Panel>;
  const { tactic, roster, can_edit: canEdit } = doc.data;
  const phase = tactic.phases[Math.min(index, tactic.phases.length - 1)];
  const players = roster.map((r) => r.user_id);
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
              <MapBoard board={pb.frame?.board ?? phase.board} map={map} level={level} players={roster} highlightUserId={viewing}
                onMarkerActivate={(m) => setOpen({ marker: m, index: 0 })} label={`Board for ${phase.name}`} bomb={tactic.side === 'T' ? tactic.bomb_carrier : null} side={tactic.side}
                ground={pb.playing ? [] : groundDrops(tactic.phases, phaseIndex)} overlay={<FlyingUtility frame={pb.frame} side={tactic.side} />} />
            </div>
            <Panel title={phase.name}>
              {phase.notes ? <p>{phase.notes}</p> : null}
              <PlayerBrowser roster={roster} phase={phase} phaseIndex={phaseIndex} plan={plan} side={tactic.side} viewing={viewing} onView={setViewing} />
              <h3>All instructions</h3>
              <PhaseInstructions assignments={phase.assignments} players={players} highlight={viewing ?? user?.user_id} />
              {phase.assignments.some((a) => a.user_id === user?.user_id) ? <Badge tone="gold">Your instruction is highlighted</Badge> : null}
              <h3>Utility</h3>
              <BuyListSummary loadouts={tactic.loadouts ?? []} bomb={tactic.bomb_carrier} phases={tactic.phases} phaseIndex={phaseIndex} side={tactic.side}
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

// Any team member can click through the team's players to read each one's
// role and their instruction for the phase shown (read only: viewing grants
// no editing or Game Mode control). The choice stays across phases.
function PlayerBrowser({ roster, phase, phaseIndex, plan, side, viewing, onView }: {
  roster: RosterEntry[]; phase: Phase; phaseIndex: number; plan: Map<string, PlayerPlan>; side: string | null;
  viewing: number | null; onView: (id: number | null) => void;
}) {
  if (!roster.length) return null;
  const who = roster.find((r) => r.user_id === viewing) ?? null;
  const a = who ? phase.assignments.find((x) => x.user_id === who.user_id) : null;
  const at = who ? plan.get(refKey({ user_id: who.user_id, slot: null }) ?? '')?.phases[phaseIndex] : undefined;
  return (
    <div className="player-browser">
      <div className="row tight wrap" role="group" aria-label="Show a player's role and instructions">
        {roster.map((r) => (
          <button key={r.user_id} type="button" className={`btn small${viewing === r.user_id ? ' primary' : ' ghost'}`} aria-pressed={viewing === r.user_id}
            onClick={() => onView(viewing === r.user_id ? null : r.user_id)}>{r.user_name}</button>
        ))}
      </div>
      {who ? (
        <div className="player-browser__card" aria-live="polite">
          <p><strong>{who.user_name}</strong> · {roleLabel(who.player_role) || 'No role set'}</p>
          {a && (a.instruction || a.utility) ? (
            <>
              {a.instruction ? <p>{a.instruction}</p> : null}
              {a.utility ? <p className="muted">Utility: {a.utility}</p> : null}
            </>
          ) : <p className="muted">No instructions for {who.user_name} in {phase.name}.</p>}
          {at && (describeCounts(at.used) || describeCounts(at.dropped) || describeCounts(at.picked)) ? (
            <p className="muted small">This phase: {[describeCounts(at.used, side) && `throws ${describeCounts(at.used, side)}`, describeCounts(at.dropped, side) && `drops ${describeCounts(at.dropped, side)}`, describeCounts(at.picked, side) && `picks up ${describeCounts(at.picked, side)}`].filter(Boolean).join('; ')}.</p>
          ) : null}
        </div>
      ) : <p className="muted small">Choose a player to see their role and instructions for this phase.</p>}
    </div>
  );
}
