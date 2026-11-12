// Shared enum values. Keep in sync with client/src/lib/constants.ts.
exports.SIDES = ['T', 'CT'];
exports.ECONOMIES = ['Pistol', 'Eco', 'Force', 'Halfbuy', 'Fullbuy'];

// Maps and their radar levels. Multi-level maps share one coordinate frame.
exports.MAP_DEFS = [
  { id: 'de_ancient', levels: ['main'] },
  { id: 'de_anubis', levels: ['main'] },
  { id: 'de_cache', levels: ['main'] },
  { id: 'de_dust2', levels: ['main'] },
  { id: 'de_inferno', levels: ['main'] },
  { id: 'de_mirage', levels: ['main'] },
  { id: 'de_nuke', levels: ['main', 'lower'] },
  { id: 'de_overpass', levels: ['main'] },
  { id: 'de_train', levels: ['main', 'lower'] },
  { id: 'de_vertigo', levels: ['main', 'lower'] },
  { id: 'practice_yard', levels: ['main'] },
];
exports.MAPS = exports.MAP_DEFS.map((m) => m.id);
exports.LEVELS = ['main', 'lower'];
exports.mapLevels = (id) => (exports.MAP_DEFS.find((m) => m.id === id) || { levels: ['main'] }).levels;

// Roster roles. 'igl' is held by at most one player per team and is the only
// role that controls live Game Mode.
exports.PLAYER_ROLES = ['entry', 'support', 'lurker', 'awper', 'anchor', 'rifler', 'igl'];
exports.EVENT_KINDS = ['training', 'game', 'demo_review'];
exports.SHORTCUT_ACTIONS = ['phase_prev', 'phase_next', 'tactic_prev', 'tactic_next', 'new_round', 'switch_side'];
exports.DEFAULT_SHORTCUTS = {
  phase_prev: 'ArrowLeft',
  phase_next: 'ArrowRight',
  tactic_prev: '[',
  tactic_next: ']',
  new_round: 'N',
  switch_side: 'S',
};
// Profile links must point at these sites.
exports.PROFILE_LINK_HOSTS = {
  steam_url: ['steamcommunity.com'],
  faceit_url: ['faceit.com', 'www.faceit.com'],
  esea_url: ['esea.net', 'play.esea.net', 'www.esea.net'],
  hltv_url: ['hltv.org', 'www.hltv.org'],
};
exports.MARKER_KINDS = ['player', 'smoke', 'flash', 'molly', 'he', 'note'];
// Marker kinds that can carry lineup screenshots.
exports.LINEUP_KINDS = ['smoke', 'flash', 'molly', 'he', 'note'];
exports.INVITE_TTL_HOURS = [1, 24, 72, 168];
exports.LIMITS = {
  phases: 20,
  markers: 60,
  routes: 30,
  routePoints: 100,
  imagesPerMarker: 4,
  imageBytes: 8 * 1024 * 1024,
  imageMaxSide: 8192,
  imagesPerTeam: 1000,
  pictureBytes: 2 * 1024 * 1024,
  pictureMaxSide: 4096,
  playerInviteDays: 7,
  holds: 20,
  noteChars: 200,
  // Shared tactics use Player 1-5 slots.
  slots: 5,
  annotationsPerRound: 300,
};

// Note text size on the board (board units; the board is 1000 units wide).
exports.NOTE_SIZE = { min: 12, max: 64, default: 22 };

// Demo Review. Radar transforms match the radar images in client/public/maps
// (from CS Demo Manager, MIT, see client/public/maps/SOURCES.md):
// px = (x - pos_x) / scale, py = (pos_y - y) / scale on a 1024px radar.
// Positions with z below lowerBelowZ are drawn on the lower radar.
exports.RADAR_TRANSFORMS = {
  de_ancient: { pos_x: -2953, pos_y: 2164, scale: 5 },
  de_anubis: { pos_x: -2796, pos_y: 3328, scale: 5.22 },
  de_cache: { pos_x: -2000, pos_y: 3250, scale: 5.5 },
  de_dust2: { pos_x: -2476, pos_y: 3239, scale: 4.4 },
  de_inferno: { pos_x: -2087, pos_y: 3870, scale: 4.9 },
  de_mirage: { pos_x: -3230, pos_y: 1713, scale: 5 },
  de_nuke: { pos_x: -3453, pos_y: 2887, scale: 7, lowerBelowZ: -495 },
  de_overpass: { pos_x: -4831, pos_y: 1781, scale: 5.2 },
  de_train: { pos_x: -2308, pos_y: 2078, scale: 4.082077, lowerBelowZ: -50 },
  de_vertigo: { pos_x: -3168, pos_y: 1762, scale: 4, lowerBelowZ: 11700 },
};
exports.RADAR_SIZE = 1024;
exports.DEMO_STATUSES = ['queued', 'processing', 'ready', 'failed'];
