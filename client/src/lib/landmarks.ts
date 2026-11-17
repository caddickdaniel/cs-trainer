import type { Level } from './constants';

// Spawn and bombsite landmarks per map, in the radar's normalised coordinates
// (0..1 across the 1024px radar, the same frame as board items and demo
// replays). `level` is the radar floor the landmark is drawn on.
//
// Sources (see README "Map landmarks"):
// - outline: centre of the orange (bombsite) or green (spawn) outline drawn on
//            the radar image, measured from the PNG and checked by eye.
// - layout:  the radar has no outline for this landmark (Overpass and Train
//            ship without them), so it is placed from the map layout.
// - supplied: coordinates supplied as percentages from the radar's top-left
//            (Phase 7), converted here by dividing by 100.
export type LandmarkKind = 'ct' | 't' | 'a' | 'b';
export interface Landmark { kind: LandmarkKind; x: number; y: number; level: Level }
export interface MapLandmarks { source: Record<LandmarkKind, 'outline' | 'layout' | 'supplied'>; points: Landmark[] }

const lm = (kind: LandmarkKind, x: number, y: number, level: Level = 'main'): Landmark => ({ kind, x, y, level });
const OUTLINE = { ct: 'outline', t: 'outline', a: 'outline', b: 'outline' } as const;
const pct = (n: number) => Math.round(n * 10) / 1000;

export const LANDMARKS: Record<string, MapLandmarks> = {
  de_ancient: { source: OUTLINE, points: [lm('ct', 0.507, 0.149), lm('t', 0.484, 0.865), lm('a', 0.302, 0.26), lm('b', 0.748, 0.41)] },
  de_anubis: { source: OUTLINE, points: [lm('ct', 0.428, 0.216), lm('t', 0.47, 0.912), lm('a', 0.754, 0.255), lm('b', 0.325, 0.493)] },
  de_cache: { source: OUTLINE, points: [lm('ct', 0.088, 0.465), lm('t', 0.888, 0.585), lm('a', 0.346, 0.809), lm('b', 0.315, 0.266)] },
  de_dust2: { source: OUTLINE, points: [lm('ct', 0.616, 0.195), lm('t', 0.39, 0.91), lm('a', 0.802, 0.168), lm('b', 0.204, 0.125)] },
  de_inferno: { source: { ...OUTLINE, a: 'supplied', b: 'supplied' }, points: [lm('ct', 0.893, 0.348), lm('t', 0.096, 0.67), lm('a', pct(81.4), pct(68.1)), lm('b', pct(48.8), pct(21.9))] },
  de_mirage: { source: { ...OUTLINE, a: 'supplied', b: 'supplied' }, points: [lm('ct', 0.305, 0.7), lm('t', 0.88, 0.362), lm('a', pct(54.4), pct(76.7)), lm('b', pct(23), pct(27.9))] },
  // B site is drawn on the lower radar only.
  de_nuke: { source: OUTLINE, points: [lm('ct', 0.817, 0.469), lm('t', 0.202, 0.567), lm('a', 0.577, 0.504), lm('b', 0.562, 0.545, 'lower')] },
  de_overpass: { source: { ct: 'supplied', t: 'supplied', a: 'supplied', b: 'supplied' }, points: [lm('ct', pct(47.8), pct(17.1)), lm('t', pct(64.8), pct(93.5)), lm('a', pct(43), pct(19.7)), lm('b', pct(69.3), pct(32.2))] },
  de_train: { source: { ct: 'supplied', t: 'layout', a: 'supplied', b: 'supplied' }, points: [lm('ct', pct(89.8), pct(80.5)), lm('t', 0.12, 0.17), lm('a', pct(65), pct(52.3)), lm('b', pct(54.3), pct(80.7))] },
  // T spawn is on the lower floor; its outline is repeated faintly on the upper radar.
  de_vertigo: { source: OUTLINE, points: [lm('ct', 0.559, 0.241), lm('t', 0.394, 0.742, 'lower'), lm('a', 0.704, 0.584), lm('b', 0.221, 0.235)] },
};

export const landmarksFor = (map: string, level: Level) => (LANDMARKS[map]?.points ?? []).filter((p) => p.level === level);
