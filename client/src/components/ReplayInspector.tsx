// Replay Inspector (Phase 11): the right-hand panel of Demo Review for one
// selected kill or utility throw. First-person media is captured from CS2 by
// the server's capture worker (services/captures.js) and shown only once it
// exists; until then the frames say why there's nothing to show. Everything
// else comes from the demo and is labelled as tactical data.
import { useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { killfeedIcon, weaponLabel } from '../lib/cs2Assets';
import { eventMoment, FACING_DEGREES, isKill, killTactics, mediaFileName, STEP_SECONDS, stepTicks, utilityTactics, type InspectFilter } from '../lib/inspector';
import { frameAt, roundTime, RECORDED_LABEL } from '../lib/replay';
import type { ReplayEvent, ReplayRound } from '../lib/types';
import { Icon } from './Icons';
import { CsImg } from './ReplayHud';
import { UtilityIcon } from './UtilityIcon';

export interface CaptureMedia {
  role: 'killer' | 'victim' | 'replay' | 'lineup'; type: 'image' | 'video'; mime: string; file: string; url: string;
  player: string; tick?: number; start?: number; end?: number; width?: number; height?: number; fps?: number; timescale?: number;
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

// One media slot: the captured image or clip when it exists, otherwise why not.
function MediaFrame({ title, note, media, capture, status, zoom, videoRef, children }: {
  title: string; note?: string; media: CaptureMedia | null; capture: Capture | null; status: CaptureStatus | null;
  zoom?: number; videoRef?: React.Ref<HTMLVideoElement>; children?: React.ReactNode;
}) {
  if (media) {
    return (
      <figure className="inspector-media">
        <figcaption>{title}{note ? <span className="muted small"> · {note}</span> : null}</figcaption>
        <div className="inspector-media__frame captured">
          {media.type === 'video'
            ? <video ref={videoRef} src={media.url} controls loop muted playsInline preload="auto" aria-label={title} />
            : <img src={media.url} alt={`${title}, captured from CS2 at tick ${media.tick}`} style={zoom && zoom > 1 ? { transform: `scale(${zoom})` } : undefined} />}
        </div>
        <span className="muted small">Captured from CS2 playing this demo{media.type === 'video'
          ? ` · ${media.player}'s view, ticks ${media.start}–${media.end}, ${media.fps} fps (frames sampled while the demo played at ${media.timescale ?? 0.2}× speed)`
          : ` · ${media.player}'s view at tick ${media.tick}`}</span>
      </figure>
    );
  }
  const busy = capture && (capture.status === 'queued' || capture.status === 'running');
  let heading = 'Capture unavailable';
  let detail = status ? status.reason : 'Checking capture status…';
  if (capture?.status === 'running') { heading = 'Capturing from CS2…'; detail = 'CS2 is seeking to the moment and recording this view.'; }
  else if (capture?.status === 'queued') { heading = 'Queued for capture'; detail = status?.available ? 'Waiting for the capture worker.' : (status?.reason ?? ''); }
  else if (capture?.status === 'failed') { heading = 'Capture failed'; detail = capture.error ?? 'Unknown error.'; }
  else if (capture?.status === 'ready') { heading = 'Not captured'; detail = 'There was no view to capture for this player.'; }
  else if (status?.enabled) { heading = 'Not captured yet'; }
  return (
    <figure className="inspector-media">
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

export function ReplayInspector({ demoId, round, roundNumber, info, tickrate, tick, event, eventIndex, selectionRound, name, side,
  filter, onFilter, onPrev, onNext, onClear, onSeek, onGoToRound, canControl, status, onStatus, onRefresh, mapName }: {
  demoId: number; round: ReplayRound | null; roundNumber: number; info: { start_tick: number; freeze_end_tick: number | null };
  tickrate: number; tick: number; event: ReplayEvent | null; eventIndex: number | null; selectionRound: number | null;
  name: (p: number | null | undefined) => string; side: (p: number | null | undefined) => 'CT' | 'T' | null;
  filter: InspectFilter; onFilter: (f: InspectFilter) => void; onPrev: () => void; onNext: () => void; onClear: () => void;
  onSeek: (tick: number) => void; onGoToRound: (n: number) => void; canControl: boolean;
  status: CaptureStatus | null; onStatus: (s: CaptureStatus) => void; onRefresh: () => void; mapName: string | null;
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
  const mediaFor = (role: CaptureMedia['role']) => (capture?.status === 'ready' ? capture.media.find((m) => m.role === role) ?? null : null);
  const busy = capture?.status === 'queued' || capture?.status === 'running';

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
    <button type="button" className="btn small" disabled={requesting} onClick={() => requestCapture(capture?.status === 'ready')}>
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
          <MediaFrame title={`Killer POV — ${killerName}`} note={`tick ${event.tick}`} media={mediaFor('killer')} capture={capture} status={status}>{captureButton}</MediaFrame>
          <MediaFrame title={`Victim POV — ${name(event.victim)}`}
            note={k.victimTick != null ? `last recorded alive tick ${k.victimTick} (${Math.round(((event.tick - k.victimTick) / tickrate) * 1000)} ms before death), not the death frame` : 'no alive sample before death'}
            media={mediaFor('victim')} capture={capture} status={status}>{captureButton}</MediaFrame>
          {capture?.status === 'ready' && captureButton ? <div className="row tight">{captureButton}</div> : null}
          {requestError ? <p className="error-text small">{requestError}</p> : null}
          <h3 className="inspector-sub">Tactical data <span className="muted small">(from the demo, not first-person imagery)</span></h3>
          <dl className="inspector-facts">
            <dt>Weapon</dt><dd>{weaponLabel(event.weapon)}{event.headshot ? ' · headshot' : ''}{event.penetrated ? ' · through a surface' : ''}</dd>
            {event.assister != null ? <><dt>Assist</dt><dd>{name(event.assister)}{event.flash_assist ? ' (flash)' : ''}</dd></> : null}
            <dt>Killer</dt><dd>{k.killer ? `${pct(k.killer.x)}, ${pct(k.killer.y)} on the radar, ${levelName(k.killer.level)}, facing ${Math.round(k.killer.yaw)}°` : 'Position not recorded'}</dd>
            <dt>Victim</dt><dd>{k.victim ? `${pct(k.victim.x)}, ${pct(k.victim.y)}, ${levelName(k.victim.level)}, facing ${Math.round(k.victim.yaw)}°, ${k.victim.hp} HP` : 'Position not recorded'}</dd>
            <dt>Distance</dt><dd>{k.distanceUnits != null ? `${metres(k.distanceUnits)} across the map` : '—'}</dd>
            <dt>Elevation</dt><dd>{k.sameFloor == null ? '—' : k.sameFloor ? 'Same radar floor' : 'Different radar floors'}<span className="muted small"> (height and pitch aren't recorded in the replay data)</span></dd>
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
            {download(mediaFor('killer'), 'Export killer screenshot', 'jpg')}
            {download(mediaFor('victim'), 'Export victim screenshot', 'jpg')}
          </div>
        </div>
      </section>
    );
  }

  const u = utilityTactics(round, event, tickrate);
  const replay = mediaFor('replay');
  const lineup = mediaFor('lineup');
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
        <MediaFrame title="Two-second replay" note={u.releaseTick != null ? `around the release, from ${name(event.player)}'s view` : 'around the detonation (release not linked)'}
          media={replay} capture={capture} status={status} videoRef={videoRef}>{captureButton}</MediaFrame>
        <div className="row wrap tight inspector-speeds" role="group" aria-label="Replay speed">
          {[0.25, 0.5, 1].map((r) => (
            <button key={r} type="button" className={`btn small${speed === r ? '' : ' ghost'}`} aria-pressed={speed === r} disabled={!replay} onClick={() => setPlayback(r)}>{r}×</button>
          ))}
        </div>
        <MediaFrame title="Lineup — just before release" note={u.releaseTick != null ? `tick ${u.releaseTick - 1}` : 'needs a linked release'}
          media={lineup} capture={capture} status={status} zoom={zoom}>{u.releaseTick != null ? captureButton : null}</MediaFrame>
        <label className="inline small inspector-zoom">Crosshair zoom {zoom}×
          <input type="range" min={1} max={5} step={1} value={zoom} disabled={!lineup} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Crosshair zoom" />
        </label>
        {capture?.status === 'ready' && captureButton ? <div className="row tight">{captureButton}</div> : null}
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
          <dt>Aim</dt><dd className="muted">{lineup ? 'Pitch isn\'t in the replay data; the lineup screenshot shows the crosshair as CS2 rendered it.' : 'Pitch and the exact crosshair point aren\'t in the replay data; only a lineup capture shows them.'}</dd>
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
