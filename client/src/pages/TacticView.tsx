import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ECONOMY_LABEL, mapName } from '../lib/constants';
import { useDocumentTitle, useLoad } from '../lib/hooks';
import type { Marker, RosterEntry, TacticDocument } from '../lib/types';
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
  useDocumentTitle(doc.data?.tactic.tactic_name ?? 'Tactic');

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
              <MapBoard board={phase.board} map={map} level={level} players={roster} highlightUserId={null}
                onMarkerActivate={(m) => setOpen({ marker: m, index: 0 })} label={`Board for ${phase.name}`} bomb={tactic.side === 'T' ? tactic.bomb_carrier : null} />
            </div>
            <Panel title={phase.name}>
              {phase.notes ? <p>{phase.notes}</p> : null}
              <PhaseInstructions assignments={phase.assignments} players={players} highlight={user?.user_id} />
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
