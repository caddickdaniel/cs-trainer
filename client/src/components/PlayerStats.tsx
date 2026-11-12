import { Link } from 'react-router-dom';
import { formatDateTime } from '../lib/hooks';
import { mapName } from '../lib/constants';
import type { PlayerStatsResponse, StatsSource } from '../lib/types';
import { Panel } from './ui';

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const fixed = (v: number | null, d = 2) => (v == null ? '—' : v.toFixed(d));

function SourceStats({ s }: { s: StatsSource }) {
  return (
    <section className="stats-source" aria-label={`${s.label} stats`}>
      <div className="row space wrap">
        <h3 className="stats-source-title">{s.label}</h3>
        <span className="muted small">{s.matches} match{s.matches === 1 ? '' : 'es'}{s.last_updated ? ` · updated ${formatDateTime(s.last_updated)}` : ''}</span>
      </div>
      <dl className="stat-tiles">
        <div><dt>Matches tracked</dt><dd>{s.matches}</dd></div>
        <div><dt>Win rate</dt><dd>{pct(s.win_rate)}</dd>
          <span className="muted small">{s.wins}W {s.losses}L{s.draws ? ` ${s.draws}D` : ''}</span></div>
        <div><dt>K/D</dt><dd>{fixed(s.kd)}</dd>
          <span className="muted small">{s.kd_no_deaths ? 'no deaths: shown as kills' : `${s.kills ?? '—'} / ${s.deaths ?? '—'}`}</span></div>
        <div><dt>ADR</dt><dd>{fixed(s.adr, 1)}</dd>
          {s.adr_matches < s.matches ? <span className="muted small">from {s.adr_matches} of {s.matches} matches</span> : null}</div>
        <div><dt>Headshot %</dt><dd>{pct(s.hs_pct)}</dd></div>
      </dl>
      {s.recent.length ? (
        <>
          <h4 className="muted small">Recent results</h4>
          <ul className="recent-results">
            {s.recent.map((r, i) => (
              <li key={i} className={`result-${(r.result ?? 'x').toLowerCase()}`}>
                <span className="result-pill">{r.result ?? '?'}</span>
                <span>{r.map ? mapName(r.map) : 'Unknown map'}</span>
                <span className="muted">{r.score ?? ''}</span>
                <span className="muted">{r.kills ?? '—'}/{r.deaths ?? '—'}/{r.assists ?? '—'}</span>
                <span className="muted small">{r.played_at ? formatDateTime(r.played_at) : ''}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

// Player Stats for Home (own, private view) and profiles (opt-in aggregates).
// Never shows demo, replay or review links.
export function PlayerStats({ data, own }: { data: PlayerStatsResponse | null; own: boolean }) {
  if (!data) return <Panel title="Player Stats"><p className="muted">Loading…</p></Panel>;
  if (!own && !data.shared) return <Panel title="Player Stats"><p className="muted">This player keeps their stats private.</p></Panel>;
  const sources = data.sources ?? [];
  const faceit = (data.providers ?? []).find((p) => p.provider === 'faceit');
  return (
    <Panel title="Player Stats" actions={own ? <Link className="btn ghost small" to="/settings#stats">Stats settings</Link> : undefined}>
      {own ? (
        <p className="muted small">
          {data.tracking ? (data.visibility === 'profile' ? 'Your aggregate stats are visible on your profile.' : 'Private: only you can see these.') : null}
        </p>
      ) : null}
      {faceit && faceit.rating != null ? (
        <p className="small">FACEIT Elo <strong>{faceit.rating}</strong>{faceit.level ? ` · Level ${faceit.level}` : ''}
          <span className="muted"> (from FACEIT{faceit.last_synced_at ? `, ${formatDateTime(faceit.last_synced_at)}` : ''})</span></p>
      ) : null}
      {sources.length ? sources.map((s) => <SourceStats key={s.source} s={s} />) : own ? (
        <div className="stats-empty">
          {!data.steam_linked ? (
            <p>Stats are matched to your verified Steam account. <Link to="/settings#steam">Link Steam</Link> to start.</p>
          ) : !data.tracking ? (
            <p>Turn on <Link to="/settings#stats">match tracking</Link> to collect stats for your Steam account.</p>
          ) : (
            <>
              <p>No tracked matches yet. Ways to start:</p>
              <ul>
                <li><Link to="/demos">Upload a CS2 demo</Link> you played in (your team's Demo Review).</li>
                <li><Link to="/settings#faceit">Connect FACEIT</Link> to import your recent FACEIT matches.</li>
              </ul>
            </>
          )}
        </div>
      ) : <p className="muted">No tracked matches yet.</p>}
      {sources.length > 1 ? <p className="muted small">Sources are shown separately so a match imported twice is never counted twice.</p> : null}
    </Panel>
  );
}
