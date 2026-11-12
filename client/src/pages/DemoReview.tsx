import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { LEVEL_LABEL, mapLevels, mapName, type Level } from '../lib/constants';
import { formatDateTime, useDocumentTitle, useLoad } from '../lib/hooks';
import { clockTick, frameAt, roundTime, type Clock } from '../lib/replay';
import { isTyping } from '../lib/shortcuts';
import type { Annotation, DemoDetail, DemoSummary, LiveReview, Point, ReplayRound } from '../lib/types';
import { Alert, Badge, Loading, NeedsTeam, Panel } from '../components/ui';
import { Icon } from '../components/Icons';
import { MapBackground } from '../components/MapBoard';

const SIZE = 1000;
const SPEEDS = [0.5, 1, 2, 4];
const SIDE_COLOR = { CT: '#5b9cf5', T: '#f5a524' } as const;
const fmtSize = (bytes: number) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(0)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// ---- Library ---------------------------------------------------------------------

interface LibraryResponse { demos: DemoSummary[]; can_upload: boolean; can_manage: boolean; limits: { max_bytes: number; per_team: number } }

function StatusPill({ status }: { status: DemoSummary['status'] }) {
  const label = { queued: 'Queued', processing: 'Processing', ready: 'Ready', failed: 'Failed' }[status];
  return <span className={`status-pill ${status}`}>{label}</span>;
}

function useTeamReview(teamId: number | undefined, intervalMs: number) {
  const [state, setState] = useState<{ review: LiveReview | null; can_control: boolean } | null>(null);
  useEffect(() => {
    if (!teamId) return undefined;
    let timer: number | undefined;
    let stopped = false;
    const load = async () => {
      try {
        const r = await api.get<{ review: LiveReview | null; can_control: boolean }>(`/teams/${teamId}/review`);
        if (!stopped) setState(r);
      } catch { /* retried on the next poll */ }
      if (!stopped) timer = window.setTimeout(load, intervalMs);
    };
    load();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [teamId, intervalMs]);
  return state;
}

export function DemoLibraryPage() {
  useDocumentTitle('Demo Review');
  const { active_team: team } = useAuth();
  if (!team) return <NeedsTeam what="Demo Review" />;
  return <DemoLibrary teamId={team.team_id} />;
}

function DemoLibrary({ teamId }: { teamId: number }) {
  const lib = useLoad(() => api.get<LibraryResponse>(`/teams/${teamId}/demos`), [teamId]);
  const live = useTeamReview(teamId, 5000);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = lib.data?.demos.some((d) => d.status === 'queued' || d.status === 'processing');
  const { reload } = lib;

  // Refresh while demos are being processed.
  useEffect(() => {
    if (!pending) return undefined;
    const t = window.setInterval(reload, 2500);
    return () => window.clearInterval(t);
  }, [pending, reload]);

  const upload = async () => {
    if (!file || !lib.data) return;
    setError(null);
    setNotice(null);
    if (!/\.dem$/i.test(file.name)) { setError('Choose a CS2 demo file (.dem). Unzip .dem.gz / .zip / .bz2 downloads first.'); return; }
    if (file.size > lib.data.limits.max_bytes) { setError(`That demo is ${fmtSize(file.size)}; the limit is ${fmtSize(lib.data.limits.max_bytes)}.`); return; }
    setProgress(0);
    try {
      const q = new URLSearchParams({ file_name: file.name, ...(title.trim() ? { title: title.trim() } : {}) });
      await api.uploadFile(`/teams/${teamId}/demos?${q}`, file, setProgress);
      setNotice('Uploaded. The demo is being processed in the background; this list updates when it is ready.');
      setFile(null);
      setTitle('');
      if (inputRef.current) inputRef.current.value = '';
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setProgress(null);
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); await reload(); } catch (err) { setError(errorMessage(err)); }
  };

  if (lib.loading && !lib.data) return <Loading />;
  const review = live?.review;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Demo Review</h1>
          <p className="muted">Your team's private demo library. Upload a CS2 demo, replay it on the radar, annotate rounds and review it live together.</p>
        </div>
      </div>
      {review ? (
        <div className="live-banner">
          <Badge tone="red">LIVE</Badge>
          <span><strong>{review.started_by?.user_name ?? 'Your IGL'}</strong> is reviewing “{review.demo.title}” (round {review.round_number}).</span>
          <Link className="btn primary small" to={`/demos/${review.demo.demo_id}?live=1`}>{review.can_control ? 'Open controls' : 'Join review'}</Link>
        </div>
      ) : null}
      <Alert>{error ?? lib.error}</Alert>
      {notice ? <div className="alert info" role="status">{notice}</div> : null}
      <Panel title="Upload a demo">
        <div className="row wrap">
          <input ref={inputRef} type="file" accept=".dem" aria-label="CS2 demo file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <input placeholder="Title (optional)" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Demo title" />
          <button type="button" className="btn primary" disabled={!file || progress !== null} onClick={upload}><Icon name="upload" /> Upload</button>
        </div>
        {progress !== null ? <progress className="upload-progress" value={progress} max={1} aria-label="Upload progress" /> : null}
        <p className="muted small">CS2 .dem files up to {fmtSize(lib.data?.limits.max_bytes ?? 0)}; {lib.data?.limits.per_team} demos per team.
          Supported for 2D replay: Ancient, Anubis, Cache, Dust II, Inferno, Mirage, Nuke, Overpass, Train and Vertigo.</p>
      </Panel>
      <Panel title="Library">
        {lib.data?.demos.length ? (
          <ul className="demo-list">
            {lib.data.demos.map((d) => {
              const mine = Boolean(lib.data?.can_manage);
              return (
                <li key={d.demo_id}>
                  <Icon name="demo" />
                  <div className="grow">
                    {d.status === 'ready' ? <Link to={`/demos/${d.demo_id}`}><strong>{d.title}</strong></Link> : <strong>{d.title}</strong>}
                    <div className="muted small">
                      {d.map ? `${mapName(d.map)} · ` : ''}{d.round_count ? `${d.round_count} rounds · ` : ''}{fmtSize(d.byte_size)} ·
                      {' '}uploaded {formatDateTime(d.created_at)}{d.uploaded_by?.user_name ? ` by ${d.uploaded_by.user_name}` : ''}
                    </div>
                    {d.status === 'failed' ? <div className="error-text">{d.error_message}</div> : null}
                  </div>
                  <StatusPill status={d.status} />
                  {d.status === 'failed' && mine ? <button type="button" className="btn ghost small" onClick={() => act(() => api.post(`/demos/${d.demo_id}/retry`))}>Retry</button> : null}
                  {mine ? (
                    <button type="button" className="btn ghost small danger" aria-label={`Delete ${d.title}`}
                      onClick={() => { if (window.confirm(`Delete "${d.title}" and its annotations? This cannot be undone.`)) act(() => api.delete(`/demos/${d.demo_id}`)); }}>
                      <Icon name="trash" />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : <p className="muted">No demos yet. Upload one above.</p>}
      </Panel>
    </div>
  );
}

// ---- Replay ----------------------------------------------------------------------

function useRound(demoId: number, roundNumber: number | null) {
  const cache = useRef(new Map<number, ReplayRound>());
  const [loaded, setLoaded] = useState<{ n: number; round: ReplayRound } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (roundNumber == null) return undefined;
    let cancelled = false;
    const hit = cache.current.get(roundNumber);
    const done = (round: ReplayRound) => { if (!cancelled) { setLoaded({ n: roundNumber, round }); setError(null); } };
    if (hit) {
      const t = window.setTimeout(() => done(hit), 0);
      return () => { cancelled = true; window.clearTimeout(t); };
    }
    api.get<ReplayRound>(`/demos/${demoId}/rounds/${roundNumber}`)
      .then((r) => { cache.current.set(roundNumber, r); done(r); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); });
    return () => { cancelled = true; };
  }, [demoId, roundNumber]);
  return { round: loaded && loaded.n === roundNumber ? loaded.round : null, error };
}

// Re-renders about 30 times a second while playing.
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 33) { last = t; setNow(Date.now()); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return now;
}

// Polls the team's live review once a second, estimating the server clock
// offset (smoothed, preferring low-latency samples) so every viewer derives
// the same playback position from the server's anchor.
function useLiveSync(teamId: number, enabled: boolean) {
  const [review, setReview] = useState<LiveReview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const offset = useRef<number | null>(null);
  const samples = useRef<{ rtt: number; sample: number }[]>([]);
  const [drift, setDrift] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const failures = useRef(0);
  const fetchRef = useRef<() => void>(() => {});

  const adopt = useCallback((r: LiveReview | null, sentAt?: number, receivedAt?: number) => {
    if (r && sentAt != null && receivedAt != null) {
      const rtt = receivedAt - sentAt;
      const sample = Date.parse(r.server_time) - (sentAt + receivedAt) / 2;
      // Use the lowest-latency sample of the last 8 polls. A rolling window
      // recovers from skewed samples (e.g. taken while the tab was hidden and
      // its timers throttled) instead of keeping one forever.
      samples.current = [...samples.current.slice(-7), { rtt, sample }];
      offset.current = samples.current.reduce((best, s) => (s.rtt < best.rtt ? s : best)).sample;
      // How far this browser's derived position is from the server's, in seconds.
      const local = clockTick({ playing: r.playing, anchorTick: r.playing ? r.anchor_tick : r.position_tick, anchorAt: Date.parse(r.anchor_at) - (offset.current ?? 0), speed: r.speed },
        r.demo.tickrate, Date.parse(r.server_time) - (offset.current ?? 0));
      setDrift(Math.abs(local - r.position_tick) / r.demo.tickrate);
    }
    setReview(r);
  }, []);

  const fetchNow = useCallback(async () => {
    window.clearTimeout(timer.current);
    const sentAt = Date.now();
    try {
      const r = await api.get<{ review: LiveReview | null }>(`/teams/${teamId}/review`);
      adopt(r.review, sentAt, Date.now());
      setLoaded(true);
      setOffline(false);
      failures.current = 0;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 404)) { setLoaded(true); return; }
      failures.current += 1;
      setOffline(true);
    }
    const delay = Math.min(10000, 1000 * 2 ** failures.current);
    timer.current = window.setTimeout(() => fetchRef.current(), document.visibilityState === 'hidden' ? Math.max(delay, 4000) : delay);
  }, [teamId, adopt]);

  useLayoutEffect(() => { fetchRef.current = fetchNow; }, [fetchNow]);
  useEffect(() => {
    if (!enabled) return undefined;
    timer.current = window.setTimeout(() => fetchRef.current(), 0);
    const wake = () => { if (document.visibilityState === 'visible') fetchRef.current(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      window.clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, [enabled]);

  return { review, loaded, offline, drift, offset, adopt, refetch: fetchNow };
}

export function DemoPage() {
  const { demoId } = useParams();
  const { active_team: team } = useAuth();
  const id = Number(demoId);
  const detail = useLoad(() => api.get<{ demo: DemoDetail; can_manage: boolean; can_control_review: boolean }>(`/demos/${id}`), [id]);
  useDocumentTitle(detail.data?.demo.title ?? 'Demo');
  const { reload } = detail;
  const status = detail.data?.demo.status;
  useEffect(() => {
    if (status !== 'queued' && status !== 'processing') return undefined;
    const t = window.setInterval(reload, 2500);
    return () => window.clearInterval(t);
  }, [status, reload]);

  if (detail.loading && !detail.data) return <Loading />;
  if (!detail.data) return <Panel title="Demo"><Alert>{detail.error}</Alert><Link className="btn" to="/demos">Back to the library</Link></Panel>;
  const demo = detail.data.demo;
  if (demo.status !== 'ready') {
    return (
      <Panel title={demo.title}>
        <p><StatusPill status={demo.status} /></p>
        {demo.status === 'failed' ? <Alert>{demo.error_message}</Alert> : <p className="muted">This demo is being processed. The page updates when it's ready.</p>}
        <Link className="btn" to="/demos">Back to the library</Link>
      </Panel>
    );
  }
  if (!team || team.team_id !== demo.team_id) {
    return <Panel title={demo.title}><Alert kind="info">Switch to the team that owns this demo to review it.</Alert></Panel>;
  }
  return <Replay demo={demo} teamId={team.team_id} canControlReview={detail.data.can_control_review} />;
}

type Mode = 'solo' | 'control' | 'follow';
type Tool = 'none' | 'draw' | 'text';

function Replay({ demo, teamId, canControlReview }: { demo: DemoDetail; teamId: number; canControlReview: boolean }) {
  const { user } = useAuth();
  const [, setParams] = useSearchParams();
  const sync = useLiveSync(teamId, true);
  const liveReview = sync.review && sync.review.status === 'active' ? sync.review : null;
  const liveHere = liveReview && liveReview.demo.demo_id === demo.demo_id ? liveReview : null;
  const [watchSolo, setWatchSolo] = useState(false);
  const mode: Mode = liveHere && !watchSolo ? (liveHere.can_control ? 'control' : 'follow') : 'solo';

  const firstRound = demo.rounds[0];
  const [solo, setSolo] = useState<Clock & { round: number }>(() => ({
    round: firstRound?.round_number ?? 1, playing: false, anchorTick: firstRound?.freeze_end_tick ?? firstRound?.start_tick ?? 0, anchorAt: Date.now(), speed: 1,
  }));
  const roundNumber = mode === 'solo' ? solo.round : liveHere!.round_number;
  const info = demo.rounds.find((r) => r.round_number === roundNumber) ?? firstRound;
  const tickrate = demo.tickrate ?? 64;
  // Live: while playing, position = server anchor + elapsed (on the server's
  // clock); otherwise the server's computed position (paused, or stopped at
  // the end of the round).
  const clock: Clock = mode === 'solo' ? solo : {
    playing: liveHere!.playing, speed: liveHere!.speed,
    anchorTick: liveHere!.playing ? liveHere!.anchor_tick : liveHere!.position_tick,
    anchorAt: Date.parse(liveHere!.anchor_at) - (sync.offset.current ?? 0),
  };
  const now = useNow(clock.playing);
  const tick = clockTick(clock, tickrate, now, info.start_tick, info.end_tick);
  const atEnd = tick >= info.end_tick;
  const { round, error: roundError } = useRound(demo.demo_id, roundNumber);
  const levels = mapLevels(demo.map);
  const [level, setLevel] = useState<Level>('main');
  const [tool, setTool] = useState<Tool>('none');
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<Point[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // Personal/team annotations outside a live review.
  const notes = useLoad(
    () => api.get<{ annotations: Annotation[] }>(`/demos/${demo.demo_id}/annotations?round=${roundNumber}`),
    [demo.demo_id, roundNumber]
  );
  const annotations = mode === 'solo' ? notes.data?.annotations ?? [] : liveHere!.annotations;
  const canAnnotate = mode !== 'follow';

  // Solo playback stops at the end of the round.
  if (mode === 'solo' && solo.playing && atEnd) setSolo({ ...solo, playing: false, anchorTick: info.end_tick, anchorAt: now });

  const sendLive = useCallback(async (body: Record<string, unknown>) => {
    if (!liveHere) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ review: LiveReview }>(`/reviews/${liveHere.review_id}/command`, { ...body, expected_version: liveHere.version });
      sync.adopt(res.review);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.body.review) {
        sync.adopt(err.body.review as LiveReview);
        if (err.code !== 'version_conflict') setError(err.message);
      } else if (err instanceof ApiError && err.code === 'not_igl') {
        setError('You are no longer the IGL, so you now follow the review.');
        sync.refetch();
      } else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [liveHere, sync]);

  const control = {
    play: () => (mode === 'solo'
      ? setSolo({ ...solo, playing: true, anchorTick: atEnd ? info.freeze_end_tick ?? info.start_tick : tick, anchorAt: Date.now() })
      : sendLive({ action: 'play' })),
    pause: () => (mode === 'solo' ? setSolo({ ...solo, playing: false, anchorTick: tick, anchorAt: Date.now() }) : sendLive({ action: 'pause' })),
    seek: (t: number) => (mode === 'solo' ? setSolo({ ...solo, anchorTick: t, anchorAt: Date.now() }) : sendLive({ action: 'seek', tick: t })),
    round: (n: number) => {
      const r = demo.rounds.find((x) => x.round_number === n);
      if (!r) return;
      if (mode === 'solo') setSolo({ ...solo, round: n, playing: false, anchorTick: r.freeze_end_tick ?? r.start_tick, anchorAt: Date.now() });
      else sendLive({ action: 'round', round_number: n });
    },
    speed: (s: number) => (mode === 'solo' ? setSolo({ ...solo, speed: s, anchorTick: tick, anchorAt: Date.now() }) : sendLive({ action: 'speed', speed: s })),
  };
  const canControl = mode !== 'follow';
  const toggle = () => (clock.playing && !atEnd ? control.pause() : control.play());

  // Space toggles play/pause; arrows step 5 seconds (when this view controls playback).
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useLayoutEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      if (!canControl || isTyping(e.target) || busy) return;
      if (e.key === ' ') { e.preventDefault(); toggle(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); control.seek(Math.min(info.end_tick, tick + 5 * tickrate)); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); control.seek(Math.max(info.start_tick, tick - 5 * tickrate)); }
    };
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const startLive = async () => {
    setError(null);
    try {
      const res = await api.post<{ review: LiveReview }>(`/teams/${teamId}/review`, { demo_id: demo.demo_id, round_number: roundNumber });
      sync.adopt(res.review);
      setWatchSolo(false);
      setParams({ live: '1' });
      // Continue from where the IGL was watching.
      if (tick !== res.review.anchor_tick) {
        const r2 = await api.post<{ review: LiveReview }>(`/reviews/${res.review.review_id}/command`, { action: 'seek', tick, expected_version: res.review.version });
        sync.adopt(r2.review);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'review_active') sync.refetch();
      setError(errorMessage(err));
    }
  };
  const endLive = async () => {
    if (!liveHere || !window.confirm('End the live review for everyone?')) return;
    try {
      const res = await api.post<{ review: LiveReview }>(`/reviews/${liveHere.review_id}/end`);
      sync.adopt(res.review.status === 'active' ? res.review : null);
      setParams({});
      sync.refetch();
    } catch (err) { setError(errorMessage(err)); }
  };

  // ---- Annotation input ----
  const toPoint = (e: { clientX: number; clientY: number }): Point | null => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: Math.min(1, Math.max(0, Math.round((p.x / SIZE) * 10000) / 10000)), y: Math.min(1, Math.max(0, Math.round((p.y / SIZE) * 10000) / 10000)) };
  };
  const saveAnnotation = async (body: Record<string, unknown>) => {
    setError(null);
    const payload = { ...body, round_number: roundNumber, tick: Math.round(tick), level };
    try {
      if (mode === 'solo') {
        await api.post(`/demos/${demo.demo_id}/annotations`, payload);
        await notes.reload();
      } else if (liveHere) {
        const res = await api.post<{ review: LiveReview }>(`/reviews/${liveHere.review_id}/annotations`, payload);
        sync.adopt(res.review);
      }
    } catch (err) { setError(errorMessage(err)); }
  };
  const removeAnnotation = async (a: Annotation) => {
    try {
      if (mode === 'solo') { await api.delete(`/demos/${demo.demo_id}/annotations/${a.annotation_id}`); await notes.reload(); } else if (liveHere) {
        const res = await api.delete<{ review: LiveReview }>(`/reviews/${liveHere.review_id}/annotations/${a.annotation_id}`);
        sync.adopt(res.review);
      }
    } catch (err) { setError(errorMessage(err)); }
  };
  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!canAnnotate || tool === 'none') return;
    const p = toPoint(e);
    if (!p) return;
    if (tool === 'text') {
      if (!text.trim()) { setError('Type the text first, then click the map to place it.'); return; }
      saveAnnotation({ kind: 'text', data: { x: p.x, y: p.y, text: text.trim() } });
      setText('');
      return;
    }
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDraft([p]);
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!draft) return;
    const p = toPoint(e);
    if (!p) return;
    const last = draft[draft.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) > 0.004 && draft.length < 400) setDraft([...draft, p]);
  };
  const onUp = () => {
    if (draft && draft.length >= 2) saveAnnotation({ kind: 'drawing', data: { points: draft } });
    setDraft(null);
  };

  const players = useMemo(() => new Map(demo.players.map((p) => [p.index, p.name])), [demo.players]);
  const visibleAnnotations = annotations.filter((a) => a.tick <= tick + 1 && (a.level ?? 'main') === level);
  const kills = round ? round.events.filter((ev) => ev.type === 'kill' && ev.tick <= tick) : [];
  const plant = round ? round.events.find((ev) => ev.type === 'plant' && ev.tick <= tick) : undefined;
  const span = info.end_tick - info.start_tick || 1;
  const pct = (t: number) => `${((t - info.start_tick) / span) * 100}%`;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow"><Link to="/demos">Demo Review</Link></p>
          <h1>{demo.title}</h1>
          <p className="muted">{mapName(demo.map)} · {demo.rounds.length} rounds · round {roundNumber}
            {info.winner ? <> · won by <strong>{info.winner}</strong>{info.reason ? ` (${info.reason.replace(/_/g, ' ')})` : ''}</> : null}
            {info.ct_score != null ? ` · score after round: CT side ${info.ct_score} – ${info.t_score} T side` : ''}</p>
        </div>
        <div className="row">
          {mode === 'solo' && canControlReview && !liveReview ? <button type="button" className="btn primary" onClick={startLive}><Icon name="live" /> Start live review</button> : null}
          {mode === 'control' ? <button type="button" className="btn ghost danger" onClick={endLive}><Icon name="stop" /> End live review</button> : null}
        </div>
      </div>

      {liveHere ? (
        <div className="live-banner" role="status">
          <Badge tone="red">LIVE</Badge>
          {mode === 'control' ? <span>You're leading this review. Everyone on the team sees your playback and drawings.</span>
            : mode === 'follow' ? <span>Following {liveHere.igl?.user_name ?? 'the IGL'}. Playback, round and drawings are controlled by the IGL.</span>
              : <span>A live review of this demo is running.</span>}
          {sync.offline ? <Badge tone="red">Reconnecting…</Badge> : <span className="muted small">{sync.drift < 0.25 ? 'In sync' : `Re-syncing (${sync.drift.toFixed(1)}s)`}</span>}
          {mode === 'follow' ? <button type="button" className="btn ghost small" onClick={() => setWatchSolo(true)}>Watch on my own</button> : null}
          {mode === 'solo' ? <button type="button" className="btn small" onClick={() => setWatchSolo(false)}>Rejoin live</button> : null}
        </div>
      ) : liveReview ? (
        <div className="live-banner"><Badge tone="red">LIVE</Badge> A live review of “{liveReview.demo.title}” is running.
          <Link className="btn small" to={`/demos/${liveReview.demo.demo_id}?live=1`}>Join</Link></div>
      ) : null}
      <Alert>{error ?? roundError}</Alert>

      <div className="replay-layout">
        <div className="stack">
          <div className="row wrap space">
            <div className="replay-controls">
              <button type="button" className="btn primary" disabled={!canControl || busy} onClick={toggle} aria-label={clock.playing && !atEnd ? 'Pause' : 'Play'}>
                <Icon name={clock.playing && !atEnd ? 'pause' : 'play'} /> {clock.playing && !atEnd ? 'Pause' : atEnd ? 'Replay' : 'Play'}
              </button>
              <span className="big" aria-live="off">{roundTime(info, tick, tickrate)}</span>
              <label className="inline">Speed
                <select value={clock.speed} disabled={!canControl || busy} onChange={(e) => control.speed(Number(e.target.value))}>
                  {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
                </select>
              </label>
            </div>
            {levels.length > 1 ? (
              <div className="segmented" role="group" aria-label="Radar floor">
                {levels.map((l) => <button key={l} type="button" className={level === l ? 'on' : ''} aria-pressed={level === l} onClick={() => setLevel(l)}>{LEVEL_LABEL[l]}</button>)}
              </div>
            ) : null}
          </div>
          <div className="timeline">
            {round ? round.events.filter((ev) => ev.type !== 'round_end').map((ev, i) => (
              <button key={i} type="button" className={`tl-mark ${ev.type}`} style={{ left: pct(ev.tick) }} disabled={!canControl}
                title={`${roundTime(info, ev.tick, tickrate)} ${ev.type}`} aria-label={`Jump to ${ev.type} at ${roundTime(info, ev.tick, tickrate)}`}
                onClick={() => control.seek(Math.max(info.start_tick, ev.tick - 2 * tickrate))} />
            )) : null}
            {annotations.map((a) => <span key={a.annotation_id} className="tl-mark annotation" style={{ left: pct(a.tick) }} />)}
            <input type="range" aria-label="Playback position" min={info.start_tick} max={info.end_tick} step={1} value={Math.round(tick)} disabled={!canControl}
              onChange={(e) => control.seek(Number(e.target.value))} />
          </div>
          <div className="board-frame">
            <svg ref={svgRef} viewBox={`0 0 ${SIZE} ${SIZE}`} className={`board${tool !== 'none' && canAnnotate ? ' editable' : ''}`} role="img"
              aria-label={`Replay of round ${roundNumber}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
              style={{ cursor: canAnnotate && tool !== 'none' ? 'crosshair' : undefined, touchAction: tool !== 'none' ? 'none' : undefined }}
              fontFamily="system-ui, sans-serif">
              <MapBackground map={demo.map ?? ''} level={level} />
              {kills.filter((k) => k.x != null && (k.level ?? 'main') === level).map((k, i) => (
                <g key={`k${i}`} transform={`translate(${k.x! * SIZE},${k.y! * SIZE})`} opacity="0.85" pointerEvents="none">
                  <path d="M-8,-8 L8,8 M8,-8 L-8,8" stroke="#ff5a5f" strokeWidth="4" strokeLinecap="round" />
                </g>
              ))}
              {plant && plant.x != null && (plant.level ?? 'main') === level ? (
                <g transform={`translate(${plant.x * SIZE},${plant.y! * SIZE})`} pointerEvents="none">
                  <rect x="-11" y="-8" width="22" height="16" rx="3" fill="#e5484d" stroke="#fff" strokeWidth="2" />
                  <text y="5" textAnchor="middle" fontSize="11" fill="#fff" fontWeight="700">C4</text>
                </g>
              ) : null}
              {round ? round.roster.map((p, i) => {
                const f = frameAt(round, i, tick);
                if (!f || (f.x === 0 && f.y === 0)) return null;
                const other = f.level !== level;
                const color = SIDE_COLOR[p.side];
                const a = (f.yaw * Math.PI) / 180;
                const name = players.get(p.player) ?? `Player ${p.player + 1}`;
                return (
                  <g key={p.player} transform={`translate(${f.x * SIZE},${f.y * SIZE})`} opacity={other ? 0.25 : f.alive ? 1 : 0.45} pointerEvents="none">
                    {f.alive ? (
                      <>
                        <line x1="0" y1="0" x2={Math.cos(a) * 22} y2={-Math.sin(a) * 22} stroke={color} strokeWidth="3" />
                        <circle r="10" fill={color} stroke="#111" strokeWidth="2.5" />
                        <text y="-15" textAnchor="middle" fontSize="13" fontWeight="600" fill="#fff" stroke="#000" strokeWidth="3" paintOrder="stroke">{name}</text>
                      </>
                    ) : <path d="M-7,-7 L7,7 M7,-7 L-7,7" stroke={color} strokeWidth="3" />}
                  </g>
                );
              }) : null}
              {visibleAnnotations.map((a) => (a.kind === 'drawing' ? (
                <polyline key={a.annotation_id} points={(a.data.points ?? []).map((p) => `${p.x * SIZE},${p.y * SIZE}`).join(' ')}
                  fill="none" stroke={a.data.color ?? '#ffd166'} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
              ) : (
                <text key={a.annotation_id} x={(a.data.x ?? 0) * SIZE} y={(a.data.y ?? 0) * SIZE} textAnchor="middle" fontSize="22" fontWeight="700"
                  fill={a.data.color ?? '#ffd166'} stroke="#000" strokeWidth="4" paintOrder="stroke" pointerEvents="none">{a.data.text}</text>
              )))}
              {draft ? <polyline points={draft.map((p) => `${p.x * SIZE},${p.y * SIZE}`).join(' ')} fill="none" stroke="#ffd166" strokeWidth="5"
                strokeDasharray="10 6" strokeLinecap="round" pointerEvents="none" /> : null}
            </svg>
          </div>
          {!round && !roundError ? <p className="muted small">Loading round…</p> : null}
          {canAnnotate ? (
            <div className="toolbar" role="toolbar" aria-label="Annotation tools">
              <button type="button" className={tool === 'none' ? 'on' : ''} aria-pressed={tool === 'none'} onClick={() => setTool('none')}><Icon name="select" /> View</button>
              <button type="button" className={tool === 'draw' ? 'on' : ''} aria-pressed={tool === 'draw'} onClick={() => setTool('draw')}><Icon name="pen" /> Draw</button>
              <button type="button" className={tool === 'text' ? 'on' : ''} aria-pressed={tool === 'text'} onClick={() => setTool('text')}><Icon name="text" /> Text</button>
              {tool === 'text' ? <input aria-label="Annotation text" maxLength={200} placeholder="Type, then click the map" value={text} onChange={(e) => setText(e.target.value)} /> : null}
              {mode === 'control' ? (
                <button type="button" className="btn ghost small danger" disabled={busy || !annotations.length}
                  onClick={() => { if (window.confirm('Clear the live drawings for this round?')) sendLive({ action: 'clear' }); }}>Clear round</button>
              ) : null}
              <span className="muted small">Annotations are saved at the current playback position ({roundTime(info, tick, tickrate)}) and appear from then on.</span>
            </div>
          ) : null}
        </div>

        <div className="stack">
          <Panel title="Rounds">
            <div className="round-strip">
              {demo.rounds.map((r) => (
                <button key={r.round_number} type="button" className={`${r.winner === 'CT' ? 'ct' : r.winner === 'T' ? 't' : ''}${r.round_number === roundNumber ? ' on' : ''}`}
                  disabled={!canControl || busy} aria-pressed={r.round_number === roundNumber} title={r.winner ? `${r.winner} win` : undefined}
                  onClick={() => control.round(r.round_number)}>{r.round_number}</button>
              ))}
            </div>
          </Panel>
          {round ? (
            <Panel title="Players">
              <div className="scoreboard">
                {(['CT', 'T'] as const).map((side) => (
                  <div key={side}>
                    <strong className={side.toLowerCase()}>{side}</strong>
                    {round.roster.map((p, i) => (p.side === side ? (
                      <div key={p.player} className={`${side.toLowerCase()}${frameAt(round, i, tick)?.alive ? '' : ' dead'}`}>
                        {players.get(p.player)} <span className="muted">{frameAt(round, i, tick)?.hp || ''}</span>
                      </div>
                    ) : null))}
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
          <Panel title="Timeline">
            {round ? (
              <ul className="event-feed">
                {round.events.map((ev, i) => (
                  <li key={i}>
                    <button type="button" className={ev.tick <= tick ? 'past' : ''} disabled={!canControl}
                      onClick={() => control.seek(Math.max(info.start_tick, ev.tick - 2 * tickrate))}>
                      <span className="muted">{roundTime(info, ev.tick, tickrate)}</span>{' '}
                      {ev.type === 'kill' ? <>{ev.attacker != null ? players.get(ev.attacker) : 'World'} ✕ {ev.victim != null ? players.get(ev.victim) : '?'} <span className="muted">({ev.weapon}{ev.headshot ? ', HS' : ''})</span></>
                        : ev.type === 'plant' ? <>Bomb planted{ev.player != null ? ` by ${players.get(ev.player)}` : ''}</>
                          : ev.type === 'defuse' ? <>Bomb defused{ev.player != null ? ` by ${players.get(ev.player)}` : ''}</>
                            : ev.type === 'explode' ? <>Bomb exploded</>
                              : <>Round end: {ev.winner} win{ev.reason ? ` (${ev.reason.replace(/_/g, ' ')})` : ''}</>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <Loading />}
          </Panel>
          <Panel title={mode === 'solo' ? 'Annotations this round' : 'Live drawings this round'}>
            {annotations.length ? (
              <ul className="event-feed">
                {annotations.map((a) => (
                  <li key={a.annotation_id} className="row space">
                    <button type="button" disabled={!canControl} onClick={() => control.seek(a.tick)}>
                      <span className="muted">{roundTime(info, a.tick, tickrate)}</span> {a.kind === 'text' ? `“${a.data.text}”` : 'Drawing'}
                      {a.author ? <span className="muted"> · {a.author.user_name}</span> : null}
                    </button>
                    {(mode === 'control' || (mode === 'solo' && a.author?.user_id === user?.user_id))
                      ? <button type="button" className="btn ghost small" aria-label="Remove annotation" onClick={() => removeAnnotation(a)}><Icon name="close" size={14} /></button> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="muted small">None yet.{canAnnotate ? ' Use Draw or Text to add one at the current moment.' : ''}</p>}
          </Panel>
        </div>
      </div>
    </div>
  );
}
