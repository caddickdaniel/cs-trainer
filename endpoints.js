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
        description: 'Body: { player_role (igl|entry|support|lurker|awper|anchor|rifler|null), is_igl? (legacy) }. Assigning or removing "igl" is owner-only and moves live Game Mode control from the previous IGL in the same transaction. Other roles: owner/IGL for anyone, or the player themself',
      },
      'PATCH /api/teams/:team_id/recruiting': { description: 'Owner only. Body: { is_recruiting?, recruiting_leagues?, roles_needed?, recruiting_notes? }' },
      'POST /api/teams/:team_id/logo': { description: 'Owner only. Raw PNG/JPEG/WebP body (max 2 MB) sets the team picture' },
      'DELETE /api/teams/:team_id/logo': { description: 'Owner only. Removes the team picture' },
      'GET /api/teams/:team_id/requests': { description: 'Owner only. Requests to join, with requester profile summaries' },
      'POST /api/teams/:team_id/requests/:request_id/invite': { description: 'Owner only. Sends the requester a player invite (does not add them)' },
      'POST /api/teams/:team_id/requests/:request_id/decline': { description: 'Owner only. Declines a request' },
      'GET /api/teams/:team_id/events': { description: 'Members only. Calendar events (query: from, to as ISO instants)' },
      'GET /api/teams/:team_id/events/next': { description: 'Members only. Next upcoming event or null' },
      'POST /api/teams/:team_id/events': { description: 'Owner only. Body: { kind: training|game, title, starts_at (ISO with offset), time_zone (IANA), opponent?, notes? }. Notifies members' },
      'GET /api/teams/:team_id/events/:event_id': { description: 'Members only' },
      'PATCH /api/teams/:team_id/events/:event_id': { description: 'Owner only. Partial event body. Notifies members' },
      'DELETE /api/teams/:team_id/events/:event_id': { description: 'Owner only. Notifies members' },
      'DELETE /api/teams/:team_id/members/:user_id': { description: 'Owner only. Removes a player' },
      'POST /api/teams/:team_id/leave': { description: 'Leave the team (not available to the owner)' },
      'GET /api/teams/:team_id/invites': { description: 'Owner/IGL. Lists invites with status' },
      'POST /api/teams/:team_id/invites': {
        description: 'Owner/IGL. Link invite: { expires_in_hours: 1|24|72|168, max_uses? } (token returned once). Player invite: { user_id } for a player with no team; 409 invite_pending if one is already pending',
      },
      'DELETE /api/teams/:team_id/invites/:invite_id': { description: 'Owner/IGL. Revokes an invite' },
      'GET /api/teams/:team_id/tactics': { description: 'Members only. Tactic library summaries' },
      'POST /api/teams/:team_id/tactics': { description: 'Owner/IGL. Creates a tactic document (see PUT /api/tactics/:tactic_id/document)' },
      'GET /api/teams/:team_id/game-session': { description: 'Members only. Active Game Mode session (or null with last_ended). Poll this' },
      'POST /api/teams/:team_id/lineup-images': {
        description: 'Owner/IGL. Uploads a lineup screenshot. Body: raw PNG with Content-Type: image/png (max 8 MB, 8192px per side). Returns { image: { image_id, width, height } }',
      },
      'POST /api/teams/:team_id/game-session': { description: 'IGL only. Body: { tactic_id }. Starts a match (map and side from the tactic) at round 1. 409 session_active if one is running' },
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
      'POST /api/game-sessions/:session_id/command': {
        description: 'IGL only. Body: { action: phase_next|phase_prev|phase_goto|tactic_next|tactic_prev|switch_side|new_round, index?, expected_version }. Tactic navigation stays within the match map and side; new_round snapshots the selected tactic at phase 1. 409 version_conflict returns the latest session; 403 not_igl once control has moved',
      },
      'POST /api/game-sessions/:session_id/phase': { description: 'IGL only. Legacy alias: { action: next|prev|goto, index?, expected_version }' },
      'POST /api/game-sessions/:session_id/end': { description: 'IGL only. Ends the match (idempotent)' },
    },
    '/me': {
      'GET /api/me/profile': { description: 'Own profile (includes email)' },
      'PATCH /api/me/profile': { description: 'Body: language, region, platform, skill_level, bio, steam_url, faceit_url, esea_url, hltv_url (https links to the matching site, or empty)' },
      'POST /api/me/avatar': { description: 'Raw PNG/JPEG/WebP body (max 2 MB, 4096 px) sets the profile picture' },
      'DELETE /api/me/avatar': { description: 'Removes the profile picture' },
      'GET /api/me/settings': { description: '{ shortcuts, defaults }' },
      'PUT /api/me/settings': { description: 'Body: { shortcuts: { phase_prev, phase_next, tactic_prev, tactic_next, new_round, switch_side } | null (reset) }. Conflicting bindings are rejected' },
      'GET /api/me/invites': { description: 'Player invites addressed to the caller' },
      'POST /api/me/invites/:invite_id/accept': { description: 'Joins the team. Re-checks that the caller has no team (409 already_in_team)' },
      'POST /api/me/invites/:invite_id/decline': { description: 'Declines the invite' },
      'GET /api/me/requests': { description: 'The caller\'s requests to join teams' },
    },
    '/players': {
      'GET /api/players/available': { description: 'Players with no team memberships (discovery fields only) and the caller\'s pending invite status' },
      'GET /api/players/:user_id': { description: 'Public profile. Visible for the caller, teammates, teamless players, and players with a pending request to a team the caller owns' },
    },
    '/recruiting': {
      'GET /api/recruiting/teams': { description: 'Teams marked as recruiting: discovery fields, roster size from memberships, caller\'s request status' },
      'GET /api/recruiting/teams/:team_id': { description: 'One recruiting team (404 if not recruiting, unless the caller is a member)' },
      'POST /api/recruiting/teams/:team_id/requests': { description: 'Request an invite (teamless players only). 409 request_pending on duplicates. Never adds the player' },
    },
    '/notifications': {
      'GET /api/notifications': { description: 'Undismissed notifications, newest first, with unread_count' },
      'POST /api/notifications/read-all': { description: 'Marks all as read' },
      'POST /api/notifications/:notification_id/dismiss': { description: 'Dismisses one notification for the caller' },
      'POST /api/notifications/:notification_id/open': { description: 'Re-checks access and returns { href, message? } for the target' },
    },
    '/shared-tactics': {
      'GET /api/tactics/:tactic_id/share': { description: 'Owner/IGL. Preview of exactly what would be published, plus the current listing' },
      'POST /api/tactics/:tactic_id/share': { description: 'Owner/IGL. Publish or update the listing snapshot ({ include_images })' },
      'GET /api/shared-tactics': { description: 'Active listings with net rating and your vote (?map, side, economy, sort=top|new, q)' },
      'GET /api/shared-tactics/:share_id': { description: 'Listing snapshot with Player 1-5 slots (404 once withdrawn)' },
      'DELETE /api/shared-tactics/:share_id': { description: 'Owner/IGL of the publishing team. Withdraw; imported copies keep working' },
      'PUT /api/shared-tactics/:share_id/vote': { description: '{ value: 1 | -1 | 0 }. One vote per user; 0 removes it' },
      'POST /api/shared-tactics/:share_id/import': { description: 'Owner/IGL of { team_id }. Independent copy; returns { tactic_id }' },
      'GET /api/shared-tactics/:share_id/images/:image_id': { description: 'Screenshot copied into an active listing' },
    },
    '/demos': {
      'GET, POST /api/teams/:team_id/demos': { description: 'Members. List, or upload a .dem as application/octet-stream (?file_name, ?title)' },
      'GET, PATCH, DELETE /api/demos/:demo_id': { description: 'Members read; uploader, owner or IGL rename/delete' },
      'POST /api/demos/:demo_id/retry': { description: 'Queue a failed demo again' },
      'GET /api/demos/:demo_id/rounds/:round': { description: 'Replay data for one round (gzip JSON)' },
      'GET, POST /api/demos/:demo_id/annotations': { description: 'Saved drawings and text (?round)' },
      'DELETE /api/demos/:demo_id/annotations/:annotation_id': { description: 'Author, owner or IGL' },
      'PATCH /api/demos/:demo_id/annotations/:annotation_id': { description: 'Move or change a utility annotation (author, owner or IGL)', body: '{ x?, y?, utility?, level? }' },
      'POST /api/teams/:team_id/demos/share-code': { description: 'Queue a match from a CS2 share code (needs a replay provider)', body: '{ share_code, title? }' },
    },
    '/reviews': {
      'GET, POST /api/teams/:team_id/review': { description: 'Current live review; the IGL starts one ({ demo_id, round_number? })' },
      'GET /api/reviews/:review_id': { description: 'Server-authoritative review state with server_time' },
      'POST /api/reviews/:review_id/command': { description: 'IGL. play | pause | seek | round | speed | clear, with expected_version' },
      'POST /api/reviews/:review_id/annotations': { description: 'IGL. Live drawing or text for the current round' },
      'DELETE /api/reviews/:review_id/annotations/:annotation_id': { description: 'IGL' },
      'PATCH /api/reviews/:review_id/annotations/:annotation_id': { description: 'IGL; move or change a live utility annotation', body: '{ x?, y?, utility?, level? }' },
      'POST /api/reviews/:review_id/end': { description: 'IGL' },
    },
    '/phase-4': {
      'GET /api/catalogue': { description: 'Languages, regions, platforms and the rank catalogue (no account data)' },
      'GET /api/players/available': { description: 'Teamless players (?language, region, platform, rank)' },
      'GET /api/auth/steam/start?intent=signin|link': { description: 'Redirects to Steam OpenID (browser navigation)' },
      'GET /api/auth/steam/callback': { description: 'Verifies the Steam response server-side, then signs in, links or offers account creation' },
      'GET, DELETE /api/auth/steam/pending': { description: 'The verified but unlinked Steam identity in this session' },
      'POST /api/auth/steam/complete': { description: 'Creates a Steam-backed account ({ user_name, use_avatar, use_profile_url })' },
      'GET /api/me/identities': { description: 'Sign-in methods (Steam, password)' },
      'DELETE /api/me/identities/steam': { description: 'Unlink Steam (refused when it is the only sign-in method)' },
      'POST /api/me/steam/link-pending': { description: 'Explicitly links the pending verified Steam identity to the signed-in account' },
      'POST /api/me/steam/prefill': { description: 'Fills empty Steam profile URL and picture from Steam' },
      'POST /api/me/password': { description: 'Adds an email and password to a Steam-only account' },
      'GET /api/me/stats': { description: 'Own Player Stats per source (private view)' },
      'GET, PATCH /api/me/stats/settings': { description: '{ track, visibility: private | profile }' },
      'GET, POST, DELETE /api/me/faceit': { description: 'FACEIT connection status, connect (from the verified Steam ID), disconnect' },
      'POST /api/me/faceit/sync': { description: 'Sync FACEIT matches and rating (rate limited)' },
      'GET /api/players/:user_id/stats': { description: 'Aggregate stats when the player shares them on their profile' },
    },
    '/pictures': {
      'GET /api/pictures/:image_id': { description: 'Profile pictures and team logos (any signed-in user)' },
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
