// Play Phase control (Phase 14): previews a phase from its saved positions.
// The board passed to MapBoard while playing is derived each frame; saved
// placements and live Game Mode state are never changed. Switching or
// replaying a phase starts again from the same saved state.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Board, GrenadeCounts, Phase } from '../lib/types';
import { frameAt, phaseTimeline, type Frame } from '../lib/phasePlayback';
import { GRENADES, itemLabel, phaseSteps, type PlayerPlan } from '../lib/utility';
import { UtilityGlyph } from './MapBoard';
import { usePlayerColors } from '../lib/playerColors';
import { UtilityIcon } from './UtilityIcon';

const SIZE = 1000;

export function usePhasePlayback(phases: Phase[], index: number, map: string, plan: Map<string, PlayerPlan>) {
  const phase = phases[index];
  // The run is tied to the phase it started on: switching phase (or editing
  // the board) leaves the preview, and Play starts again from saved state.
  const [run, setRun] = useState<{ phase: Phase; index: number; t: number } | null>(null);
  const raf = useRef(0);
  const earlier = useMemo(() => new Set(phases.slice(0, index).flatMap((p) => p.board.markers.map((m) => m.id))), [phases, index]);
  const tl = useMemo(() => (phase ? phaseTimeline(phase.board, map, phaseSteps, earlier) : null), [phase, map, earlier]);
  const start = useMemo(() => new Map([...plan.values()].map((p) => [p.key, { ...(p.phases[index]?.start ?? p.buy) } as GrenadeCounts])), [plan, index]);
  const dropKinds = useMemo(() => new Map(phases.flatMap((p) => (p.board.actions ?? []).filter((a) => a.type === 'drop').map((a) => [a.id, a.kind ?? '']))), [phases]);
  const stop = () => { cancelAnimationFrame(raf.current); setRun(null); };
  const play = () => {
    if (!tl || !phase) return;
    cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const tick = () => {
      const now = (performance.now() - t0) / 1000;
      setRun({ phase, index, t: Math.min(now, tl.duration) });
      if (now < tl.duration + 1) raf.current = requestAnimationFrame(tick);
    };
    setRun({ phase, index, t: 0 });
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const live = run && run.phase === phase && run.index === index ? run : null;
  // Stop the animation loop once the phase changes.
  useEffect(() => { if (!live) cancelAnimationFrame(raf.current); }, [live]);
  const t = live ? live.t : null;
  const frame: Frame | null = tl && t != null && phase ? frameAt(phase.board, tl, t, start, dropKinds) : null;
  return { playing: t != null, t, duration: tl?.duration ?? 0, frame, play, stop };
}

export function PlayPhaseBar({ pb, side, name }: {
  pb: ReturnType<typeof usePhasePlayback>; side: string | null; name: (key: string) => string;
}) {
  const inv = pb.frame?.inventory;
  return (
    <div className="play-phase">
      <div className="row tight">
        <button type="button" className="btn small primary" onClick={pb.play}>{pb.playing ? '↺ Replay phase' : '▶ Play phase'}</button>
        {pb.playing ? <button type="button" className="btn small ghost" onClick={pb.stop}>Stop</button> : null}
        {pb.playing ? (
          <span className="muted small" aria-live="off">{pb.t!.toFixed(1)} / {pb.duration.toFixed(1)} s</span>
        ) : <span className="muted small">Preview only: the saved board isn't changed.</span>}
      </div>
      {pb.playing ? <progress max={pb.duration} value={pb.t ?? 0} aria-label="Phase preview progress" /> : null}
      {inv && inv.size ? (
        <div className="play-inventory" aria-label="Utility carried during the preview">
          {[...inv].map(([key, c]) => (
            <span key={key} className="small">
              <strong>{name(key)}</strong>{' '}
              {GRENADES.filter((g) => c[g]).map((g) => (
                <span key={g} className="inv-item" title={`${c[g]} ${itemLabel(g, side, c[g] !== 1)}`}><UtilityIcon kind={g} side={side} size={14} label="" />{c[g]}</span>
              ))}
              {!GRENADES.some((g) => c[g]) ? <span className="muted">none</span> : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Grenades in flight during the preview.
export function FlyingUtility({ frame, side }: { frame: Frame | null; side: string | null }) {
  const colorOf = usePlayerColors();
  if (!frame || !frame.flying.length) return null;
  return (
    <g data-layer="phase-preview" pointerEvents="none">
      {frame.flying.map((f) => (
        <g key={f.id} transform={`translate(${f.at.x * SIZE},${f.at.y * SIZE})`} data-flying={f.kind}>
          <UtilityGlyph kind={f.kind} color={colorOf(f.owner)} r={11} side={side} />
        </g>
      ))}
    </g>
  );
}

export type PreviewBoard = Board;
