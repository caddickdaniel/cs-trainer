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

## Contact

Daniel Caddick, caddickdaniel93@gmail.com
Project link: https://github.com/caddickdaniel/cs-trainer
