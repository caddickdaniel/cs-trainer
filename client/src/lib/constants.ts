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
export const PLAYER_ROLES = ['igl', 'entry', 'support', 'lurker', 'awper', 'anchor', 'rifler'] as const;
// Display labels for stored role values.
export const ROLE_LABEL: Record<string, string> = {
  igl: 'IGL', entry: 'Entry', support: 'Support', lurker: 'Lurker', awper: 'AWPer', anchor: 'Anchor', rifler: 'Rifler',
};
export const roleLabel = (role: string | null | undefined) => (role ? ROLE_LABEL[role] ?? role : '');
// One colour per roster role, used wherever a role badge appears.
export const ROLE_COLOR: Record<string, string> = {
  igl: '#e5484d', entry: '#ff8a4c', support: '#4cc38a', lurker: '#b07cf7', awper: '#5b9cf5', anchor: '#3dd6d0', rifler: '#f5c542',
};
export const EVENT_KINDS = ['training', 'game', 'demo_review'] as const;
export const EVENT_LABEL: Record<string, string> = { training: 'Training', game: 'Game', demo_review: 'Demo Review' };

export const SHORTCUT_ACTIONS = ['phase_prev', 'phase_next', 'tactic_prev', 'tactic_next', 'new_round', 'switch_side'] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];
export const SHORTCUT_LABEL: Record<ShortcutAction, string> = {
  phase_prev: 'Previous phase',
  phase_next: 'Next phase',
  tactic_prev: 'Previous tactic',
  tactic_next: 'Next tactic',
  new_round: 'Start a new round',
  switch_side: 'Switch between T and CT',
};
export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  phase_prev: 'ArrowLeft', phase_next: 'ArrowRight', tactic_prev: 'ArrowUp', tactic_next: 'ArrowDown', new_round: 'Home', switch_side: 'End',
};
export const PROFILE_LINKS = [
  { key: 'steam_url', label: 'Steam', host: 'steamcommunity.com' },
  { key: 'faceit_url', label: 'FACEIT', host: 'faceit.com' },
  { key: 'esea_url', label: 'ESEA', host: 'esea.net' },
  { key: 'hltv_url', label: 'HLTV', host: 'hltv.org' },
] as const;
export const MARKER_KINDS = ['player', 'smoke', 'flash', 'molly', 'he', 'note'] as const;
export const INVITE_TTL_HOURS = [1, 24, 72, 168] as const;
export const LIMITS = {
  phases: 20, markers: 60, routes: 30, routePoints: 100, holds: 20, imagesPerMarker: 4, imageBytes: 8 * 1024 * 1024,
  pictureBytes: 2 * 1024 * 1024, noteChars: 200, slots: 5,
};
export const NOTE_SIZE = { min: 12, max: 64, default: 22, step: 2 };
// Supplied utility icons (client/public/icons/utility).
// Transparent CT defuse kit image for buy lists and instructions.
export const KIT_ICON = '/icons/defuse-kit.png';
export const UTILITY_ICON: Record<string, string> = {
  smoke: '/icons/utility/smoke.png', flash: '/icons/utility/flash.png', molly: '/icons/utility/molly.png', he: '/icons/utility/he.png',
};
// Player 1-5 colours for shared/imported tactics before slots are mapped.
export const SLOT_COLORS = ['#f5a524', '#4cc38a', '#5b9cf5', '#e5484d', '#b07cf7'];
export const SLOTS = [1, 2, 3, 4, 5] as const;

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
