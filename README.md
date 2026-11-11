# CS-Trainer

CS-Trainer is a Counter-Strike 2 web app for teams. Teams plan rounds, give each player a job for every phase, and follow those instructions live on a second monitor in **Game Mode**.

**Milestone 1 (this branch):** a user signs up, creates a team, invites a teammate and builds a tactic. They then start it in Game Mode, and each teammate sees only the instructions assigned to them. Both users can refresh or reconnect and pick up at the current phase.

- [Quick start](#quick-start)
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

**Development accounts.** The seeds create `user-a@cs-trainer.test` … `user-l@cs-trainer.test`, plus `user-m@cs-trainer.test`, who has no team. Their password is `SEED_PASSWORD` in [db/seeds/index.js](db/seeds/index.js). User A owns *Team A* and has a demo tactic, *A Split (demo)*. User B is a member of Team A. Seeds are for development and test databases only.

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
| `npm run dev` | API (nodemon) and Vite dev server together |
| `npm test` | Mocha suite against `cs_trainer_test` |
| `npm run lint` | ESLint (server JS + client TS/React hooks) |
| `npm run typecheck` | `tsc --noEmit` for the client |
| `npm run build` | Type-checks and builds the client |
| `npm run check` | lint + typecheck + test + build (all passed together) |

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

- **Board.** An SVG with a 1000×1000 viewBox over an original schematic map, *Practice Yard*. Annotations are stored as 0–1 fractions of the map, so they stay aligned at any rendered size. The editor supports placing markers (player, smoke, flash, molotov, HE, note), dragging them, drawing routes and dragging route points. Markers can also be moved with the arrow keys or exact X/Y fields. Player instructions are edited in a plain form, so no drag gestures are needed.
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
- **Snapshots.** Starting Game Mode copies the tactic (phases, assignments, board, revision) into `game_sessions.snapshot`. Editing the saved tactic cannot change a running round.

## Data model and migration notes

The four new migrations only add things. The original tables, columns and IDs are kept.

| Migration | Adds |
| --- | --- |
| `…0100_add_auth_and_memberships` | `users.email` (unique, case-insensitive), `users.password_hash`, `user_sessions`, `team_memberships` (unique `(team_id, user_id)`, `is_igl`, `player_role`), `migration_review_items`, foreign keys `tactics.team_id → teams` and `users.team_id → teams` |
| `…0200_create_team_invites` | `team_invites` |
| `…0300_add_tactic_phases` | `tactics.map/side/revision/created_by/updated_by`, `tactic_phases` (ordered, with `board jsonb`), `phase_assignments` (unique per phase and player) |
| `…0400_create_game_sessions` | `game_sessions` with snapshot, version and the one-active-per-team index |

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
| `npm test` | **88 passing**: legacy endpoints 43, auth 10, teams/invites/permissions 14, tactics 6, Game Mode 9, migrations 6 |
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

1. **Training.** A team practice view for drills and lineup references. Scope: a drill list per team, with lineups that can link to a tactic phase or board marker, and owner/IGL-curated content. Reuses the board and the access checks. Not included: in-game automation or server configs.
2. **Schedule.** A team calendar for practice sessions with explicit time zones. Store UTC times plus the creator's IANA zone, render in each viewer's zone, and support recurring practices and RSVPs. Scope: create/edit by owner/IGL, view for members, and optional ICS export. Not included: external calendar sync.
3. **Steam sign-in.** An additional identity linked to an existing account. Scope: an OpenID 2.0 "link Steam" action for signed-in users, stored in a `user_identities` table that is unique per provider ID. Sign-in through a linked Steam identity comes after that. It never creates accounts implicitly or merges accounts automatically.
4. **Demo Review.** Start with a feasibility check of the CS Demo Manager integration suggested in this README: licensing, a headless or CLI parser, and the CS2 demo format. Then import one small sample demo into a separate `demos` store, showing rounds and a basic timeline. Linking rounds to tactics comes after that.
5. **Native overlay.** Evaluate separately after the browser Game Mode has been playtested. Consider anti-cheat and VAC policy, OS support, and whether a second-monitor page or a minimal always-on-top window is enough.

Other small follow-ups: a password reset / legacy-account claim flow, ownership transfer, a resolve action for review items, more maps, a public team directory, and push updates (SSE) instead of polling.

## Contact

Daniel Caddick, caddickdaniel93@gmail.com
Project link: https://github.com/caddickdaniel/cs-trainer
