// Served at GET /api. Every endpoint except GET /api and /api/auth/* requires a
// signed-in session. Mutations (POST/PUT/PATCH/DELETE) must send the CSRF token
// from GET /api/auth/csrf or /api/auth/me in the X-CSRF-Token header.
// Team-scoped resources the caller cannot see respond 404; actions inside the
// caller's team that need more permission respond 403.
exports.endpoints = {
  '/api': {
    'GET /api': {
      description: 'This endpoint lists all available endpoints on the server',
    },
    '/auth': {
      'GET /api/auth/csrf': { description: 'Returns { csrf_token } for the current session' },
      'GET /api/auth/me': {
        description: 'Returns the signed-in user (or null), their teams, active_team and a csrf_token',
      },
      'POST /api/auth/signup': {
        description: 'Creates an account and signs in. Body: { email, user_name, password (10+ chars) }. Rate limited',
      },
      'POST /api/auth/signin': { description: 'Signs in. Body: { email, password }. Rate limited' },
      'POST /api/auth/signout': { description: 'Ends the session' },
    },
    '/teams': {
      'GET /api/teams': {
        description: 'Teams the caller belongs to. Query: sort_by (team_id|team_name|language|region|platform|skill_level), order (asc|desc)',
      },
      'GET /api/teams/:team_id': { description: 'A team the caller belongs to' },
      'GET /api/teams/name/:team_name, /lang/:language, /reg/:region, /plat/:platform, /skill/:skill_level': {
        description: 'Filters over the caller\'s teams',
      },
      'POST /api/teams': {
        description: 'Creates a team owned by the caller, with the owner membership, atomically. 409 already_in_team if the caller is already in a team',
      },
      'PATCH /api/teams/:team_id': { description: 'Owner only. Updates team details' },
      'DELETE /api/teams/:team_id': { description: 'Owner only. Deletes the team, its tactics, invites and sessions' },
      'GET /api/teams/:team_id/owner': { description: 'Members only. Returns { team: { owner } }' },
      'PATCH /api/teams/:team_id/users/:user_id': { description: 'Owner only. Removes a player (legacy; same as DELETE members/:user_id)' },
      'GET /api/teams/:team_id/roster': { description: 'Members only. Team details, members with permissions/player roles, and the viewer\'s permissions' },
      'PATCH /api/teams/:team_id/members/:user_id': {
        description: 'Body: { is_igl? (owner only), player_role? (owner/IGL, or the player themself) }',
      },
      'DELETE /api/teams/:team_id/members/:user_id': { description: 'Owner only. Removes a player' },
      'POST /api/teams/:team_id/leave': { description: 'Leave the team (not available to the owner)' },
      'GET /api/teams/:team_id/invites': { description: 'Owner/IGL. Lists invites with status' },
      'POST /api/teams/:team_id/invites': {
        description: 'Owner/IGL. Body: { expires_in_hours: 1|24|72|168, max_uses? }. Returns the token once',
      },
      'DELETE /api/teams/:team_id/invites/:invite_id': { description: 'Owner/IGL. Revokes an invite' },
      'GET /api/teams/:team_id/tactics': { description: 'Members only. Tactic library summaries' },
      'POST /api/teams/:team_id/tactics': { description: 'Owner/IGL. Creates a tactic document (see PUT /api/tactics/:tactic_id/document)' },
      'GET /api/teams/:team_id/game-session': { description: 'Members only. Active Game Mode session (or null with last_ended). Poll this' },
      'POST /api/teams/:team_id/lineup-images': {
        description: 'Owner/IGL. Uploads a lineup screenshot. Body: raw PNG with Content-Type: image/png (max 8 MB, 8192px per side). Returns { image: { image_id, width, height } }',
      },
      'POST /api/teams/:team_id/game-session': { description: 'Owner/IGL. Body: { tactic_id }. Starts a session from a snapshot. 409 session_active if one is running' },
    },
    '/invites': {
      'GET /api/invites/:token': { description: 'Preview an invite: team, status (active|expired|revoked|used_up)' },
      'POST /api/invites/:token/accept': { description: 'Join the team. 410 if expired/revoked/used up; 409 if already in a team' },
    },
    '/tactics': {
      'GET /api/tactics': {
        description: 'Tactics of the caller\'s teams. Query: sort_by (tactic_id|tactic_name|economy|team_id|created_at|updated_at), order',
      },
      'GET /api/tactics/:tactic_id': { description: 'A tactic (legacy shape plus map, side, revision)' },
      'GET /api/tactics/name/:tactic_name, /econ/:economy, /team/:team_id': { description: 'Filters over the caller\'s tactics' },
      'POST /api/tactics': {
        description: 'Owner/IGL. Legacy create. Body: { tactic_name, economy, grenade, molly, flash, smoke, team_id, T?, CT? }',
      },
      'PATCH /api/tactics/:tactic_id': { description: 'Owner/IGL. Updates legacy fields' },
      'DELETE /api/tactics/:tactic_id': { description: 'Owner/IGL. Deletes a tactic' },
      'PATCH /api/tactics/:tactic_id/steps': { description: 'Owner/IGL. Replaces legacy steps; user_ids must be team members' },
      'GET /api/tactics/:tactic_id/user/:user_id/steps': { description: 'Members only. Legacy steps for one player' },
      'GET /api/tactics/:tactic_id/document': { description: 'Members only. Full tactic with ordered phases, assignments, board and roster' },
      'PUT /api/tactics/:tactic_id/document': {
        description: 'Owner/IGL. Replaces the tactic. Body: { revision, tactic_name, map, map (de_ancient|de_anubis|de_cache|de_dust2|de_inferno|de_mirage|de_nuke|de_overpass|de_train|de_vertigo|practice_yard), side (T|CT), economy (Pistol|Eco|Force|Halfbuy|Fullbuy), grenade, molly, flash, smoke, phases: [{ name, notes, board: { markers: [{ id, kind, x, y, level (main|lower), user_id, label, images: [{ image_id, caption }] }], routes: [{ id, level, user_id, color, points }] }, assignments: [{ user_id, instruction, utility, reference_url }] }] }. lower is only valid on de_nuke, de_train, de_vertigo. 409 stale_revision',
      },
    },
    '/lineup-images': {
      'GET /api/lineup-images/:image_id': { description: 'Members of the owning team only. Returns the PNG' },
    },
    '/game-sessions': {
      'GET /api/game-sessions/:session_id': { description: 'Members only. A session (active or ended)' },
      'POST /api/game-sessions/:session_id/phase': {
        description: 'Owner/IGL. Body: { action: next|prev|goto, index?, expected_version }. 409 version_conflict returns the latest session',
      },
      'POST /api/game-sessions/:session_id/end': { description: 'Owner/IGL. Ends the session (idempotent)' },
    },
    '/users': {
      'GET /api/users': { description: 'The caller and their teammates (never includes email)' },
      'POST /api/users': { description: 'Removed: responds 410. Use POST /api/auth/signup' },
      'GET /api/users/:user_id': { description: 'The caller or a teammate' },
      'GET /api/users/name/:user_name, /lang/:language, /reg/:region, /plat/:platform, /skill/:skill_level, /role/:role': {
        description: 'Filters over the caller and their teammates',
      },
      'GET /api/users/team/:team_id': { description: 'Members only. Users in the team' },
      'PATCH /api/users/:user_id': {
        description: 'Self only. Profile fields; team_id may only switch the active team to an existing membership',
      },
      'PATCH /api/users/:user_id/remove-team': { description: 'Self only. Leaves the active team' },
      'DELETE /api/users/:user_id': { description: 'Self only. Deletes the account (not while owning a team)' },
    },
  },
};
