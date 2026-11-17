// Replay Inspector (Phases 11–12): the right-hand panel of Demo Review for one
// selected kill or utility throw. First-person media is captured from CS2 by
// the server's capture worker (services/captures.js) and shown only once it
// exists; until then the frames say why there's nothing to show. Everything
// else comes from the demo and is labelled as tactical data.
import { useEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { killfeedIcon, weaponLabel } from '../lib/cs2Assets';
import { eventMoment, FACING_DEGREES, isKill, killTactics, mediaFileName, STEP_SECONDS, stepTicks, utilityTactics, type InspectFilter } from '../lib/inspector';
import { frameAt, roundTime, RECORDED_LABEL } from '../lib/replay';
import type { ReplayEvent, ReplayRound } from '../lib/types';
import { Icon } from './Icons';
import { CsImg } from './ReplayHud';
import { UtilityIcon } from './UtilityIcon';
import { CaptureWarning, ConfirmDialog } from './CaptureSession';

// Recorded input for a clip: usercmd button bits per tick from `start`
// (null where the demo has none), and which bit is which action.
export interface ClipInputs { start: number; bits: (number | null)[]; tickrate: number; map: Record<string, number> }
// Phase 15: nearby events by one player share one clip (kills by the
// killer, throws by the thrower); each member event keeps its own capture.
export interface MediaGroup {
  id: string; kind: 'kill' | 'utility'; start: number; end: number;
  members: { capture_id: number; round_number: number; event_index: number | null; event_tick: number }[];
}
// Lineup still timing: the aim before the throw's setup movement.
export interface LineupSetup { technique: string; reliable: boolean; reason: string | null; setup_start: number | null; still_tick: number; note: string | null }
export interface CaptureMedia {
  // Phase 11 kill captures used 'killer' / 'victim' for the stills.
  role: 'killer' | 'victim' | 'killer_clip' | 'killer_still' | 'victim_clip' | 'victim_still' | 'replay' | 'lineup';
  type: 'image' | 'video'; mime: string; file: string; url: string; attempt?: number;
  player: string; tick?: number; start?: number; end?: number; width?: number; height?: number; fps?: number; timescale?: number;
  xray?: boolean; inputs?: ClipInputs; event_tick?: number; group?: MediaGroup; release_tick?: number; setup?: LineupSetup;
}
export interface Capture {
  capture_id: number; round_number: number; event_index: number; kind: 'kill' | 'utility';
  status: 'queued' | 'running' | 'ready' | 'failed'; error: string | null; error_code: string | null; media: CaptureMedia[];
}
export interface CaptureStatus { enabled?: boolean; available: boolean; reason: string; checks?: Record<string, unknown> | null; captures?: Capture[] }

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
// CS2 world units are inches.
const metres = (units: number) => `${units.toLocaleString('en-GB')} units (≈${(units * 0.0254).toFixed(1)} m)`;
const levelName = (l: string) => (l === 'lower' ? 'lower floor' : 'main floor');

// A clip with its own loading and error state (one slot never waits on another).
// startAt: seconds into the clip to show first (a grouped clip opens at
// the selected event; the frame remounts the clip when it changes).
function ClipVideo({ url, title, videoRef, startAt }: { url: string; title: string; videoRef?: Ref<HTMLVideoElement>; startAt?: number }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  return (
    <>
      <video ref={videoRef} src={url} controls loop muted playsInline preload="metadata" aria-label={title} data-start-at={startAt ?? 0}
        onLoadedMetadata={(e) => { if (startAt) e.currentTarget.currentTime = Math.max(0, startAt); }}
        onLoadedData={() => setState('ready')} onCanPlay={() => setState('ready')} onError={() => setState('error')} />
      {state !== 'ready' ? (
        <div className="clip-state" role="status">{state === 'loading' ? <><span className="inspector-spinner" aria-hidden="true" /> Loading clip…</> : 'This clip could not be loaded.'}</div>
      ) : null}
    </>
  );
}

// One media slot: the captured image or clip when it exists, otherwise why not.
function MediaFrame({ title, note, media, capture, status, zoom, crosshair, videoRef, overlay, missing, children, startAt, tabs }: {
  title: string; note?: string; media: CaptureMedia | null; capture: Capture | null; status: CaptureStatus | null;
  zoom?: number; crosshair?: boolean; videoRef?: Ref<HTMLVideoElement>; overlay?: ReactNode; startAt?: number; tabs?: ReactNode;
  // This slot has no media although the capture finished (e.g. one POV only).
  missing?: string; children?: ReactNode;
}) {
  const busy = capture && (capture.status === 'queued' || capture.status === 'running');
  if (media) {
    return (
      <figure className="inspector-media">
        {tabs}
        <figcaption>{title}{note ? <span className="muted small"> · {note}</span> : null}
          {media.xray ? <span className="xray-badge" title="Spectator X-ray was on: players are outlined through walls, smoke and flashes, which the player could not see.">X-ray enabled</span> : null}</figcaption>
        <div className="inspector-media__frame captured">
          {media.type === 'video'
            ? <ClipVideo key={`${media.url}#${startAt ?? 0}`} url={media.url} title={title} videoRef={videoRef} startAt={startAt} />
            : <img src={media.url} alt={`${title}, captured from CS2 at tick ${media.tick}`} style={zoom && zoom > 1 ? { transform: `scale(${zoom})` } : undefined} />}
          {/* Thin crosshair through the aim point (the frame centre, where CS2
              draws the crosshair); the zoom scales about the same point. */}
          {crosshair ? <div className="lineup-crosshair" aria-hidden="true"><span className="h" /><span className="v" /></div> : null}
          {overlay}
        </div>
        {media.type === 'image' ? (
          <span className="muted small still-note">Paused still: positions and view are exact for the tick, but CS2 rebuilds smoke and fire effects when it seeks, so their density can differ from live playback (the clip plays through and is closer).</span>
        ) : null}
        <span className="muted small">Captured from CS2 playing this demo{media.type === 'video'
          ? ` · ${media.player}'s view, ticks ${media.start}–${media.end}, ${media.fps} fps (frames sampled while the demo played at ${media.timescale ?? 0.2}× speed)`
          : ` · ${media.player}'s view at tick ${media.tick}`}
          {media.xray ? ' · X-ray enabled (outlines show players the player could not see)' : ''}
          {busy ? ' · a new capture is in progress; this one stays until it succeeds' : capture?.status === 'failed' ? ` · the last recapture failed (${capture.error}); this is the earlier capture` : ''}</span>
      </figure>
    );
  }
  let heading = 'Capture unavailable';
  let detail = status ? status.reason : 'Checking capture status…';
  if (capture?.status === 'running') { heading = 'Capturing from CS2…'; detail = 'CS2 is seeking to the moment and recording this view.'; }
  else if (capture?.status === 'queued') { heading = 'Queued for capture'; detail = status?.available ? 'Waiting for the capture worker.' : (status?.reason ?? ''); }
  else if (capture?.status === 'failed') { heading = 'Capture failed'; detail = capture.error ?? 'Unknown error.'; }
  else if (capture?.status === 'ready') { heading = 'Not captured'; detail = missing ?? 'There was no view to capture for this player.'; }
  else if (status?.enabled) { heading = 'Not captured yet'; }
  return (
    <figure className="inspector-media">
      {tabs}
      <figcaption>{title}{note ? <span className="muted small"> · {note}</span> : null}</figcaption>
      <div className="inspector-media__frame" role="img" aria-label={`${title}: ${heading.toLowerCase()}`}>
        <div className="inspector-media__empty" aria-live="polite">
          <Icon name="screen" size={22} />
          <strong>{heading}{busy ? <span className="inspector-spinner" aria-hidden="true" /> : null}</strong>
          <span className="small">{detail}</span>
          {children}
        </div>
      </div>
    </figure>
  );
}

// Downloads a crop around the crosshair (frame centre) of a captured lineup
// image, scaled back up: the same pixels the zoom shows.
async function downloadZoom(url: string, zoom: number, name: string) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const w = Math.round(img.naturalWidth / zoom);
  const h = Math.round(img.naturalHeight / zoom);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (img.naturalWidth - w) / 2, (img.naturalHeight - h) / 2, w, h, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// Recorded actions over a utility clip, highlighted in sync with the video
// (including slow playback). The demo stores the actions the player's client
// sent each tick (usercmd buttons), shown with CS2's default keys; the
// physical keys pressed aren't recorded, and ticks without data say so.
const INPUT_KEYS = ['W', 'A', 'S', 'D', 'Shift', 'Ctrl', 'Space', 'LMB', 'RMB'] as const;
const INPUT_ACTION: Record<string, string> = { W: 'forward', A: 'move left', S: 'back', D: 'move right', Shift: 'walk', Ctrl: 'crouch', Space: 'jump', LMB: 'attack', RMB: 'attack 2' };
function InputOverlay({ media, videoRef }: { media: CaptureMedia; videoRef: RefObject<HTMLVideoElement | null> }) {
  const [bits, setBits] = useState<number | null | undefined>(undefined);
  const inp = media.inputs;
  useEffect(() => {
    const v = videoRef.current;
    if (!inp || media.start == null || !v) return undefined;
    let raf = 0;
    let stopped = false;
    const update = () => {
      // Frame time → demo tick: the clip covers start..end in real time, so
      // the overlay follows any playback speed.
      const tick = Math.round(media.start! + v.currentTime * inp.tickrate);
      const i = tick - inp.start;
      setBits(i >= 0 && i < inp.bits.length ? inp.bits[i] : null);
    };
    // Every decoded frame when supported, otherwise every animation frame;
    // plus seek/time events so a paused, scrubbed or hidden video still updates.
    const vfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback?.bind(v);
    const loop = () => { if (stopped) return; update(); if (vfc) vfc(loop); else raf = requestAnimationFrame(loop); };
    loop();
    const events = ['seeked', 'timeupdate', 'loadeddata', 'play', 'pause'];
    events.forEach((e) => v.addEventListener(e, update));
    // Fallback when frame callbacks and events are delayed (hidden tab).
    const poll = window.setInterval(update, 150);
    return () => { stopped = true; cancelAnimationFrame(raf); window.clearInterval(poll); events.forEach((e) => v.removeEventListener(e, update)); };
  }, [inp, media.start, videoRef]);
  if (!inp) {
    return <div className="input-overlay unavailable" title="No recorded input was read for this clip.">Input not recorded</div>;
  }
  const state = (k: string) => {
    const bit = inp.map[k];
    return bits == null || bit == null ? 'na' : (bits & (1 << bit)) ? 'on' : 'off';
  };
  const cap = (k: string, label: string, cls: string) => {
    const st = state(k);
    return (
      <span className={`kc ${cls} ${st}`} data-key={k}
        title={st === 'na' ? `${k}: not recorded at this tick` : `${INPUT_ACTION[k]} (default key ${k})${st === 'on' ? ': held' : ''}`}>{label}</span>
    );
  };
  // Laid out like the keys: W above A S D, Shift left of them, Ctrl under
  // Shift beside a wide Space; the mouse on the right with M1 / M2.
  return (
    <div className="input-overlay" role="img" aria-label={`Recorded actions: ${INPUT_KEYS.filter((k) => state(k) === 'on').join(', ') || 'none'}`}
      title={bits === null ? 'No input recorded at this tick' : 'Recorded actions, shown with CS2 default keys (physical keys are not recorded)'}>
      <div className="kb">
        {cap('W', 'W', 'k-w')}
        {cap('Shift', 'Shift', 'k-shift')}
        {cap('A', 'A', 'k-a')}
        {cap('S', 'S', 'k-s')}
        {cap('D', 'D', 'k-d')}
        {cap('Ctrl', 'Ctrl', 'k-ctrl')}
        {cap('Space', 'Space', 'k-space')}
      </div>
      <div className="mouse" aria-hidden="true">
        {cap('LMB', 'M1', 'm1')}
        {cap('RMB', 'M2', 'm2')}
        <span className="mouse-body" />
      </div>
    </div>
  );
}

export function ReplayInspector({ demoId, round, roundNumber, info, tickrate, tick, event, eventIndex, selectionRound, name, side,
  filter, onFilter, onPrev, onNext, onClear, onSeek, onGoToRound, canControl, status, onStatus, onRefresh, mapName, tab = {}, onTab }: {
  demoId: number; round: ReplayRound | null; roundNumber: number; info: { start_tick: number; freeze_end_tick: number | null };
  tickrate: number; tick: number; event: ReplayEvent | null; eventIndex: number | null; selectionRound: number | null;
  name: (p: number | null | undefined) => string; side: (p: number | null | undefined) => 'CT' | 'T' | null;
  filter: InspectFilter; onFilter: (f: InspectFilter) => void; onPrev: () => void; onNext: () => void; onClear: () => void;
  onSeek: (tick: number) => void; onGoToRound: (n: number) => void; canControl: boolean;
  status: CaptureStatus | null; onStatus: (s: CaptureStatus) => void; onRefresh: () => void; mapName: string | null;
  // Grouped events: the victim / lineup tab shown (an event index in this
  // round; shared in a live review). Null means the selected event's own.
  tab?: { victim?: number | null; lineup?: number | null }; onTab?: (t: { victim?: number | null; lineup?: number | null }) => void;
}) {
  const [step, setStep] = useState<number>(STEP_SECONDS[1]);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(1);
  const videoRef = useRef<HTMLVideoElement>(null);

  const kind = event && isKill(event) ? 'kill' : 'utility';
  const capture = event && eventIndex != null && selectionRound != null
    ? status?.captures?.find((c) => c.round_number === selectionRound && c.event_index === eventIndex && c.kind === kind) ?? null
    : null;
  // Media stays visible while a recapture is pending or after it failed.
  const mediaFor = (...roles: CaptureMedia['role'][]) => {
    for (const r of roles) {
      const m = capture?.media.find((x) => x.role === r);
      if (m) return m;
    }
    return null;
  };
  const busy = capture?.status === 'queued' || capture?.status === 'running';
  const [confirm, setConfirm] = useState(false);
  // Another event's capture in this round (group members).
  const captureOf = (index: number | null | undefined, k: 'kill' | 'utility') => (index == null || selectionRound == null ? null
    : status?.captures?.find((c) => c.round_number === selectionRound && c.event_index === index && c.kind === k) ?? null);
  const roleOf = (c: Capture | null, ...roles: CaptureMedia['role'][]) => {
    for (const r of roles) { const m = c?.media.find((x) => x.role === r); if (m) return m; }
    return null;
  };
  // Seconds into a (grouped) clip for an event tick: a second before it.
  const offsetFor = (m: CaptureMedia | null, t: number | undefined) => (m && m.start != null && t != null ? Math.max(0, (t - m.start) / tickrate - 1) : undefined);

  // Asks the server to capture the selected event (validated there); the
  // result appears through the polled status.
  const requestCapture = async (retry = false) => {
    if (event == null || eventIndex == null || selectionRound == null) return;
    setRequesting(true);
    setRequestError(null);
    try {
      await api.post(`/demos/${demoId}/captures`, { kind, round_number: selectionRound, event_index: eventIndex, ...(retry ? { retry: true } : {}) });
      onRefresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'capture_unavailable' && err.body.status) onStatus(err.body.status as CaptureStatus);
      else setRequestError(errorMessage(err));
    } finally {
      setRequesting(false);
    }
  };
  const captureButton = status?.enabled && !busy ? (
    <button type="button" className="btn small" disabled={requesting} onClick={() => setConfirm(true)}>
      {requesting ? 'Requesting…' : capture?.status === 'failed' ? 'Try again' : capture?.status === 'ready' ? 'Capture again' : 'Capture from CS2'}
    </button>
  ) : !status?.enabled ? (
    <button type="button" className="btn ghost small" disabled={requesting} onClick={onRefresh}>Check again</button>
  ) : null;
  const fileName = (m: CaptureMedia, ext: string, label: string = m.role) => mediaFileName({
    map: mapName, round: selectionRound ?? roundNumber, kind: `${kind}-${label}`, player: m.player, tick: m.tick ?? m.start ?? 0, ext,
  });
  const setPlayback = (r: number) => {
    setSpeed(r);
    if (videoRef.current) videoRef.current.playbackRate = r;
  };

  const confirmDialog = confirm && event ? (
    <ConfirmDialog title={capture?.status === 'ready' ? 'Capture this again?' : 'Capture this from CS2?'} confirmLabel={capture?.status === 'ready' ? 'Capture again' : 'Capture'}
      busy={requesting} onCancel={() => setConfirm(false)}
      onConfirm={async () => { await requestCapture(!!capture?.media.length); setConfirm(false); }}>
      <p>Only this {isKill(event) ? 'kill (killer and victim views)' : 'throw (clip and lineup)'} is captured.{capture?.media.length ? ' The current media stays until the new capture succeeds.' : ''}</p>
      <CaptureWarning />
    </ConfirmDialog>
  ) : null;
  const header = (
    <div className="inspector-head">
      <h2>Replay Inspector</h2>
      <div className="row tight">
        <select aria-label="Inspect which events" value={filter} onChange={(e) => onFilter(e.target.value as InspectFilter)}>
          <option value="all">Kills and utility</option>
          <option value="kill">Kills</option>
          <option value="utility">Utility</option>
        </select>
        <button type="button" className="btn ghost small" aria-label="Previous event" onClick={onPrev}><Icon name="left" size={14} /></button>
        <button type="button" className="btn ghost small" aria-label="Next event" onClick={onNext}><Icon name="right" size={14} /></button>
        {event || selectionRound != null ? <button type="button" className="btn ghost small" aria-label="Clear the inspector" onClick={onClear}><Icon name="close" size={14} /></button> : null}
      </div>
    </div>
  );

  if (selectionRound != null && selectionRound !== roundNumber) {
    return (
      <section className="replay-inspector" aria-label="Replay Inspector">
        {header}
        <div className="inspector-empty">
          <p>The selected event is in round {selectionRound}.</p>
          <button type="button" className="btn small" disabled={!canControl} onClick={() => onGoToRound(selectionRound)}>Go to round {selectionRound}</button>
        </div>
      </section>
    );
  }
  if (!event || !round) {
    return (
      <section className="replay-inspector" aria-label="Replay Inspector">
        {header}
        <div className="inspector-empty">
          <Icon name="screen" size={28} />
          <p><strong>Select a kill or utility event</strong> to inspect it.</p>
          <p className="muted small">Click a kill in the kill feed or on the timeline, a grenade on the timeline, or use the arrows above.</p>
        </div>
      </section>
    );
  }

  const at = (t: number) => roundTime(info, t, tickrate);
  const moment = eventMoment(event);
  const stepT = stepTicks(step, tickrate);
  const nav = (
    <div className="inspector-nav" role="group" aria-label="Step through the moment">
      <button type="button" className="btn ghost small" disabled={!canControl} onClick={() => onSeek(Math.max(info.start_tick, tick - stepT))} aria-label={`Back ${step} seconds`}>−{step}s</button>
      <button type="button" className="btn small" disabled={!canControl} onClick={() => onSeek(moment)}>{isKill(event) ? 'Kill moment' : 'Release'}</button>
      <button type="button" className="btn ghost small" disabled={!canControl} onClick={() => onSeek(tick + stepT)} aria-label={`Forward ${step} seconds`}>+{step}s</button>
      <select aria-label="Step size" value={step} onChange={(e) => setStep(Number(e.target.value))}>
        {STEP_SECONDS.map((s) => <option key={s} value={s}>{s} s</option>)}
      </select>
      <span className="muted small">Now: tick {Math.round(tick)} ({at(tick)})</span>
    </div>
  );
  const download = (m: CaptureMedia | null, label: string, ext: string) => (m
    ? <a className="btn ghost small" href={m.url} download={fileName(m, ext)}>{label}</a>
    : <button type="button" className="btn ghost small" disabled title="Nothing captured to export">{label}</button>);

  if (isKill(event)) {
    const k = killTactics(round, event, frameAt);
    const killerName = event.attacker != null ? name(event.attacker) : event.weapon === 'planted_c4' ? 'The bomb' : 'World';
    const flags = [event.headshot ? 'Headshot' : null, event.penetrated ? 'Wallbang' : null, event.noscope ? 'No-scope' : null,
      event.through_smoke ? 'Through smoke' : null, event.attacker_blind ? 'Attacker blind' : null, event.in_air ? 'In the air' : null].filter(Boolean);
    return (
      <section className="replay-inspector" aria-label="Replay Inspector: kill">
        {header}
        <div className="inspector-body">
          <p className="inspector-title">
            <span className={`inspector-name ${(side(event.attacker) ?? '').toLowerCase()}`}>{killerName}</span>
            <CsImg className="inspector-weapon" src={killfeedIcon(event.weapon)} alt={weaponLabel(event.weapon)} fallback={<span className="small"> {weaponLabel(event.weapon)} </span>} />
            <span className={`inspector-name ${(side(event.victim) ?? '').toLowerCase()}`}>{name(event.victim)}</span>
          </p>
          <p className="muted small">Round {roundNumber} · {at(event.tick)} · tick {event.tick}{flags.length ? ` · ${flags.join(', ')}` : ''}</p>
          {nav}
          {/* Both views stacked, killer above victim; each shows its own
              state, so a missing POV never hides the other. Nearby kills by
              the same killer share one Killer POV clip (Phase 15) and each
              victim has its own tab; the clip opens at the chosen kill. */}
          {(() => {
            const killerMedia = mediaFor('killer_clip') ?? mediaFor('killer_still', 'killer');
            const group = killerMedia?.group;
            const members = group ? group.members.filter((m) => m.event_index != null) : [];
            const victimIndex = group && tab.victim != null && members.some((m) => m.event_index === tab.victim) ? tab.victim : eventIndex;
            const victimCapture = victimIndex === eventIndex ? capture : captureOf(victimIndex, 'kill');
            const victimEv = victimIndex != null ? round.events[victimIndex] : event;
            const victimMedia = roleOf(victimCapture, 'victim_clip') ?? roleOf(victimCapture, 'victim_still', 'victim');
            const killTick = (group ? members.find((m) => m.event_index === victimIndex)?.event_tick : undefined) ?? killerMedia?.event_tick ?? event.tick;
            const tabs = members.length > 1 ? (
              <div className="pov-tabs" role="tablist" aria-label={`Victims of ${killerName} in this clip`}>
                {members.map((m, i) => {
                  const ev = round.events[m.event_index!];
                  const on = m.event_index === victimIndex;
                  return (
                    <button key={m.capture_id} type="button" role="tab" aria-selected={on} className={on ? 'on' : ''} disabled={!onTab}
                      onClick={() => onTab?.({ ...tab, victim: m.event_index })}>
                      {i + 1}. {ev && ev.type === 'kill' ? name(ev.victim) : 'Victim'} <span className="muted small">{at(m.event_tick)}</span>
                    </button>
                  );
                })}
              </div>
            ) : null;
            return (
              <div className="pov-stack">
                <MediaFrame title={`Killer POV — ${killerName}`} note={group ? `${group.members.length} kills in one clip, opened at the ${victimIndex === eventIndex ? 'selected' : 'chosen'} kill` : '1 s either side of the kill'}
                  media={killerMedia} capture={capture} status={status} startAt={offsetFor(killerMedia, killTick)}
                  missing={capture?.status === 'ready' && !killerMedia ? (event.attacker == null || event.attacker === event.victim ? 'No killer view: this kill has no player killer.' : 'The killer\'s view could not be captured.') : undefined}>{captureButton}</MediaFrame>
                <MediaFrame title={`Victim POV — ${victimEv && victimEv.type === 'kill' ? name(victimEv.victim) : name(event.victim)}`} note="1 s either side of the death (after it, CS2 shows its death camera)"
                  media={victimMedia} capture={victimCapture} status={status} tabs={tabs}
                  missing={victimCapture?.status === 'ready' && !victimMedia ? 'The victim\'s view could not be captured.' : undefined}>{victimIndex === eventIndex ? captureButton : null}</MediaFrame>
              </div>
            );
          })()}
          {capture?.media.length && captureButton ? <div className="row tight">{captureButton}</div> : null}
          {confirmDialog}
          {requestError ? <p className="error-text small">{requestError}</p> : null}
          <h3 className="inspector-sub">Tactical data <span className="muted small">(from the demo, not first-person imagery)</span></h3>
          <dl className="inspector-facts">
            <dt>Weapon</dt><dd>{weaponLabel(event.weapon)}{event.headshot ? ' · headshot' : ''}{event.penetrated ? ' · through a surface' : ''}</dd>
            {event.assister != null ? <><dt>Assist</dt><dd>{name(event.assister)}{event.flash_assist ? ' (flash)' : ''}</dd></> : null}
            <dt>Killer</dt><dd>{k.killer ? `${pct(k.killer.x)}, ${pct(k.killer.y)} on the radar, ${levelName(k.killer.level)}, facing ${Math.round(k.killer.yaw)}°` : 'Position not recorded'}</dd>
            <dt>Victim</dt><dd>{k.victim ? `${pct(k.victim.x)}, ${pct(k.victim.y)}, ${levelName(k.victim.level)}, facing ${Math.round(k.victim.yaw)}°, ${k.victim.hp} HP` : 'Position not recorded'}</dd>
            <dt>Distance</dt><dd>{k.distanceUnits != null ? `${metres(k.distanceUnits)} across the map` : '—'}</dd>
            <dt>Elevation</dt><dd>{k.sameFloor == null ? '—' : k.sameFloor ? 'Same radar floor' : 'Different radar floors'}<span className="muted small"> (height and pitch are in the demo but not in this app's replay data yet)</span></dd>
            <dt>Facing</dt>
            <dd>{k.killerFacingOff != null ? (
              <>
                {killerName} was {k.killerFacingOff <= FACING_DEGREES ? 'facing' : 'not facing'} {name(event.victim)} ({k.killerFacingOff}° off);
                {' '}{name(event.victim)} was {k.victimFacingOff! <= FACING_DEGREES ? 'facing' : 'not facing'} {killerName} ({k.victimFacingOff}° off).
                <div className="muted small">Facing is not visibility: walls, cover and smoke aren't accounted for, so this doesn't say who could see whom.</div>
              </>
            ) : '—'}</dd>
          </dl>
          <div className="row wrap tight inspector-exports">
            {download(mediaFor('killer_clip'), 'Export killer clip (WebM)', 'webm')}
            {download(mediaFor('victim_clip'), 'Export victim clip (WebM)', 'webm')}
          </div>
        </div>
      </section>
    );
  }

  const u = utilityTactics(round, event, tickrate);
  const replay = mediaFor('replay');
  // Nearby throws by one player share one clip; each keeps its own lineup tab.
  const ugroup = replay?.group;
  const umembers = ugroup ? ugroup.members.filter((m) => m.event_index != null) : [];
  const lineupIndex = ugroup && tab.lineup != null && umembers.some((m) => m.event_index === tab.lineup) ? tab.lineup : eventIndex;
  const lineupCapture = lineupIndex === eventIndex ? capture : captureOf(lineupIndex, 'utility');
  const lineup = roleOf(lineupCapture, 'lineup');
  const lineupEv = lineupIndex != null ? round.events[lineupIndex] : event;
  const throwTick = (ugroup ? umembers.find((m) => m.event_index === lineupIndex)?.event_tick : undefined) ?? replay?.event_tick ?? u.releaseTick ?? event.tick;
  const lineupTabs = umembers.length > 1 ? (
    <div className="pov-tabs" role="tablist" aria-label={`Lineups of ${name(event.player)}'s throws in this clip`}>
      {umembers.map((m, i) => {
        const ev = round.events[m.event_index!];
        const on = m.event_index === lineupIndex;
        return (
          <button key={m.capture_id} type="button" role="tab" aria-selected={on} className={on ? 'on' : ''} disabled={!onTab}
            onClick={() => onTab?.({ ...tab, lineup: m.event_index })}>
            {i + 1}. <UtilityIcon kind={ev?.type ?? 'smoke'} variant={ev?.variant} size={14} label="" /> {ev ? (RECORDED_LABEL[ev.type] ?? ev.type) : 'Throw'} <span className="muted small">{at(m.event_tick)}</span>
          </button>
        );
      })}
    </div>
  ) : null;
  const lineupNote = lineup?.setup?.note ?? (lineup?.tick != null ? `tick ${lineup.tick}` : u.releaseTick != null ? `tick ${u.releaseTick - 1}` : 'needs a linked release');
  const utilityKind = event.type === 'fire' ? (event.variant === 'incendiary' ? 'Incendiary' : 'Molotov') : RECORDED_LABEL[event.type] ?? event.type;
  return (
    <section className="replay-inspector" aria-label="Replay Inspector: utility">
      {header}
      <div className="inspector-body">
        <p className="inspector-title">
          <UtilityIcon kind={event.type} variant={event.variant} size={22} />
          <span>{utilityKind} — <span className={`inspector-name ${(side(event.player) ?? '').toLowerCase()}`}>{name(event.player)}</span></span>
        </p>
        <p className="muted small">Round {roundNumber} · {u.releaseTick != null ? `released ${at(u.releaseTick)} (tick ${u.releaseTick})` : 'release not linked'} · detonated {at(event.tick)} (tick {event.tick})</p>
        {nav}
        <MediaFrame title={ugroup ? `Throw clip — ${ugroup.members.length} throws` : 'Two-second replay'}
          note={ugroup ? `${name(event.player)}'s view, opened at the ${lineupIndex === eventIndex ? 'selected' : 'chosen'} throw` : u.releaseTick != null ? `around the release, from ${name(event.player)}'s view` : 'around the detonation (release not linked)'}
          media={replay} capture={capture} status={status} videoRef={videoRef} startAt={offsetFor(replay, throwTick)}
          overlay={replay ? <InputOverlay media={replay} videoRef={videoRef} /> : null}>{captureButton}</MediaFrame>
        <div className="row wrap tight inspector-speeds" role="group" aria-label="Replay speed">
          {[0.25, 0.5, 1].map((r) => (
            <button key={r} type="button" className={`btn small${speed === r ? '' : ' ghost'}`} aria-pressed={speed === r} disabled={!replay} onClick={() => setPlayback(r)}>{r}×</button>
          ))}
        </div>
        <MediaFrame title={`Lineup — ${lineupEv && lineupEv !== event ? `${RECORDED_LABEL[lineupEv.type] ?? lineupEv.type}, ` : ''}aim before the throw`} note={lineupNote}
          media={lineup} capture={lineupCapture} status={status} zoom={zoom} crosshair tabs={lineupTabs}>{u.releaseTick != null && lineupIndex === eventIndex ? captureButton : null}</MediaFrame>
        {lineup?.setup && !lineup.setup.reliable ? (
          <p className="small warn-text" role="note">Limitation: {lineup.setup.note}</p>
        ) : null}
        <div className="row tight wrap inspector-zoom" role="group" aria-label="Crosshair zoom">
          <span className="small">Crosshair zoom</span>
          {[1, 2, 4, 6, 8].map((z) => (
            <button key={z} type="button" className={`btn small${zoom === z ? '' : ' ghost'}`} aria-pressed={zoom === z} disabled={!lineup} onClick={() => setZoom(z)}>{z}×</button>
          ))}
        </div>
        {capture?.media.length && captureButton ? <div className="row tight">{captureButton}</div> : null}
        {confirmDialog}
        {requestError ? <p className="error-text small">{requestError}</p> : null}
        <h3 className="inspector-sub">Tactical data <span className="muted small">(from the demo, not first-person imagery)</span></h3>
        <dl className="inspector-facts">
          <dt>Release</dt>
          <dd>{u.linked ? `tick ${u.releaseTick} · ${u.flightSeconds!.toFixed(2)} s in the air`
            : 'Not linked to a recorded throw: only the detonation is known.'}
            <div className="muted small">{event.type === 'fire'
              ? 'Fires start as a new entity, so the throw is matched by thrower and timing (the molotov whose flight ends as the fire starts).'
              : 'Matched to its throw by the projectile entity id, not by timing.'}</div></dd>
          <dt>Thrown from</dt><dd>{u.from ? `${pct(u.from.x)}, ${pct(u.from.y)}, ${levelName(u.from.level)}` : 'Not recorded'}</dd>
          <dt>Landed</dt><dd>{u.landed ? `${pct(u.landed.x)}, ${pct(u.landed.y)}, ${levelName(u.landed.level)}` : 'Not recorded'}</dd>
          <dt>Distance</dt><dd>{u.throwDistanceUnits != null ? metres(u.throwDistanceUnits) : '—'}</dd>
          {event.end_tick != null ? <><dt>Lasted</dt><dd>{((event.end_tick - event.tick) / tickrate).toFixed(1)} s</dd></> : null}
          <dt>Aim</dt><dd className="muted">{lineup ? 'The lineup screenshot shows the crosshair as CS2 rendered it (green lines mark it).' : 'The exact crosshair point is only shown by a lineup capture.'}</dd>
        </dl>
        <div className="row wrap tight inspector-exports">
          {download(replay, 'Export clip (WebM)', 'webm')}
          {download(lineup, 'Export lineup image', 'jpg')}
          <button type="button" className="btn ghost small" disabled={!lineup || zoom === 1}
            title={!lineup ? 'Nothing captured to export' : zoom === 1 ? 'Set a zoom above 1×' : undefined}
            onClick={() => lineup && downloadZoom(lineup.url, zoom, fileName(lineup, 'png', `lineup-zoom${zoom}x`))}>Export zoomed image</button>
          <button type="button" className="btn ghost small" disabled title="GIF export isn't available: this machine has no GIF encoder. Use the WebM clip.">Export GIF</button>
        </div>
      </div>
    </section>
  );
}
