# CS-Trainer

CS-Trainer is a Counter-Strike 2 web app for teams. Teams plan rounds, give each player a job for every phase, and follow those instructions live on a second monitor in **Game Mode**.

- **Milestone 1:** sign up, create a team, invite a teammate, build a tactic and run it in Game Mode. Each teammate sees only their own instructions, and refresh or reconnect resumes the current phase.
- **Phase 2 (this branch):**
  - team management, with the IGL role controlling live play;
  - player profiles, player invites and a recruiting directory;
  - Game Mode rounds with tactic and side switching and configurable shortcuts;
  - a Training calendar with a countdown on Home;
  - notifications.

- [Quick start](#quick-start)
- [Phase 2](#phase-2)
- [Scripts](#scripts)
- [Architecture](#architecture)
- [Security model](#security-model)
- [Data model and migration notes](#data-model-and-migration-notes)
- [Intentional API changes](#intentional-api-changes)
- [Design references](#design-references)
- [Verification](#verification)
- [Roadmap](#roadmap)

## Quick start

Prerequisites: Node.js ≥ 20.12 (developed on 24), npm, and a local PostgreSQL server (developed on 18; 13+ expected to work).

```sh
git clone https://github.com/caddickdaniel/cs-trainer.git
cd cs-trainer
cp .env.example .env        # adjust DATABASE_URL / TEST_DATABASE_URL if needed
npm install                 # installs the API and the client (npm workspaces)
npm run setup               # creates cs_trainer + cs_trainer_test, migrates and seeds development
npm run dev                 # API on :9090, Vite on :5173 (proxies /api)
```

Open <http://localhost:5173>.

**Development accounts.** Every seeded account uses the password `SEED_PASSWORD` from [db/seeds/index.js](db/seeds/index.js). Seeds are for development and test databases only.

| View to test | Account | Notes |
| --- | --- | --- |
| Team owner (not IGL) | `test-owner@cs-trainer.test` | Owns **Test Team 1**; can manage the team but cannot control live play |
| IGL | `test-juno@cs-trainer.test` | Test Team 1's IGL; controls Game Mode |
| Ordinary players | `test-vex@`, `test-morrow@`, `test-talon@cs-trainer.test` | Entry, Support and AWPer on Test Team 1 |
| Teamless players | `demo-kestrel@`, `demo-mateo@`, `demo-hana@`, `demo-liam@`, `demo-sofia@`, `demo-noah@`, `demo-priya@`, `demo-yusuf@`, `demo-emma@`, `demo-chen@cs-trainer.test` | Varied languages, regions, platforms and skill levels; some have bios and profile links |
| Legacy sample data | `user-a@` … `user-m@cs-trainer.test` | User A owns *Team A* (demo tactic *A Split (demo)*); User M has no team |

**Adding demo accounts to an existing database without a reset** (development only):

```sh
npm run db:migrate                          # apply new migrations; existing data is kept
npm run db:demo                             # add or refresh the 10 teamless demo players
npm run db:demo -- --team "Test Team 1"     # also add Juno, Vex, Morrow and Talon to that team
```

The script matches accounts by email and can be re-run. Teammates already on another team are skipped. Juno becomes IGL only if the team has none, otherwise Rifler.

To try the two-player flow on one machine, use two browser profiles, or open one tab on `localhost:5173` and another on `127.0.0.1:5173`. Each host gets its own cookies, so the two tabs can be signed in as different users.

Heroku is not used anywhere. Every connection string comes from `.env` (see [.env.example](.env.example)).

### Production build (deployment is not part of this milestone)

```sh
npm run build                         # client/dist
NODE_ENV=production DATABASE_URL=... SESSION_SECRET=... TRUST_PROXY=1 npm run db:migrate
NODE_ENV=production DATABASE_URL=... SESSION_SECRET=... TRUST_PROXY=1 npm start
```

In production, Express serves `client/dist` and the API from one origin, with no CORS. Session cookies are `Secure`, so the app must be served over HTTPS. Set `TRUST_PROXY` to the number of proxies in front of it.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run setup` | `db:create` + `db:reset` |
| `npm run db:create` | Creates the dev and test databases if missing (never drops) |
| `npm run db:reset` | Rolls back all migrations, migrates and seeds. Refuses `NODE_ENV=production` |
| `npm run db:migrate` / `db:rollback` / `db:seed` | Knex migrate/seed |
| `npm run db:review` | Lists legacy records the migrations could not map unambiguously |
| `npm run db:demo [-- --team "Name"]` | Development only: adds the demo players (and four teammates) without resetting |
| `npm run dev` | API (nodemon) and Vite dev server together |
| `npm test` | Mocha suite against `cs_trainer_test` |
| `npm run lint` | ESLint (server JS + client TS/React hooks) |
| `npm run typecheck` | `tsc --noEmit` for the client |
| `npm run build` | Type-checks and builds the client |
| `npm run check` | lint + typecheck + test + build (all passed together) |

**CI.** [.github/workflows/ci.yml](.github/workflows/ci.yml) runs on pull requests and on pushes to `main`, on Node 22 and 24, with a PostgreSQL 17 service container. It runs lint, typecheck, the test suite and the build, then migrates and seeds a fresh development database.

**Test database safety.** `spec/setup.js` and the seed both call [db/guard.js](db/guard.js). The guard refuses to reset any database unless `NODE_ENV=test` and the database name ends in `_test`. `db:reset` also refuses production.

## Architecture

```
app.js, listen.js        Express app factory (helmet, JSON, sessions, /api, static client in production)
config/env.js            .env loading and validated config
knexfile.js              committed Knex config (dev/test/production from env)
routes/ controllers/     legacy routers + auth, invites, game-sessions
services/                access checks, teams/invites, tactics, Game Mode
models/                  legacy list/filter queries (team-scoped)
validation/              zod schemas for every request body / param
db/migrations            3 original + 4 additive migrations
db/lib/legacy-backfill   shared, idempotent mapping of legacy data
db/seeds, db/data        deterministic dev/test data
client/                  React 19 + Vite + TypeScript SPA
spec/                    mocha + supertest
```

The client has pages for Home, Team, Invite, Tactics (library, view, editor) and Game Mode. Training and Schedule are not in the navigation; see the [roadmap](#roadmap).

- **Maps.** Radar images for Ancient, Anubis, Cache, Dust II, Inferno, Mirage and Nuke (Active Duty) and Overpass, Train and Vertigo (Reserve) are in [client/public/maps](client/public/maps). Provenance is in `SOURCES.md` and `manifest.json` there. The original *Practice Yard* schematic is still available.
  - Nuke, Train and Vertigo have an **Upper / main ↔ Lower** switch. Every marker and route records its `level`, and the board only draws the level being shown. The switch shows how many items are on each level.
  - Both layers share one coordinate frame. The viewer and Game Mode open on the level that holds your own items.
  - Moving a tactic to a single-level map moves lower items to main, after a confirmation.
- **Board.** An SVG with a 1000×1000 viewBox over the selected radar. Annotations are stored as 0–1 fractions of the map, so they stay aligned at any rendered size. The editor supports placing markers (player, smoke, flash, molotov, HE, note), dragging them, drawing routes and dragging route points. Markers can also be moved with the arrow keys or exact X/Y fields. Player instructions are edited in a plain form, so no drag gestures are needed.
- **Lineup screenshots.** Owners and IGLs can attach up to 4 PNG screenshots, each with an optional caption, to any smoke, flash, molotov, HE or note marker.
  - In the editor, select the marker and use *Add PNG*, or paste a screenshot straight from the clipboard.
  - Images upload as soon as they are added, are immutable, and are stored per team in PostgreSQL (`lineup_images`). Only members of that team can fetch them.
  - In Game Mode, each player's own lineups appear large under "Your instruction". Any utility marker with screenshots (shown by a camera badge) opens a full-screen viewer when clicked. Teammates' lineups for the phase sit in a collapsible list.
- **Game Mode.** The client polls `GET /api/teams/:id/game-session` every 2 s, or every 5 s when the tab is hidden. On failure it backs off up to 15 s and shows "Reconnecting…". It refetches when the tab regains focus or the browser comes back online. A "Second-screen view" button hides the app chrome. Leads can step phases with ← →.

## Security model

- **Authentication.** Passwords are hashed with bcryptjs (cost 12; 4 in tests). Sessions are server-side (express-session with connect-pg-simple, table `user_sessions`). The cookie `cst.sid` is `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Sessions are regenerated on sign-in and sign-up. Unknown emails and wrong passwords get the same response.
- **CSRF.** Uses the synchroniser-token pattern (`csrf-sync`). Every POST/PUT/PATCH/DELETE under `/api`, including sign-in, must send `X-CSRF-Token`. The token comes from `GET /api/auth/csrf` or `/api/auth/me`.
- **Rate limits.** Sign-in and sign-up allow 20 requests per 15 minutes per IP. The whole API allows 600 per minute per IP.
- **Authorisation.** The acting user always comes from the session. Every team-scoped read and write, including the legacy endpoints, checks membership on the server.
  - Resources in teams the caller is not in return **404**.
  - Actions that need more permission inside the caller's own team return **403**.
- **Permissions.** The **owner** (`teams.owner`) and members with **IGL access** (`team_memberships.is_igl`) can edit tactics, create and revoke invites, and run Game Mode. Only the owner can grant IGL access or remove players. A **player role** (entry, support, lurker, awper, anchor, rifler) is stored separately and grants nothing.
- **Validation.** zod checks IDs, enums (side, economy, map, marker kind, player role, invite TTL) and board payloads (coordinates in [0, 1], size limits, unique item IDs). Players named in assignments and board items must belong to the tactic's team.
- **Invites.** Tokens are 192-bit random values; only their SHA-256 is stored. Invites expire after 1 h, 24 h, 3 d or 7 d, can be limited to N uses, can be revoked, and are validated on the server inside a row-locked transaction.
- **Concurrency.**
  - Creating a team and its owner membership happens in one transaction, with the user row locked. Overlapping requests yield one team.
  - A partial unique index allows only one active Game Mode session per team. Overlapping starts give one `201` and `409 session_active` for the rest.
  - Phase changes are compare-and-set on `version`. The losing request gets `409 version_conflict` with the latest state, which the client applies.
  - Tactic saves carry `revision`. A stale save gets `409 stale_revision`.
- **Uploads.** Only PNGs are accepted. The server checks the signature and reads the dimensions without decoding the image. Limits: 8 MB, 8192 px per side, 1000 images per team. A tactic may only reference images belonging to its own team (`400 image_not_found`). Image responses are served with `Cache-Control: private` and their own `default-src 'none'` CSP.
- **Snapshots.** Starting Game Mode copies the tactic (phases, assignments, board, revision) into `game_sessions.snapshot`. Editing the saved tactic cannot change a running round.

## Data model and migration notes

The four new migrations only add things. The original tables, columns and IDs are kept.

| Migration | Adds |
| --- | --- |
| `…0100_add_auth_and_memberships` | `users.email` (unique, case-insensitive), `users.password_hash`, `user_sessions`, `team_memberships` (unique `(team_id, user_id)`, `is_igl`, `player_role`), `migration_review_items`, foreign keys `tactics.team_id → teams` and `users.team_id → teams` |
| `…0200_create_team_invites` | `team_invites` |
| `…0300_add_tactic_phases` | `tactics.map/side/revision/created_by/updated_by`, `tactic_phases` (ordered, with `board jsonb`), `phase_assignments` (unique per phase and player) |
| `…0400_create_game_sessions` | `game_sessions` with snapshot, version and the one-active-per-team index |
| `…0500_create_lineup_images` | `lineup_images` (PNG bytes, size, dimensions, SHA-256, team) |

Board items without a `level` (anything saved before map levels existed) are treated as `main`.

**How legacy data is mapped** ([db/lib/legacy-backfill.js](db/lib/legacy-backfill.js); the seeds go through the same code):

- **Memberships.**
  - A membership is created from `users.team_id` (when the team exists), from `teams.owner`, and from each entry in `teams.users[]`.
  - The legacy columns stay in place. `team_memberships` is now the source of truth.
  - `users.team_id` is kept as the user's *active team* pointer, and the app keeps it on one of the user's memberships.
- **Conflicts.**
  - A user listed in `teams.users[]` whose `users.team_id` points elsewhere gets a membership in **both** teams, flagged `conflicting_team_users_entry`.
  - Users in several teams are flagged `multiple_memberships`. The UI shows their active team and offers a team switcher.
  - Dangling references are flagged and skipped: `dangling_user_team`, `dangling_team_users_entry`, `dangling_tactic_team`.
- **Foreign keys** are added `NOT VALID`. New writes are enforced, and existing rows that would fail are reported rather than rejected.
- **Roles.** The legacy free-text `users.role` (e.g. "IGL") is **not** turned into a permission or a player role. Access has to be granted explicitly by the owner.
- **Tactics.**
  - `side` comes from the legacy `T`/`CT` booleans. Both true or both false is flagged `ambiguous_side` and left empty until edited.
  - Economy values outside Pistol/Eco/Force/Halfbuy/Fullbuy are kept and flagged `unknown_economy`.
  - Tactics without a team are flagged `tactic_without_team` and are not reachable through the API.
  - Utility counts are kept.
- **Steps to phases.**
  - Legacy `steps` become ordered phases named "Step N", one assignment per player.
  - Duplicate entries for the same player and step are joined (`duplicate_step`).
  - Steps for players who are not team members are not converted (`assignee_not_member`).
  - `ref_img` values that are not http(s) URLs are not converted (`reference_not_url`).
  - The original `steps` JSON is left untouched, and the legacy steps endpoints still read and write it.
- **Accounts.** Legacy users have no email or password, so they cannot sign in until a claim/reset flow exists. That flow is not in this milestone.
- **Leaving a team.** When a player leaves or is removed, their saved instructions stay in place. The editor marks them "no longer on the team" and drops them on the next save.

Run `npm run db:review` after migrating an existing database. On the seed data it reports, for example, that User B is in Teams A and B, plus several duplicate legacy steps.

## Intentional API changes

The full list is served at `GET /api` ([endpoints.js](endpoints.js)). Changes to existing behaviour:

- Every endpoint except `GET /api` and `/api/auth/*` now needs a signed-in session. Mutations also need the CSRF header.
- List and filter endpoints (`/api/teams…`, `/api/tactics…`, `/api/users…`) return only the caller's teams, those teams' tactics, and the caller plus teammates. A public team/player directory (the "Team Lookup" and "Player Lookup" designs) is deferred.
- Team responses build `users` from `team_memberships`.
- User responses never include `email` or `password_hash`. Users without a team are no longer dropped from user queries (the inner join became a left join).
- `POST /api/teams`:
  - The owner is always the caller; `body.owner` and `body.users` are ignored.
  - It is atomic with the owner membership.
  - It returns `409 already_in_team` if the caller already belongs to a team (one active team per user for this milestone).
- `PATCH/DELETE /api/teams/:id`: owner only.
- `PATCH /api/teams/:id/users/:user_id`: owner only. The acting owner comes from the session, not from `body.user_id`.
- `POST /api/tactics`: requires `team_id` for a team the caller leads, and validates the utility counts.
- `PATCH`/`DELETE` of tactics and steps: owner or IGL only. Steps may only name team members.
- `POST /api/users` now returns `410` with code `use_signup` (accounts come from `POST /api/auth/signup`).
- `PATCH/DELETE /api/users/:id`: only on yourself. `team_id` may only switch between teams you already belong to.
- `PATCH /api/users/:id/remove-team`: leaves the active team (the owner cannot).
- `sort_by`/`order` are whitelisted (`400` otherwise). Bad IDs return `400`. Errors have the shape `{ message, code }`.
- `GET /api/tactics/:id` gains `map`, `side` and `revision`.

The existing tests in [spec/index.spec.js](spec/index.spec.js) were updated to these semantics. Their coverage was kept.

## Design references

All seven README reference images were reachable and used: Home, Team (joined / not joined), Training, Schedule, Tactics and Game Mode.

- **Followed.** The dark shell, the top bar with username, the uppercase sidebar, the dark panels, the Team "Create a Team" form, the roster table, the Tactics board with a tool column, and the Saved Tactics list with side/economy filters.
- **Filled in.**
  - **Home** was blank in the reference. It now has a signed-out landing page and, for signed-in users, Team / Tactics / Game Mode cards, including a teamless state and a live-session link.
  - **Game Mode** was blank. It now has a big "Your instruction" card with an explicit no-instruction state, a phase stepper, the board with the viewer's own items highlighted, lead controls, a connection status, and a second-screen view.
- **Deviations.**
  - The CS silhouette logo is replaced by an original crosshair mark.
  - The radar-style map is replaced by an original schematic.
  - "Team Lookup" and "Player Lookup" are replaced by join-by-invite.
  - Roster stats (P/W/L/K/D/ADR/HS%) are omitted because there is no data source yet.
  - The reference's Settings and donation buttons are omitted.
  - Training and Schedule are hidden until they have a workflow.

## Verification

All commands were run on 2026-11-11 (Linux, Node 24.21, PostgreSQL 18.6):

| Command | Result |
| --- | --- |
| `npm test` | **93 passing**: legacy endpoints 43, auth 10, teams/invites/permissions 14, tactics 6, Game Mode 9, migrations 6, lineup images and map levels 5 |
| `npm run lint` | 0 problems |
| `npm run typecheck` | 0 errors |
| `npm run build` | built (≈374 kB JS, 118 kB gzip) |

Areas the automated suite covers:

- A user without a team can sign in, create a team, or join one.
- Non-members get 404 on another team's team, roster, tactics, tactic documents, users and Game Mode.
- Ordinary members get 403 when editing tactics or starting, advancing or ending a session; IGLs can do these.
- Invite expiry, revocation, use limits and unknown tokens.
- Tactic save and reload (phase order, assignments, exact board geometry), and stale-revision conflicts.
- Assignment validation (non-member assignees and board items, enums, coordinates, IDs).
- Game Mode:
  - refresh and reconnect (a new sign-in) resume the current phase;
  - snapshot isolation;
  - overlapping starts and phase changes;
  - the end-of-session state.
- The migration backfill on conflicting legacy data, rollback/re-apply, cookie flags, CSRF and rate limiting.

Lineup images and map levels: a follow-up manual check on the same day.

1. The owner created a Nuke tactic with the owner's marker on upper and a smoke for the teammate on lower.
2. A 1280×720 PNG was attached by pasting it into the lineup panel, then given a caption, and the tactic was saved.
3. In Game Mode the teammate's screen opened on the Lower level automatically, with the screenshot shown large under the instruction.
4. Clicking the smoke on the board opened the full-screen viewer.
5. Automated tests cover uploads (lead only, PNG only, size and dimension limits, CSRF), member-only fetching, rejecting images from another team, images on player markers, and lower-level items on single-level maps.

Manual end-to-end check: two signed-in browser sessions, `localhost` and `127.0.0.1`, with separate cookies.

1. The owner signed up and saw the teamless Home.
2. The owner created a team and generated an invite link.
3. The teammate opened the link while signed out, was sent to sign-up, came back to the invite and joined.
4. The owner built a two-phase tactic: player markers, smoke, a route, form-entered instructions, and a phase where only the owner had an instruction.
5. The owner saved and reopened it, then started Game Mode.
6. The teammate's tab picked up the session through polling and showed only the teammate's instruction.
7. The owner advanced a phase. The teammate reloaded, landed on phase 2 and saw "No instruction for you this phase".
8. With the API process stopped, the teammate's tab showed "Reconnecting…". After a restart it recovered by itself and followed the owner's return to phase 1.
9. Board alignment: marker centres measured at (0.7898, 0.1218) of the board at both 591 px and 668 px wide, which matches the stored coordinates.
10. Moving a marker by dragging and saving produced revision 2 with the new coordinates.
11. Ending the session showed "ended by Ollie" on both screens.
12. The teammate saw no Edit button, and `/tactics/:id/edit` was read-only for them.
13. A production build was served by Express with `NODE_ENV=production`: SPA fallback, CSP headers, and no `Secure` cookie issued over plain HTTP.

**Not verified:**

- Windows/macOS setup.
- Touch dragging on a real phone or tablet. Pointer events are used, but only mouse input was exercised.
- A real HTTPS deployment behind a proxy (cookie `Secure` and `TRUST_PROXY`).
- Screen-reader and keyboard-only audits beyond the arrow-key and form alternatives.
- Behaviour with many concurrent teams or under load.
- Browsers other than the Chromium-based preview.

## Roadmap

Each follow-on milestone stays out of primary navigation until it has a usable workflow.

1. **Training drills.** The team calendar shipped in Phase 2. What remains is a drill and lineup-reference library linked to tactic phases and board markers.
2. **Calendar extras.** Recurring practices, RSVPs and ICS export, building on the Phase 2 calendar.
3. **Steam sign-in.** An additional identity linked to an existing account. Scope: an OpenID 2.0 "link Steam" action for signed-in users, stored in a `user_identities` table that is unique per provider ID. Sign-in through a linked Steam identity comes after that. It never creates accounts implicitly or merges accounts automatically.
4. **Demo Review extras.** The demo library, 2D replay and live team review shipped in Phase 3. Next: grenade trajectories and smoke/molotov areas on the replay, linking rounds to tactics, and push updates (SSE) for live review instead of 1 s polling.
5. **Native overlay.** Evaluate separately after the browser Game Mode has been playtested. Consider anti-cheat and VAC policy, OS support, and whether a second-monitor page or a minimal always-on-top window is enough.

Other small follow-ups: cleanup of unused lineup images (uploads are kept even if a tactic edit is abandoned, so running sessions never lose an image), moving image storage to object storage if volume grows, deriving the utility counts from board markers, a password reset / legacy-account claim flow, ownership transfer, a resolve action for review items, more maps, a public team directory, and push updates (SSE) instead of polling.

## Phase 2

### What was added

- **Team management (owner).**
  - Edit team details and picture, change roster roles, and remove players (with a confirmation).
  - Delete the team, which requires typing its name.
  - Deleting a team cascades its tactics, lineup images, invites, join requests, calendar and Game Mode sessions, and moves every member's active team to another membership or clears it.
  - A removed player loses access straight away, because access is checked against membership on every request.
- **Roles.** Labels are Entry, Support, Lurker, AWPer, Anchor, Rifler and IGL. Stored values are unchanged (`entry`, `awper`, …) plus a new `igl`. Role badges have icons, for example a crosshair for AWPer.
- **IGL controls live play.**
  - `igl` is a roster role. A unique index allows at most one per team, and a check constraint keeps the legacy `is_igl` column equal to `player_role = 'igl'`.
  - Only the owner assigns or removes the IGL. Assigning it clears the previous IGL in the same transaction and bumps any running session's version, so every screen refreshes.
  - Game Mode commands check the role on every request, so the former IGL gets `403 not_igl` immediately.
  - The owner keeps team administration but controls live play only when they are the IGL.
  - Tactic editing and invite links stay with the owner or IGL, as before.
  - New teams start with their creator as IGL.
- **Profiles.** Use *Edit profile* on Home or click your name in the header.
  - Fields: language, region, platform, skill level, bio, and optional Steam, FACEIT, ESEA and HLTV links (https only, host checked on the server).
  - Profile picture: PNG, JPEG or WebP, up to 2 MB and 4096 px, with format checked from the file header. It can be replaced or removed, and initials are shown as a fallback.
- **Player invites.**
  - *Invite players* on the Team page lists players with no team, with their picture, language, region, platform and skill.
  - Clicking a name opens their profile, with bio and links.
  - The **Invite** buttons in the list and on the profile send the same player-specific invite (`POST /api/teams/:id/invites { user_id }`) and then show *Invite pending*.
  - Recipients review invites on **/invites** (from the bell or Home) and accept or decline. Accepting re-checks that they still have no team.
  - Invite links still work as before.
- **Recruiting.**
  - The owner turns recruiting on and sets leagues, roles needed and notes.
  - **Recruiting** in the sidebar lists recruiting teams with picture, language, region, platform, skill, leagues, roles needed and roster size (counted from memberships). Each team has a details page.
  - **Request invite** in the directory and on the details page sends the same request and then shows *Request pending*. Duplicate pending requests are rejected.
  - The owner reviews requests on the Team page (`/team#requests`), opens the player's profile, and either sends an invite or declines. A request never adds anyone to a team.
  - Discovery endpoints return only profile and recruiting fields. Tactics, calendars, invites and rosters keep their membership checks.
- **Game Mode matches.**
  - The IGL starts a match from a tactic; its map and side become the match's.
  - The IGL can step phases, browse that map and side's tactics (wrapping around), switch T/CT (an empty state appears when the side has no tactics), start a new round (the selected tactic's snapshot at phase 1, round number +1) and end the match.
  - Teammates, including a non-IGL owner, get a read-only view: round, current tactic and phase, their own instruction and lineups, "Up next", and who the IGL is.
  - Snapshots, polling, version checks and reconnect resume the right round, tactic and phase.
- **Shortcuts.** In **Settings** (bottom of the sidebar), each user can rebind previous/next phase, previous/next tactic, new round and switch side, or reset them.
  - Defaults: ← → [ ] N S.
  - Conflicts are flagged in the UI and rejected by the server.
  - Shortcuts only work on the focused Game Mode page, are ignored while typing or rebinding, and only act for the IGL. The Settings page explains this.
  - Game Mode buttons show the current bindings.
- **Training calendar.** **Training** (below Tactics) shows a month view with an upcoming list and event details.
  - The owner adds, edits and removes Training and Game events: title, date, start time, and optional opponent or notes.
  - Times are stored as UTC instants together with the IANA zone they were entered in, and are displayed in the viewer's zone, which is labelled.
  - Home shows the next event with a countdown. It refreshes every 30 s, on focus, and when the event starts, and says when nothing is scheduled.
- **Notifications.** A bell sits left of your name, with an unread count. It opens a modal listing notifications newest first, each with what happened, when, and a link; × dismisses one entry.
  - Created for: a player receiving an invite; the owner receiving a join request; calendar events created, updated or removed; a tactic being updated. The person who acted is not notified.
  - Read and dismissed state is stored per recipient.
  - Opening a link re-checks access and whether the target still exists. A cancelled event goes to the calendar with a cancellation message, and a deleted team falls back to Home.
  - `(user_id, dedupe_key)` is unique, so retried actions never duplicate notifications.
- **Sidebar.** Home, Team, Recruiting, Tactics, Training and Game Mode (red accent), with Settings pinned to the bottom.

### Migration (`20261112000100_phase_2.js`, additive)

New tables:
- `public_images` (profile pictures and team logos);
- `team_join_requests`;
- `team_events`;
- `notifications`.

New columns:
- `users`: avatar, profile links, `settings`;
- `teams`: logo and recruiting fields;
- `team_invites`: `invitee_user_id`, `response`, `responded_at`, `join_request_id`. `token_hash` is now nullable: exactly one of token or invitee is set;
- `game_sessions`: `map`, `side`, `selected_tactic_id`, `round_number`, backfilled from existing snapshots.

Role reconciliation:
- A member with legacy IGL access becomes `igl`.
- If several members had it, the earliest keeps it (`multiple_igls` review item).
- A team without one gets its owner as IGL when the owner has no other role. Otherwise `team_without_igl` is recorded and the owner should assign one.
- A role replaced by `igl` is recorded as `role_replaced_by_igl`.
- Unknown role values are cleared and recorded.

Saved tactics, map layers, lineup screenshots and legacy records are untouched. `npm run db:review` lists the review items.

On the maintainer's local database this applied cleanly. The 4 demo teammates were then added to the existing Test Team 1 with `npm run db:demo -- --team "Test Team 1"`. The owner keeps their Entry role and Juno became the IGL.

### Verification (2026-11-12)

| Command | Result |
| --- | --- |
| `npm run lint` | 0 problems |
| `npm run typecheck` | 0 errors |
| `npm test` | **109 passing**: legacy 43, auth 10, teams 15, tactics 6, Game Mode 9, images/levels 5, migrations 6, **phase 2: 15** |
| `npm run build` | built (430 kB JS, 134 kB gzip) |
| Fresh `db:reset` + `db:demo` on a temporary database | Test Team 1 = Test Owner (Rifler, owner), Juno (IGL), Vex, Morrow, Talon. 11 teamless players. Every seeded team has an IGL. Re-running `db:demo` changes nothing |

The phase 2 tests cover:
- owner-only actions;
- removal and deletion cascades;
- IGL transfer mid-session, where the old IGL gets 403, the new IGL advances, and others get the read-only view;
- tactic navigation within map and side, side switching with an empty state, new rounds and reconnect;
- profile link and picture validation;
- both invite entry points and pending state;
- accept, decline and eligibility re-check;
- both request entry points, pending and duplicate handling, owner approve and decline, and that a request never adds the player;
- the calendar and the next event after create, edit and delete;
- notification recipients, link resolution including a cancelled event, independent dismissal and dedupe;
- shortcut persistence, conflicts and reset.

Manual check with separate signed-in browser sessions (`owner.localhost`, `seeker.localhost`, `rhea.localhost`):

1. The owner turned recruiting on.
2. A teamless demo player requested an invite. *Request pending* showed on the directory and details pages, and the owner's bell linked to the request, which was declined.
3. A new player was invited from their profile page. *Invite pending* showed on the profile and in the list, the player accepted from the bell, and they left the teamless list.
4. The IGL started a match, used `]`, `N` and `→` from the keyboard, and the teammate's read-only view followed.
5. The owner transferred the IGL role mid-match. The owner's screen became read-only, and the new IGL's controls appeared through polling. The new IGL then used `←` and `S` (side switch with "Up next").
6. A calendar event was created, edited and removed, and the teammate's Home countdown followed each change.
7. Invite, calendar and tactic notifications reached the right people. The cancelled-event link showed its message, the tactic link opened the tactic, and a dismissed entry stayed gone after reload.
8. A shortcut was rebound to `D`; a conflict was flagged and Save disabled; the new key worked in Game Mode.
9. An existing Nuke tactic still showed its upper/lower layers and lineup screenshot.

**Not verified:**
- Uploading pictures through the browser's file picker. The picture endpoints are covered by API tests, but the picker can't be driven by automation.
- Touch devices.
- Clock and time-zone edge cases around daylight-saving changes.
- The browser automation tool could not send `]` by its key name, so I typed the literal key. That's a tool limitation, not the app.

## Phase 3

Built on `main` after Phase 2 (`f2a4599`). One additive migration, `20261113000100_phase_3.js`. Saved tactics, assignments, radar floors, lineup images and Game Mode snapshots load unchanged; boards without holds or slots get defaults when read.

Implementation order: migration and validation → board (carry-forward, icons, notes, holds, connectors) → sharing → Game Mode picker, notification panel, role colours → calendar → Demo Review stage A (parser probe, library, replay, annotations) → stage B (live review).

### What was added

- **Tactics board**
  - **Add phase** inserts a phase after the current one. Each player marker starts at the end of that player's last route in the previous phase (on that route's floor), otherwise where the marker was. Routes, utility, notes and holds start empty. Copies are independent, so editing an earlier phase never moves saved later phases.
  - **Utility icons**: the supplied PNGs (`smoke(1).png`, `flash.png`, `fire(1).png`, `explosion(1).png`, resized to 128 px in `client/public/icons/utility/`) are drawn on a light disc with a player-coloured ring, so they read over light and dark radar areas. Same rendering in the editor, viewer, shared preview and Game Mode.
  - **Notes** show their text on the board (no "i"). Text and size are edited in the inspector; the size box and its ▲/▼ buttons (or the up/down arrow keys) go from 12 to 64, default 22. Notes stay selectable and draggable.
  - **Hold** tool: press a player marker and drag to aim a cone. Handles adjust direction/reach and width; sliders and *Remove hold* are in the inspector. The cone is stored as `{ marker_id, angle, spread, length }`, so it follows its marker and floor at any board size.
  - **Utility connectors**: round dotted lines from a player's last route end (or marker) to each of their utility markers in the phase, drawn only when both ends are on the visible floor. Derived from coordinates, so they follow every move.
- **Sharing** (owner or IGL)
  - **Share** on a saved tactic opens a dialog listing what will and won't be published, with the exact JSON. Publishing stores a snapshot; later edits don't change it until *Update listing*. *Withdraw listing* removes it.
  - Snapshots contain no user ids, names, team identity or reference URLs. Players become stable **Player 1–5** slots across phases (markers, routes, holds, utility, instructions). Lineup screenshots are optional and copied into the listing under new ids, served from `/api/shared-tactics/:id/images/:image` only while the listing is active.
  - **Tactics → Browse shared**: filters, previews, net rating, and up/down votes. One vote per user per listing (primary key), changeable or removable; the score is always summed from votes; you can't vote on your own team's listing.
  - **Save to team** creates an independent copy (screenshots copied into the importing team's private library). The editor's **Map player slots** panel assigns slots to roster players across all phases; unmapped slots stay editable as "Player N".
- **Game Mode**: the IGL's dropdown lists the same tactics as the next/previous shortcuts, grouped by economy (Pistol, Eco, Force, Half buy, Full buy); shortcuts walk the same order. Choosing one queues it (`tactic_select`); *Start round* applies it at phase 1. The live tactic and a "Next: …" chip are shown separately. Teammates stay read-only.
- **Notifications** open in a panel anchored below the bell (positioned from the bell, kept inside the viewport and scrollable on narrow screens).
- **Role colours**: one colour per role (`ROLE_COLOR` in `client/src/lib/constants.ts`) used by every role badge, with labels kept.
- **Calendar**: new **Demo Review** event type, optionally linked to a demo in the team library. Event details and the Home countdown show **Open demo**. Linking another team's demo is rejected.
- **Demo Review** (sidebar, below Training)
  - **Library**: members upload `.dem` files (streamed to disk, `application/octet-stream`); states are queued → processing → ready or failed with a clear reason. Checks: CS2 signature (`PBDEMS2`; CS:GO demos are named as such), size limit, per-team limit, duplicate detection. Uploader, owner or IGL can retry failed demos or delete.
  - **Processing** runs outside the web request: a job runner in the server process claims queued demos (`FOR UPDATE SKIP LOCKED`) and parses each in a **child process** with a time limit, so the native, synchronous parser never blocks other users. Interrupted jobs are retried once on restart.
  - **Replay**: radar from the existing images, round strip, play/pause, speed, seekable timeline with kill/plant/defuse/explosion marks, player positions with view direction, floors on multi-level maps, scoreboard and event feed.
  - **Annotations**: drawings and text tied to a round and tick, shown from that moment on, listed with time and author, removable by their author (or owner/IGL), and kept after reload.
  - **Live review**: the current IGL starts a review; teammates get a notification and a banner to join. The server owns the state (demo, round, play/pause, speed and an anchor tick/time); clients derive the position from it, estimating the server clock from the lowest-latency of their last 8 polls (1 s). Late joiners and refreshes land on the same frame. Followers are read-only (they can switch to *Watch on my own*). IGL drawings are synced and *Clear round* removes them. Control is re-checked on every command, so an IGL transfer revokes it immediately. Reviews never touch Game Mode sessions.

### Demo parser

- **Parser**: [`@laihoe/demoparser2`](https://github.com/LaihoE/demoparser) **0.42.0** (MIT, pinned). It ships prebuilt N-API binaries for Linux x64/arm64 (glibc and musl), macOS and Windows, so it needs no compiler and works on Node 22 and 24 (the CI matrix). On an unsupported platform demos fail with `parser_unavailable` instead of crashing. Four platform builds the package lists (`darwin-universal`, `darwin-x64`, `freebsd-x64`, `win32-ia32-msvc`) were never published, which makes `npm ci` on npm 11 reject the lockfile. `overrides` in `package.json` points those names at the published Android/ARM build, which npm never installs on Linux, macOS or Windows, so the lockfile is complete. Intel Macs, FreeBSD and 32-bit Windows have no parser build and get `parser_unavailable`.
- **Coordinates**: `px = (x − pos_x) / scale`, `py = (pos_y − y) / scale` on the 1024 px radars, using CS Demo Manager's (MIT) values for the same radar images (`RADAR_TRANSFORMS` in `domain/constants.js`). Lower floor: Nuke below z −495, Vertigo below 11700 (CSDM values), Train below −50 (from the game's overview file).
- **Fixture tested**: `valve-de_mirage-472514809.dem` (84 MB, sha256 `2e0a4f9a…0506`) from the [awpy-fixtures](https://github.com/pnxenopoulos/awpy-fixtures) releases. It parsed in ~0.3 s: map `de_mirage`, 10 players, 13 rounds (13–0 including the side swap), 78 kills, 2 plants; ~97 KB of gzip replay data. Positions were plotted over the radar and follow the corridors. Not committed (size); run the real-demo test with `CS_DEMO_FIXTURE=/path/to/file.dem npm test`.
- **Limits**: no real Nuke/Vertigo/Train demo has been tested, so lower-floor placement is checked only with synthetic positions; grenades, smokes and fires aren't drawn; tick rate is assumed to be 64; maps outside the ten radars fail as `unsupported_map`.

### Running the demo workflow locally

```bash
npm install
npm run db:migrate
npm run dev
```

Open **Demo Review**, upload a CS2 `.dem` (for example from CS2's *Watch* tab), wait for **Ready**, and open it. For a live review, sign in as the team's IGL in one browser and as a teammate in another; the IGL presses **Start live review**. Optional settings (see `.env.example`): `DEMO_STORAGE_DIR` (default `storage/demos`, git-ignored), `DEMO_MAX_MB` (600), `DEMO_PARSE_TIMEOUT_S` (300), `DEMO_LIMIT_PER_TEAM` (50), `DEMO_WORKER=off` to run parsing elsewhere.

### Migration (`20261113000100_phase_3.js`, additive)

- `phase_assignments`: `user_id` nullable plus `slot` (1–5), one of them required; one slot per phase.
- New tables: `shared_tactics` (one active listing per tactic), `shared_tactic_images`, `shared_tactic_votes` (PK share+user, value ±1), `demos`, `demo_rounds` (gzip replay per round), `review_sessions` (one active per team), `demo_annotations`.
- `tactics.imported_from_share_id`; `team_events.demo_id` and the `demo_review` kind.
- Full `down`, which deletes slot-only instructions (they can't exist in the old schema).

### Verification (2026-11-12)

| Command | Result |
| --- | --- |
| `npm run lint` | 0 problems |
| `npm run typecheck` | 0 errors |
| `npm test` | **124 passing, 1 pending** (the real-demo test, skipped without `CS_DEMO_FIXTURE`; it passes with the Mirage fixture) |
| `npm run build` | built (482 kB JS, 150 kB gzip) |

New tests (`spec/phase3.spec.js`) cover board validation and defaults; snapshot privacy (no ids, names, team name, reference URLs or private image ids, including in the preview), snapshot immutability, votes and the database constraint, import, slot mapping and withdrawal; the economy-ordered picker and IGL-only `tactic_select`; Demo Review events; upload validation and team scoping; background processing, round data and failures; the real parser in a child process; annotations; live review control, late join, stale versions, clamping, clear and IGL transfer; the radar transform and round detection with a restored round.

Checked in the browser with separate signed-in sessions:
1. A Nuke tactic: Add phase put each player at their route end on the right floor; moving a player in phase 1 after creating phase 2 left phase 2 unchanged after save and reload.
2. Holds (drawn with the tool, widened by handle), sized multi-line notes, icons and connectors survived save and reload, and appeared in the viewer and Game Mode.
3. Another team browsed, upvoted, previewed (Player 1–3, copied screenshot, no private names, links or images) and imported the tactic, mapped Player 1 and saved; withdrawal blocked new previews and imports while the copy and its screenshot still loaded.
4. The IGL picked "Nuke eco rush" from the Eco group; the header kept the live tactic with a "Next:" chip; pressing N started it at phase 1 for the teammate, who had no controls.
5. The notification panel opened below the bell at 1300 px and 375 px wide.
6. A Demo Review event linked to the uploaded demo showed in the calendar and as the teammate's next event, and **Open demo** opened it.
7. The 84 MB Mirage demo uploaded through the page, processed in seconds, and replayed aligned to the radar; drawing and text annotations persisted.
8. Live review (Juno as IGL, Vex following): Vex joined late and after a refresh landed on the IGL's round and exact tick; paused and end-of-round positions matched the server; a live drawing appeared for Vex and *Clear round* removed it; Vex got 404 for another team's demo, rounds, annotations and review.

Fixed during these checks: hard-to-grab hold handles, faint connectors, a live-review client showing the play-start position after the round ended, and a follower clock estimate stuck on a sample taken while its tab was hidden.

**Not verified:**
- Smooth playback drift while playing in the follower's view after the clock fix: the browser pane was hidden, which pauses animation, so only the per-poll sync check ("In sync") and paused/end positions were confirmed.
- Lower-floor placement with a real Nuke, Vertigo or Train demo.
- Network-drop reconnect (only refresh and late join were exercised; reconnect uses the same polling path with backoff).
- Touch drawing on the replay and dragging hold handles on touch devices.

## Contact

Daniel Caddick, caddickdaniel93@gmail.com
Project link: https://github.com/caddickdaniel/cs-trainer
