// Team-level CS2 teammate colours (team_memberships.game_color) are the one
// source of truth for players' colours. Tactics also store colours (Phase 6,
// per tactic and for Player 1-5 slots); when a tactic or a Game Mode round is
// shown, a member's team colour replaces whatever the tactic stored, so the
// Team tab, Tactics, Game Mode and the board all agree.
const db = require('../db/connection');

async function teamColors(teamId, trx = db) {
  const rows = await trx('team_memberships').where('team_id', teamId).whereNotNull('game_color').select('user_id', 'game_color');
  return new Map(rows.map((r) => [r.user_id, r.game_color]));
}

// Pure: overlays team colours on a tactic's colour list. Each colour stays
// unique: an entry (player or slot) holding a colour now assigned to a team
// member loses it.
function applyTeamColors(list, assigned) {
  const taken = new Set(assigned.values());
  const out = (list || []).filter((c) => !(c.user_id != null && assigned.has(c.user_id)) && !taken.has(c.color));
  for (const [userId, color] of assigned) out.push({ user_id: userId, slot: null, color });
  return out;
}

module.exports = { teamColors, applyTeamColors };
