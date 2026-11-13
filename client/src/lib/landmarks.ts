import type { Level } from './constants';

// Spawn and bombsite landmarks per map, in the radar's normalised coordinates
// (0..1 across the 1024px radar, the same frame as board items and demo
// replays). `level` is the radar floor the landmark is drawn on.
//
// Sources (see README "Map landmarks"):
// - demo:  median position of players whose CS2 place name was CTSpawn /
//          TSpawn / BombsiteA / BombsiteB in a parsed match demo, converted
//          with the radar transform (Mirage, Nuke, Ancient).
// - radar: centre of the spawn / bombsite zone outlined on the radar image
//          (Dust II, Inferno, Anubis, Cache, Vertigo; Nuke's T spawn).
// - layout: placed from the map layout; no demo or outline was available
//          (Overpass, Train). Check these against a demo when one is added.
export type LandmarkKind = 'ct' | 't' | 'a' | 'b';
export interface Landmark { kind: LandmarkKind; x: number; y: number; level: Level }
export interface MapLandmarks { source: Record<LandmarkKind, 'demo' | 'radar' | 'layout'>; points: Landmark[] }

const lm = (kind: LandmarkKind, x: number, y: number, level: Level = 'main'): Landmark => ({ kind, x, y, level });

export const LANDMARKS: Record<string, MapLandmarks> = {
  de_ancient: {
    source: { ct: 'demo', t: 'demo', a: 'demo', b: 'demo' },
    points: [lm('ct', 0.508, 0.091), lm('t', 0.475, 0.857), lm('a', 0.255, 0.293), lm('b', 0.77, 0.381)],
  },
  de_anubis: {
    source: { ct: 'radar', t: 'radar', a: 'radar', b: 'radar' },
    points: [lm('ct', 0.42, 0.22), lm('t', 0.47, 0.89), lm('a', 0.74, 0.26), lm('b', 0.33, 0.49)],
  },
  de_cache: {
    source: { ct: 'radar', t: 'radar', a: 'radar', b: 'radar' },
    points: [lm('ct', 0.09, 0.47), lm('t', 0.87, 0.58), lm('a', 0.345, 0.81), lm('b', 0.315, 0.265)],
  },
  de_dust2: {
    source: { ct: 'radar', t: 'radar', a: 'radar', b: 'radar' },
    points: [lm('ct', 0.6, 0.2), lm('t', 0.38, 0.9), lm('a', 0.8, 0.16), lm('b', 0.21, 0.13)],
  },
  de_inferno: {
    source: { ct: 'radar', t: 'radar', a: 'radar', b: 'radar' },
    points: [lm('ct', 0.89, 0.35), lm('t', 0.1, 0.67), lm('a', 0.81, 0.68), lm('b', 0.485, 0.22)],
  },
  de_mirage: {
    source: { ct: 'demo', t: 'demo', a: 'demo', b: 'demo' },
    points: [lm('ct', 0.363, 0.682), lm('t', 0.868, 0.363), lm('a', 0.537, 0.699), lm('b', 0.24, 0.289)],
  },
  de_nuke: {
    source: { ct: 'demo', t: 'radar', a: 'demo', b: 'demo' },
    // B site is on the lower floor.
    points: [lm('ct', 0.828, 0.463), lm('t', 0.21, 0.553), lm('a', 0.566, 0.554), lm('b', 0.602, 0.454, 'lower')],
  },
  de_overpass: {
    source: { ct: 'layout', t: 'layout', a: 'layout', b: 'layout' },
    points: [lm('ct', 0.5, 0.08), lm('t', 0.62, 0.87), lm('a', 0.37, 0.2), lm('b', 0.8, 0.33)],
  },
  de_train: {
    source: { ct: 'layout', t: 'layout', a: 'layout', b: 'layout' },
    points: [lm('ct', 0.85, 0.45), lm('t', 0.12, 0.17), lm('a', 0.55, 0.45), lm('b', 0.56, 0.8)],
  },
  de_vertigo: {
    source: { ct: 'radar', t: 'radar', a: 'radar', b: 'radar' },
    // T spawn is on the lower floor (50th); everything else is upstairs.
    points: [lm('ct', 0.56, 0.24), lm('t', 0.4, 0.74, 'lower'), lm('a', 0.7, 0.58), lm('b', 0.22, 0.24)],
  },
};

export const landmarksFor = (map: string, level: Level) => (LANDMARKS[map]?.points ?? []).filter((p) => p.level === level);
