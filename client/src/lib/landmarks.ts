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
export type LandmarkKind = 'ct' | 't' | 'a' | 'b';
export interface Landmark { kind: LandmarkKind; x: number; y: number; level: Level }
export interface MapLandmarks { source: Record<LandmarkKind, 'outline' | 'layout'>; points: Landmark[] }

const lm = (kind: LandmarkKind, x: number, y: number, level: Level = 'main'): Landmark => ({ kind, x, y, level });
const OUTLINE = { ct: 'outline', t: 'outline', a: 'outline', b: 'outline' } as const;
const LAYOUT = { ct: 'layout', t: 'layout', a: 'layout', b: 'layout' } as const;

export const LANDMARKS: Record<string, MapLandmarks> = {
  de_ancient: { source: OUTLINE, points: [lm('ct', 0.507, 0.149), lm('t', 0.484, 0.865), lm('a', 0.302, 0.26), lm('b', 0.748, 0.41)] },
  de_anubis: { source: OUTLINE, points: [lm('ct', 0.428, 0.216), lm('t', 0.47, 0.912), lm('a', 0.754, 0.255), lm('b', 0.325, 0.493)] },
  de_cache: { source: OUTLINE, points: [lm('ct', 0.088, 0.465), lm('t', 0.888, 0.585), lm('a', 0.346, 0.809), lm('b', 0.315, 0.266)] },
  de_dust2: { source: OUTLINE, points: [lm('ct', 0.616, 0.195), lm('t', 0.39, 0.91), lm('a', 0.802, 0.168), lm('b', 0.204, 0.125)] },
  de_inferno: { source: OUTLINE, points: [lm('ct', 0.893, 0.348), lm('t', 0.096, 0.67), lm('a', 0.833, 0.695), lm('b', 0.488, 0.222)] },
  de_mirage: { source: OUTLINE, points: [lm('ct', 0.305, 0.7), lm('t', 0.88, 0.362), lm('a', 0.543, 0.782), lm('b', 0.233, 0.276)] },
  // B site is drawn on the lower radar only.
  de_nuke: { source: OUTLINE, points: [lm('ct', 0.817, 0.469), lm('t', 0.202, 0.567), lm('a', 0.577, 0.504), lm('b', 0.562, 0.545, 'lower')] },
  de_overpass: { source: LAYOUT, points: [lm('ct', 0.5, 0.08), lm('t', 0.62, 0.87), lm('a', 0.37, 0.2), lm('b', 0.8, 0.33)] },
  de_train: { source: LAYOUT, points: [lm('ct', 0.85, 0.45), lm('t', 0.12, 0.17), lm('a', 0.55, 0.45), lm('b', 0.56, 0.8)] },
  // T spawn is on the lower floor; its outline is repeated faintly on the upper radar.
  de_vertigo: { source: OUTLINE, points: [lm('ct', 0.559, 0.241), lm('t', 0.394, 0.742, 'lower'), lm('a', 0.704, 0.584), lm('b', 0.221, 0.235)] },
};

export const landmarksFor = (map: string, level: Level) => (LANDMARKS[map]?.points ?? []).filter((p) => p.level === level);
