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
| Team owner (not IGL) | `test-owner@cs-trainer.test` (Test Owner) | Owns **Practice Roster**; can manage and delete the team but cannot control live play |
| IGL | `test-igl@cs-trainer.test` (Sable) | Practice Roster's IGL; controls Game Mode and live Demo Review |
| Ordinary players | `test-blitz@`, `test-wren@`, `test-onyx@cs-trainer.test` | Entry, Support and Lurker on Practice Roster (read-only Game Mode) |
| Teamless recruits | 16 `demo-*@cs-trainer.test` accounts (Kestrel, Mateo, Hana, Liam, Sofia, Noah, Priya, Yusuf, Emma, Chen, Amira, Oskar, Lucia, Dmitri, Grace, Tomás) | Varied languages and regions; all three ranks, partial ranks, no rank, and one legacy-only entry (Chen, "Perfect World") |
| Recruiting teams | `demo-owner-lights@`, `-pride@`, `-pampas@`, `-circuit@cs-trainer.test` | Owners of Northern Lights, Lion Pride, Pampas Five and Iron Circuit: several platform rank requirements each, leagues and matchmaking selected |
| Legacy sample data | `user-a@` … `user-m@cs-trainer.test` | User A owns *Team A* (demo tactic *A Split (demo)*); User M has no team |

The fixtures are in [db/data/demo.js](db/data/demo.js); ranks use the current model (one optional Premier, FACEIT and ESEA rank each).

**Refreshing the demo data without a reset** (development only):

```sh
npm run db:migrate   # apply new migrations; existing data is kept
npm run db:demo      # add or refresh recruits, Practice Roster, recruiting teams and the 30 shared tactics
```

`db:demo` matches accounts by email and teams by name and owner. It refreshes seeded profile fields, ranks and recruitment settings, and adds anything missing. It never deletes users, teams, tactics, demos, votes or memberships, and never moves a fixture player who has since joined another team (it logs a note instead). Re-running it changes nothing. The old `--team` option was removed; the test roster is its own team.

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
| `npm run db:demo` | Development only: adds or refreshes the demo data (recruits, Practice Roster, recruiting teams, shared tactics) without resetting or deleting |
| `npm run demos:reprocess [-- --all \| <ids>]` | Re-parses ready demos for the current replay data (recorded utility); keeps annotations |
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
3. **Automatic Valve matchmaking import.** Blocked on replay retrieval (see Phase 4, "Provider limitations").
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
  - Defaults (Phase 5): ← → for phases, ↑ ↓ for tactics, Home for a new round, End to switch side (previously ← → [ ] N S).
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

## Phase 4

Built on `main` after Phase 3 (`4c220de`). One additive migration, `20261114000100_phase_4.js`. The stats importer reuses the Demo Review parser and background worker.

### What was added

- **Profile options and ranks**
  - One catalogue (`domain/catalogue.js`, served at `GET /api/catalogue`) drives the profile editor, player search, validation and badges.
  - **Language** and **Region** are searchable dropdowns: typing filters immediately (prefix matches first); ↑/↓, Home/End, Enter and Escape work. Player search on the Team page uses the same component and options.
  - **Platform** (Premier, FACEIT, ESEA) and a dependent **Skill** list that shows only that platform's ranks. Changing platform clears an incompatible rank. The server rejects a rank from another platform.
  - Bands are inclusive and each value maps to exactly one band (tested exhaustively from 0 to 35,000). FACEIT 3,000 is in 2,751–3,000; 3,001 is in 3,001+. Premier colours change at 5,000, 10,000, 15,000, 20,000, 25,000 and 30,000.
  - FACEIT Challenger can be selected as a self-reported rank. It is never derived from Elo, and nothing shows a verified Challenger badge (no leaderboard data).
  - All profile ranks are labelled **self-reported**. Provider ratings (FACEIT Elo) appear separately in Player Stats, labelled with their source.
  - **Badges are original SVGs** in each platform's colours, always with a text label. No official artwork is used, because its reuse terms weren't confirmed.
  - **Legacy values:** existing free text is kept. The migration fills in a rank only where the text maps confidently (e.g. "FACEIT 7", "Premier 18,250", "ESEA B+"). "FACEIT 10" stays legacy because it could be any of five Level 10 bands. Unmapped text shows in italics with a note in the editor and is replaced the next time the player picks a platform and rank.
- **Steam sign-up, sign-in and linking**
  - **Continue with Steam** on sign-in and sign-up, and **Link Steam** in Settings, using Steam's OpenID 2.0 website sign-in.
  - Every callback is checked: session state, return URL, endpoint, claimed ID format, signed fields and nonce age. It is then verified server-side with Steam (`check_authentication`), and each nonce is accepted only once.
  - The verified SteamID64 is stored as a string in `user_identities`, unique per provider and per user, with a format check.
  - A linked Steam ID signs in to its account. An unlinked one can create a Steam-backed account (no email or password needed), or the player can sign in with their password and then explicitly link it. Accounts are never merged automatically.
  - A Steam ID linked elsewhere gets a clear message and recovery path, and linking it never moves it between accounts.
  - Unlinking is refused while Steam is the only sign-in method. Steam-only players can add an email and password in Settings.
  - **Prefill:** the editable Steam profile URL (separate from the verified ID) can be filled in from Steam. The name and avatar can be too when `STEAM_WEB_API_KEY` is set. Only empty fields are filled.
  - Match tracking is a separate, explicit opt-in.
- **Player Stats** on Home (below the four cards) and on player profiles
  - Shows matches tracked, win rate, K/D, ADR, headshot %, and the 10 most recent results with source, sample size and last-updated time.
  - Private by default. Players can opt in to show aggregate stats on their profile. Profile stats never include demo IDs, replay links, team data or annotations, and private demos still return 404 to non-members.
  - Players without data see the ways to start: link Steam, turn on tracking, upload a demo, or connect FACEIT.
  - Sources are shown **separately** and never summed, so a match imported from both a demo and FACEIT can't be counted twice. Demos from FACEIT keep the FACEIT match ID from their file name for reconciliation.

### Metric definitions

| Metric | Definition | Edge cases |
| --- | --- | --- |
| Matches tracked | Matches containing the player's verified SteamID64 (per source) | — |
| Win rate | wins ÷ (wins + losses); draws excluded | "—" with no decided matches |
| K/D | kills ÷ deaths | 0 deaths: shown as the kill count, flagged "no deaths" |
| ADR | damage ÷ rounds played, over matches that report damage | "—" if none; shows "from N of M matches" when partial |
| HS% | headshot kills ÷ kills, over matches that report headshots | "—" with 0 kills |

From demos (only events inside detected rounds count, so warmup is excluded):
- **Kills:** enemy kills only; team kills and suicides are excluded.
- **Deaths:** every death, including suicides.
- **Assists:** kill assists; flash-only assists are excluded.
- **Damage:** health removed from enemies, capped at the victim's remaining health; team and self damage are excluded.
- **Result:** from the final team score, with teams tracked across the side swap.

Each match is keyed by a fingerprint of the map, the players' SteamIDs and each round's result, so uploading it again, or another team uploading its own recording, updates the same match instead of adding one. Demos processed before Phase 4 are re-parsed once in the background.

### Sources and provider limitations

- **Uploaded demos: working.**
  - Checked against awpy-fixtures' ground truth (from csstats.gg) for `valve-de_mirage-472514809.dem`.
  - **organner.pl free trial** matches exactly: 27 kills, 1 death, 2 assists, ADR 183.2, 41% headshots, win.
  - **bargota22** matches on kills, deaths, assists and headshot % (4/13/0, 25%), but ADR is **37.7 against 34.7**. That is 39 health points over 13 rounds; every hit is capped at the victim's remaining health and none falls after a round ended. This is an open discrepancy.
- **FACEIT: implemented, not verified live.**
  - Uses the official Data API v4 with a server-side `FACEIT_API_KEY`. The FACEIT account is found from the verified SteamID64 (`game_player_id`), so nobody can attach someone else's FACEIT stats.
  - Sync imports the last 30 matches keyed by FACEIT match ID (re-syncs don't duplicate) plus Elo and level. It is limited to once every 10 minutes. On HTTP 429 it waits for the provider's Retry-After time and shows when to retry. A missing key, unknown player and API errors each have a clear message. Disconnecting removes the FACEIT matches.
  - **No API key was available, so this was tested only against a local mock of the API.** The per-match field names (`Kills`, `ADR`, `Result`, …) follow FACEIT's stats labels but are unconfirmed. Missing fields stay empty rather than guessed.
- **Valve automatic import: not shipped (blocker).**
  - Finding new matches (`ICSGOPlayers_730/GetNextMatchSharingCode` with a Steam Web API key, the player's Game Authentication Code and a known share code) is a Web API call.
  - **Getting the replay is not.** A share code decodes to match ID, outcome ID and token. The demo URL comes only from the CS2 Game Coordinator (`MatchListRequestFullGameInfo`), which needs a logged-in Steam game client (a bot account), not the Web API. Valve replays also expire after a few weeks.
  - No Web API key, bot account, auth code or recent share code was available, so neither step could be verified. No authentication codes are collected or stored. Settings says this path isn't available yet and points players to uploading Premier demos.
- **Steam sign-in: not completed against real Steam.**
  - The dev redirect to `https://steamcommunity.com/openid/login` was checked: correct `return_to` and `realm` for the browser's host.
  - The full round trip (verification, replay, forged, expired and cross-session callbacks, linking, takeover attempts) is tested against a local server that mimics Steam's `check_authentication` endpoint.
  - Completing it against real Steam needs a person to sign in on Steam.

### Migration and configuration

```bash
npm install
npm run db:migrate
```

- Migration `20261114000100_phase_4.js` adds:
  - `users.rank_platform` and `users.rank_id`, with checks;
  - the tables `user_identities`, `openid_nonces`, `matches`, `match_players`, `demo_matches` and `provider_accounts`;
  - `demos.stats_version`.

  Legacy columns are kept, and it has a full `down`.
- On the maintainer's database: 14 profiles now have a catalogue rank and 12 keep legacy text (mostly "FACEIT 10"). Languages and regions were normalised only on exact matches, so values such as "EU" and "NA" remain as legacy text.
- Configuration (see `.env.example`):

  | Variable | Purpose |
  | --- | --- |
  | `APP_ORIGIN` | Public URL. **Required in production** for Steam sign-in; development uses localhost hosts. |
  | `STEAM_WEB_API_KEY` | Optional. Steam name and avatar prefill. |
  | `FACEIT_API_KEY` | Optional. FACEIT source. |
  | `STEAM_OPENID_ENDPOINT`, `STEAM_API_BASE`, `FACEIT_API_BASE` | Override for testing only. |

### Verification (2026-11-12)

| Command | Result |
| --- | --- |
| `npm run lint` | 0 problems |
| `npm run typecheck` | 0 errors |
| `npm test` | **135 passing, 2 pending.** The pending tests need the real demo; with `CS_DEMO_FIXTURE` both pass (137). |
| `npm run build` | built |

`spec/phase4.spec.js` covers:
- every rank band boundary, plus an exhaustive check that no value falls into two bands;
- legacy mapping;
- profile validation and keeping legacy values;
- search filters;
- Steam account creation, signing in again, linking, a takeover attempt, the database uniqueness constraint, linking a pending identity after password sign-in, and unverified, replayed, forged, expired and cross-session callbacks;
- unlink protection;
- demo stats: opt-in, idempotent re-import, profile visibility, no demo leakage, empty history and backfill;
- FACEIT against a mock: connect from the Steam ID, idempotent sync, partial ADR, rate limit, disconnect, missing key and unknown player;
- real-demo stats against the published figures.

Manual checks in signed-in browser sessions (test accounts Juno, Vex and Kestrel):
1. In Edit profile, typing "nor" filtered the regions and ↓ then Enter picked "North America Central". Switching FACEIT → Premier cleared the rank and listed only the Premier bands. Premier 30,000+ was saved and reloaded with its gold badge.
2. In the Team page's player search, Premier listed Hana and Noah, and 20,000–22,499 narrowed it to Hana. Typing "ger" in Language and pressing Enter left only Noah.
3. The Mirage demo uploaded by two teams resolved to **one** match. With Juno temporarily linked to the demo's top player (local test data, removed afterwards), Home showed 1 match, 100% win rate, K/D 27.00, ADR 183.2 and 41% headshots. Vex saw the same aggregates on Juno's profile, with no demo links, and got 404 for the other team's demo.
4. Settings showed sign-in methods, the tracking opt-in, "FACEIT isn't available on this server yet" and the Valve status. The sign-in page's Steam link redirected to Steam's OpenID endpoint with the right return URL.

## Phase 5

### What was added

- **Profiles, teams and recruitment.** Players keep one optional self-reported rank per platform (Premier, FACEIT, ESEA); editing one never touches the others. Create Team, Edit Team, Edit Profile and the player search use the same searchable Language and Region lists. Player search has a column and a rank filter per platform (all active filters must match; blank = not entered). Recruiting teams set up to one requirement per platform, either an exact band or a range, shown on the listing and team page. Leagues and matchmaking (grouped: ESEA League (on FACEIT), UKIC League; Premier, FACEIT Matchmaking, ESEA Matchmaking (legacy)) are a searchable multi-select from `domain/catalogue.js` (`COMPETITIONS`; add entries there, never rename ids).
- **Shared tactic voting.** Voting already worked for other accounts (+1, switching −2, clearing reverses, persisted). The arrows that "did nothing" were the publisher's: the API refuses votes from the publishing team, and the page showed disabled arrows with no reason. The creator now sees the score with "Your team shared this, so you can't vote on it." Failed votes show "Vote not saved: …".
- **30 development shared tactics** (`db/lib/sharedTactics.js`): three for every side × economy across seven maps, 2–3 phases, all five slots positioned and instructed every phase, routes, utility matching each slot's buy list, the bomb (Player 3) on T and kits on CT. Published by a dev-only "Community Library" team. `npm run db:demo` (and the development seed) creates them once and refreshes them afterwards without duplicating listings or touching votes and imports.
- **Board layout.** Boards are sized to the window height on desktop (`useFitToViewport`), the editor puts tools, floor switch and legend in a rail beside the board, the inspector is narrower, and long sections scroll inside their column. Below 1100 px the layout stacks.
- **Map landmarks.** CT/T spawn icons and A/B bombsite markers are part of the radar background layer (`client/src/lib/landmarks.ts`, radar coordinates, per floor), so every view that draws the radar shows them and they never take clicks.
- **Per-player buy lists.** The team-wide counters are replaced by a buy list per player under Player Instructions (CS2 carry limits), a defuse kit on CT, and the bomb carrier on T (badge on their marker and in their instructions). Assigned utility markers are the planned throws; a marker can be marked "Reference only". Each throw is counted once (a marker kept in later phases by id is not counted again). What a player has at the start of a phase is derived from the buy list and earlier phases (`domain/utility.js`, mirrored in `client/src/lib/utility.ts`), so going back, refreshing or reconnecting gives the same counts. Over-planned utility is flagged in the editor and Game Mode. Buy lists and the bomb travel through Player 1–5 slots when sharing/importing and are copied into the Game Mode round snapshot.
- **Shortcuts.** New defaults (see Phase 2) for new users and Reset to defaults. Saved bindings are kept; if a new default clashes with a key a player already saved for another action, that action keeps its previous default. Handled keys never scroll the page; keys are ignored while typing, rebinding, in dropdowns/listboxes or modals, and on held-down repeats. The shortcut editor is on the right of Settings on desktop.
- **Demo Review.** Utility annotations (Smoke, Flash, HE, Molotov) saved with round, tick and floor; change type, move and remove them solo or, as the IGL, live (followers see each change). Match share code import (below).

### HLTV demo failure (`spirit-vs-g2-m3-ancient.dem`)

- Reproduced through the normal upload: the 253 MB file uploaded completely (under the 600 MB limit, valid `PBDEMS2` header) and the job failed within ~60 ms with `InvalidArg` / `EntityNotFound`.
- Cause: the demo was recorded by **CS2 build 14197** (network protocol 14197, the 11 November 2026 update), which changed how 8-bit fields are encoded. `@laihoe/demoparser2` 0.42.0 misreads every entity after that, so `parseEvents` fails on any event (the Nuke map of the same series fails with `IllegalPathOp`). Demos from older builds (14169) still parsed.
- Fix: upstream fixed it in 0.42.2 (LaihoE/demoparser#375). The 0.42.2 platform binaries are on npm but the wrapper package was not re-released, so `package.json` `overrides` pin the platform packages to 0.42.2 (darwin-x64 and others without a 0.42.2 build keep the stub). Drop the overrides once `@laihoe/demoparser2` 0.42.2+ is published.
- Parser errors after a readable header now say the demo is from a newer CS2 build than the parser supports, with the protocol and parser version. Re-uploading a demo that failed retries the existing import instead of reporting a duplicate.
- After the fix the original file imported through the UI in ~2 s: Ancient, 18 rounds, G2 13–5, playable replay. All three maps of the series parse. The 253 MB file is not committed.

### Match share codes

- `POST /api/teams/:team_id/demos/share-code { share_code }` validates and decodes the code (`services/shareCode.js`: match ID, outcome ID, token) and reuses an existing import of the same match.
- The replay URL only comes from Valve's Game Coordinator through a logged-in game client, so retrieval goes through a configurable **replay provider** (`MATCH_REPLAY_PROVIDER_URL`, optional `MATCH_REPLAY_PROVIDER_TOKEN`; contract in `services/replayProvider.js`). The returned URL must be on an allowed host (`MATCH_REPLAY_HOSTS`, default `replay*.valve.net`). The job downloads and bunzips it in a child process (`workers/demo-fetch-child.js`) with the size limit and signature check, then parses it like an upload.
- Messages: invalid code (400), no provider configured (503), replay expired/unknown, provider errors, non-Valve download address, and the usual parser errors.
- **Verified with mocks only**: no provider or bot account is available, so the provider and replay server are local fakes in `spec/phase5.spec.js`. Code decoding is checked against a published example.

### Migrations and commands

- `20261115000100_phase_5_ranks.js`: `users.premier_rank/faceit_rank/esea_rank` (filled from Phase 4's rank; a platform chosen without a rank, and unmappable text such as "FACEIT 10", stay as legacy text for the player to review or remove), `teams.rank_requirements` (filled only when the legacy platform/skill maps to one band) and `teams.competitions` (legacy `recruiting_leagues` text kept until the owner edits competitions). `rank_platform/rank_id` and legacy text columns are kept.
- `20261115000200_phase_5_loadouts.js`: `tactics.loadouts` and `tactics.bomb_carrier`; buy lists are filled for existing tactics only from utility markers already assigned to players. Legacy grenade/molly/flash/smoke totals are unchanged. Adds the `utility` annotation kind.
- `20261115000300_phase_5_share_codes.js`: `demos.source`, `share_code`, `valve_match_id` (unique per team).
- Run `npm install` (parser override, `unbzip2-stream`), `npm run db:migrate`, then `npm run db:demo` for the 30 shared tactics.

### Map landmark sources

Superseded in Phase 6: every landmark that has an outline on its radar is now centred in that outline (see "Radar landmarks" under Phase 6).

## Phase 6

### What was added

- **Team page.** Owners get **Delete team** next to **Edit details**. It opens a dialog that names the team, lists what is deleted (tactics, lineups, calendar, community listings, demos and reviews, invites, Game Mode history) and only enables the final button once the owner types `DELETE`. The server's owner check and the existing deletion flow are unchanged.
- **Invite Players.** Shorter rank cells: Premier shows the badge and the band (`20,000–22,499`), FACEIT and ESEA show the badge and the platform name. Each badge's accessible label is the full rank ("FACEIT Level 7").
- **Radar landmarks** (`client/src/lib/landmarks.ts`, used by every radar view). A/B are centred in the orange bombsite outlines and T/CT in the green spawn outlines, measured from the radar PNGs and checked by eye on every layer. Nuke's B is on the lower radar; Vertigo's T spawn is on the lower radar. The Overpass and Train radars have no outlines, so their four landmarks stay placed from the map layout (superseded in Phase 7 by supplied coordinates for Overpass A/B/T/CT and Train A/B/CT).
- **Tactic editor.**
  - Layout: tool rail | square board | draggable divider | right-hand pane. The board takes the largest square that fits the window, and dragging the divider (or arrow keys on it; double-click resets) shrinks it to give Player Instructions more room. Minimum widths are 320 px (board) and 340 px (pane). The split is remembered per browser, and pointer accuracy is unaffected. Below 1101 px the layout stacks.
  - The Utility and Reference URL text boxes are gone. Values saved by older versions are shown read-only, kept on save, and can be removed.
  - Utility labels are capitalised (Smoke, Flash, Molotov, HE).
  - The toolbar has icons for every tool; the grenade tools reuse the supplied utility symbols.
  - The bomb badge is half its old size, just right of the carrier's marker, and moves and scales with it.
- **In-game player colours.** Each player (or Player 1–5 slot) can have Orange `#eda338`, Green `#109856`, Blue `#68a3e5`, Yellow `#e6f13d` or Purple `#803ca1`. Each colour is used once; picking a taken colour swaps it, and "Assign in-game colours" fills the rest. Colours are stored on the tactic (`tactics.player_colors`) and used by the editor, viewer, shared listings and Game Mode. They travel through Player 1–5 slots when sharing and importing, and mapping a slot gives its colour to the player. Tactics without colours use the previous derived colours.
- **Game Mode.**
  - The IGL's controls and shortcut hints are in a compact left-hand pane, with the radar sized to the window in the middle and the player's call and lineups on the right. At 1920×1080 the pane, a 771 px radar and the lineups are visible together without scrolling.
  - Teammates get the radar and their call only (read-only).
- **Desktop app for the IGL** (`desktop/`, Electron, Windows-first). See "Windows desktop app" below.
- **Demo Review: recorded events.** The parser now extracts smokes (with when they cleared), flashes, HEs, molotovs/incendiaries (with when they burned out), plants, defusals and explosions, with tick, round, thrower and position.
  - The replay draws them at the right moment with a dashed edge in the thrower's side colour. Manual annotations stay solid yellow, and a legend explains the difference.
  - The timeline has a second row for utility, and the event feed lists each one.
  - What's shown is computed from the current tick alone, so seeking, rewinding, switching rounds and live followers always match.
  - A "Recorded utility" toggle hides the recorded layer.
- **Development data** (`db/data/demo.js`, `db/lib/demo.js`): 16 teamless recruits, the five-player **Practice Roster** (owner, IGL, three players) and four recruiting teams. See "Development accounts" above.

### What the demo parser supplies

From `spirit-vs-g2-m3-ancient.dem` (demoparser2 0.42.2, CS2 build 14197):
- **Grenade events.** `smokegrenade_detonate` / `smokegrenade_expired`, `flashbang_detonate`, `hegrenade_detonate` and `inferno_startburn` / `inferno_expire` carry the grenade's own `x/y/z`, the thrower (`user_steamid`, `user_X/Y/Z` at that moment) and an `entityid` that links a smoke or fire to its end.
- **Molotov vs incendiary.** CS2 only reports an "inferno", so the thrower's side decides the label (T = molotov, CT = incendiary).
- **Bomb events.** `bomb_planted` and `bomb_defused` give the planter's or defuser's position. `bomb_exploded`'s "user" is just whoever the event names and is not where the bomb was, so the explosion is drawn at the plant position. If there is no plant in the round it shows on the timeline only.
- **No expiry event.** A smoke or fire with no expiry event (the round ended first) is cut off at the round's end, or after 22 s / 7 s if that comes first.
- **Counts for the 18 rounds.** 116 smokes, 115 flashes, 69 HEs, 91 fires, 9 plants, 1 defusal and 2 explosions, all with positions.

### Migrations and commands

```sh
npm install
npm run db:migrate          # 20261116000100_phase_6_player_colors, 20261116000200_phase_6_replay_version
npm run db:demo             # new development fixtures (non-destructive)
npm run demos:reprocess     # optional: upgrade existing demos now instead of in the background
```

- `tactics.player_colors` (jsonb, default `[]`) is additive.
- `demos.replay_version` starts at 1 for existing demos. The demo worker re-parses ready demos below version 2 in the background, one at a time, and replaces each round's data in place by round number. Annotations and reviews reference the demo and round number, so they are kept.
- `npm run demos:reprocess` does the same immediately (`-- --all` forces every demo, `-- 4 7` specific ids). It prints how many annotations each demo kept. The demo file must still be in `DEMO_STORAGE_DIR`.
- The 253 MB HLTV demo is not in the repository. `DEMO_FIXTURE=/path/to/spirit-vs-g2-m3-ancient.dem npm test` runs the extra regression test against it.

### Windows desktop app

The IGL runs CS Trainer in the desktop app on a second monitor. Teammates keep using a normal browser.
- **Sign-in.** The app loads the normal web app (`CS_TRAINER_URL`, default `http://localhost:5173`), so sign-in, the API and the Game Mode screen are the same as in a browser.
- **Hotkeys.** Global hotkeys are registered in the Electron main process with `globalShortcut` and sent to the page. The page runs exactly the same commands as the buttons, including the version check and the server's IGL check. Queuing a tactic (previous/next tactic) never starts a round; only "Start new round" does.
- **Narrow bridge.** The page can only get, set, enable and disable the six bindings and receive the pressed action (`desktop/src/preload.js`). IPC from any other origin is refused, and navigation away from CS Trainer is blocked.
- **When hotkeys are active.**
  - They are registered only while the current IGL has Game Mode open and has pressed **Turn on hotkeys**. The pane shows Active or Off with a one-click **Turn off hotkeys**.
  - They are removed when the IGL leaves Game Mode, signs out, loses IGL control (seen on the next 2 s poll), when the page reloads or crashes, and when the app exits.
- **Bindings.**
  - Separate from the browser shortcuts and stored in the app's user-data folder (`hotkeys.json`).
  - Defaults: Ctrl+Alt+← / → (phase), Ctrl+Alt+↑ / ↓ (tactic), Ctrl+Alt+Home (new round), Ctrl+Alt+End (switch side).
  - Lone letters, digits and arrows are refused (they would fire while playing). F-keys and the number pad are allowed alone.
  - A combination the system refuses (for example one already used by an overlay) is reported next to that action with a prompt to choose another.
- **No double handling.** While the app holds a key globally, the page ignores the same key, so one press never runs a command twice.
- **Never activates the window.** A hotkey never focuses or raises the window and sends nothing to CS2. `backgroundThrottling` is off, so the second-monitor view keeps updating while CS2 has focus.

Run and package (on Windows, from `desktop/`, separate from the web app's install):

```sh
cd desktop
npm install
set CS_TRAINER_URL=https://your-cs-trainer-host   # or leave unset for http://localhost:5173
npm start                                          # run
npm run dist                                       # NSIS installer + portable .exe in desktop/dist
```

`npm run pack` builds an unpacked app for a quick check.

### Verification (2026-11-13)

- `npm run check`: lint and type checks clean, **159 passing, 3 pending** (the DEMO_FIXTURE test is pending without the file), build OK. With `DEMO_FIXTURE` set the real-demo test passes.
- **Browser checks.** Separate signed-in sessions on `owner.`, `sable.` and `blitz.localhost:5173` covered:
  - **Delete dialog.** The owner sees the dialog; lowercase `delete` keeps it disabled, `DELETE` enables it; it was cancelled, so the roster was kept. The IGL doesn't see the button.
  - **Invite Players.** The formatting and accessible labels are as described above.
  - **Editor.** The split fits at 1440×900 (board 633 px, ends at 872 px). Dragging the divider shrank the board to 453 px and a click landed exactly where the marker was drawn.
  - **Colours and bomb badge.** Assignment, swapping, save, viewer, slot mapping and Game Mode colours all worked. The bomb badge is 9×10 px against an 18×20 px badge before, level with the marker and 1 px overlap.
  - **Live Game Mode.** Next phase from the IGL pane updated the teammate's browser.
  - **Live Demo Review.** The IGL leads and the follower sees the same smokes and fires at the same tick. Rewinding cleared them. Round 5 showed plant, then explosion, on both screens.
- **Desktop app on Linux.** Electron 44 ran under XWayland on this Linux desktop (a stand-in, not Windows) against the dev server:
  - Sign-in through the normal form worked, and the bridge exposed only its six functions.
  - **Turn on hotkeys** registered all six with the OS (`globalShortcut.isRegistered` false before, true after).
  - Sending the hotkey action from the main process (exactly what the shortcut callback does) advanced the IGL's view and the teammate's browser. Previous phase, next tactic (queue only), switch side both ways and new round all worked.
  - A combination already held by another registration was reported on that action, and rebinding fixed it.
  - Leaving Game Mode, and then losing IGL control mid-session, both unregistered everything, and a stray hotkey after losing control did nothing.
  - **Not verified here.** A real key press from the OS: XTest presses on this Wayland desktop don't reach X11 key grabs.
- **Not run: CS2.** CS2 is not installed in this environment.

**Outstanding Windows test (with CS2 running).** On Windows 10/11, with CS2 in the foreground on monitor 1 and the desktop app (Practice Roster IGL, Sable) in Game Mode on monitor 2, and a teammate (Blitz) in a browser:
1. Turn on hotkeys.
2. Press Ctrl+Alt+→ while CS2 has focus. Check that:
   - the second-monitor view and the teammate's browser move to the next phase;
   - CS2 keeps focus and receives no input;
   - the desktop window is not raised.
3. Repeat for:
   - Ctrl+Alt+← (previous phase);
   - Ctrl+Alt+↑ / ↓ (queue changes, round number unchanged);
   - Ctrl+Alt+End (side switches);
   - Ctrl+Alt+Home (round number goes up, phase 1).
4. Bind an action to a combination another app already holds (for example the Steam overlay's Shift+Tab, or a Game Bar shortcut). Check that it's reported and can be rebound.
5. Leave Game Mode, then press Ctrl+Alt+→. Nothing should happen and CS2 should receive the key.
6. As the owner, move the IGL role to someone else mid-round. Check that the hotkeys turn Off within about 2 s and a press does nothing.

### Changes left in the development database from verification

- **Background upgrade.** All four existing demos (including your team's demo 3 and demo 2) were upgraded to the recorded-utility data in place, and their annotations are unchanged.
- **Practice Roster.**
  - Has imported tactic 25 (*Mirage B fake into A*) with colours, and demo 5 (the Ancient demo).
  - Has a running Game Mode match (round 2).
  - The IGL role was moved to Blitz and back to Sable during the hotkey test.
- **Kestrel Verify.** Tactic 23 now has in-game colours (Kestrel is purple), and a Game Mode match is still running (round 1).

## Phase 7

### What was added

- **Rank requirements read as one range** (`client/src/lib/rankRange.ts`, used by `RequirementBadge`). A requirement spanning several bands shows its badge once (two badges only when the ends look different, e.g. Level 7 – Level 10), the platform name once and one range from the first band's minimum to the last band's maximum: FACEIT Level 10 (2,001–2,250) to Level 10 (2,251–2,500) reads **[10] FACEIT (2,001–2,500)**. Open-ended bands read `3,001+`; FACEIT Challenger is named and never given numbers. The stored requirement still holds the original band ids, so editing and filtering are unchanged. The team form shows "Shown to players as …" under each requirement row.
- **Teams Looking for Players.** Each card has the picture, name and roster size at the top, then labelled groups (Rank requirements, Roles needed, Language, Region, Plans to play) that wrap long values and badges, and **Details / Request invite** pinned to the bottom of the card.
- **Create Tactic keeps a draft per map** (`client/src/lib/mapDrafts.ts`). The first visit to a map opens a clean board with one phase; switching back restores that map's phases, positions, routes, holds, notes, instructions and utility (with floors). Name, side, economy, buy lists, bomb carrier and colours carry over. A note in the editor bar names the maps with kept drafts. **Save tactic** sends only the selected map; the other drafts are dropped once the save succeeds and kept if it fails. Editing a saved tactic works as before (the board moves with a map change).
- **Defuse kit icon** (`/icons/defuse-kit.png`, `KitIcon`) next to the "Defuse kit" / "Kit" labels in the editor's CT buy list, the viewer's buy lists and Game Mode's "Your buy" and team utility. The image hides itself if the file is missing, leaving the label.
- **Radar landmarks.** The supplied percentages (top-left origin, divided by 100) for Mirage A/B, Inferno A/B, Overpass A/B/T/CT and Train A/B/CT, source `supplied` in `landmarks.ts`. All stay on the main radar. Other landmarks are unchanged (Train T is still placed from the layout).
- **Demo Review layout.** Annotation tools on the left (View, Draw, Text, Smoke, Flash, HE, Molotov, plus floor, recorded-utility toggle and legend); the playback controls, round timeline and square radar in the centre; Rounds, Players, Events and annotations directly beside the radar. The radar is sized to the window; the side panes scroll inside the radar's height. Below 1101 px the areas stack (radar first).
- **Round timeline.** Spans the centre pane from the end of freeze time (0:00) to the end of the round. Each event has an icon above its moment: skull for kills, the utility symbols for grenades, the C4 for plants (orange for explosions) and wire cutters for defusals. Close events stack in up to three rows. Hover or focus shows the details (time, player, thrown at, flight time, duration); clicking jumps there (to the throw for grenades). Team annotations are yellow ticks under the slider.
- **Grenade flights** (replay version 3). Each grenade records its throw tick, where the thrower stood at the throw, and the projectile path up to detonation. While it is in the air the replay draws a dotted line in the thrower's side colour, a ring where it was thrown from and the projectile with "Smoke · HeavyGod". At detonation the path clears and the smoke or fire (with its countdown) takes over. Floors are handled like players: path segments on the other floor are faded. All of it is derived from the playback tick, so seeking, rewinding, switching rounds, following a live review and reconnecting show the same state.

### What the demo parser supplies (trajectories)

From `spirit-vs-g2-m3-ancient.dem` (demoparser2 0.42.2), using `parseGrenades(file, null, false)` (projectiles only):
- **Samples.** Every tick, for every smoke, flash, HE and molotov/incendiary projectile, with position and thrower. The replay keeps every 4th tick plus the detonation point (15,866 points for the match).
- **Linking.** Smokes, flashes and HEs detonate as the same entity as their projectile. A fire starts as a new entity, so it is matched to the thrower's molotov whose flight ends as the fire starts (within 8 ticks). Entity ids are reused during a match, so a gap in ticks starts a new flight.
- **Coverage.** All 391 grenades (116 smokes, 115 flashes, 69 HEs, 91 fires) have a path, a throw tick and the thrower's position. Flight times: flashes and HEs 1.63 s (fuse), fires 0.6–2.0 s, smokes 0.4–7.6 s (until they stop rolling). No path crosses to Ancient's lower floor (it has none).
- **Effect timings.** Smokes last 22.06 s (8.9 s minimum where the round ended first), fires 7.02 s (0.8 s minimum), from the recorded expiry events.
- **Limitations.** Projectile samples exist only in CS2 demos the parser can read this way; a demo without them keeps thrower, position and duration and simply has no path (no estimated line is drawn). The thrower position is the nearest 8-tick player sample at or before the throw. Decoys are not shown.
- **Cost.** Parsing the Ancient demo takes 2.3 s instead of 1.4 s, peaks at 1.05 GB instead of 0.78 GB and stores 4.5 MB of round data instead of 4.2 MB.

### Upgrading existing demos

No migration. `REPLAY_VERSION` is 3, so the demo worker re-parses ready demos in the background (or `npm run demos:reprocess`), replacing round data in place by round number. Annotations and reviews are kept.

## Phase 8

### What was added

- **Demo Review controls in the left pane.** One compact group at the top: Play/Pause, playback speed, the playback position (time since freeze end / round length, separate from the in-game clock in the HUD), previous/next round, and Start/End live review. The duplicate "Demo Review" link above the title is gone (the sidebar item is the entry point). The centre is now HUD → radar → timeline, sized so all of it fits the window at desktop sizes (at 1440×900 the radar is 607 px, the timeline 52 px).
- **Shallower timeline.** 16 px icons in at most two rows, tooltips opening upwards (the timeline sits under the radar), same hover/focus details and click-to-jump.
- **Fixed HUD above the radar** (`components/ReplayHud.tsx`, after reference image 2). CT players on the left, T on the right, the round clock and score in the middle with alive counts and team names. One row per player: health, name, armour (kevlar or kevlar + helmet), defuse kit (CT) or bomb (T carrier), current weapon, carried utility and money. Dead players are greyed with a skull. The clock counts freeze time down, then 1:55; after a plant it shows the bomb; after the round result it reads END and the score updates.
- **Bomb countdown.** A pulsing red line across the top of the HUD, full width at the plant, shrinking from both ends to the centre over 40 s. It is computed from the replay tick, so it freezes on pause, follows the speed and is right after a seek; it clears on defusal, explosion or the round result.
- **Flashed players.** The radar marker turns white and fades back to the side colour over the recorded flash duration (the side-coloured ring, view line and name stay). The HUD row whitens too. Derived from the tick, so seeking into, through or out of a flash is exact, and followers in a live review see the same.
- **Expanded scoreboard** (Scoreboard button under the annotation tools, after reference image 1). Overlays the radar without moving anything or changing playback. Per team: score, side, team name and alive count, then Name · Money · Kills · Deaths · Assists · HS% · Damage at the current moment (seeking back restores earlier values). "—" with a tooltip marks a field the demo doesn't supply; demos still on an older replay version say they are being updated.
- **Text tool like a tactic Note.** Choose Text, click the radar to place it, type (Ctrl+Enter adds), use the up/down arrows to change the size (12–64). Click a text (or Edit in the list) to change its content and size; Move and remove work as for utility markers. The text, size, round, replay position and floor are stored.
- **Round notes and Save.** The right pane has a notepad per round. Switching rounds shows that round's notes and keeps unsaved edits while the page is open (the browser warns before leaving with unsaved notes). **Save notes and annotations** saves every edited round's notes and your new annotations, and says what was saved or why not. New annotations are drafts only you see (tagged "unsaved") until you save. A note someone else saved since you loaded it is reported instead of overwritten. In a live review the IGL's drawings are broadcast immediately as before (tagged "live"), and Save also keeps them as saved annotations of the demo. Saved notes and annotations show when the demo is reopened, and in live reviews for everyone following. Teammates following can read the notes but not edit them; outside a review any member can write notes and their own annotations (as before).
- **Match share code** sits on its own row with room above it; the field fits a whole code (monospaced, about 40 characters) and shrinks on narrow screens.
- **Calendar.** The Training nav item, page heading and tab title are now **Calendar** (`/training` still works, `/calendar` is an alias). Clicking a day (or Enter on a focused day) selects it and shows everything booked that day with full details. Double-clicking a day opens a new event on that date (team owner). The Add event button is always shown; other members see it disabled with the reason. While adding an event, clicking another day moves the form to it. The selected day has a white outline; today keeps its orange ring, including when selected. Events and event types are unchanged.
- **Kit icon and Game Mode utility icons.** Game Mode's team utility table uses the same white/grey grenade icons as elsewhere and has a kit column for CT players assigned a kit. `KitIcon` uses `client/public/icons/defuse-kit.png`; **that PNG is not in the repository** (it wasn't found on this machine), so an olive pliers outline stands in until the file is added. Drop the transparent PNG at that path and every kit icon (Tactics Player instructions, viewer, Game Mode, Demo Review HUD) uses it.

### What the demo parser supplies (HUD and scoreboard, replay version 4)

Checked on `spirit-vs-g2-m3-ancient.dem` (demoparser2 0.42.2):
- **Money, armour, helmet, defuse kit, active weapon, carried grenades and the bomb** from player properties (`balance`, `armor_value`, `has_helmet`, `has_defuser`, `active_weapon_name`, `inventory`), sampled with positions every 8 ticks and stored only when something changes (8,572 entries for the match).
- **Kills, deaths, assists, headshots and damage** from `player_death` and `player_hurt`, with the same rules as Player Stats: enemy kills only, flash-only assists excluded, damage capped at the victim's remaining health. Each round stores everyone's totals before it and the changes during it; end-of-match totals equal the Player Stats rows exactly. The demo's own `damage_total` property was not used: it only updates at round boundaries and didn't match the damage events.
- **Flashes.** This demo has no `player_blind` event, so a flash is detected from `flash_duration` changing between the tick before and 2 ticks after each flashbang detonation: 249 player flashes, 0.09–5.05 s. Teammates flashed by their own team are included (as in game).
- **Team names** from `team_clan_name` (Spirit / G2); score before each round from the round results.
- **Not supplied or approximated:** grenade counts (two flashbangs show one flash icon); health, money and equipment between 8-tick samples; the round time and bomb timer are the competitive defaults (1:55, 40 s) rather than read from the server's settings; the in-game scoreboard's assist and damage numbers can differ slightly from these definitions (CS2 counts flash assists).
- **Cost.** Parsing Ancient now takes 3.3 s (was 2.3 s) and stores 5.4 MB of round data (was 4.5 MB). Peak memory is 1.8 GB (was 1.05 GB), mostly from the per-tick inventory lists, which matters on small servers.

### Migrations and upgrading

- `20261117000100_phase_8_round_notes.js`: `demo_round_notes` (one per demo round, versioned) and `demo_annotations.saved` (default true, so every existing annotation stays shared).
- `REPLAY_VERSION` is 4: the demo worker re-parses ready demos in the background (or `npm run demos:reprocess`), replacing round data in place. Annotations, notes and reviews are kept.
- New endpoints: `GET /api/demos/:id/notes`, `POST /api/demos/:id/save` (`{ notes: [{ round_number, body, expected_version }], review_id? }`). Live review state now includes the demo's saved annotations for the round and its `note`.

## Phase 9

### CS2 icons from your own game install

Demo Review uses Valve's own HUD icons, extracted from the local CS2 install. **They are not in the repository** (this repo is public and the artwork is Valve's), so each machine builds them once:

1. Extractor: ValveResourceFormat's `Source2Viewer-CLI` 20.1 (official GitHub release, `cli-linux-x64.zip`, SHA-256 `29d25a6d…aef5`), unzipped to `tools/cs2-asset-extraction/bin/vrf/`. It is self-contained (no .NET needed).
2. Python with CairoSVG and Pillow in a local venv: `python3 -m venv tools/cs2-asset-extraction/work/venv && tools/cs2-asset-extraction/work/venv/bin/pip install cairosvg==2.7.1 pillow==11.3.0`.
3. `npm run cs2:assets` (add `-- --extract` to re-extract after a game update). It finds CS2 through Steam's `libraryfolders.vdf` (or `CS2_DIR`), reads `pak01_dir.vpk` read-only, and writes `client/public/assets/cs2/` (gitignored). **Restart the dev server afterwards**: Vite only serves public files that existed when it started.

Output (checked on this machine): 235 icons from `panorama/images/` (weapons by class, all knives, grenades, armour, kit, Zeus, C4, kill feed indicators, team counter, scoreboard, radar and objective icons), each as the original SVG (what the app uses), a 256×256 PNG (kill feed icons: natural width at 64 px high) and white and black PNG variants (470); `manifest.json` (source resource and archive, sizes, variants, status, `weapon_<id>` → inventory and kill feed icons) and `contact-sheet.png`. Validation: every file opens, has transparency, isn't cropped, and every manifest path exists. Findings:
- The kill feed and the inventory use the same `icons/equipment/<weapon>` files; there are no separate kill feed silhouettes in the game files.
- `world`, `worldent` and `trigger_hurt` are blank in the game (no icon for world or fall deaths); `kevlar`/`armor` and `c4`/`bomb_icon` are identical images.
- Not provided as images: planting/defusing progress, burning, scoped and footstep indicators, a team-kill indicator, and knife/grenade/fire kill indicators other than the team counter's kill types.

Without the asset set everything still works, with text or the app's own icons instead.

### Styling taken from the game

From the extracted Panorama styles and layouts (`hudteamcounter`, `hudteamcounter-equipmentinfo`, `scoreboard`, `huddeathnotice`, `csgostyles`), confirmed values are marked `(P)` in `styles.css`: team colours (#B5D4EE / #EAD18A; kill feed #6f9ce6 / #eabe54), team counter backgrounds, name, health bar and equipment rows, the planted-bomb icon washed #b80000 pulsing every 0.8 / 0.5 / 0.3 s, scoreboard cell backgrounds and 80 px team panel, kill feed 3 px radius, #000000a0 background, 5 s lifetime with a 1 s fade, and the order of its parts. The scoreboard order is from `scoreboard.js` (competitive: damage, kills, assists, fewest deaths). Approximations: CS2's Stratum2 font is a `.uifont` the browser can't load (a condensed system font stands in); sizes are scaled to fit beside the radar (cards about 43–58 px against CS2's 54 px); there are no Steam avatars in demos, so cards have no picture.

### What was added

- **Spectator HUD** (replaces the Phase 8 rows): CT cards, then score, timer and score, then T cards, as in CS2's team counter. Each card: name, health bar with the number (skull icon when dead), money, best weapon (primary, else pistol), carried grenades, armour or armour + helmet, defuse kit or bomb. Alive counts, round number and team names under the timer. The Phase 8 40-second bomb line is kept along the top.
- **Scoreboard** (same Scoreboard button): a CS2-style overlay across the replay area with each team's score, side, team name and alive count, then Money · Kills · Deaths · Assists · HS% · DMG, ordered like CS2's competitive scoreboard. Values at the current tick, as before. No ping or score column (CS2 doesn't show score there; ping isn't in demos).
- **Kill feed** in the radar's top right: attacker, "+ assister" with the flash-assist icon, then weapon, no-scope, through smoke, wallbang, headshot (and blind, in air, suicide), then victim, in team colours. Shown for 5 s of demo time with the last second fading, derived from the tick (pausing, speed, seeking and round changes are exact). Clicking an entry (or Enter) seeks to the kill without changing play or pause, outlines the killer and victim on the radar with a dashed line between them and highlights their HUD cards for 3 s of demo time. Bomb kills show the C4 icon with no killer; world deaths show the recorded weapon as text. Toggle: Display → Kill feed.
- **Bomb detonation** (from the recorded `bomb_exploded` event, placed at the plant): a 1.5 s shockwave (flash, expanding ring, fade) and, separately, an estimated damage area that stays for 5 s (3, 5, 10 or 20 s). Players hurt or killed by the bomb get an orange ring and their recorded damage ("−139 C4 kill", "−9 (17 HP)"). Display toggles: Bomb shockwave, Bomb damage area (both on by default). Both are drawn in the radar's coordinates, so they stay aligned at any size.
- **Damage area is an estimate.** It uses the CS:GO formula (500 damage, Gaussian falloff over 1,750 units, no armour or cover) and is labelled as such. Recorded CS2 bomb damage doesn't follow it: on these demos 829 units did 27 and 1,599 units did 69 (map settings and cover change it), so the real damage is always shown on the players.
- The kit icon (Tactics, viewer, Game Mode) now uses CS2's own pliers icon when the asset set is built.

### Replay data (version 5)

`REPLAY_VERSION` is 5: kills carry the assister and flash assist, wallbang, no-scope, through smoke, attacker blind and in air (only when the event has them) and the raw weapon id; rounds carry the bomb damage actually done (`player_hurt` with `planted_c4`), each player's best weapon and in-game score, and the radar width in game units. Demos are re-parsed in the background as before; annotations and notes are kept.

## Phase 10

### Team
- **CS2 colours per player** (`team_memberships.game_color`): yellow, purple, green, blue, orange, with CS2's own values from the game's Panorama styles (`color-player-*`: #f8f62d, #c03699, #1da284, #88cef5, #ff9b25; the earlier approximations were replaced). One colour per player, unique on the team (database index); the picker disables colours other players have and names them. The owner and the IGL assign them (as with roles); leaving the team frees the colour; a sixth player stays unassigned. Shown as a swatch and a ring round the avatar.
- **One source of truth for colours:** a member's team colour replaces any colour stored in a tactic or Game Mode round when they're shown (`services/teamColors.js`, mirrored in the client), so Team, Tactics, Game Mode and the board agree. Tactic editor colour pickers are read-only for players with a team colour; Player 1–5 slots in shared tactics keep their own colours.
- **Rank columns** Premier, FACEIT and ESEA from each player's profile (self-reported, the existing Phase 5 catalogue), "Not set" when missing. Invite players uses the same rank cells and order; pending invites show only what's known (no colours until a player joins).
- **Access column removed** (presentation only); the owner badge sits beside the name and the permissions note below the table is unchanged.

### Calendar
- **Availability** (`team_availability`): every member adds, edits and deletes their **own** Available / Unavailable entries (date dd/mm/yyyy, All day or From–Until, optional note); everyone sees them; nobody else can change them (enforced on the server). Stored as instants; all-day = local midnight to midnight; no notifications.
- **Events:** the owner **and the IGL** now create, edit and delete Training, Game and Demo Review events (was owner only), with an optional end time. One Add calendar entry form: members see only Available / Unavailable; the owner and IGL also see the event types.
- **Display:** events (coloured by type) and availability (✓ green / ✕ striped red, with the player's colour dot) are styled differently; up to three entries per day then "+N more"; clicking a day lists everything and a **Team availability** table: per player Available / Unavailable / Not specified (no entry is never treated as available) with times.
- **Conflicts:** the event form warns, live, when players marked themselves unavailable during the session ("1 player has marked themselves unavailable during this session: Blitz"); events without an end time are checked for 2 hours. It warns, it doesn't block.
- **Sample data:** `npm run db:sample-calendar` fills the existing **Practice Roster** team (only) with 11 events and 30 availability entries over two weeks from the current week: all-day, partial and evening entries, overlaps, conflicts and several days with three or more entries. Idempotent; titles end in "(sample)", availability notes say "Sample entry"; inserted directly, so no notifications.

### Notifications
- **Clear all** (replaces Close) moves every active notification to history (`dismissed_at`, the existing soft-dismiss column; nothing is deleted) and resets the unread count. **History** lists cleared notifications, most recently cleared first, with title, message, type, when it was created and when it was cleared; **Back to notifications** returns. Per user; persists across refreshes and sign-ins. New endpoints: `POST /api/notifications/clear-all`, `GET /api/notifications/history`.

### Demo Review
- The **scoreboard is centred on the radar** (positioned from the radar's own frame, both ways), so it stays centred whatever the side panes or window do; it may extend past a small radar's sides but stays inside the window.
- **Timeline utility icons** are the extracted CS2 icons (smoke, flashbang, HE, molotov or incendiary as recorded for each fire).

### Shared utility icons
- `utilityId()` / `UtilityIcon` (`lib/cs2Assets.ts`, `components/UtilityIcon.tsx`) map every identifier used in the app (`smoke`, `flash`, `he`, `molly`, `fire` + variant, `inc`, `decoy`, `smokegrenade`, `c4`, `kit`, armour…) to one CS2 icon. `molly` follows the side: molotov for T, incendiary for CT. Used in Demo Review (timeline, HUD, tools), Game Mode (Your buy, Team buy) and Tactics (toolbar, buy lists, board markers, which put the white CS2 icon on a dark disc). Without the CS2 asset set the app's own icons are used.

### Game Mode
- **Team buy** uses the CS2 icons (molotov or incendiary by side), a C4 column for T and a defuse kit column for CT, and is shown to everyone.
- **Team roles this round:** every member can pick a teammate (pills in their CS2 colours, default: you) to see their roster role, this phase's instruction, the utility they throw and have, and where they're placed; the board highlights them. Viewing only: control stays with the IGL (the server now sends every instruction to all members, read-only).

### Tactics: utility throw paths
- Placing a smoke, flash, molotov or HE: **click** to add points, **Enter** (or Finish) to place it at the last point, **Backspace** removes the latest point, **Esc** cancels; a dashed preview follows the cursor and a hint bar shows the keys. The throw is drawn from the thrower (route end or player marker) through each bounce point (small rings) to the utility icon. Selected utility: drag its bounce points, **Add bounce point**, **Remove last bounce** or **Straight line**; moving or deleting the marker works as before. Up to 8 bounce points.
- Stored as an optional `path` of bounce points on the utility marker (board coordinates); saved tactics without one still draw a straight line, so nothing is migrated. Paths are hand-drawn illustrations, labelled as such, not simulated CS2 grenade physics.
- The editor has no undo/redo; Backspace during placement and the buttons above are the ways back.

### Migrations
`20261118000100_phase_10_colours_availability.js`: `team_memberships.game_color` (+ unique per team), `team_events.ends_at`, `team_availability`.

## Phase 11: Replay Inspector

### First-person capture from CS2
Real POV screenshots and clips are recorded by the CS2 client playing the demo on this machine (`tools/cs2-capture/`, driven by `services/captures.js`). Nothing is drawn or synthesised: a frame exists only if CS2 rendered it for that tick and player.

**How it works**
- **Control:** console commands are typed into CS2 through a **uinput virtual keyboard** (`ukeys.py`). On GNOME Wayland the compositor treats it as real hardware; Steam's udev rules (`60-steam-input.rules`) already give the logged-in user `/dev/uinput`. Nothing is typed unless the CS2 window has input focus, checked before every command.
- **Confirmation:** every step is checked against CS2's own `console.log` (`-condebug`): the demo loaded, the seek **finished at the exact tick**, which player is being watched. The console's open/closed state and paused playback are checked from the pixels.
- **Capture:** the CS2 window's pixels are read through XWayland (`xgrab.py`), scaled to 1280×720 (lineups at 2560×1440 for the crosshair zoom) and saved as JPEG. Clips are frames sampled while the demo plays at 0.2× speed (30 fps output, timing checked against the clock) and encoded to WebM (VP8) with GStreamer.
- **What makes the frames trustworthy:** every seek goes past the target and back, so CS2 rebuilds the frame from a full snapshot (a long forward skip while paused left stale positions on screen). Spectator X-ray is turned off (it outlines players through walls, which the player didn't see) and the HUD is reduced to crosshair and kill feed. The demo playback bar is detected in the pixels and hidden. All of these settings are put back afterwards.
- **Queue:** requests are stored in `demo_captures` and run one at a time by the worker in the API process (there is one CS2). Media is cached under `storage/captures/<demo>/<capture>/` and served only to members of the demo's team. Deleting a demo deletes its captures. A kill takes about 20–30 s; a throw (clip and lineup) about 30–40 s; loading a different demo adds about 20 s.

**Running it**
1. Set `CAPTURE_WORKER=on` in `.env` (opt-in: it types into the CS2 window on this desktop).
2. Start CS2 with `-condebug -console`, for example from the game folder: `SteamAppId=730 SteamGameId=730 ~/.local/share/Steam/steamapps/common/SteamLinuxRuntime_sniper/run -- ./cs2.sh -steam -novid -windowed -condebug -console`. This route avoids the "Processing Vulkan shaders" dialog Steam can show.
3. Click into the CS2 window and leave it focused while captures run. The inspector shows the reason whenever capture can't run yet; queued requests start once CS2 is ready.

`-condebug` writes `game/csgo/console.log` inside the CS2 install while the game runs. Delete it after closing CS2 if you don't want it there.

**Dead ends (16 Nov 2026, GNOME on Wayland):** `-netconport` and `-vconsole` opened no port; `+playdemo` at launch is dropped; XTest keystrokes never reach the game. Seeking right after a demo loads crashed CS2 once ("CopyNewEntity: invalid class index"), so the tool now lets the demo play for a few seconds first.

### What was added
- **Replay Inspector** (`components/ReplayInspector.tsx`): a permanent panel in the space right of the Rounds / notes column. It takes the spare width, up to 760 px, without shrinking the radar; on narrower windows it moves below at full width; it scrolls inside itself. It shows an empty state until an event is selected.
- **Selecting events:** clicking a kill in the kill feed or on the timeline, or a grenade on the timeline, selects it and seeks to its moment without changing play/pause, and highlights the players.
  - A kill's moment is its exact tick.
  - A throw's moment is its **release** tick. Throws are linked to their detonation by projectile entity id, or by thrower and timing for fires.
  - **Previous / Next** steps through events in order (filter: kills and utility, kills, utility), continuing into the neighbouring rounds.
- **Kill mode:**
  - **Killer POV** at the kill tick.
  - **Victim POV** at the victim's **last recorded alive tick** (labelled as such, never as the death frame).
  - Kill details, and **tactical data labelled as such**: positions and floors, distance, facing angles, with the note that facing is not visibility.
- **Utility mode:**
  - A **two-second replay** from the thrower's view (1 s either side of the release, clamped to the round), with 0.25× / 0.5× / 1× playback.
  - A **lineup** frame the tick before release, with a 1–5× crosshair zoom about the frame centre (where CS2 draws the crosshair).
  - Release and detonation ticks, flight time, positions, distance and duration.
- **Exports:** downloads of the captured killer/victim screenshots, clip (WebM), lineup image, and a zoomed crop of the lineup (PNG, the same pixels as the zoom). Files are named map_round_event_player_tick. GIF export is disabled: there's no GIF encoder on this machine.
- **API:**
  - `GET /api/demos/:id/captures`: status, reason and this demo's captures.
  - `POST /api/demos/:id/captures`: `{ kind, round_number, event_index, retry? }`. It is validated against the demo the user can access and the recorded event, then queued, or the existing capture is returned. With the worker off it answers **503 `capture_unavailable`**.
  - `GET /api/demos/:id/captures/:capture_id/media/:file`: only files listed for that capture.
  - No paths or commands are ever accepted from the client: the demo path comes from storage, and player names come from the parsed demo.

## Phase 12: capture sessions, kill clips and recorded input

### What was added
- **Capture sessions** (`capture_sessions`, `services/captures.js`): one session is one run of CS2. A batch from upload, a single (re)capture or Watch this round each get their own session.
  - **CS2 lifecycle:** the worker launches CS2 itself through the Steam runtime (`tools/cs2-capture/launcher.py`) in a 1280×720 window and focuses it. It loads the demo once and captures events in tick order. When the session ends (also on failure) it closes the instance it launched.
  - **Process tracking:** the session tracks its CS2 by a marker environment variable, so it never closes an unrelated CS2. An already-open CS2 started with `-condebug -console` is used and left open.
  - **Your settings:** `cs2_video.txt` is backed up before launch and restored after the instance exits; a crash is recovered on the next session. Changed convars are put back before quitting. The `console.log` that `-condebug` creates is deleted afterwards.
  - **Focus without the user:** a new CS2 window normally takes focus itself. Otherwise `_NET_ACTIVE_WINDOW` is tried, then a uinput absolute pointer moves to the window centre. It clicks only once XWayland reports the pointer inside the CS2 window, so nothing else can be clicked. Focus is still checked before every command.
- **Upload options:** Demo Review → Upload has Kills & Utility / Kills only / Utility only (none selected by default; select again to clear).
  - With an option, a confirmation explains that CS2 launches, how long it takes and that the PC must be left alone, and **Go back** keeps the choice.
  - After parsing, the matching recorded events are queued as one batch. A failed event doesn't stop the rest; a fatal error (CS2 closed, focus lost) marks the remaining events as not captured.
  - Without an option the import is unchanged.
- **Progress overlay:** a translucent overlay with a spinner covers the Demo Review page while the user's session runs. It shows the stage (starting CS2, loading the demo, "capturing kill 3 of 12"), the count and the remaining time.
  - It follows the job (`GET /api/capture-sessions/current`), so it survives a refresh.
  - When the job ends it is replaced by a summary with **Retry N failed**, which requeues them as one session (`POST /api/demos/:id/captures/retry`).
- **Kills:** a **Killer / Victim** switch shows one POV at a time.
  - **Clip:** two seconds centred on the kill (on the death for the victim), clamped to the round.
  - **Still below:** the killer at the kill tick, the victim at their last recorded alive tick.
  - **X-ray:** flash-affected (attacker blind or flash assist) and through-smoke kills are recorded with spectator X-ray on and labelled **X-ray enabled**.
  - **Earlier media:** older captures (Phase 11 stills) stay visible, also while a recapture is pending or after it fails.
- **Utility:**
  - **Input overlay:** the clip has an overlay (W A S D Shift Ctrl Space LMB RMB) synced to the video at any speed.
  - **Lineup:** the still has a thin green crosshair through the aim point that stays aligned when zooming.
  - **Radar:** landed recorded utility on the radar is clickable and opens the same inspector event as its timeline entry (the same event object, so overlapping throws resolve correctly).
- **Watch this round** (under the round list): opens the original demo in CS2 at the selected round's start. CS2 is launched with the player's own video settings, paused, and left open. The tool confirms from CS2's log that it is playing that demo file and landed on the round's start tick.
- **Capture again / Capture from CS2** asks first (it takes control of the local CS2 window) and recaptures only that event. The existing media stays until the new capture succeeds; each attempt is stored in its own folder.

### Recorded input (verified in the demo)
The demo stores each player's usercmd button state per tick (`usercmd_buttonstate_1`). The bits were checked against the game's own state over 53,245 alive samples of `spirit-vs-g2-m3-ancient.dem`, with none missing:

| Bit | Action | Default key | Check against game state |
|---|---|---|---|
| 0 | attack | LMB | |
| 1 | jump | Space | |
| 2 | duck | Ctrl | |
| 3 | forward | W | |
| 4 | back | S | |
| 9 | move left | A | |
| 10 | move right | D | |
| 11 | attack2 | RMB | |
| 16 | speed (walk) | Shift | 6,436 of 6,496 `is_walking` samples have it |

These are **actions the player's client sent, not physical keys**: the overlay labels them "recorded actions · default keys". Ticks without data are shown struck through, never guessed from movement. The bits are read in one parse per session (`workers/demo-inputs-child.js`) and stored with the clip.

### Benchmarks (16 Nov 2026, `tools/cs2-capture/bench.py`, RTX 4090, `spirit-vs-g2-m3-ancient.dem`)

**Final settings** (1280×720 window, your own quality settings, clips recorded at 1× speed):

| Step | Time |
|---|---|
| Cold start (launch → window 1.5 s → main menu → focused) | 7.1 s (once 53 s while CS2 rebuilt its shader cache after a settings change) |
| Demo load | 18.9 s |
| Kill, both POVs (2 clips + 2 stills) | 25.0–27.1 s; 35 s in dense smoke |
| Utility throw (clip + lineup) | 12.8–14.7 s |
| Mixed batch, 3 throws + 3 kills | 119 s, about 20 s per event |
| Close | 3.8 s |
| Website end-to-end single recapture | 57.6 s in total |

Inside a kill, roughly:
- seeking 5–8.5 s;
- recording 9.1 s (2 × (2 s + 0.5 s pre-roll) plus console steps);
- stills 3.2 s;
- POV switches 1.3 s;
- encoding 0 s, because VP8 encoding streams during recording and the tail is ~2 ms.

**Estimates shown to users** (`services/captureEstimates.js`): 8 s start + 19 s load + 26 s per kill + 13.5 s per throw. For a full match like this one (131 kills, 391 throws, 18 rounds):
- Kills & Utility: about 2.4 h;
- Kills only: about 57 min;
- Utility only: about 1.5 h.

After parsing, the overlay uses the real count.

**Findings:**
- **Resolution:** at 1920×1080 a grab takes 35 ms and clips at 1× fell up to 48 ticks behind. At 1280×720 a grab takes 13–14 ms with 0.0 ticks of lag at 1×, so 720p is used. Media is saved at 1280×720 either way.
- **Graphics settings:** low settings didn't help. Grab time was 13.9 ms on the low profile vs 12.7 ms on your own settings, and seeking (the real bottleneck) is CPU-bound. Capture keeps your quality settings (`CAPTURE_PROFILE=native`); only the window size changes.
- **Seeks:** a backward seek is always rebuilt from a full snapshot, so it is one command. Forward seeks still overshoot and come back (`CAPTURE_SHORT_FORWARD=0`).
  - After a 1,500-tick forward seek the players were at the right tick but the camera was where magixx stood 23 seconds earlier (frame difference 38 vs about 0.5 for identical paused frames).
  - Short forward seeks (64–400 ticks) kept the camera but still differed by 10–13, mainly in smoke.
- **Accidental extra seeks:** after each clip the tool forgot where it was paused, so the next seek defaulted to the slow overshoot path. It now keeps the clip end as a lower bound, and kills are ordered killer clip → killer still → victim still → victim clip, so all seeks after the first are single backward commands. The deliberately doubled convar commands were dropped once the console's input delay was handled.
- **Stills from clips:** a clip frame at the kill tick differs from a paused still by 14.3, so stills stay separate captures.
- **Smoke and fire in stills:** when CS2 seeks it rebuilds smoke and fire without their history. At the same tick and view, paused stills showed visibly different smoke density, and once missed a fire the clip showed. Positions and camera are exact. Stills carry a note saying this, and the clips (played through) are closer to what was seen.
- **Flash and smoke views:** in the flashed-attacker kill (NertZ → zont1x) the view at the kill tick is heavily washed out but not fully white, and X-ray outlines stay visible. In the through-smoke kill (magixx → huNter) the view inside the smoke shows nothing without X-ray; with it, the players are outlined.

## Phase 13: 720p muted capture, speed benchmarks, round and player capture

### What was added
- **Capture profile:** CS2 launches for capture in a **1280×720 window** with low video settings (`CAPTURE_PROFILE=capture`: no shadows/AO, low textures and shaders, MSAA 2×), plus **`-nosound`** and **`-novid`**. The resolution is applied at launch through the temporary `cs2_video.txt` profile, so CS2 renders at 720p rather than downscaling. Watch this round still opens CS2 with sound and the player's own settings. Everything changed on the installation is restored after the instance exits.
- **Speed-aware clip sampler** (`capture.py clip()`): frames are grabbed as fast as the window allows and each 30 fps output frame takes the grab nearest its moment, so a clip recorded at any demo speed plays at normal speed. Each clip records how many distinct grabs it contains.
- **Capture this round:** under Watch this round, with Kills & Utility / Kills only / Utility only. Only the selected round's matching events are queued. The count is checked first (`POST /api/demos/:id/captures/batch` with `dry_run`), so a round with nothing to capture says so before CS2 launches. The confirmation shows the count, the estimate and the launch warning.
- **Upload player filter:** capture stays off by default. With an option selected, the demo uploads and parses first; the uploader then picks **All players** or one player from the parsed roster in the library before anything is queued or launched.
  - A specific player means kills they made and/or utility they threw, matched by the **parsed player index**, so duplicate display names don't mix.
  - Each matching kill still produces killer and victim POVs.
  - The confirmation states the player, the scope and the count. **Skip capture** clears the option.
- **Keyboard and mouse overlay:** compact keycaps laid out like a keyboard (W above A S D, Shift left of A, Ctrl under Shift beside a wide Space) and a mouse outline with M1 / M2. Held actions are highlighted amber; unavailable ones are dashed and struck through, as before. It follows the clip at any playback speed and after seeking (per decoded frame, plus seek/time events and a 150 ms fallback).
- **Batch fix:** batch sessions are created as `preparing` and only queued once every event is attached. Before this, the worker could start a batch with part of its events: a live round capture took 1 of 11 events and stopped.
- **Failure evidence:** when a capture step fails, the tool saves the last 200 CS2 log lines and the current frame to `storage/captures/cs2-session/failures/`. CS2's own log is deleted at cleanup.

### Live results (16 Nov 2026, RTX 4090, `spirit-vs-g2-m3-ancient.dem` unless noted)
**Launch (verified live, three launches):**
- **Window:** 1280×720.
- **Muted:** CS2 logged `Setting null device for -nosound`, and no CS2 audio stream appeared in PipeWire, before or after the demo load.
- **No intro:** the UI went straight from start-up to the main menu.
- **Timing:** main menu in 8.6–11.4 s (31 s once while shaders rebuilt), focused without the user, demo load 18.4–19.6 s, close 3.4–5.0 s.

**Recording speed** (the same smoke kill, flash kill and flash throw; 2 s clips = 60 frames at 30 fps):

| Speed | Distinct frames | Worst sampling lag | Recording per kill (2 clips) | Visual check |
|---|---|---|---|---|
| 1× | 56–60 | ~1 tick | 9.1–9.2 s | Smooth; release and kill frames present |
| 2× | 26–48 | 2–4 ticks | 7.25 s | Release and kill kept; motion halved, visible repeats and jumps |
| 4× | 6–12 | 12–24 ticks | 6.4–6.6 s | Grenade release missed; slideshow |
| 8× | 4–11 | 33–45 ticks | 6.3–6.4 s | Unusable |

The window can be read about 40 times a second, so recording faster than real time only repeats frames. The time saved is small because fixed per-clip costs (pre-roll, console, pause) dominate. **Clips stay at 1×** (`CAPTURE_TIMESCALE=1`); 2× saves about 2 s per kill (7%) for half the motion.

**Navigation:**
- To a kill 541 ticks ahead, the verified seek took 1.5 s.
- Playing through at 8× took 2.1 s, and then CS2's paused-tick line couldn't be read, so it fell back to the seek anyway.
- Navigation stays on the verified seek (`CAPTURE_NAV=seek`); the play-through code remains as an option.
- Phase 12 already measured that one-command forward seeks leave stale views.

**Workloads** (start, load and close excluded unless stated):

| Workload | Events | Wall-clock | Output | Failures |
|---|---|---|---|---|
| Round 3, baseline (1×, seek) | 16 | 284.6 s | 27.1 MB | 0 |
| Round 3, 1× + 8× play-through | 16 | 282.5 s | 26.1 MB | 1 (CS2 lost focus mid-run; automatic recovery failed; reported as retryable) |
| Website: round 17 Kills only, total | 6 | 203 s | | 0 |
| Website: round 17 Utility only, total | 5 | 109 s | | 0 |
| Website: round 17 Kills & Utility, total | 11 | 271 s | | 0 |
| Website: player filter, tN1R kills in round 16 | 1 | | both POVs (killer tN1R, victim NertZ) | 0 |

- **Per event:** 26.3–28.1 s per kill (both POVs), 13.0–14.1 s per throw, plus about 6 s for the first event.
- **Cold start:** CS2 start-up and demo load add about 30 s once per session.
- **Sizes:** at the new 4 Mbit/s VP8 target, a 2 s 720p clip is about 1.0 MB (about 1.45 MB at Phase 12's 6 Mbit/s); a kill with 2 clips and 2 stills is about 2.4 MB; a throw about 1.2 MB.

**Full-match estimate** (not a measured full-match run; extrapolated from the per-event sample, 131 kills and 391 throws in this demo):
- Kills & Utility: about 2.4 h;
- Kills only: about 59 min;
- Utility only: about 1.5 h.

Lower settings and 720p saved only output size, not wall-clock time: seeking (CPU) and per-step console overhead dominate.

**720p lineup zoom:** crosshair, doorway edges and target are crisp at 3× and softer but readable at 5×.

### Known limitations found live
- **POV confirmation needs CS2's TrueView log lines.** The tool only captures a view once CS2's log confirms whose view it is. Two cases fail as retryable:
  - Kills after the final round's end, while the victory screen shows: the switch happens, but CS2 logs "TrueView inactive". The filtered zont1x kill in round 18 failed this way.
  - Demos where CS2 never logs POV changes. The Mirage Premier demo: twelve `spec_next` produced no lines, so 𝙟𝙆.'s kill could not be captured.
  - Capturing these would need another way to confirm the POV.
- Recorded input may also be missing from such demos; the overlay then shows "Input not recorded".

## Phase 14: faster capture, stacked kill videos, buy costs, drops and Play Phase

### Tactics
- **Player browser (Tactic view):** any team member can click through the roster to read each player's role, their instruction for the current phase, and this phase's throws, drops and pickups. The selection stays when the phase changes. A player with nothing this phase shows "No instructions for … in …". Browsing gives no edit or Game Mode control.
- **Buy-list prices and total cost:**
  - Prices: Flash $200 (max 2), Smoke $300, HE $300, Molotov $400 (T) / Incendiary $500 (CT), Decoy $50, Defuse kit $400 (CT only); one each except flashes.
  - Each player's cost comes from their starting buy list, and the buy list shows a **Total cost**. The utility summary has a Cost column with a breakdown tooltip.
  - Decoys are new in loadouts; older tactics load with 0. The server validates limits and the 4-grenade cap on save.
- **Drop and Pickup actions:**
  - **Drop:** a player drops an item at a point placed on the radar. It leaves their inventory and shows as "on ground" in later phases.
  - **Pickup:** links to one specific drop and adds the item to the receiver.
  - **Rules (client and server, `domain/utility.js` mirrored by `client/src/lib/utility.ts`):** a pickup can't come before its drop (same phase: later in that player's order), and a drop can't be picked up twice. Plans that use an item a player doesn't have, or go over the buy limits, are flagged.
  - **Inventory:** derived deterministically, phase by phase in step order.
  - **Share and import:** actions are kept through share/import, mapped to Player 1–5 slots.
- **Per-player throw order:** the Utility order panel sets each player's sequence of throws, drops and pickups (stored as `seq`).
- **Play Phase:** animates the current phase on the board.
  - **Movement:** players move along their routes from their saved positions at CS2 running pace (230 u/s), scaled to each map's radar. Players without a route stay put.
  - **Utility:** each player throws in their set order, 0.5 s apart; players run independently. Drops and pickups update the inventory chips; a pickup waits for its drop.
  - **Preview only:** the board can't be edited while playing, and Stop / Replay / changing phase resets it. Nothing is saved.
- Local trial data: `node scripts/seed-phase14-demo.js` creates a lead, an ordinary member and a T and a CT tactic (development only).

### Capture
- **Kill events:** the inspector shows **Killer POV above Victim POV** as two stacked videos, each with its own loading / unavailable state. There are no POV tabs and no kill stills; older captures still show their stills. Utility keeps its lineup still and replay clip.
- **Planned from demo ticks before launch (`services/capturePlan.js`):**
  - Every output is a window 1 s either side of the event (tick rate from the demo), clamped to the round.
  - Kill: killer and victim clips; X-ray on for flash-affected and through-smoke kills.
  - Utility: a replay clip around the release, plus a lineup still on the tick before release.
  - Clips stay 720p / 30 fps at 1×.
- **Schedules (`CAPTURE_SCHEDULE`, default `hybrid`):**
  - **chronological:** tick order.
  - **player:** each player's windows together.
  - **hybrid:** per round and POV, windows that overlap and share settings (X-ray) are recorded once and cut into each clip's own window.
  - Lineup stills go just before their throw's segment.
- **One demo load per batch.** Up to 3 clips encode in the background while recording continues (bounded queue).
- **Console input:**
  - Commands are pasted in full and submitted with one Enter (`tools/cs2-capture/xclip.py` serves the X11 clipboard).
  - Your clipboard text is saved first and put back afterwards. It is also saved to disk so a crashed run can restore it. Only text can be restored.
  - Esc, the console key and Enter stay single keypresses.
  - Each command is checked through CS2's log. A paste that shows no effect is retried typed and counted as a paste failure.
  - Focus is checked before input.
- **Startup:**
  - CS2 starts with `-novid`; Esc dismisses an intro if one appears (none did).
  - The launcher waits for Steam to be logged in, and retries the launch once if the main menu never appears.
  - The demo load waits for CS2's readiness lines instead of a fixed 6 s.
- **Seeking:**
  - **POV first:** the view switches before the seek, because a switch resumes playback; the seek then pauses exactly. If the player can't be watched where the demo is (dead there), the tool seeks first, switches, and seeks again.
  - **Forward seeks:** one forward command when the paused position is exact and ≤ 400 ticks ahead; otherwise a backward seek or overshoot-and-back.
  - **Stalled seeks:** a seek CS2 ignores (already on that tick) falls back to overshoot-and-back.
  - **Resync detection:** CS2 sometimes skips to the previous tick and resumes ~1 s after a pause. The tool detects these lines after a seek and seeks again. The stillness check uses frames 0.3 s apart.

### Live results (17 Nov 2026, RTX 4090, `spirit-vs-g2-m3-ancient.dem`)
**Startup and input:**

| | Phase 13 | Phase 14 |
|---|---|---|
| Launch → main menu | 8.6–11.4 s | 5.9–10.4 s (no intro seen; `-novid` confirmed) |
| Demo load | 18.4–19.6 s | 4.3–6.0 s |
| Close | 3.4–5.0 s | 2.8 s |
| Console submission, 181 commands | 72.8 s typed | 13.7–14.7 s pasted (≈0.08 s each) |

**Seeking** (still at a fixed tick compared with the overshoot reference):
- Forward 64 / 200 / 400 ticks took 0.18–0.28 s; overshoot-and-back took 1.35–1.46 s.
- The stills matched the reference (mean pixel difference 2.3–2.5, from the HUD weapon highlight).
- **Gaps:** through a 600-tick gap, fast-forward at 8× plus the exact seek took 2.1 s; seeking alone took 0.58–0.62 s. Seeking is kept.

**Round 3 schedules** (6 kills + 10 throws = 22 clips + 10 lineup stills; start, load and close excluded):

| Schedule | Wall-clock | POV switches | Outputs | Failures |
|---|---|---|---|---|
| Phase 13 baseline (clips + kill stills) | 284.6 s | | 16 events | 0 |
| chronological, typed | 208.2 s | 20 | 18 / 22 | 4 (POV first on dead players; fixed below) |
| chronological | 148.3 s | 25 | 22 / 22 | 0 |
| player | 126.4 s | 13 | 22 / 22 | 0 |
| hybrid, 1.6 s wait after each POV switch | 145.9 s | 22 | 21 / 22 | 1 (ignored seek; fallback added) |
| **hybrid** | **107.3 s** | 24 | 22 / 22 | 0 |

- **Clip checks:** all decoded at 60/60 frames, worst lag 1.1 ticks, about 1 MB per clip.
- **Kill moment:** each victim clip switches to the death camera at the middle frame.
- **Lineups:** each lineup still is the thrower's view on the tick before release.
- **No resync wait:** the post-switch wait never caught a resync and cost about 1.2 s per switch, so it is off (`RESYNC_WAIT_S = 0`). Detection stays on.
- **Hybrid result:** **2.65× faster** than Phase 13 for the same round.

**Website, Capture this round** (round 17, Kills & Utility, hybrid):
- **Phase 14:** 11 of 11 ready in **121 s total**:
  - CS2 start 10.4 s;
  - load 4.3 s;
  - steps 100.4 s;
  - close 2.8 s;
  - 1 seek fallback used.
- **Phase 13:** 271 s for the same round.
- **Inspector:** both kill videos loaded at 1280×720 / 2.0 s, stacked; utility showed its 1280×720 lineup still and replay.

**Full-match estimate** (ESTIMATE, not a measured full-match run; per-event figures fitted to rounds 3 and 17, for 131 kills and 391 throws):
- Kills & Utility: about 1.0 h (was 2.4 h);
- Kills only: about 24 min (was 59 min);
- Utility only: about 36 min (was 1.5 h).

### Still needed / not verified
- Lineup stills are still a separate exact-tick still within the same pass. A 30 fps recording samples every ~2 ticks while playing, so the frame on the tick before release can't be identified reliably from it; pulling stills from the recording was not adopted.
- Spectating needs CS2's TrueView log lines (see Phase 13 limitations). A player CS2 can't spectate at the current position is handled by seeking first.
- Clipboard restore covers text only; images or files on the clipboard are lost during a capture.
- Share/import with drops and pickups is covered by API tests, not checked by hand in the browser.

## Phase 15: route pickups, lineup picker, grouped captures, shared inspector

### Tactics
- **Drops on the radar:** the **Drop item** tool in the map toolbar. Pick who drops what from the dropdowns, then click the map; the drop saves its position, floor and player with the phase. Select a drop to move it, change it or remove it.
- **Route-based pickups:** there are no manual pickups any more. A teammate whose route passes within reach of a dropped item (96 game units) on the same floor, after it lands, picks it up if they can carry it.
  - **Order:** when several players reach one item, the earliest takes it; exact ties go to the player key.
  - **Before the drop:** a route that crosses before the item is dropped leaves it there.
  - **Carry limits:** a player who can't carry the item passes it, and it stays.
  - **Later phases:** uncollected items stay on the map into later phases.
  - **Old data:** Phase 14 pickup annotations are accepted and discarded.
- **One simulation for everything:** `simulatePhase` / `phasePlan` in `domain/utility.js` (mirrored in `client/src/lib/utility.ts`, parity-tested) drives Play Phase, the phase-to-phase inventory, the editor's pickup notes and Game Mode's utility. So replaying a phase, stepping back or reloading always gives the same numbers.
- **Throw order in Player Instructions:** each player's card lists their throws and drops in order, with ↑ / ↓ to reorder. Only `seq` changes, so each marker keeps its player and throw path, also through share and import. Pickups made on that player's route and any problems are listed underneath.
- **Phase overview:**
  - **Player cards:** each player has a card with an **All instructions** control (role, instruction, utility in order, pickups, what they carry). Any teammate can use it; open cards stay open across phases.
  - **Utility table:** fixed-width grenade columns with the icon in the header and the count beneath. A dash means none. −thrown, ↓dropped, +picked up this phase.
- **Hold cones** pulse gently during Play Phase; the outline and direction stay solid.
- **Lineup picker** (Lineup picker tool):
  1. Choose the utility and the player, then click roughly where it should land.
  2. Matching throw origins are drawn on the radar and listed: same map, floor, utility and T/CT side, landing within 5% of the radar width of the click.
  3. Choose one: the confirmation lists every change before you apply it (player moved or placed at the start, the throw added at the landing). For running or run-jump throws it adds the run-up from start to release as the player's route, replacing their routes in that phase, and says so.
  - **Attribution:** the throw keeps an attributed **View lineup on CSNADES.gg** link to that exact entry. It's shown in the editor, the tactic view and Game Mode, and travels through share and import.
- **Lineup catalogue (`domain/lineups.js`, `GET /api/lineups?map=`):** a small manually supplied test set on Ancient:
  - Top Mid from T Spawn (standing jump throw);
  - Top Mid from T Spawn 1 (run-jump);
  - Elbow from CT Spawn (standing jump throw).

  The links are to individual CSNADES entries, checked by hand. Radar positions come from real throws in `spirit-vs-g2-m3-ancient`, not from CSNADES. Nothing else from CSNADES is copied; bulk import waits for their confirmation. Which numbered "Top Mid from T Spawn" variant matches our run-jump throw exactly still needs confirming.
- Local trial data: `node scripts/seed-phase15-demo.js`, after the Phase 14 seed (development only).

### Replay Inspector and live review
- **Grouped events** (`services/capturePlan.js`):
  - **Grouping rule:** nearby events by one player in a round are grouped when each is within **3 s** of the previous one and the whole group spans at most **8 s**.
  - **Kills:** grouped kills need the same killer and the same capture settings (X-ray). They share one continuous Killer POV clip, from 1 s before the first kill to 1 s after the last. Each kill keeps its own Victim POV clip, shown as tabs below.
  - **Throws:** grouped throws share one throw clip, and each keeps its own lineup still and tab.
  - **Stable identities:** the shared clip is recorded once and hard-linked into every member capture, so each event keeps its identity and its own media. Single events and older captures play as before.
  - **Opening a group:** choosing any member from the timeline opens the shared clip a second before that event and selects its tab.
  - **In the Ancient demo:** 16 kill groups and 62 throw groups. Verified live: zont1x's three kills in round 17, sh1ro's and tN1R's doubles in round 3, and donk's molotov + HE in round 3.
- **Shared selection in live review:**
  - **Host:** the host's selected event and its victim / lineup tab are part of the review state (`review_sessions.inspect`). They travel with the host's seek, or on their own without moving playback.
  - **Followers and late joiners:** they get them from the normal sync and fetch the team-scoped media. Pending or uncaptured media shows per slot ("Not captured yet", "Capturing…") while the radar replay continues.
  - **Peeking:** a follower can look at another event locally until the host picks a new one.
- **Lineup still timing** (`services/throwSetup.js`, per-tick samples from `workers/demo-throws-child.js`):
  - **What it picks:** the still is the player's stable aim before the throw's setup movement (jump, run-up), not the tick before release.
  - **Standing throws** keep the tick before release.
  - **No still moment:** when there is none within 3 s, the tick before release is kept and the inspector says so.
  - **Verified live** (POV and tick confirmed from CS2's log):
    - standing (zont1x, round 3): same frame as before;
    - jump (sh1ro, round 17): ground-level aim 13 ticks earlier instead of mid-air;
    - running (donk, round 17): aim from the run start;
    - run-jump (sh1ro, round 3): aim at the start position, 31 ticks before release, instead of airborne at the release point.
  - **Across the demo's 391 throws:** 222 have a reliable setup frame; the rest are mostly mid-fight molotovs and flashes thrown on the move.
- **Crosshair zoom:** 1×, 2×, 4×, 6× and 8× around the frame centre with the thin green crosshair. At 720p, roof edge, tile rows and foliage stay recognisable to 6×; 8× is soft.

### Capture speed (17 Nov 2026, RTX 4090, `tools/cs2-capture/bench15.py` and the website)
- **Frame grabbing:**
  - **Cause:** Phase 13's ~40 grabs/s limit was the per-frame `pgrep` check (~6 ms), not the window.
  - **Now:** with a cached PID, grabs run at 210–217/s (XGetImage) and up to 274/s with the new MIT-SHM grabber. The grabber is checked against XGetImage on start: mean difference 0.18.
- **Kill footage at 2× (round 17, 6 kills, 10 clips, grouped):**

| | 1× | 2× (60+ grabs/s retimed to 30 fps) |
|---|---|---|
| Wall-clock (seek, POV, recording, encoding) | 56.6 s | 46.3 s (−18%) |
| Recording | 30.5 s | 19.9 s |
| Decoded frames | 60/60 per clip | 60/60 per clip |
| Distinct frames, worst clip | 97% | 83% |
| Worst lag | 0.08 ticks | 2.07 ticks (≈1 output frame) |
| Death camera frame in victim clips | 30, 30, 24, 30, 30, 37 | 30, 29, 24, 30, 30, 37 |

  - **Round 3 at 2×:** five segments dropped to 62% distinct frames and 3.5 ticks of lag. The new automatic check (under 75% distinct or over 3 ticks → record again at 1×) caught them, but recording twice cost more than 2× saved.
  - **Decision:** 2× stays **opt-in** (`CAPTURE_KILL_TIMESCALE=2`, with the 1× fallback); the proven 1× path is the default. Utility always records at 1×, in its own segments.
- **Website, Capture this round:**
  - **Round 17 (Kills & Utility):** 11/11 in **95.4 s** total, with kills at 2× and no fallbacks. Phase 14: 121 s; Phase 13: 271 s.
  - **Round 3 (Kills & Utility):** 16/16 in 151.8 s, including five 2× fallbacks.
  - **Seek fix:** the first round 3 run lost a throw to a seek CS2 interrupted with its own resync (skip to the tick before, resume) before reporting the tick. Seeks now detect that and seek again; the rerun had no failures and 2.4 s of idle time.
- **Estimates:** capture estimates are unchanged (Phase 14 figures). These runs mixed 2× attempts and fallbacks, so they don't give a clean per-event figure for the 1× default.

### Still needed / not verified
- The lineup catalogue is a three-entry test set; more entries (and every map) need supplied data or CSNADES's permission.
- Share / import with lineup references is covered by API tests, not checked by hand in the browser.
- Game Mode shows the lineup link through the same gallery as the tactic view; not checked by hand in a live Game Mode session.
- A run-jump or running throw with no still moment in the 3 s before release keeps the tick-before-release still, with the limitation shown.

## Contact

Daniel Caddick, caddickdaniel93@gmail.com
Project link: https://github.com/caddickdaniel/cs-trainer
