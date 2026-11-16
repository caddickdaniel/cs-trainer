import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { LEVEL_LABEL, mapLevels, mapName, NOTE_SIZE, type Level } from '../lib/constants';
import { formatDateTime, useDocumentTitle, useLoad } from '../lib/hooks';
import { BLAST_SHOW_TICKS, bombDamageAt, BOMB_ESTIMATE, clockTick, detonationAt, estimatedRadiusFor, FLASH_SHOW_TICKS, flashAmount, flightsAt, frameAt, killFeedAt, playbackText, recordedAt, roundTime, RECORDED_LABEL, shockwaveFrame, timelineRows, type Clock } from '../lib/replay';
import { isTyping } from '../lib/shortcuts';
import type { Annotation, DemoDetail, DemoSummary, LiveReview, Point, ReplayEvent, ReplayRound, RoundNote } from '../lib/types';
import { Alert, Badge, Loading, NeedsTeam, Panel } from '../components/ui';
import { Icon } from '../components/Icons';
import { MapBackground, UtilityGlyph } from '../components/MapBoard';
import { KillFeed, ReplayHud, ReplayScoreboard } from '../components/ReplayHud';
import { ReplayInspector, type CaptureStatus } from '../components/ReplayInspector';
import { CaptureOverlay, CaptureWarning, ConfirmDialog, minutes, useCaptureSession } from '../components/CaptureSession';
import { eventMoment, inspectable, inspectableIndexes, isKill, isUtility, neighbourIndex, type InspectFilter } from '../lib/inspector';
import { weaponLabel } from '../lib/cs2Assets';
import { UtilityIcon } from '../components/UtilityIcon';

const SIZE = 1000;
type UtilityKind = 'smoke' | 'flash' | 'he' | 'molly';
const UTILITY_KINDS: [UtilityKind, string][] = [['smoke', 'Smoke'], ['flash', 'Flash'], ['he', 'HE'], ['molly', 'Molotov']];
const SPEEDS = [0.5, 1, 2, 4];
const SIDE_COLOR = { CT: '#5b9cf5', T: '#f5a524' } as const;
// Recorded effects (from the demo) are drawn with dashed edges in the
// thrower's side colour; manual utility annotations use a solid yellow ring.
const RECORDED_UTILITY: ReplayEvent['type'][] = ['smoke', 'flash', 'he', 'fire'];
// Radius in board units (1000 = radar width): CS2 smoke ~144 and fire ~120
// game units at the radars' ~5 units/pixel.
const RECORDED_RADIUS = { smoke: 28, fire: 22 };
const fmtSize = (bytes: number) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(0)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// ---- Library ---------------------------------------------------------------------

interface LibraryResponse { demos: DemoSummary[]; can_upload: boolean; can_manage: boolean; limits: { max_bytes: number; per_team: number }; share_codes?: boolean }

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

// Estimated capture time for an upload option, from measured benchmarks.
function estimateText(est: { measured: boolean; options?: { all: number; kill: number; utility: number }; per_kill?: number; per_utility?: number; cold_start?: number;
  typical_kills?: number; typical_utility?: number } | undefined, opt: 'all' | 'kill' | 'utility') {
  if (!est || !est.measured || !est.options) return 'Capture can take a long time for a full match (no measured estimate yet).';
  const per = opt === 'kill' ? `about ${Math.round(est.per_kill!)} s per kill` : opt === 'utility' ? `about ${Math.round(est.per_utility!)} s per throw`
    : `about ${Math.round(est.per_kill!)} s per kill and ${Math.round(est.per_utility!)} s per throw`;
  return `Expect roughly ${minutes(est.options[opt])} for a full match (${per}, plus about ${Math.round(est.cold_start!)} s to start CS2).`;
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
  // Optional CS2 capture once the demo has parsed (none selected by default).
  const [captureOpt, setCaptureOpt] = useState<'' | 'all' | 'kill' | 'utility'>('');
  const [confirming, setConfirming] = useState(false);
  const { current: captureCurrent, refresh: refreshCapture } = useCaptureSession();
  const captureInfo = captureCurrent?.capture;
  const pending = lib.data?.demos.some((d) => d.status === 'queued' || d.status === 'processing');
  const { reload } = lib;

  // Refresh while demos are being processed.
  useEffect(() => {
    if (!pending) return undefined;
    const t = window.setInterval(reload, 2500);
    return () => window.clearInterval(t);
  }, [pending, reload]);

  const upload = async (confirmed = false) => {
    if (!file || !lib.data) return;
    if (captureOpt && !confirmed) { setConfirming(true); return; }
    setConfirming(false);
    setError(null);
    setNotice(null);
    if (!/\.dem$/i.test(file.name)) { setError('Choose a CS2 demo file (.dem). Unzip .dem.gz / .zip / .bz2 downloads first.'); return; }
    if (file.size > lib.data.limits.max_bytes) { setError(`That demo is ${fmtSize(file.size)}; the limit is ${fmtSize(lib.data.limits.max_bytes)}.`); return; }
    setProgress(0);
    try {
      const q = new URLSearchParams({ file_name: file.name, ...(title.trim() ? { title: title.trim() } : {}), ...(captureOpt ? { capture: captureOpt } : {}) });
      const res = await api.uploadFile<{ retried?: boolean }>(`/teams/${teamId}/demos?${q}`, file, setProgress);
      setNotice((res?.retried
        ? 'This demo was already in your library but had failed, so it is being processed again.'
        : 'Uploaded. The demo is being processed in the background; this list updates when it is ready.')
        + (captureOpt ? ' CS2 capture starts once processing finishes.' : ''));
      setFile(null);
      setTitle('');
      setCaptureOpt('');
      refreshCapture();
      if (inputRef.current) inputRef.current.value = '';
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setProgress(null);
    }
  };

  const [shareCode, setShareCode] = useState('');
  const [importing, setImporting] = useState(false);
  const importCode = async () => {
    setError(null);
    setNotice(null);
    const code = shareCode.trim();
    if (!/^CSGO(-[A-Za-z0-9]{5}){5}$/.test(code)) { setError('That is not a CS2 match share code. It looks like CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx.'); return; }
    setImporting(true);
    try {
      const res = await api.post<{ existing: boolean; retried?: boolean; demo: DemoSummary }>(`/teams/${teamId}/demos/share-code`, { share_code: code });
      setNotice(res.existing
        ? (res.retried ? `This match was already imported as “${res.demo.title}” and failed, so it is being fetched again.` : `This match is already in your library as “${res.demo.title}”.`)
        : 'Match queued. The replay is being fetched from Valve and processed; this list updates when it is ready.');
      setShareCode('');
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setImporting(false);
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
      <CaptureOverlay current={captureCurrent} refresh={refreshCapture} />
      {confirming && captureOpt ? (
        <ConfirmDialog title={`Upload and capture ${captureOpt === 'all' ? 'kills & utility' : captureOpt === 'kill' ? 'kills' : 'utility'}?`}
          confirmLabel="Upload and capture" onCancel={() => setConfirming(false)} onConfirm={() => upload(true)}>
          <p>After the demo is processed, every recorded {captureOpt === 'all' ? 'kill and utility throw' : captureOpt === 'kill' ? 'kill' : 'utility throw'} is captured from CS2.</p>
          <CaptureWarning extra={<p>{estimateText(captureInfo?.estimates, captureOpt)} You can follow progress on this page.</p>} />
        </ConfirmDialog>
      ) : null}
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
          <button type="button" className="btn primary" disabled={!file || progress !== null} onClick={() => upload()}><Icon name="upload" /> Upload</button>
        </div>
        <fieldset className="capture-options">
          <legend className="small">Also capture first-person footage from CS2 <span className="muted">(optional)</span></legend>
          <div className="row tight wrap" role="group" aria-label="Capture from CS2 after import">
            {([['all', 'Kills & Utility'], ['kill', 'Kills only'], ['utility', 'Utility only']] as const).map(([v, l]) => (
              <button key={v} type="button" className={`btn small${captureOpt === v ? ' primary' : ' ghost'}`} aria-pressed={captureOpt === v}
                disabled={!captureInfo?.enabled} onClick={() => setCaptureOpt((cur) => (cur === v ? '' : v))}>{l}</button>
            ))}
          </div>
          <p className="muted small">{!captureInfo ? 'Checking whether capture is available…' : !captureInfo.enabled ? captureInfo.reason
            : captureOpt ? `${estimateText(captureInfo.estimates, captureOpt)} Select it again to clear.` : 'None selected: the demo is imported as usual.'}</p>
        </fieldset>
        {progress !== null ? <progress className="upload-progress" value={progress} max={1} aria-label="Upload progress" /> : null}
        <div className="row wrap share-code-row">
          <span className="muted small share-code-label">Or import a match share code</span>
          <input className="share-code-input" aria-label="Match share code" placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx" value={shareCode} spellCheck={false} autoComplete="off"
            maxLength={200} onChange={(e) => setShareCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') importCode(); }} />
          <button type="button" className="btn" disabled={!shareCode.trim() || importing} onClick={importCode}>{importing ? 'Importing…' : 'Import match'}</button>
        </div>
        {lib.data && lib.data.share_codes === false ? (
          <p className="muted small">Share code import needs a replay provider on this server; without one, codes are checked and you're told to upload the .dem instead.</p>
        ) : null}
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
                    {d.source === 'share_code' && d.status !== 'ready' ? <div className="muted small">From share code {d.share_code}</div> : null}
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

// Desktop replay layout: playback and annotation tools | HUD, square radar and
// round timeline | rounds, notes and annotations. The radar takes the largest
// square that fits the window height with the HUD above it and the timeline
// below; the right pane sits directly beside the radar. Below the breakpoint
// everything stacks.
const REPLAY_COLS = { tools: 172, side: 320, minSide: 280, gap: 14, stackBelow: 1101, inspectorMin: 340, inspectorMax: 760 };
function useReplayColumns() {
  const [layout, setLayout] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ board: number; height: number; inspector: number } | null>(null);
  useLayoutEffect(() => {
    if (!layout) return undefined;
    const measure = () => {
      if (window.innerWidth < REPLAY_COLS.stackBelow) { setSize(null); return; }
      const frame = layout.querySelector('.replay-centre .board-frame');
      const top = (frame ?? layout).getBoundingClientRect().top + window.scrollY;
      const layoutTop = layout.getBoundingClientRect().top + window.scrollY;
      // Everything under the radar in the centre column (the timeline).
      let below = 0;
      layout.querySelectorAll('.replay-centre > .board-frame ~ *').forEach((el) => { below += (el as HTMLElement).offsetHeight + 6; });
      const byWidth = layout.clientWidth - REPLAY_COLS.tools - REPLAY_COLS.side - REPLAY_COLS.gap * 2;
      const board = Math.max(320, Math.floor(Math.min(byWidth, window.innerHeight - top - below - 12)));
      // The side panes scroll inside the height of the HUD, radar and timeline.
      const height = Math.max(320, Math.floor(top - layoutTop + board + below));
      // Replay Inspector: the width left beside the rounds column, when there's
      // enough of it (otherwise it goes below, at full width).
      const spare = layout.clientWidth - REPLAY_COLS.tools - REPLAY_COLS.side - board - REPLAY_COLS.gap * 3;
      const inspector = spare >= REPLAY_COLS.inspectorMin ? Math.floor(Math.min(spare, REPLAY_COLS.inspectorMax)) : 0;
      setSize((s) => (s && s.board === board && s.height === height && s.inspector === inspector ? s : { board, height, inspector }));
    };
    measure();
    window.addEventListener('resize', measure);
    // The HUD and timeline appear when a round loads: watch them too.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(layout);
    const watched = new Set<Element>();
    const watch = () => layout.querySelectorAll('.replay-centre > :not(.board-frame)').forEach((el) => { if (!watched.has(el)) { watched.add(el); ro?.observe(el); } });
    watch();
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => { watch(); measure(); }) : null;
    const centre = layout.querySelector('.replay-centre');
    if (centre) mo?.observe(centre, { childList: true });
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); mo?.disconnect(); };
  }, [layout]);
  const style = size == null ? undefined : {
    gridTemplateColumns: `${REPLAY_COLS.tools}px ${size.board}px minmax(${REPLAY_COLS.minSide}px, ${REPLAY_COLS.side}px)${size.inspector ? ` ${size.inspector}px` : ''}`,
    ['--replay-height' as string]: `${size.height}px`,
  };
  return { setLayout, style, inspectorBeside: Boolean(size?.inspector) };
}

function TimelineGlyph({ ev }: { ev: ReplayEvent }) {
  if (ev.type === 'kill') return <span className="tl-glyph kill"><Icon name="skull" size={13} /></span>;
  if (ev.type === 'plant') return <span className="tl-glyph plant"><img src="/icons/bomb.png" alt="" width="10" height="13" /></span>;
  if (ev.type === 'explode') return <span className="tl-glyph explode"><img src="/icons/bomb.png" alt="" width="10" height="13" /></span>;
  if (ev.type === 'defuse') return <span className="tl-glyph defuse"><Icon name="defuse" size={13} /></span>;
  // The same CS2 icon as the kill feed for that utility (fire: molotov or incendiary, as recorded).
  return <span className={`tl-glyph util ${ev.type}`}><UtilityIcon kind={ev.type} variant={ev.variant} size={12} label="" /></span>;
}

// Round timeline across the centre pane, from the end of freeze time (the
// round clock's 0:00) to the end of the round: an icon above each event's
// moment (proportional to elapsed round time), stacked in rows where events are
// close, details on hover or keyboard focus, and the playback slider below.
const TL_ICON = 16;
const TL_ROW = TL_ICON + 1;
function EventTimeline({ info, events, annotations, tick, canControl, describe, onSeek, onJump }: {
  info: { start_tick: number; end_tick: number }; events: ReplayEvent[]; annotations: Annotation[]; tick: number; canControl: boolean;
  describe: (ev: ReplayEvent) => string; onSeek: (t: number) => void; onJump: (ev: ReplayEvent) => void;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(800);
  useLayoutEffect(() => {
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth || 800);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [el]);
  const span = info.end_tick - info.start_tick || 1;
  const frac = (t: number) => Math.min(1, Math.max(0, (t - info.start_tick) / span));
  const rows = timelineRows(events.map((ev) => frac(ev.tick) * width), TL_ROW, 2);
  const rowCount = Math.max(1, ...rows.map((r) => r + 1));
  return (
    <div className="event-timeline" ref={setEl}>
      <div className="tl-icons" style={{ height: rowCount * TL_ROW }} role="list" aria-label="Round events">
        {events.map((ev, i) => {
          const f = frac(ev.tick);
          const text = describe(ev);
          return (
            <button key={`${ev.type}${ev.tick}-${i}`} type="button" role="listitem" className={`tl-ev ${ev.type}${ev.tick <= tick ? ' past' : ''}`}
              style={{ left: `${f * 100}%`, top: rows[i] * TL_ROW }} aria-label={text} aria-disabled={!canControl || undefined}
              data-event={ev.type} onClick={() => { if (canControl) onJump(ev); }}>
              <TimelineGlyph ev={ev} />
              <span className={`tl-tip${f < 0.2 ? ' from-left' : f > 0.8 ? ' from-right' : ''}`} aria-hidden="true">{text}</span>
            </button>
          );
        })}
      </div>
      <div className="tl-track">
        {annotations.map((a) => <span key={a.annotation_id} className="tl-note" style={{ left: `${frac(a.tick) * 100}%` }} title="Team annotation" />)}
        <input type="range" aria-label="Playback position" min={info.start_tick} max={info.end_tick} step={1} value={Math.round(tick)} disabled={!canControl}
          style={{ ['--progress' as string]: `${frac(tick) * 100}%` }} onChange={(e) => onSeek(Number(e.target.value))} />
      </div>
    </div>
  );
}

type Mode = 'solo' | 'control' | 'follow';
type Tool = 'none' | 'draw' | 'text' | UtilityKind;
const isUtilityTool = (t: Tool): t is UtilityKind => UTILITY_KINDS.some(([k]) => k === t);
// The Text tool's editor: a new text (annotation_id null) or an existing one.
interface TextEdit { annotation_id: number | null; x: number; y: number; level: Level; tick: number; text: string; size: number }
type SaveState = { status: 'idle' | 'saving' | 'saved' | 'error'; message?: string };

// Blends a side colour towards white (flashed players), keeping the hue visible.
function towardsWhite(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) + (255 - ((n >> shift) & 255)) * amount);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

// Multi-line annotation text with a dark outline (same look as tactic notes).
function AnnotationText({ x, y, text, size, color, placeholder }: { x: number; y: number; text: string; size: number; color: string; placeholder?: boolean }) {
  const lines = (text || (placeholder ? 'Text' : '')).split('\n');
  const startY = -((lines.length - 1) * size * 1.2) / 2 + size * 0.35;
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={size} fontWeight="700" fill={placeholder && !text ? '#ffffff88' : color}
      stroke="#000" strokeWidth={Math.max(3, size / 5)} paintOrder="stroke" strokeLinejoin="round">
      {lines.map((line, i) => <tspan key={i} x={x} y={y + startY + i * size * 1.2}>{line || ' '}</tspan>)}
    </text>
  );
}
const textBox = (text: string, size: number) => {
  const lines = (text || 'Text').split('\n');
  return { w: Math.max(...lines.map((l) => l.length), 2) * size * 0.6 + 16, h: lines.length * size * 1.2 + 10 };
};

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
  const roundIndex = demo.rounds.findIndex((r) => r.round_number === roundNumber);
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
  // Recorded utility from the demo (each viewer can hide it; it is derived
  // from the shared playback position, so everyone in a live review sees the same).
  const [showRecorded, setShowRecorded] = useState(true);
  // The expanded scoreboard (per viewer; toggling never touches playback).
  const [showScoreboard, setShowScoreboard] = useState(false);
  // Display options (per viewer, never touch playback): kill feed, bomb
  // detonation shockwave and the estimated bomb damage area with its duration.
  const [showKillFeed, setShowKillFeed] = useState(true);
  const [showShockwave, setShowShockwave] = useState(true);
  const [showDamageArea, setShowDamageArea] = useState(true);
  const [damageSeconds, setDamageSeconds] = useState(5);
  // The kill picked in the kill feed: killer and victim are highlighted around it.
  const [selectedKill, setSelectedKill] = useState<ReplayEvent | null>(null);
  // Replay Inspector: the selected kill or utility event (round + index in that
  // round's events, or the first/last inspectable one once that round loads).
  // Kept until another event is chosen or it's cleared.
  const [inspect, setInspect] = useState<{ round: number; index: number } | null>(null);
  const [inspectFilter, setInspectFilter] = useState<InspectFilter>('all');
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus | null>(null);
  const [captureRefresh, setCaptureRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api.get<CaptureStatus>(`/demos/${demo.demo_id}/captures`).then((s) => { if (!cancelled) setCaptureStatus(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [demo.demo_id, captureRefresh]);
  // The user's capture session (overlay); its progress refreshes the list.
  const { current: captureCurrent, refresh: refreshCapture } = useCaptureSession(() => setCaptureRefresh((n) => n + 1));
  const capturePending = !!captureStatus?.captures?.some((c) => c.status === 'queued' || c.status === 'running');
  useEffect(() => {
    // Captures someone else started on this demo: check now and then.
    if (!capturePending) return undefined;
    const t = window.setTimeout(() => setCaptureRefresh((n) => n + 1), 5000);
    return () => window.clearTimeout(t);
  }, [capturePending, captureStatus]);
  const [watchConfirm, setWatchConfirm] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  const watchRound = async () => {
    setWatchBusy(true);
    setWatchError(null);
    try {
      await api.post(`/demos/${demo.demo_id}/watch`, { round_number: roundNumber });
      setWatchConfirm(false);
      refreshCapture();
    } catch (err) {
      setWatchError(errorMessage(err));
    } finally {
      setWatchBusy(false);
    }
  };
  // moving: the utility marker or text that the next map click moves.
  const [moving, setMoving] = useState<number | null>(null);
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null);
  const [draft, setDraft] = useState<Point[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const { setLayout, style: layoutStyle, inspectorBeside } = useReplayColumns();

  // Saved annotations plus this user's unsaved drafts (outside a live review).
  const notes = useLoad(
    () => api.get<{ annotations: Annotation[] }>(`/demos/${demo.demo_id}/annotations?round=${roundNumber}`),
    [demo.demo_id, roundNumber]
  );
  const annotations = mode === 'solo' ? notes.data?.annotations ?? [] : liveHere!.annotations;
  const canAnnotate = mode !== 'follow';

  // ---- Round notes ----
  // Saved notes come from the server (reloaded on each round change) or from
  // this browser's last save, whichever is newer. Edits are kept per round
  // until saved, so switching rounds never loses them while the page is open.
  const notesLoad = useLoad(() => api.get<{ notes: RoundNote[] }>(`/demos/${demo.demo_id}/notes`), [demo.demo_id, roundNumber]);
  const [savedLocal, setSavedLocal] = useState<Record<number, RoundNote>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
  const [annotationsDirty, setAnnotationsDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const savedNote = (n: number): RoundNote | null => {
    const server = notesLoad.data?.notes.find((x) => x.round_number === n) ?? null;
    const local = savedLocal[n] ?? null;
    const live = mode !== 'solo' && liveHere?.note && liveHere.note.round_number === n ? liveHere.note : null;
    return [server, local, live].reduce<RoundNote | null>((best, x) => (x && (!best || x.version > best.version) ? x : best), null);
  };
  const noteText = noteDrafts[roundNumber] ?? savedNote(roundNumber)?.body ?? '';
  const dirtyRounds = Object.keys(noteDrafts).map(Number).filter((n) => noteDrafts[n] !== (savedNote(n)?.body ?? ''));
  const unsavedHere = annotations.filter((a) => !a.saved && (mode === 'control' ? a.review_id != null : a.author?.user_id === user?.user_id));
  const dirty = dirtyRounds.length > 0 || annotationsDirty || unsavedHere.length > 0;
  useEffect(() => {
    if (!dirtyRounds.length) return undefined;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyRounds.length]);

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
    // startTick: where to start in that round (Replay Inspector navigation);
    // otherwise the end of freeze time.
    round: async (n: number, startTick?: number) => {
      const r = demo.rounds.find((x) => x.round_number === n);
      if (!r) return;
      setTextEdit(null);
      setMoving(null);
      setSelectedKill(null);
      const at = startTick != null ? Math.max(r.start_tick, Math.min(r.end_tick, startTick)) : r.freeze_end_tick ?? r.start_tick;
      if (mode === 'solo') setSolo({ ...solo, round: n, playing: false, anchorTick: at, anchorAt: Date.now() });
      else if (liveHere) {
        // Live: change round, then seek with the version that change returned.
        setBusy(true);
        try {
          const res = await api.post<{ review: LiveReview }>(`/reviews/${liveHere.review_id}/command`, { action: 'round', round_number: n, expected_version: liveHere.version });
          let review = res.review;
          if (startTick != null) review = (await api.post<{ review: LiveReview }>(`/reviews/${review.review_id}/command`, { action: 'seek', tick: at, expected_version: review.version })).review;
          sync.adopt(review);
        } catch (err) {
          if (err instanceof ApiError && err.status === 409 && err.body.review) sync.adopt(err.body.review as LiveReview);
          else setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }
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
    if (!liveHere) return;
    const unsavedLive = liveHere.annotations.some((a) => a.review_id != null);
    if (!window.confirm(unsavedLive ? 'End the live review for everyone? Live drawings you have not saved will be discarded.' : 'End the live review for everyone?')) return;
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
  const saveAnnotation = async (body: Record<string, unknown>, at: { tick: number; level: Level } = { tick, level }) => {
    setError(null);
    const payload = { ...body, round_number: roundNumber, tick: Math.round(at.tick), level: at.level };
    try {
      if (mode === 'solo') {
        await api.post(`/demos/${demo.demo_id}/annotations`, payload);
        await notes.reload();
      } else if (liveHere) {
        const res = await api.post<{ review: LiveReview }>(`/reviews/${liveHere.review_id}/annotations`, payload);
        sync.adopt(res.review);
      }
      setAnnotationsDirty(true);
      setSaveState({ status: 'idle' });
      return true;
    } catch (err) { setError(errorMessage(err)); return false; }
  };
  // Moves a marker or text, or changes a marker's type or a text's content and size
  // (live: the IGL's change reaches everyone following).
  const editAnnotation = async (a: Annotation, patch: Record<string, unknown>) => {
    setError(null);
    try {
      if (mode === 'solo') { await api.patch(`/demos/${demo.demo_id}/annotations/${a.annotation_id}`, patch); await notes.reload(); } else if (liveHere) {
        const res = await api.patch<{ review: LiveReview }>(`/reviews/${liveHere.review_id}/annotations/${a.annotation_id}`, patch);
        sync.adopt(res.review);
      }
      return true;
    } catch (err) { setError(errorMessage(err)); return false; }
  };
  const removeAnnotation = async (a: Annotation) => {
    try {
      if (mode === 'solo') { await api.delete(`/demos/${demo.demo_id}/annotations/${a.annotation_id}`); await notes.reload(); } else if (liveHere) {
        const res = await api.delete<{ review: LiveReview }>(`/reviews/${liveHere.review_id}/annotations/${a.annotation_id}`);
        sync.adopt(res.review);
      }
      if (textEdit?.annotation_id === a.annotation_id) setTextEdit(null);
    } catch (err) { setError(errorMessage(err)); }
  };
  // Who may change an annotation here: in a live review the IGL changes the
  // live layer; outside one, authors change their own (as before).
  const canEdit = (a: Annotation) => (mode === 'control' ? a.review_id != null : mode === 'solo' && a.author?.user_id === user?.user_id);

  const commitText = async () => {
    if (!textEdit) return;
    const text = textEdit.text.trim();
    if (!text) { setError('Type some text first, or cancel.'); return; }
    let ok: boolean;
    if (textEdit.annotation_id == null) {
      ok = await saveAnnotation({ kind: 'text', data: { x: textEdit.x, y: textEdit.y, text, size: textEdit.size } }, { tick: textEdit.tick, level: textEdit.level });
    } else {
      const a = annotations.find((x) => x.annotation_id === textEdit.annotation_id);
      ok = a ? await editAnnotation(a, { text, size: textEdit.size }) : false;
      if (ok) setAnnotationsDirty(true);
    }
    if (ok) setTextEdit(null);
  };
  const openText = (a: Annotation) => setTextEdit({
    annotation_id: a.annotation_id, x: a.data.x ?? 0.5, y: a.data.y ?? 0.5, level: a.level ?? 'main', tick: a.tick, text: a.data.text ?? '', size: a.data.size ?? NOTE_SIZE.default,
  });

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!canAnnotate) return;
    if (moving != null) {
      const p = toPoint(e);
      const a = annotations.find((x) => x.annotation_id === moving);
      setMoving(null);
      if (p && a) editAnnotation(a, { x: p.x, y: p.y, level });
      return;
    }
    if (tool === 'none') return;
    const p = toPoint(e);
    if (!p) return;
    if (isUtilityTool(tool)) {
      saveAnnotation({ kind: 'utility', data: { x: p.x, y: p.y, utility: tool } });
      return;
    }
    if (tool === 'text') {
      // Like a tactic note: place it, then type. Clicking elsewhere while a
      // new text is open moves it there.
      if (textEdit && textEdit.annotation_id == null) setTextEdit({ ...textEdit, x: p.x, y: p.y, level });
      else setTextEdit({ annotation_id: null, x: p.x, y: p.y, level, tick: Math.round(tick), text: '', size: NOTE_SIZE.default });
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

  // ---- Save notes and annotations ----
  const save = async () => {
    setError(null);
    setSaveState({ status: 'saving' });
    const body: Record<string, unknown> = {
      notes: dirtyRounds.map((n) => ({ round_number: n, body: noteDrafts[n], expected_version: savedNote(n)?.version ?? 0 })),
      ...(mode === 'control' && liveHere ? { review_id: liveHere.review_id } : {}),
    };
    const keep = (list: RoundNote[]) => setSavedLocal((cur) => ({ ...cur, ...Object.fromEntries(list.map((n) => [n.round_number, n])) }));
    try {
      const res = await api.post<{ notes: RoundNote[]; saved_annotations: number }>(`/demos/${demo.demo_id}/save`, body);
      keep(res.notes);
      setNoteDrafts((cur) => Object.fromEntries(Object.entries(cur).filter(([n]) => !dirtyRounds.includes(Number(n)))));
      setAnnotationsDirty(false);
      if (mode === 'solo') await notes.reload(); else sync.refetch();
      notesLoad.reload();
      const parts = [dirtyRounds.length ? `notes for ${dirtyRounds.length === 1 ? `round ${dirtyRounds[0]}` : `${dirtyRounds.length} rounds`}` : null,
        res.saved_annotations ? `${res.saved_annotations} annotation${res.saved_annotations === 1 ? '' : 's'}` : null].filter(Boolean);
      setSaveState({ status: 'saved', message: `Saved ${parts.length ? parts.join(' and ') : '(nothing had changed)'} at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'notes_conflict') keep((err.body.notes as RoundNote[]) ?? []);
      setSaveState({ status: 'error', message: `Not saved: ${errorMessage(err)}` });
    }
  };

  const players = useMemo(() => new Map(demo.players.map((p) => [p.index, p.name])), [demo.players]);
  const nameOf = useCallback((p: number) => players.get(p) ?? `Player ${p + 1}`, [players]);
  const visibleAnnotations = annotations.filter((a) => a.tick <= tick + 1 && (a.level ?? 'main') === level && a.annotation_id !== textEdit?.annotation_id);
  const kills = round ? round.events.filter((ev) => ev.type === 'kill' && ev.tick <= tick) : [];
  // Recorded utility and bomb state at this exact tick (see recordedAt).
  const rec = round && showRecorded ? recordedAt(round.events, tick) : null;
  const sideOf = new Map(round ? round.roster.map((p) => [p.player, p.side]) : []);
  const recColor = (ev: ReplayEvent) => (ev.player != null && sideOf.get(ev.player) ? SIDE_COLOR[sideOf.get(ev.player)!] : '#d7dde4');
  const onLevel = (ev: ReplayEvent) => ev.x != null && ev.y != null && (ev.level ?? 'main') === level;
  const who = (ev: ReplayEvent) => (ev.player != null ? players.get(ev.player) ?? `Player ${ev.player + 1}` : null);
  const secs = (ticks: number) => Math.max(0, Math.round(ticks / tickrate));
  const flights = round && showRecorded ? flightsAt(round.events, tick) : [];
  const utilityName = (ev: ReplayEvent) => (ev.type === 'fire' ? (ev.variant === 'incendiary' ? 'Incendiary' : 'Molotov') : RECORDED_LABEL[ev.type] ?? ev.type);
  // Event details for the timeline (hover / focus) and screen readers.
  const describe = (ev: ReplayEvent) => {
    const at = roundTime(info, ev.tick, tickrate);
    if (ev.type === 'kill') {
      const mods = [ev.headshot ? 'headshot' : null, ev.penetrated ? 'wallbang' : null, ev.noscope ? 'no-scope' : null, ev.through_smoke ? 'through smoke' : null,
        ev.attacker_blind ? 'while blind' : null, ev.in_air ? 'in the air' : null].filter(Boolean);
      const assist = ev.assister != null ? `, ${ev.flash_assist ? 'flash assist' : 'assist'} ${players.get(ev.assister) ?? '?'}` : '';
      const killer = ev.attacker != null ? players.get(ev.attacker) ?? '?' : ev.weapon === 'planted_c4' ? 'The bomb' : 'World';
      return `Round ${roundNumber} ${at} Kill: ${killer} killed ${ev.victim != null ? players.get(ev.victim) ?? '?' : '?'}${ev.weapon ? ` (${weaponLabel(ev.weapon)}${mods.length ? `, ${mods.join(', ')}` : ''})` : ''}${assist}`;
    }
    if (ev.type === 'plant' || ev.type === 'defuse') return `${at} ${RECORDED_LABEL[ev.type]}${who(ev) ? ` by ${who(ev)}` : ''}`;
    if (ev.type === 'explode') return `${at} Bomb exploded`;
    const parts = [`${at} ${utilityName(ev)}${who(ev) ? ` thrown by ${who(ev)}` : ''}`];
    if (ev.throw_tick != null) parts.push(`thrown at ${roundTime(info, ev.throw_tick, tickrate)}, ${(Math.max(0, ev.tick - ev.throw_tick) / tickrate).toFixed(1)} s in the air`);
    if (ev.end_tick != null) parts.push(`lasts ${secs(ev.end_tick - ev.tick)} s`);
    if (ev.x == null) parts.push('no position recorded');
    return parts.join(', ');
  };
  const timelineEvents = round ? round.events.filter((ev) => ev.type !== 'round_end' && (showRecorded || !RECORDED_UTILITY.includes(ev.type))) : [];
  const jump = (ev: ReplayEvent) => control.seek(Math.max(info.start_tick, Math.min(ev.throw_tick ?? ev.tick, ev.tick - 2 * tickrate)));
  const annotationTools: { id: Tool; label: string; icon: ReactNode }[] = [
    { id: 'none', label: 'View', icon: <Icon name="select" /> },
    { id: 'draw', label: 'Draw', icon: <Icon name="pen" /> },
    { id: 'text', label: 'Text', icon: <Icon name="text" /> },
    ...UTILITY_KINDS.map(([k, label]) => ({ id: k as Tool, label, icon: <UtilityIcon kind={k} size={18} label="" /> })),
  ];
  const playing = clock.playing && !atEnd;
  // ---- Kill feed, kill highlight and bomb detonation (all from the tick) ----
  const killFeed = round && showKillFeed ? killFeedAt(round.events, tick, tickrate) : [];
  const sideOfPlayer = (pl: number | null | undefined) => (pl == null ? null : sideOf.get(pl) ?? null);
  const slotOfPlayer = (pl: number | null | undefined) => (round && pl != null ? round.roster.findIndex((r) => r.player === pl) : -1);
  // Selecting an event for the inspector (kill feed, timeline or Previous /
  // Next): seek to its moment (a kill's tick, a throw's release) without
  // changing play/pause, highlight the players, and show it in the inspector.
  // Following viewers get the selection and highlight but don't move playback.
  const selectEvent = (ev: ReplayEvent) => {
    if (!round) return;
    const index = round.events.indexOf(ev);
    if (index < 0) return;
    setInspect({ round: roundNumber, index });
    setSelectedKill(isKill(ev) ? ev : null);
    if (canControl) control.seek(Math.max(info.start_tick, Math.min(info.end_tick, eventMoment(ev))));
  };
  const pickKill = (ev: ReplayEvent) => selectEvent(ev);
  // Landed recorded utility on the radar opens the same inspector event as
  // its timeline entry (same event object, so overlapping throws resolve to
  // their own clip). Off while a drawing tool is active.
  const pickUtility = (ev: ReplayEvent) => (tool === 'none' && isUtility(ev) ? {
    pointerEvents: 'auto' as const, role: 'button', tabIndex: 0, style: { cursor: 'pointer' },
    'aria-label': `Inspect ${RECORDED_LABEL[ev.type] ?? ev.type} by ${ev.player != null ? nameOf(ev.player) : 'unknown'}`,
    onPointerDown: (e: ReactPointerEvent) => e.stopPropagation(),
    onClick: () => selectEvent(ev),
    onKeyDown: (e: { key: string; preventDefault: () => void }) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectEvent(ev); } },
  } : {});
  // The inspected event, once its round is loaded.
  const inspectedEv = inspect && round && inspect.round === roundNumber ? round.events[inspect.index] : undefined;
  const inspected = inspectedEv && inspectable(inspectedEv) ? { ev: inspectedEv, index: inspect!.index } : null;
  const stepEvent = (dir: 1 | -1) => {
    if (!round) return;
    const from = inspected ? inspected.index : (() => {
      // Nothing selected: start from the current moment.
      const list = inspectableIndexes(round.events, inspectFilter);
      const pick = dir === 1 ? list.find((i) => eventMoment(round.events[i]) >= tick) : [...list].reverse().find((i) => eventMoment(round.events[i]) <= tick);
      return pick ?? null;
    })();
    if (!inspected && from != null) { selectEvent(round.events[from]); return; }
    const next = from != null ? neighbourIndex(round.events, from, dir, inspectFilter) : null;
    if (next != null) { selectEvent(round.events[next]); return; }
    // Past either end of the round: continue with the first / last
    // inspectable event of the neighbouring rounds (fetched first, so the
    // round and position change together).
    if (!canControl) return;
    void (async () => {
      for (let i = roundIndex + dir; i >= 0 && i < demo.rounds.length; i += dir) {
        const target = demo.rounds[i];
        try {
          const data = await api.get<ReplayRound>(`/demos/${demo.demo_id}/rounds/${target.round_number}`);
          const list = inspectableIndexes(data.events, inspectFilter);
          const index = dir === 1 ? list[0] : list[list.length - 1];
          if (index == null) continue;
          setInspect({ round: target.round_number, index });
          await control.round(target.round_number, eventMoment(data.events[index]));
          if (isKill(data.events[index])) setSelectedKill(data.events[index]);
          return;
        } catch (err) {
          setError(errorMessage(err));
          return;
        }
      }
    })();
  };
  // Utility throw highlight: where it was thrown from and where it landed.
  const utilityHighlight = inspected && isUtility(inspected.ev) && Math.abs(tick - eventMoment(inspected.ev)) <= 3 * tickrate ? inspected.ev : null;
  const killHighlight = (() => {
    if (!round || !selectedKill || Math.abs(tick - selectedKill.tick) > 3 * tickrate) return null;
    const killerSlot = slotOfPlayer(selectedKill.attacker);
    const killer = killerSlot >= 0 ? frameAt(round, killerSlot, selectedKill.tick) : null;
    const victimSlot = slotOfPlayer(selectedKill.victim);
    const victimFrame = victimSlot >= 0 ? frameAt(round, victimSlot, selectedKill.tick - 1) : null;
    const victim = selectedKill.x != null ? { x: selectedKill.x, y: selectedKill.y!, level: selectedKill.level ?? 'main' } : victimFrame;
    const fade = 1 - Math.abs(tick - selectedKill.tick) / (3 * tickrate);
    return { killer, victim, fade, players: [selectedKill.attacker, selectedKill.victim].filter((x): x is number => x != null) };
  })();
  const detonation = round ? detonationAt(round.events, tick, tickrate) : null;
  const shock = detonation && showShockwave ? shockwaveFrame(detonation.elapsed) : null;
  const damageArea = detonation && showDamageArea && detonation.elapsed < damageSeconds ? detonation : null;
  const unitsPerBoard = (round?.units_per_radar ?? 5000) / SIZE;
  const bombHits = round && detonation && detonation.elapsed < damageSeconds ? bombDamageAt(round, tick) : [];
  const prevRound = demo.rounds[roundIndex - 1];
  const nextRound = demo.rounds[roundIndex + 1];
  const textSize = (n: number) => Math.min(NOTE_SIZE.max, Math.max(NOTE_SIZE.min, n));

  return (
    <div className="stack replay-page">
      <CaptureOverlay current={captureCurrent} refresh={refreshCapture} demoId={demo.demo_id} />
      {watchConfirm ? (
        <ConfirmDialog title={`Watch round ${roundNumber} in CS2?`} confirmLabel="Open in CS2" busy={watchBusy}
          onCancel={() => setWatchConfirm(false)} onConfirm={watchRound}>
          <p>Opens this demo in <strong>CS2 on this PC</strong> at the start of round {roundNumber}, paused, with your own video settings. CS2 stays open for you to watch.</p>
          <p>While it starts, CS2's window is controlled automatically: please don't type or click until the round is open.</p>
          {watchError ? <p className="error-text small">{watchError}</p> : null}
        </ConfirmDialog>
      ) : null}
      <div className="replay-head">
        <h1>{demo.title}</h1>
        <p className="muted small">{mapName(demo.map)} · {demo.rounds.length} rounds · round {roundNumber}
          {info.winner ? <> · won by <strong>{info.winner}</strong>{info.reason ? ` (${info.reason.replace(/_/g, ' ')})` : ''}</> : null}
          {info.ct_score != null ? ` · after the round: CT ${info.ct_score} – ${info.t_score} T` : ''}</p>
      </div>

      {liveHere ? (
        <div className="live-banner compact" role="status">
          <Badge tone="red">LIVE</Badge>
          {mode === 'control' ? <span>You're leading this review. Everyone on the team sees your playback and drawings.</span>
            : mode === 'follow' ? <span>Following {liveHere.igl?.user_name ?? 'the IGL'}. Playback, round and drawings are controlled by the IGL.</span>
              : <span>A live review of this demo is running.</span>}
          {sync.offline ? <Badge tone="red">Reconnecting…</Badge> : <span className="muted small">{sync.drift < 0.25 ? 'In sync' : `Re-syncing (${sync.drift.toFixed(1)}s)`}</span>}
          {mode === 'follow' ? <button type="button" className="btn ghost small" onClick={() => setWatchSolo(true)}>Watch on my own</button> : null}
          {mode === 'solo' ? <button type="button" className="btn small" onClick={() => setWatchSolo(false)}>Rejoin live</button> : null}
        </div>
      ) : liveReview ? (
        <div className="live-banner compact"><Badge tone="red">LIVE</Badge> A live review of “{liveReview.demo.title}” is running.
          <Link className="btn small" to={`/demos/${liveReview.demo.demo_id}?live=1`}>Join</Link></div>
      ) : null}
      <Alert>{error ?? roundError}</Alert>

      <div className={`replay-layout${layoutStyle ? '' : ' stacked'}`} ref={setLayout} style={layoutStyle}>
        <aside className="tool-rail replay-tools" aria-label="Playback, annotation tools and view options">
          <div className="playback-group" role="group" aria-label="Playback">
            <div className="playback-row">
              <button type="button" className="btn primary small" disabled={!canControl || busy} onClick={toggle} aria-label={playing ? 'Pause' : atEnd ? 'Replay round' : 'Play'}>
                <Icon name={playing ? 'pause' : 'play'} size={16} /> {playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}
              </button>
              <select aria-label="Playback speed" value={clock.speed} disabled={!canControl || busy} onChange={(e) => control.speed(Number(e.target.value))}>
                {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
              </select>
            </div>
            <div className="playback-pos" title="Playback position since the end of freeze time (the in-game round clock is in the HUD)">
              <span className="muted small">Position</span> <output aria-label="Playback time">{playbackText(info, tick, tickrate)}</output>
            </div>
            <div className="playback-row round-nav">
              <button type="button" className="btn ghost small" aria-label="Previous round" disabled={!canControl || busy || !prevRound} onClick={() => prevRound && control.round(prevRound.round_number)}>
                <Icon name="left" size={14} />
              </button>
              <span className="small">Round <strong>{roundNumber}</strong> / {demo.rounds.length}</span>
              <button type="button" className="btn ghost small" aria-label="Next round" disabled={!canControl || busy || !nextRound} onClick={() => nextRound && control.round(nextRound.round_number)}>
                <Icon name="right" size={14} />
              </button>
            </div>
            {mode === 'solo' && canControlReview && !liveReview ? <button type="button" className="btn small" onClick={startLive}><Icon name="live" size={14} /> Start live review</button> : null}
            {mode === 'control' ? <button type="button" className="btn ghost small danger" onClick={endLive}><Icon name="stop" size={14} /> End live review</button> : null}
          </div>
          {canAnnotate ? (
            <>
              <div className="toolbar vertical" role="toolbar" aria-label="Annotation tools" aria-orientation="vertical">
                {annotationTools.map((t) => (
                  <button key={t.id} type="button" className={tool === t.id ? 'on' : ''} aria-pressed={tool === t.id} data-tool={t.id}
                    onClick={() => { setTool(t.id); if (t.id !== 'text') setTextEdit(null); }}
                    title={t.id === 'none' ? 'View only (no annotation)' : t.id === 'text' ? 'Text: click the map to place it, then type (click a text to edit it)' : `${t.label}: click the map to add it at the current moment`}>
                    <span className="tool-icon" aria-hidden="true">{t.icon}</span>{t.label}
                  </button>
                ))}
              </div>
              {textEdit ? (
                <div className="text-editor" role="group" aria-label={textEdit.annotation_id == null ? 'New text' : 'Edit text'}>
                  <textarea rows={3} maxLength={200} aria-label="Annotation text" placeholder="Type the text" autoFocus value={textEdit.text}
                    onChange={(e) => setTextEdit({ ...textEdit, text: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitText(); } if (e.key === 'Escape') setTextEdit(null); }} />
                  <div className="row tight">
                    <button type="button" className="btn small" aria-label="Smaller text" disabled={textEdit.size <= NOTE_SIZE.min}
                      onClick={() => setTextEdit({ ...textEdit, size: textSize(textEdit.size - NOTE_SIZE.step) })}><Icon name="down" size={14} /></button>
                    <span className="small" aria-live="polite">Size {textEdit.size}</span>
                    <button type="button" className="btn small" aria-label="Larger text" disabled={textEdit.size >= NOTE_SIZE.max}
                      onClick={() => setTextEdit({ ...textEdit, size: textSize(textEdit.size + NOTE_SIZE.step) })}><Icon name="up" size={14} /></button>
                  </div>
                  <div className="row tight">
                    <button type="button" className="btn primary small" disabled={!textEdit.text.trim()} onClick={commitText}>{textEdit.annotation_id == null ? 'Add' : 'Update'}</button>
                    <button type="button" className="btn ghost small" onClick={() => setTextEdit(null)}>Cancel</button>
                    {textEdit.annotation_id != null ? (
                      <button type="button" className="btn ghost small danger" aria-label="Delete text" onClick={() => {
                        const a = annotations.find((x) => x.annotation_id === textEdit.annotation_id);
                        if (a) removeAnnotation(a);
                      }}><Icon name="trash" size={14} /></button>
                    ) : null}
                  </div>
                  <p className="muted small hint">At {roundTime(info, textEdit.tick, tickrate)}{levels.length > 1 ? `, ${LEVEL_LABEL[textEdit.level].toLowerCase()}` : ''}. Click the map to move a new text.</p>
                </div>
              ) : null}
              {moving != null ? <span className="muted small">Click the map to move it. <button type="button" className="btn ghost small" onClick={() => setMoving(null)}>Cancel</button></span> : null}
              {!textEdit ? <p className="muted small hint">{tool === 'none' ? 'Choose a tool to annotate.' : tool === 'text' ? 'Click the map to place text.' : 'Click the map.'} Added at {roundTime(info, tick, tickrate)}.</p> : null}
              {mode === 'control' ? (
                <button type="button" className="btn ghost small danger" disabled={busy || !annotations.some((a) => a.review_id != null)}
                  onClick={() => { if (window.confirm('Clear the unsaved live drawings for this round?')) sendLive({ action: 'clear' }); }}>Clear live drawings</button>
              ) : null}
            </>
          ) : <p className="muted small hint">Following the IGL: annotation tools are with them.</p>}
          <button type="button" className={`btn small scoreboard-toggle${showScoreboard ? ' on' : ''}`} aria-pressed={showScoreboard} aria-controls="replay-scoreboard"
            onClick={() => setShowScoreboard((v) => !v)}><Icon name="scoreboard" size={14} /> Scoreboard</button>
          {levels.length > 1 ? (
            <div className="segmented" role="group" aria-label="Radar floor">
              {levels.map((l) => <button key={l} type="button" className={level === l ? 'on' : ''} aria-pressed={level === l} onClick={() => setLevel(l)}>{LEVEL_LABEL[l]}</button>)}
            </div>
          ) : null}
          <label className="inline-check small" title="Smokes, flashes, HEs, molotovs, plants and defusals recorded in the demo">
            <input type="checkbox" checked={showRecorded} onChange={(e) => setShowRecorded(e.target.checked)} /> Recorded utility
          </label>
          <fieldset className="display-options">
            <legend className="small muted">Display</legend>
            <label className="inline-check small"><input type="checkbox" checked={showKillFeed} onChange={(e) => setShowKillFeed(e.target.checked)} /> Kill feed</label>
            <label className="inline-check small"><input type="checkbox" checked={showShockwave} onChange={(e) => setShowShockwave(e.target.checked)} /> Bomb shockwave</label>
            <label className="inline-check small" title="Estimated damage around the bomb when it explodes (an approximation; recorded damage is shown on players)">
              <input type="checkbox" checked={showDamageArea} onChange={(e) => setShowDamageArea(e.target.checked)} /> Bomb damage area</label>
            {showDamageArea ? (
              <label className="inline small">for
                <select aria-label="Bomb damage area duration" value={damageSeconds} onChange={(e) => setDamageSeconds(Number(e.target.value))}>
                  {[3, 5, 10, 20].map((n) => <option key={n} value={n}>{n} s</option>)}
                </select>
              </label>
            ) : null}
          </fieldset>
          <div className="replay-legend small muted">
            <span><span className="legend-swatch recorded" aria-hidden="true" /> Recorded in the demo (dashed, thrower's side colour)</span>
            <span><span className="legend-swatch flight" aria-hidden="true" /> Grenade in the air</span>
            <span><span className="legend-swatch annotation" aria-hidden="true" /> Team annotations</span>
            <span><span className="legend-swatch flashed" aria-hidden="true" /> Flashed player</span>
          </div>
        </aside>

        <div className="replay-centre">
          {round ? <ReplayHud round={round} info={info} tick={tick} tickrate={tickrate} name={nameOf} roundNumber={roundNumber}
            highlight={[...(killHighlight?.players ?? []), ...(utilityHighlight?.player != null ? [utilityHighlight.player] : []), ...bombHits.map((d) => d.player)]} /> : <div className="cs2-hud placeholder" aria-hidden="true" />}
          <div className="board-frame">
            <svg ref={svgRef} viewBox={`0 0 ${SIZE} ${SIZE}`} className={`board${tool !== 'none' && canAnnotate ? ' editable' : ''}`} role="img"
              aria-label={`Replay of round ${roundNumber}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
              style={{ cursor: canAnnotate && tool !== 'none' ? 'crosshair' : undefined, touchAction: tool !== 'none' ? 'none' : undefined }}
              fontFamily="system-ui, sans-serif">
              <MapBackground map={demo.map ?? ''} level={level} />
              {damageArea && damageArea.level === level ? (() => {
                // Estimated damage area (analysis aid): radius where the estimate drops to 1 HP, with stops at 100 and 50 HP.
                const rMax = estimatedRadiusFor(1);
                const fade = Math.min(1, (damageSeconds - damageArea.elapsed) / 1);
                return (
                  <g pointerEvents="none" data-bomb-damage-area="" opacity={fade}>
                    <defs>
                      <radialGradient id="bomb-damage-gradient">
                        <stop offset="0" stopColor="#ff2a1a" stopOpacity="0.55" />
                        <stop offset={estimatedRadiusFor(100) / rMax} stopColor="#ff7a1a" stopOpacity="0.4" />
                        <stop offset={estimatedRadiusFor(50) / rMax} stopColor="#ffc21a" stopOpacity="0.28" />
                        <stop offset="1" stopColor="#ffe066" stopOpacity="0" />
                      </radialGradient>
                    </defs>
                    <circle cx={damageArea.x * SIZE} cy={damageArea.y * SIZE} r={rMax / unitsPerBoard} fill="url(#bomb-damage-gradient)" />
                  </g>
                );
              })() : null}
              {kills.filter((k) => k.x != null && (k.level ?? 'main') === level).map((k, i) => (
                <g key={`k${i}`} transform={`translate(${k.x! * SIZE},${k.y! * SIZE})`} opacity="0.85" pointerEvents="none">
                  <path d="M-8,-8 L8,8 M8,-8 L-8,8" stroke="#ff5a5f" strokeWidth="4" strokeLinecap="round" />
                </g>
              ))}
              {rec ? (
                <g className="recorded" pointerEvents="none" data-recorded-layer="">
                  {rec.smokes.filter(onLevel).map((ev) => (
                    <g key={`s${ev.tick}-${ev.x}`} transform={`translate(${ev.x! * SIZE},${ev.y! * SIZE})`} data-recorded="smoke" {...pickUtility(ev)}>
                      <circle r={RECORDED_RADIUS.smoke} fill="#c9d0d8" fillOpacity="0.55" stroke={recColor(ev)} strokeWidth="2" strokeDasharray="5 4" />
                      <UtilityGlyph kind="smoke" color={recColor(ev)} r={10} />
                      <text y={RECORDED_RADIUS.smoke + 13} textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff" stroke="#000" strokeWidth="3" paintOrder="stroke">
                        {secs((ev.end_tick ?? tick) - tick)}s</text>
                    </g>
                  ))}
                  {rec.fires.filter(onLevel).map((ev) => (
                    <g key={`f${ev.tick}-${ev.x}`} transform={`translate(${ev.x! * SIZE},${ev.y! * SIZE})`} data-recorded="fire" {...pickUtility(ev)}>
                      <circle r={RECORDED_RADIUS.fire} fill="#e8833a" fillOpacity="0.5" stroke={recColor(ev)} strokeWidth="2" strokeDasharray="5 4" />
                      <UtilityGlyph kind="molly" color={recColor(ev)} r={10} />
                      <text y={RECORDED_RADIUS.fire + 13} textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff" stroke="#000" strokeWidth="3" paintOrder="stroke">
                        {secs((ev.end_tick ?? tick) - tick)}s</text>
                    </g>
                  ))}
                  {rec.flashes.filter(onLevel).map((ev) => (
                    <g key={`fl${ev.tick}-${ev.x}`} transform={`translate(${ev.x! * SIZE},${ev.y! * SIZE})`} data-recorded="flash" {...pickUtility(ev)}
                      opacity={Math.max(0.25, 1 - (tick - ev.tick) / FLASH_SHOW_TICKS)}>
                      <circle r="20" fill="#fffbe0" fillOpacity="0.6" />
                      <UtilityGlyph kind="flash" color={recColor(ev)} r={10} />
                    </g>
                  ))}
                  {rec.hes.filter(onLevel).map((ev) => (
                    <g key={`he${ev.tick}-${ev.x}`} transform={`translate(${ev.x! * SIZE},${ev.y! * SIZE})`} data-recorded="he" {...pickUtility(ev)}
                      opacity={Math.max(0.25, 1 - (tick - ev.tick) / BLAST_SHOW_TICKS)}>
                      <circle r="22" fill="none" stroke="#ff7a45" strokeWidth="4" />
                      <UtilityGlyph kind="he" color={recColor(ev)} r={10} />
                    </g>
                  ))}
                  {rec.bomb ? (() => {
                    const at = rec.bomb.state === 'defused' ? rec.bomb.event : rec.bomb.plant ?? rec.bomb.event;
                    if (!onLevel(at)) return null;
                    const fill = rec.bomb.state === 'defused' ? '#2f9e66' : '#e5484d';
                    return (
                      <g transform={`translate(${at.x! * SIZE},${at.y! * SIZE})`} data-recorded={`bomb-${rec.bomb.state}`}>
                        {rec.bomb.state === 'exploded' && tick - rec.bomb.event.tick < 2 * tickrate ? <circle r="46" fill="#ff7a45" fillOpacity="0.35" /> : null}
                        <rect x="-12" y="-9" width="24" height="18" rx="3" fill={fill} stroke="#fff" strokeWidth="2" />
                        <text y="5" textAnchor="middle" fontSize="11" fill="#fff" fontWeight="700">{rec.bomb.state === 'defused' ? 'DEF' : 'C4'}</text>
                      </g>
                    );
                  })() : null}
                  {/* Grenades in the air: recorded path (dotted, thrower's side colour), where the thrower stood, and the projectile now. */}
                  {flights.map((fl) => {
                    const c = recColor(fl.event);
                    const from = fl.event.from;
                    const head = fl.head;
                    return (
                      <g key={`air${fl.event.type}${fl.event.tick}-${fl.event.throw_tick}`} data-recorded="flight" data-flight={fl.event.type}>
                        {from && from.level === level ? (
                          <circle cx={from.x * SIZE} cy={from.y * SIZE} r="13" fill="none" stroke={c} strokeWidth="2" strokeDasharray="2 3" data-thrown-from="" />
                        ) : null}
                        {fl.runs.map((run, i) => (
                          <polyline key={i} points={run.points.map((p) => `${p.x * SIZE},${p.y * SIZE}`).join(' ')} fill="none" stroke={c}
                            strokeWidth="3" strokeDasharray="0.5 7" strokeLinecap="round" opacity={run.level === level ? 1 : 0.25} />
                        ))}
                        <g transform={`translate(${head.x * SIZE},${head.y * SIZE})`} opacity={head.level === level ? 1 : 0.3}>
                          <circle r="6" fill={c} stroke="#111" strokeWidth="2" />
                          <text y="-10" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" stroke="#000" strokeWidth="3" paintOrder="stroke">
                            {utilityName(fl.event)}{who(fl.event) ? ` · ${who(fl.event)}` : ''}</text>
                        </g>
                      </g>
                    );
                  })}
                </g>
              ) : null}
              {shock && detonation && detonation.level === level ? (
                <g pointerEvents="none" transform={`translate(${detonation.x * SIZE},${detonation.y * SIZE})`} data-shockwave={detonation.elapsed.toFixed(2)}>
                  {shock.flash > 0 ? <circle r={18 + 30 * (1 - shock.flash)} fill="#fff3b0" opacity={shock.flash} /> : null}
                  {shock.flash > 0 ? <circle r={10 + 14 * (1 - shock.flash)} fill="#ff9a1f" opacity={shock.flash} /> : null}
                  <circle r={Math.max(4, shock.ring * (BOMB_ESTIMATE.radius / unitsPerBoard))} fill="none" stroke="#ffb347" strokeWidth={6 - 4 * shock.ring} opacity={Math.max(0, shock.ringOpacity)} />
                  {shock.secondRing > 0 ? <circle r={shock.secondRing * 0.7 * (BOMB_ESTIMATE.radius / unitsPerBoard)} fill="none" stroke="#fff" strokeWidth="2"
                    opacity={Math.max(0, 0.5 * (1 - shock.secondRing))} /> : null}
                </g>
              ) : null}
              {killHighlight && killHighlight.killer && killHighlight.victim && killHighlight.killer.level === level ? (
                <g pointerEvents="none" opacity={0.4 + 0.6 * killHighlight.fade} data-kill-highlight="">
                  <line x1={killHighlight.killer.x * SIZE} y1={killHighlight.killer.y * SIZE} x2={killHighlight.victim.x * SIZE} y2={killHighlight.victim.y * SIZE}
                    stroke="#fff" strokeWidth="2.5" strokeDasharray="7 5" />
                </g>
              ) : null}
              {utilityHighlight && utilityHighlight.from && utilityHighlight.x != null ? (
                <g pointerEvents="none" data-utility-highlight="">
                  {utilityHighlight.from.level === level ? <circle cx={utilityHighlight.from.x * SIZE} cy={utilityHighlight.from.y * SIZE} r="20" fill="none" stroke="#fff" strokeWidth="3" /> : null}
                  {(utilityHighlight.level ?? 'main') === level ? <circle cx={utilityHighlight.x * SIZE} cy={utilityHighlight.y! * SIZE} r="16" fill="none" stroke="#ffd166" strokeWidth="3" strokeDasharray="5 4" /> : null}
                </g>
              ) : null}
              {killHighlight ? [killHighlight.killer, killHighlight.victim].map((pt, i) => (pt && pt.level === level ? (
                <circle key={`kh${i}`} cx={pt.x * SIZE} cy={pt.y * SIZE} r="20" fill="none" stroke={i === 0 ? '#ffffff' : '#ff5a5f'} strokeWidth="3"
                  opacity={killHighlight.fade} pointerEvents="none" />
              ) : null)) : null}
              {round ? round.roster.map((p, i) => {
                const f = frameAt(round, i, tick);
                if (!f || (f.x === 0 && f.y === 0)) return null;
                const other = f.level !== level;
                const color = SIDE_COLOR[p.side];
                const a = (f.yaw * Math.PI) / 180;
                const name = nameOf(p.player);
                // Flashed: the marker turns white and fades back over the
                // recorded flash duration; the side-coloured ring, view line
                // and name keep it identifiable.
                const flash = f.alive ? flashAmount(round, p.player, tick) : 0;
                return (
                  <g key={p.player} transform={`translate(${f.x * SIZE},${f.y * SIZE})`} opacity={other ? 0.25 : f.alive ? 1 : 0.45} pointerEvents="none"
                    data-marker={p.player} data-flash={flash > 0 ? flash.toFixed(2) : undefined}>
                    {f.alive ? (
                      <>
                        <line x1="0" y1="0" x2={Math.cos(a) * 22} y2={-Math.sin(a) * 22} stroke={color} strokeWidth="3" />
                        {flash > 0 ? <circle r="15" fill="#fff" opacity={0.35 * flash} /> : null}
                        <circle r="10" fill={flash > 0 ? towardsWhite(color, flash) : color} stroke={flash > 0 ? color : '#111'} strokeWidth={flash > 0 ? 3 : 2.5} />
                        <text y="-15" textAnchor="middle" fontSize="13" fontWeight="600" fill="#fff" stroke="#000" strokeWidth="3" paintOrder="stroke">{name}</text>
                      </>
                    ) : <path d="M-7,-7 L7,7 M7,-7 L-7,7" stroke={color} strokeWidth="3" />}
                    {bombHits.filter((d) => d.player === p.player).map((d) => (
                      <g key={`bd${d.tick}`} data-bomb-hit={d.damage}>
                        <circle r="16" fill="none" stroke="#ff7a1a" strokeWidth="2.5" />
                        <text y="30" textAnchor="middle" fontSize="13" fontWeight="800" fill="#ffb347" stroke="#000" strokeWidth="3" paintOrder="stroke">
                          −{d.damage}{d.health === 0 ? ' C4 kill' : ` (${d.health} HP)`}</text>
                      </g>
                    ))}
                  </g>
                );
              }) : null}
              {visibleAnnotations.filter((a) => a.kind === 'utility').map((a) => (
                <g key={a.annotation_id} transform={`translate(${(a.data.x ?? 0) * SIZE},${(a.data.y ?? 0) * SIZE})`} pointerEvents="none"
                  opacity={moving === a.annotation_id ? 0.4 : 0.95} data-utility-annotation={a.data.utility}>
                  {a.data.utility === 'smoke' ? <circle r="40" fill="#c9d0d8" opacity="0.35" /> : a.data.utility === 'molly' ? <circle r="30" fill="#e8833a" opacity="0.35" /> : null}
                  <UtilityGlyph kind={a.data.utility ?? 'smoke'} color="#ffd166" r={16} />
                </g>
              ))}
              {visibleAnnotations.filter((a) => a.kind === 'drawing').map((a) => (
                <polyline key={a.annotation_id} points={(a.data.points ?? []).map((p) => `${p.x * SIZE},${p.y * SIZE}`).join(' ')}
                  fill="none" stroke={a.data.color ?? '#ffd166'} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
              ))}
              {visibleAnnotations.filter((a) => a.kind === 'text').map((a) => {
                const size = a.data.size ?? NOTE_SIZE.default;
                const editable = tool === 'text' && canAnnotate && canEdit(a);
                const { w, h } = textBox(a.data.text ?? '', size);
                const x = (a.data.x ?? 0) * SIZE;
                const y = (a.data.y ?? 0) * SIZE;
                return (
                  <g key={a.annotation_id} data-text-annotation={a.annotation_id} opacity={moving === a.annotation_id ? 0.4 : 1}
                    pointerEvents={editable ? 'all' : 'none'} style={editable ? { cursor: 'text' } : undefined}
                    onPointerDown={editable ? (e) => { e.stopPropagation(); openText(a); } : undefined}>
                    {editable ? <rect x={x - w / 2} y={y - h / 2} width={w} height={h} fill="transparent" stroke="#ffffff55" strokeDasharray="4 4" rx="4" /> : null}
                    <AnnotationText x={x} y={y} text={a.data.text ?? ''} size={size} color={a.data.color ?? '#ffd166'} />
                  </g>
                );
              })}
              {textEdit && textEdit.level === level ? (() => {
                const { w, h } = textBox(textEdit.text, textEdit.size);
                const x = textEdit.x * SIZE;
                const y = textEdit.y * SIZE;
                return (
                  <g pointerEvents="none" data-text-editing="">
                    <rect x={x - w / 2} y={y - h / 2} width={w} height={h} fill="#00000055" stroke="#fff" strokeWidth="2" strokeDasharray="8 6" rx="4" />
                    <AnnotationText x={x} y={y} text={textEdit.text} size={textEdit.size} color="#ffd166" placeholder />
                  </g>
                );
              })() : null}
              {draft ? <polyline points={draft.map((p) => `${p.x * SIZE},${p.y * SIZE}`).join(' ')} fill="none" stroke="#ffd166" strokeWidth="5"
                strokeDasharray="10 6" strokeLinecap="round" pointerEvents="none" /> : null}
            </svg>
            {/* Centred on the radar itself (not the window), over the map; never changes playback. */}
            {showScoreboard && round ? (
              <div id="replay-scoreboard" className="cs2-scoreboard-layer"><ReplayScoreboard round={round} tick={tick} name={nameOf} onClose={() => setShowScoreboard(false)} /></div>
            ) : null}
            {round && killFeed.length ? (
              <KillFeed entries={killFeed} side={sideOfPlayer} name={nameOf} describe={describe} onSelect={pickKill} selected={selectedKill} />
            ) : null}
            {damageArea ? (
              <p className="bomb-estimate-note" role="note">Estimated bomb damage area (CS:GO formula: {BOMB_ESTIMATE.damage} damage, {BOMB_ESTIMATE.radius}-unit radius, no armour or cover).
                {' '}Not what the game calculated{bombHits.length ? '; recorded bomb damage is shown on the players.' : '; no bomb damage was recorded for any player.'}</p>
            ) : null}
          </div>
          {round ? (
            <EventTimeline info={{ start_tick: info.freeze_end_tick ?? info.start_tick, end_tick: info.end_tick }} events={timelineEvents} annotations={annotations} tick={tick} canControl={canControl}
              describe={describe} onSeek={control.seek} onJump={(ev) => (inspectable(ev) ? selectEvent(ev) : jump(ev))} />
          ) : !roundError ? <p className="muted small">Loading round…</p> : null}
        </div>

        <aside className="replay-side" aria-label="Rounds, notes and annotations">
          <Panel title="Rounds">
            <div className="round-strip">
              {demo.rounds.map((r) => (
                <button key={r.round_number} type="button" className={`${r.winner === 'CT' ? 'ct' : r.winner === 'T' ? 't' : ''}${r.round_number === roundNumber ? ' on' : ''}`}
                  disabled={!canControl || busy} aria-pressed={r.round_number === roundNumber} title={r.winner ? `${r.winner} win` : undefined}
                  onClick={() => control.round(r.round_number)}>{r.round_number}</button>
              ))}
            </div>
            {captureStatus?.enabled ? (
              <div className="watch-round">
                <button type="button" className="btn small" onClick={() => setWatchConfirm(true)}>
                  <Icon name="screen" size={14} /> Watch this round</button>
                <span className="muted small">Opens round {roundNumber} in CS2</span>
              </div>
            ) : null}
          </Panel>
          <Panel title={`Round ${roundNumber} notes`} className="round-notes">
            <textarea aria-label={`Notes for round ${roundNumber}`} value={noteText} maxLength={5000} readOnly={!canAnnotate}
              placeholder={canAnnotate ? 'Notes for this round: what happened, what to fix, calls to practise…' : 'No saved notes for this round yet.'}
              onChange={(e) => { const body = e.target.value; setNoteDrafts((cur) => ({ ...cur, [roundNumber]: body })); setSaveState({ status: 'idle' }); }} />
            {(() => {
              const s = savedNote(roundNumber);
              return s ? <p className="muted small">Last saved by {s.updated_by?.user_name ?? 'a teammate'} {formatDateTime(s.updated_at)}</p> : null;
            })()}
            {canAnnotate ? (
              <div className="save-row">
                <button type="button" className="btn primary small" disabled={saveState.status === 'saving' || !dirty} onClick={save}>
                  <Icon name="check" size={14} /> {saveState.status === 'saving' ? 'Saving…' : 'Save notes and annotations'}
                </button>
                <span className={`small ${saveState.status === 'error' ? 'error-text' : saveState.status === 'saved' ? 'ok-text' : 'muted'}`} role="status">
                  {saveState.message ?? (dirty ? `Unsaved: ${[dirtyRounds.length ? `notes (${dirtyRounds.map((n) => `R${n}`).join(', ')})` : null,
                    unsavedHere.length || annotationsDirty ? (mode === 'control' ? 'live drawings' : 'annotations') : null].filter(Boolean).join(' and ')}` : 'Everything is saved.')}
                </span>
              </div>
            ) : null}
          </Panel>
          <Panel title={mode === 'solo' ? 'Annotations this round' : 'Annotations and live drawings'}>
            {annotations.length ? (
              <ul className="event-feed">
                {annotations.map((a) => (
                  <li key={a.annotation_id} className="row space">
                    <button type="button" disabled={!canControl} onClick={() => control.seek(a.tick)}>
                      <span className="muted">{roundTime(info, a.tick, tickrate)}</span> {a.kind === 'text' ? `“${a.data.text}”`
                        : a.kind === 'utility' ? <><UtilityIcon kind={a.data.utility ?? 'smoke'} size={14} label="" /> {UTILITY_KINDS.find(([k]) => k === a.data.utility)?.[1] ?? 'Utility'}</> : 'Drawing'}
                      {a.level === 'lower' ? ' (lower)' : ''}
                      {a.author ? <span className="muted"> · {a.author.user_name}</span> : null}
                      {!a.saved ? <span className="unsaved-tag">{a.review_id != null ? 'live' : 'unsaved'}</span> : null}
                    </button>
                    {canEdit(a) && a.kind === 'utility' ? (
                      <span className="row tight">
                        <select aria-label="Utility type" value={a.data.utility} onChange={(e) => editAnnotation(a, { utility: e.target.value })}>
                          {UTILITY_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                        </select>
                      </span>
                    ) : null}
                    {canEdit(a) && a.kind === 'text' ? (
                      <button type="button" className="btn ghost small" onClick={() => { setTool('text'); openText(a); }}>Edit</button>
                    ) : null}
                    {canEdit(a) && a.kind !== 'drawing' ? <button type="button" className="btn ghost small" onClick={() => setMoving(a.annotation_id)}>Move</button> : null}
                    {canEdit(a) ? <button type="button" className="btn ghost small" aria-label="Remove annotation" onClick={() => removeAnnotation(a)}><Icon name="close" size={14} /></button> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="muted small">None yet.{canAnnotate ? ' Choose a tool on the left to add one at the current moment.' : ''}</p>}
          </Panel>
          <details className="panel-details">
            <summary>Round events</summary>
            {round ? (
              <ul className="event-feed">
                {round.events.filter((ev) => showRecorded || !RECORDED_UTILITY.includes(ev.type)).map((ev, i) => (
                  <li key={i}>
                    <button type="button" className={ev.tick <= tick ? 'past' : ''} disabled={!canControl} onClick={() => jump(ev)}>
                      {ev.type === 'round_end' ? <>{roundTime(info, ev.tick, tickrate)} Round end: {ev.winner} win{ev.reason ? ` (${ev.reason.replace(/_/g, ' ')})` : ''}</> : describe(ev)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <Loading />}
          </details>
        </aside>
        <div className={`replay-inspector-cell${inspectorBeside ? '' : ' below'}`}>
          <ReplayInspector demoId={demo.demo_id} round={round} roundNumber={roundNumber} info={info} tickrate={tickrate} tick={tick}
            event={inspected?.ev ?? null} eventIndex={inspected?.index ?? null} selectionRound={inspect?.round ?? null}
            name={(p) => (p == null ? 'Unknown' : nameOf(p))} side={sideOfPlayer} filter={inspectFilter} onFilter={setInspectFilter}
            onPrev={() => stepEvent(-1)} onNext={() => stepEvent(1)} onClear={() => { setInspect(null); setSelectedKill(null); }}
            onSeek={(t) => control.seek(Math.max(info.start_tick, Math.min(info.end_tick, t)))} onGoToRound={(n) => control.round(n)}
            canControl={canControl} status={captureStatus} onStatus={setCaptureStatus} onRefresh={() => { setCaptureRefresh((n) => n + 1); refreshCapture(); }} mapName={demo.map} />
        </div>
      </div>
    </div>
  );
}
