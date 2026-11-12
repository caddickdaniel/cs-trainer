import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ECONOMIES, ECONOMY_LABEL, MAPS, mapName, type Level } from '../lib/constants';
import { formatDateTime, useDocumentTitle, useLoad } from '../lib/hooks';
import type { Marker, SharedListing, SharedTactic, SharePreview } from '../lib/types';
import { Alert, Loading, Panel, SideBadge } from '../components/ui';
import { Icon } from '../components/Icons';
import { MapBoard, ownerColor } from '../components/MapBoard';
import { LevelSwitch, LineupGallery, LineupLightbox, lineupMarkers } from '../components/Lineups';

// Up/down vote with a derived net score. Clicking your current vote removes it.
export function VoteControl({ listing, onChange }: { listing: SharedListing; onChange: (l: SharedListing) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cast = async (value: 1 | -1) => {
    setBusy(true);
    setError(null);
    try {
      const next = listing.my_vote === value ? 0 : value;
      const res = await api.put<{ tactic: SharedListing }>(`/shared-tactics/${listing.share_id}/vote`, { value: next });
      onChange(res.tactic);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="vote" title={`${listing.upvotes} up, ${listing.downvotes} down`}>
      <button type="button" className={`up${listing.my_vote === 1 ? ' on' : ''}`} disabled={busy || listing.is_mine}
        aria-pressed={listing.my_vote === 1} aria-label="Upvote" onClick={() => cast(1)}><Icon name="vote_up" size={16} /></button>
      <span className="score" aria-label={`Net rating ${listing.score}`}>{listing.score > 0 ? `+${listing.score}` : listing.score}</span>
      <button type="button" className={`down${listing.my_vote === -1 ? ' on' : ''}`} disabled={busy || listing.is_mine}
        aria-pressed={listing.my_vote === -1} aria-label="Downvote" onClick={() => cast(-1)}><Icon name="vote_down" size={16} /></button>
      {error ? <span className="error-text">{error}</span> : null}
    </span>
  );
}

export function BrowseShared() {
  const [filters, setFilters] = useState({ map: '', side: '', economy: '', sort: 'top', q: '' });
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const list = useLoad(() => api.get<{ tactics: SharedListing[] }>(`/shared-tactics${query ? `?${query}` : ''}`), [query]);
  const set = (patch: Partial<typeof filters>) => setFilters({ ...filters, ...patch });
  const replace = (l: SharedListing) => list.setData((d) => (d ? { tactics: d.tactics.map((x) => (x.share_id === l.share_id ? l : x)) } : d));
  return (
    <div className="stack">
      <div className="row wrap filters">
        <input type="search" placeholder="Search shared tactics…" aria-label="Search shared tactics" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
        <select aria-label="Map" value={filters.map} onChange={(e) => set({ map: e.target.value })}>
          <option value="">All maps</option>
          {MAPS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <div className="segmented" role="group" aria-label="Side">
          {(['', 'T', 'CT'] as const).map((s) => (
            <button key={s || 'all'} type="button" className={filters.side === s ? 'on' : ''} aria-pressed={filters.side === s} onClick={() => set({ side: s })}>{s || 'All sides'}</button>
          ))}
        </div>
        <select aria-label="Economy" value={filters.economy} onChange={(e) => set({ economy: e.target.value })}>
          <option value="">All economies</option>
          {ECONOMIES.map((e) => <option key={e} value={e}>{ECONOMY_LABEL[e]}</option>)}
        </select>
        <select aria-label="Sort" value={filters.sort} onChange={(e) => set({ sort: e.target.value })}>
          <option value="top">Top rated</option>
          <option value="new">Newest</option>
        </select>
      </div>
      <Alert>{list.error}</Alert>
      {list.loading && !list.data ? <Loading /> : list.data?.tactics.length ? (
        <div className="shared-grid">
          {list.data.tactics.map((t) => (
            <article key={t.share_id} className="shared-card">
              <h3><Link to={`/tactics/shared/${t.share_id}`}>{t.tactic_name}</Link></h3>
              <p className="muted small"><SideBadge side={t.side} /> {mapName(t.map)} · {ECONOMY_LABEL[t.economy] ?? t.economy} · {t.phase_count} phases</p>
              <div className="row space">
                <VoteControl listing={t} onChange={replace} />
                <span className="muted small">{t.is_mine ? 'Shared by your team' : `${t.import_count} imports`}</span>
              </div>
            </article>
          ))}
        </div>
      ) : <p className="muted">No shared tactics match these filters yet.</p>}
    </div>
  );
}

export function SharedTacticPage() {
  const { shareId } = useParams();
  const { active_team: team } = useAuth();
  const navigate = useNavigate();
  const doc = useLoad(() => api.get<{ tactic: SharedTactic }>(`/shared-tactics/${shareId}`), [shareId]);
  const [index, setIndex] = useState(0);
  const [level, setLevel] = useState<Level>('main');
  const [open, setOpen] = useState<{ marker: Marker; index: number } | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle(doc.data?.tactic.tactic_name ?? 'Shared tactic');

  if (doc.loading && !doc.data) return <Loading />;
  if (!doc.data) {
    return <Panel title="Shared tactic"><Alert>{doc.error ?? 'This shared tactic is no longer available.'}</Alert><Link className="btn" to="/tactics?tab=browse">Browse</Link></Panel>;
  }
  const t = doc.data.tactic;
  const phase = t.phases[Math.min(index, t.phases.length - 1)];
  const canImport = Boolean(team?.can_lead);
  const importIt = async () => {
    if (!team) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ tactic_id: number }>(`/shared-tactics/${t.share_id}/import`, { team_id: team.team_id, tactic_name: name.trim() || undefined });
      navigate(`/tactics/${res.tactic_id}/edit`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const lineups = phase ? lineupMarkers(phase.board) : [];
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Shared tactic</p>
          <h1>{t.tactic_name}</h1>
          <p className="muted">
            <SideBadge side={t.side} /> {ECONOMY_LABEL[t.economy] ?? t.economy} · {mapName(t.map)} · Utility: {t.smoke} smoke, {t.flash} flash,
            {' '}{t.molly} molly, {t.grenade} HE · {t.slot_count} players · shared {formatDateTime(t.updated_at)}
          </p>
        </div>
        <div className="row">
          <VoteControl listing={t} onChange={(l) => doc.setData({ tactic: { ...t, ...l } })} />
          <Link className="btn ghost" to="/tactics?tab=browse">Browse</Link>
        </div>
      </div>
      <Panel title="Save a copy to your team">
        {canImport ? (
          <div className="row wrap">
            <input aria-label="Name for your copy" maxLength={60} placeholder={t.tactic_name} value={name} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="btn primary" disabled={busy} onClick={importIt}><Icon name="download" /> Save to {team?.team_name}</button>
            <span className="muted small">Your copy is independent. Players arrive as Player 1–{Math.max(1, t.slot_count)}; map them to your roster in the editor.</span>
          </div>
        ) : <p className="muted">Only a team owner or IGL can save shared tactics to a team library.</p>}
        <Alert>{error}</Alert>
      </Panel>
      {phase ? (
        <>
          <div className="phase-tabs" role="tablist" aria-label="Phases">
            {t.phases.map((p, i) => (
              <button key={i} type="button" role="tab" aria-selected={i === index} className={i === index ? 'on' : ''} onClick={() => setIndex(i)}>{i + 1}. {p.name}</button>
            ))}
          </div>
          <div className="board-layout">
            <div className="stack">
              <LevelSwitch map={t.map} level={level} board={phase.board} onChange={setLevel} />
              <MapBoard board={phase.board} map={t.map} level={level} players={[]} onMarkerActivate={(m) => setOpen({ marker: m, index: 0 })}
                label={`Shared board for ${phase.name}`} />
            </div>
            <Panel title={phase.name}>
              {phase.notes ? <p>{phase.notes}</p> : null}
              {phase.assignments.length ? (
                <ul className="instructions">
                  {phase.assignments.map((a) => (
                    <li key={a.slot}>
                      <span className="dot" style={{ background: ownerColor({ user_id: null, slot: a.slot }) }} />
                      <div><strong>Player {a.slot}</strong>{a.instruction ? <p>{a.instruction}</p> : null}{a.utility ? <p className="muted">Utility: {a.utility}</p> : null}</div>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">No player instructions in this phase.</p>}
              {lineups.length ? <><h3>Lineups</h3><LineupGallery markers={lineups} onOpen={(m, i) => setOpen({ marker: m, index: i })} /></> : null}
            </Panel>
          </div>
        </>
      ) : null}
      <LineupLightbox marker={open?.marker ?? null} index={open?.index ?? 0}
        onIndex={(i) => setOpen((o) => (o ? { ...o, index: i } : o))} onClose={() => setOpen(null)} />
    </div>
  );
}

// Share dialog on a team tactic: shows exactly what will be published.
export function ShareDialog({ tacticId, onClose }: { tacticId: number; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [includeImages, setIncludeImages] = useState(true);
  const [data, setData] = useState<SharePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => {
    let cancelled = false;
    api.get<SharePreview>(`/tactics/${tacticId}/share?include_images=${includeImages}`)
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); });
    return () => { cancelled = true; };
  }, [tacticId, includeImages]);

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ tactic: SharedListing }>(`/tactics/${tacticId}/share`, { include_images: includeImages });
      setData((d) => (d ? { ...d, listing: res.tactic, out_of_date: false } : d));
      setDone('Published. Other teams can now find it under Tactics → Browse.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async () => {
    if (!data?.listing || !window.confirm('Withdraw this listing? Nobody can view or import it any more. Copies other teams already saved keep working.')) return;
    setBusy(true);
    try {
      await api.delete(`/shared-tactics/${data.listing.share_id}`);
      setData((d) => (d ? { ...d, listing: null } : d));
      setDone('Listing withdrawn.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const p = data?.preview;
  const markerCount = p ? p.phases.reduce((n, ph) => n + ph.board.markers.length, 0) : 0;
  const holdCount = p ? p.phases.reduce((n, ph) => n + (ph.board.holds?.length ?? 0), 0) : 0;
  return (
    <dialog ref={ref} className="modal" aria-labelledby="share-title" onClose={onClose}>
      <div className="modal-body">
        <div className="row space">
          <h2 id="share-title">Share with the community</h2>
          <button type="button" className="btn ghost small" onClick={() => ref.current?.close()}>Close</button>
        </div>
        <Alert>{error}</Alert>
        {done ? <div className="alert info" role="status">{done}</div> : null}
        {!p ? <Loading /> : (
          <>
            {data?.listing ? (
              <p>Currently shared (net rating {data.listing.score}, {data.listing.import_count} imports).
                {data.out_of_date ? ' Your tactic has changed since it was shared; the listing still shows the shared version until you update it.' : ' The listing matches your latest save.'}</p>
            ) : <p>Publishing creates a snapshot. Later edits to your tactic don't change it until you choose “Update listing”.</p>}
            <h3>What will be published</h3>
            <ul className="privacy-list">
              <li>{p.tactic.tactic_name} · {mapName(p.tactic.map)} · {p.tactic.side} · {ECONOMY_LABEL[p.tactic.economy] ?? p.tactic.economy}</li>
              <li>{p.phases.length} phases with notes, {markerCount} markers, routes and {holdCount} holds</li>
              <li>{p.slot_count ? `Your players become Player 1–${p.slot_count}` : 'No players are assigned'}{data?.dropped_players ? ` (${data.dropped_players} more players become unassigned)` : ''}</li>
              <li>{includeImages && data?.image_count
                ? `${data.image_count} lineup screenshot${data.image_count === 1 ? '' : 's'}, copied into the listing (not linked to your team)`
                : 'No lineup screenshots'}</li>
            </ul>
            <h3>Never published</h3>
            <ul className="privacy-list muted">
              <li>Your team name and roster, player names and user IDs</li>
              <li>Reference links from instructions</li>
              <li>Links to your team's private lineup images</li>
            </ul>
            <label className="check"><input type="checkbox" checked={includeImages} onChange={(e) => setIncludeImages(e.target.checked)} /> Include lineup screenshots</label>
            <details>
              <summary>Exact data that will be published</summary>
              <pre className="json-preview">{JSON.stringify(p, null, 2)}</pre>
            </details>
            <div className="row">
              <button type="button" className="btn primary" disabled={busy} onClick={publish}>
                <Icon name="share" /> {data?.listing ? 'Update listing' : 'Publish'}
              </button>
              {data?.listing ? <Link className="btn ghost" to={`/tactics/shared/${data.listing.share_id}`}>View listing</Link> : null}
              {data?.listing ? <button type="button" className="btn ghost danger" disabled={busy} onClick={withdraw}>Withdraw listing</button> : null}
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
