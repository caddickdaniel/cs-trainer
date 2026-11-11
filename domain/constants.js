// Shared enum values. Keep in sync with client/src/lib/constants.ts.
exports.SIDES = ['T', 'CT'];
exports.ECONOMIES = ['Pistol', 'Eco', 'Force', 'Halfbuy', 'Fullbuy'];
exports.MAPS = ['practice_yard'];
exports.PLAYER_ROLES = ['entry', 'support', 'lurker', 'awper', 'anchor', 'rifler'];
exports.MARKER_KINDS = ['player', 'smoke', 'flash', 'molly', 'he', 'note'];
exports.INVITE_TTL_HOURS = [1, 24, 72, 168];
exports.LIMITS = {
  phases: 20,
  markers: 60,
  routes: 30,
  routePoints: 100,
};
