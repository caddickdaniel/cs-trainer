import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ECONOMIES, ECONOMY_LABEL, mapName } from '../lib/constants';
import { formatDateTime, useDocumentTitle, useLoad } from '../lib/hooks';
import type { TacticSummary } from '../lib/types';
import { Alert, Loading, NeedsTeam, Panel, SideBadge } from '../components/ui';
import { Icon } from '../components/Icons';
import { BrowseShared } from './SharedTactics';

// Team library and the community Browse tab.
export function TacticsPage() {
  useDocumentTitle('Tactics');
  const [params, setParams] = useSearchParams();
  const browse = params.get('tab') === 'browse';
  return (
    <div className="stack">
      <div className="tabs" role="tablist" aria-label="Tactics">
        <button type="button" role="tab" aria-selected={!browse} className={!browse ? 'on' : ''} onClick={() => setParams({})}>Team library</button>
        <button type="button" role="tab" aria-selected={browse} className={browse ? 'on' : ''} onClick={() => setParams({ tab: 'browse' })}>Browse shared</button>
      </div>
      {browse ? <Panel title="Shared by the community"><BrowseShared /></Panel> : <TeamLibrary />}
    </div>
  );
}

function TeamLibrary() {
  const { active_team: team } = useAuth();
  const teamId = team?.team_id;
  const list = useLoad(
    () => (teamId ? api.get<{ tactics: TacticSummary[]; can_edit: boolean }>(`/teams/${teamId}/tactics`) : Promise.resolve(null)),
    [teamId]
  );
  const [search, setSearch] = useState('');
  const [side, setSide] = useState<'' | 'T' | 'CT'>('');
  const [economy, setEconomy] = useState('');

  const filtered = useMemo(() => (list.data?.tactics ?? []).filter((t) =>
    (!search || t.tactic_name.toLowerCase().includes(search.toLowerCase()))
    && (!side || t.side === side)
    && (!economy || t.economy === economy)), [list.data, search, side, economy]);

  if (!team) return <NeedsTeam what="Tactics" />;
  if (list.loading && !list.data) return <Loading />;

  return (
    <Panel title="Saved Tactics" actions={list.data?.can_edit ? (
      <Link className="btn primary" to="/tactics/new"><Icon name="plus" /> New tactic</Link>
    ) : null}>
      <Alert>{list.error}</Alert>
      <div className="row wrap filters">
        <input type="search" placeholder="Search by name…" aria-label="Search tactics" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="segmented" role="group" aria-label="Side">
          {(['', 'T', 'CT'] as const).map((s) => (
            <button key={s || 'all'} type="button" className={side === s ? 'on' : ''} aria-pressed={side === s} onClick={() => setSide(s)}>{s || 'All sides'}</button>
          ))}
        </div>
        <select aria-label="Economy" value={economy} onChange={(e) => setEconomy(e.target.value)}>
          <option value="">All economies</option>
          {ECONOMIES.map((e) => <option key={e} value={e}>{ECONOMY_LABEL[e]}</option>)}
        </select>
      </div>
      {filtered.length ? (
        <table className="table">
          <thead><tr><th>Name</th><th>Side</th><th>Economy</th><th>Map</th><th>Phases</th><th>Updated</th></tr></thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.tactic_id}>
                <td><Link to={`/tactics/${t.tactic_id}`}>{t.tactic_name}</Link>
                  {t.share_id ? <span className="muted small"> · shared</span> : null}
                  {t.imported_from_share_id ? <span className="muted small"> · imported</span> : null}</td>
                <td><SideBadge side={t.side} /></td>
                <td>{ECONOMY_LABEL[t.economy] ?? t.economy}</td>
                <td className="muted">{mapName(t.map)}</td>
                <td>{t.phase_count}</td>
                <td className="muted">{formatDateTime(t.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">{list.data?.tactics.length ? 'No tactics match these filters.' : 'No tactics yet.'}
          {list.data?.can_edit && !list.data.tactics.length ? <> <Link to="/tactics/new">Create the first one.</Link></> : null}</p>
      )}
    </Panel>
  );
}
