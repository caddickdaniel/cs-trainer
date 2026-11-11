import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ECONOMY_LABEL, mapName } from '../lib/constants';
import { useDocumentTitle, useLoad } from '../lib/hooks';
import type { RosterEntry, TacticDocument } from '../lib/types';
import { Alert, Badge, Loading, Panel, SideBadge } from '../components/ui';
import { MapBoard } from '../components/MapBoard';
import { PhaseInstructions } from '../components/PhaseInstructions';

export interface DocumentResponse { tactic: TacticDocument; roster: RosterEntry[]; can_edit: boolean }

export function TacticViewPage() {
  const { tacticId } = useParams();
  const { user } = useAuth();
  const doc = useLoad(() => api.get<DocumentResponse>(`/tactics/${tacticId}/document`), [tacticId]);
  const [index, setIndex] = useState(0);
  useDocumentTitle(doc.data?.tactic.tactic_name ?? 'Tactic');

  if (doc.loading && !doc.data) return <Loading />;
  if (!doc.data) return <Panel title="Tactic"><Alert>{doc.error}</Alert><Link className="btn" to="/tactics">Back</Link></Panel>;
  const { tactic, roster, can_edit: canEdit } = doc.data;
  const phase = tactic.phases[Math.min(index, tactic.phases.length - 1)];
  const players = roster.map((r) => r.user_id);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{tactic.tactic_name}</h1>
          <p className="muted">
            <SideBadge side={tactic.side} /> {ECONOMY_LABEL[tactic.economy] ?? tactic.economy} · {mapName(tactic.map)} ·
            Utility: {tactic.smoke} smoke, {tactic.flash} flash, {tactic.molly} molly, {tactic.grenade} HE · rev {tactic.revision}
          </p>
        </div>
        <div className="row">
          <Link className="btn ghost" to="/tactics">Library</Link>
          {canEdit ? <Link className="btn" to={`/tactics/${tactic.tactic_id}/edit`}>Edit</Link> : null}
          {canEdit && tactic.phases.length ? <Link className="btn primary" to={`/game?tactic=${tactic.tactic_id}`}>Use in Game Mode</Link> : null}
        </div>
      </div>
      {!tactic.phases.length ? <Alert kind="info">This tactic has no phases yet.</Alert> : (
        <>
          <div className="phase-tabs" role="tablist" aria-label="Phases">
            {tactic.phases.map((p, i) => (
              <button key={i} type="button" role="tab" aria-selected={i === index} className={i === index ? 'on' : ''} onClick={() => setIndex(i)}>
                {i + 1}. {p.name}
              </button>
            ))}
          </div>
          <div className="board-layout">
            <MapBoard board={phase.board} players={roster} highlightUserId={null} label={`Board for ${phase.name}`} />
            <Panel title={phase.name}>
              {phase.notes ? <p>{phase.notes}</p> : null}
              <PhaseInstructions assignments={phase.assignments} players={players} highlight={user?.user_id} />
              {phase.assignments.some((a) => a.user_id === user?.user_id) ? <Badge tone="gold">Your instruction is highlighted</Badge> : null}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
