// Keep in sync with domain/constants.js on the server.
export const SIDES = ['T', 'CT'] as const;
export const ECONOMIES = ['Pistol', 'Eco', 'Force', 'Halfbuy', 'Fullbuy'] as const;
export type Level = 'main' | 'lower';
export interface MapDef { id: string; name: string; pool: 'Active Duty' | 'Reserve' | 'Other'; levels: Level[]; radar: boolean }

// Radar PNGs live in client/public/maps (see SOURCES.md there). Keep ids and
// levels in sync with domain/constants.js on the server.
export const MAPS: MapDef[] = [
  { id: 'de_ancient', name: 'Ancient', pool: 'Active Duty', levels: ['main'], radar: true },
  { id: 'de_anubis', name: 'Anubis', pool: 'Active Duty', levels: ['main'], radar: true },
  { id: 'de_cache', name: 'Cache', pool: 'Active Duty', levels: ['main'], radar: true },
  { id: 'de_dust2', name: 'Dust II', pool: 'Active Duty', levels: ['main'], radar: true },
  { id: 'de_inferno', name: 'Inferno', pool: 'Active Duty', levels: ['main'], radar: true },
  { id: 'de_mirage', name: 'Mirage', pool: 'Active Duty', levels: ['main'], radar: true },
  { id: 'de_nuke', name: 'Nuke', pool: 'Active Duty', levels: ['main', 'lower'], radar: true },
  { id: 'de_overpass', name: 'Overpass', pool: 'Reserve', levels: ['main'], radar: true },
  { id: 'de_train', name: 'Train', pool: 'Reserve', levels: ['main', 'lower'], radar: true },
  { id: 'de_vertigo', name: 'Vertigo', pool: 'Reserve', levels: ['main', 'lower'], radar: true },
  { id: 'practice_yard', name: 'Practice Yard (schematic)', pool: 'Other', levels: ['main'], radar: false },
];
export const DEFAULT_MAP = 'de_mirage';
export const LEVEL_LABEL: Record<Level, string> = { main: 'Upper / main', lower: 'Lower' };
export const findMap = (id: string | null | undefined) => MAPS.find((m) => m.id === id);
export const mapLevels = (id: string | null | undefined): Level[] => findMap(id)?.levels ?? ['main'];
export const radarUrl = (id: string, level: Level) => `/maps/${id}${level === 'lower' ? '_lower' : ''}.png`;
export const LINEUP_KINDS = ['smoke', 'flash', 'molly', 'he', 'note'] as const;
export const PLAYER_ROLES = ['entry', 'support', 'lurker', 'awper', 'anchor', 'rifler'] as const;
export const MARKER_KINDS = ['player', 'smoke', 'flash', 'molly', 'he', 'note'] as const;
export const INVITE_TTL_HOURS = [1, 24, 72, 168] as const;
export const LIMITS = { phases: 20, markers: 60, routes: 30, routePoints: 100, imagesPerMarker: 4, imageBytes: 8 * 1024 * 1024 };

export const PLAYER_COLORS = ['#f5a524', '#4cc38a', '#5b9cf5', '#e5484d', '#b07cf7', '#3dd6d0', '#f17ac6', '#c9d36a', '#ff8a4c', '#9aa4b2'];

export const ECONOMY_LABEL: Record<string, string> = {
  Pistol: 'Pistol',
  Eco: '$ Eco',
  Force: '$$ Force',
  Halfbuy: '$$ Half buy',
  Fullbuy: '$$$ Full buy',
};

export const MARKER_LABEL: Record<string, string> = {
  player: 'Player',
  smoke: 'Smoke',
  flash: 'Flash',
  molly: 'Molotov',
  he: 'HE grenade',
  note: 'Note',
};

export const mapName = (id: string | null | undefined) => findMap(id)?.name ?? 'No map set';
