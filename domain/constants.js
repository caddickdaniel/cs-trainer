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

exports.PLAYER_ROLES = ['entry', 'support', 'lurker', 'awper', 'anchor', 'rifler'];
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
};
