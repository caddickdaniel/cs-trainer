// Request validation at the API boundary (zod).
const { z } = require('zod');
const C = require('../domain/constants');

const id = z.coerce.number().int().positive().max(2147483647);
const trimmed = (max) => z.string().trim().max(max);
const optionalText = (max) => trimmed(max).optional().nullable();

exports.z = z;
exports.id = id;

exports.parseId = (value, name = 'id') => {
  const result = id.safeParse(value);
  if (!result.success) {
    const { badRequest } = require('../errors');
    throw badRequest(`${name} must be a positive integer`, 'invalid_id');
  }
  return result.data;
};

exports.signup = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address')),
  user_name: trimmed(32).min(2, 'Username must be at least 2 characters')
    .regex(/^[\p{L}\p{N} _.-]+$/u, 'Username may contain letters, numbers, spaces, _ . and -'),
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

exports.steamComplete = z.object({
  user_name: trimmed(32).min(2, 'Username must be at least 2 characters')
    .regex(/^[\p{L}\p{N} _.-]+$/u, 'Username may contain letters, numbers, spaces, _ . and -'),
  use_avatar: z.boolean().optional().default(false),
  use_profile_url: z.boolean().optional().default(true),
});
exports.steamPrefill = z.object({ profile_url: z.boolean().optional().default(false), avatar: z.boolean().optional().default(false) });

exports.addPassword = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address')),
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

exports.signin = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().min(1).max(200),
});

const CAT = require('../domain/catalogue');

// Team recruitment requirements and competitions (catalogue values only).
const rankRequirements = z.array(z.object({
  platform: z.enum(CAT.PLATFORM_IDS),
  min: z.string().max(30),
  max: z.string().max(30),
}).strict()).max(CAT.PLATFORM_IDS.length).superRefine((list, ctx) => {
  const seen = new Set();
  list.forEach((r, i) => {
    const problem = CAT.checkRequirement(r);
    if (problem) ctx.addIssue({ code: 'custom', path: [i], message: problem });
    if (seen.has(r.platform)) ctx.addIssue({ code: 'custom', path: [i], message: 'Add at most one requirement per platform' });
    seen.add(r.platform);
  });
});
const competitions = z.array(z.enum(CAT.COMPETITION_IDS)).max(CAT.COMPETITION_IDS.length).transform((l) => [...new Set(l)]);

const teamFields = {
  team_name: trimmed(60).min(2, 'Team name must be at least 2 characters'),
  language: optionalText(40),
  region: optionalText(40),
  platform: optionalText(40),
  skill_level: optionalText(40),
  description: optionalText(1000),
};
const teamExtras = () => ({ rank_requirements: rankRequirements.optional(), competitions: competitions.optional() });
exports.createTeam = z.object({ ...teamFields, ...teamExtras() });
exports.patchTeam = z.object({ ...teamFields, ...teamExtras() }).partial();

exports.createInvite = z.object({
  expires_in_hours: z.coerce.number().refine((h) => C.INVITE_TTL_HOURS.includes(h), {
    message: `expires_in_hours must be one of ${C.INVITE_TTL_HOURS.join(', ')}`,
  }).default(72),
  max_uses: z.coerce.number().int().min(1).max(20).optional().nullable(),
});

exports.inviteToken = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/, 'Invalid invite code');

exports.patchMember = z.object({
  is_igl: z.boolean().optional(),
  player_role: z.enum(C.PLAYER_ROLES).nullable().optional(),
}).refine((v) => v.is_igl !== undefined || v.player_role !== undefined, 'Nothing to update');

exports.recruiting = z.object({
  is_recruiting: z.boolean().optional(),
  recruiting_leagues: optionalText(300),
  competitions: competitions.optional(),
  rank_requirements: rankRequirements.optional(),
  roles_needed: z.array(z.enum(C.PLAYER_ROLES)).max(7)
    .transform((list) => [...new Set(list)]).optional(),
  recruiting_notes: optionalText(1000),
});

exports.invitePlayer = z.object({ user_id: id });
exports.joinRequest = z.object({ message: trimmed(500).optional().default('') });

// Profile links must be https URLs on the matching site.
const profileLink = (field) => z.string().trim().max(300).nullable().optional()
  .transform((v) => (v === '' ? null : v))
  .refine((v) => {
    if (v == null) return true;
    try {
      const url = new URL(v);
      return url.protocol === 'https:' && C.PROFILE_LINK_HOSTS[field].includes(url.hostname.toLowerCase());
    } catch {
      return false;
    }
  }, { message: `Must be an https link to ${C.PROFILE_LINK_HOSTS[field][0]}` });


const rankFor = (platform) => z.string().max(30).nullable().optional()
  .refine((v) => v == null || v === '' || CAT.isValidRank(platform, v), { message: `Choose a ${platform} rank from the list` });

exports.profile = z.object({
  language: optionalText(40),
  region: optionalText(40),
  // Self-reported ranks, one per platform. Omitted platforms are left unchanged.
  ranks: z.object(Object.fromEntries(CAT.PLATFORM_IDS.map((p) => [p, rankFor(p)]))).strict().optional(),
  clear_legacy_rank: z.boolean().optional(),
  bio: optionalText(1000),
  steam_url: profileLink('steam_url'),
  faceit_url: profileLink('faceit_url'),
  esea_url: profileLink('esea_url'),
  hltv_url: profileLink('hltv_url'),
});

exports.statsSettings = z.object({
  track: z.boolean().optional(),
  visibility: z.enum(['private', 'profile']).optional(),
});

exports.playerFilters = z.object({
  language: z.string().max(40).optional(),
  region: z.string().max(40).optional(),
  ...Object.fromEntries(CAT.PLATFORM_IDS.map((p) => [p, z.string().max(30).optional()])),
});

exports.rankRequirements = rankRequirements;
exports.competitions = competitions;

// Key bindings such as "ArrowRight", "N", "Shift+N", "Ctrl+]".
const binding = z.string().max(40).regex(/^((Ctrl|Alt|Shift|Meta)\+){0,3}([A-Z0-9]|F[1-9]|F1[0-2]|Arrow(Up|Down|Left|Right)|Space|Enter|Tab|Backspace|Delete|Home|End|PageUp|PageDown|Insert|[[\]\\;',./`=-])$/,
  'Unsupported key binding');
exports.settings = z.object({
  shortcuts: z.object(Object.fromEntries(C.SHORTCUT_ACTIONS.map((a) => [a, binding]))).nullable().optional()
    .superRefine((value, ctx) => {
      if (!value) return;
      const seen = new Map();
      for (const [action, key] of Object.entries(value)) {
        if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [action], message: `Conflicts with ${seen.get(key)}` });
        seen.set(key, action);
      }
    }),
});

// Calendar events. starts_at must include an offset (e.g. toISOString()).
const isoInstant = z.string().max(40).refine((v) => /(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v)),
  'Start time must be an ISO 8601 timestamp with a time zone offset');
const timeZone = z.string().max(64).refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown time zone');
exports.event = z.object({
  kind: z.enum(C.EVENT_KINDS),
  // Demo Review events may link a demo from the team's library.
  demo_id: id.nullable().optional(),
  title: trimmed(80).min(1, 'Title is required'),
  starts_at: isoInstant,
  time_zone: timeZone,
  opponent: optionalText(80),
  notes: trimmed(2000).optional().default(''),
});
exports.eventPatch = exports.event.partial();
exports.eventRange = z.object({ from: isoInstant.optional(), to: isoInstant.optional() });

exports.gameCommand = z.object({
  action: z.enum(['phase_next', 'phase_prev', 'phase_goto', 'tactic_next', 'tactic_prev', 'tactic_select', 'switch_side', 'new_round']),
  index: z.number().int().min(0).optional(),
  tactic_id: id.optional(),
  expected_version: z.number().int().positive(),
}).refine((v) => v.action !== 'phase_goto' || v.index !== undefined, 'index is required for phase_goto')
  .refine((v) => v.action !== 'tactic_select' || v.tactic_id !== undefined, 'tactic_id is required for tactic_select');

// Board geometry: coordinates are normalised to the map (0..1) so they stay
// aligned at any rendered size.
const coord = z.number().finite().min(0).max(1);
const point = z.object({ x: coord, y: coord });
const clientId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const level = z.enum(C.LEVELS).optional().default('main');
const imageId = z.uuid();

const lineupImage = z.object({
  image_id: imageId,
  caption: trimmed(120).optional().default(''),
});

// Player slots (1-5) identify players in shared and imported tactics until the
// team maps them to its roster.
const slot = z.number().int().min(1).max(C.LIMITS.slots).nullable().optional().default(null);

const marker = z.object({
  id: clientId,
  kind: z.enum(C.MARKER_KINDS),
  x: coord,
  y: coord,
  level,
  user_id: id.nullable().optional().default(null),
  slot,
  // Player markers show initials; notes show this text on the board.
  label: trimmed(C.LIMITS.noteChars).optional().default(''),
  // Note font size in board units (notes only).
  size: z.number().int().min(C.NOTE_SIZE.min).max(C.NOTE_SIZE.max).optional(),
  // Utility markers assigned to a player are planned throws unless they are
  // only a reference (e.g. showing where a teammate's smoke lands).
  reference: z.boolean().optional(),
  // Lineup screenshots (uploaded via POST /api/teams/:team_id/lineup-images).
  images: z.array(lineupImage).max(C.LIMITS.imagesPerMarker).optional().default([]),
}).refine((m) => !m.images.length || C.LINEUP_KINDS.includes(m.kind), {
  message: 'Only utility and note markers can have lineup screenshots',
  path: ['images'],
}).refine((m) => m.kind === 'note' || m.label.length <= 40, {
  message: 'Labels can be at most 40 characters',
  path: ['label'],
});

const route = z.object({
  id: clientId,
  level,
  user_id: id.nullable().optional().default(null),
  slot,
  color: color.optional().default('#f5a524'),
  points: z.array(point).min(2).max(C.LIMITS.routePoints),
});

// A hold is an angle a player covers: a cone anchored to that player's marker
// (it takes the marker's position and floor). angle is the cone's centre in
// degrees (0 = right, 90 = down), spread its total width, length its reach as
// a fraction of the map width.
const hold = z.object({
  id: clientId,
  marker_id: clientId,
  angle: z.number().finite().min(-360).max(360),
  spread: z.number().finite().min(5).max(180),
  length: z.number().finite().min(0.02).max(0.6),
});

const board = z.object({
  markers: z.array(marker).max(C.LIMITS.markers).default([]),
  routes: z.array(route).max(C.LIMITS.routes).default([]),
  holds: z.array(hold).max(C.LIMITS.holds).default([]),
}).superRefine((b, ctx) => {
  const ids = [...b.markers, ...b.routes, ...b.holds].map((x) => x.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Board item ids must be unique' });
  const players = new Set(b.markers.filter((m) => m.kind === 'player').map((m) => m.id));
  b.holds.forEach((h, i) => {
    if (!players.has(h.marker_id)) {
      ctx.addIssue({ code: 'custom', path: ['holds', i, 'marker_id'], message: 'A hold must belong to a player marker on this phase' });
    }
  });
});
exports.board = board;

const assignment = z.object({
  user_id: id.nullable().optional().default(null),
  slot,
  instruction: trimmed(2000).default(''),
  utility: trimmed(1000).default(''),
  reference_url: z.string().trim().max(500).optional().nullable()
    .refine((v) => !v || /^https?:\/\//i.test(v), 'Reference must be an http(s) URL'),
}).refine((a) => a.user_id != null || a.slot != null, 'An instruction needs a player or a player slot');

const phase = z.object({
  name: trimmed(60).min(1, 'Every phase needs a name'),
  notes: trimmed(2000).default(''),
  board: board.default({ markers: [], routes: [] }),
  assignments: z.array(assignment).max(10).default([]).superRefine((list, ctx) => {
    const ids = list.map((a) => (a.user_id != null ? `u${a.user_id}` : `s${a.slot}`));
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'A player can only have one instruction per phase' });
  }),
});

const utilityCount = (max) => z.coerce.number().int().min(0).max(max);

// One player's buy list (CS2 carry limits: 1 smoke, 2 flashes, 1 molotov or
// incendiary, 1 HE, at most 4 grenades; a defuse kit on CT).
const U = require('../domain/utility');
const loadout = z.object({
  user_id: id.nullable().optional().default(null),
  slot,
  smoke: z.number().int().min(0).max(U.BUY_LIMITS.smoke).default(0),
  flash: z.number().int().min(0).max(U.BUY_LIMITS.flash).default(0),
  molly: z.number().int().min(0).max(U.BUY_LIMITS.molly).default(0),
  he: z.number().int().min(0).max(U.BUY_LIMITS.he).default(0),
  kit: z.boolean().default(false),
}).refine((l) => l.user_id != null || l.slot != null, 'A buy list needs a player or a player slot')
  .refine((l) => l.smoke + l.flash + l.molly + l.he <= U.MAX_GRENADES, `A player can carry at most ${U.MAX_GRENADES} grenades`);
const owner = z.object({ user_id: id.nullable().optional().default(null), slot })
  .refine((o) => o.user_id != null || o.slot != null, 'Choose a player or a player slot');
const playerColor = z.object({ user_id: id.nullable().optional().default(null), slot, color: z.enum(C.PLAYER_COLOR_IDS) })
  .refine((o) => o.user_id != null || o.slot != null, 'A colour needs a player or a player slot');

const tacticDocumentBase = z.object({
  tactic_name: trimmed(60).min(1, 'Name is required'),
  map: z.enum(C.MAPS),
  side: z.enum(C.SIDES),
  economy: z.enum(C.ECONOMIES),
  grenade: utilityCount(5).default(0),
  molly: utilityCount(5).default(0),
  flash: utilityCount(10).default(0),
  smoke: utilityCount(5).default(0),
  loadouts: z.array(loadout).max(10).default([]).superRefine((list, ctx) => {
    const keys = list.map(U.ownerKey);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', message: 'A player can only have one buy list' });
  }),
  // T only: who carries the bomb.
  bomb_carrier: owner.nullable().optional().default(null),
  // In-game colours: one per player, each colour used once.
  player_colors: z.array(playerColor).max(C.PLAYER_COLOR_IDS.length).default([]).superRefine((list, ctx) => {
    const keys = list.map(U.ownerKey);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', message: 'A player can only have one colour' });
    const colors = list.map((c) => c.color);
    if (new Set(colors).size !== colors.length) ctx.addIssue({ code: 'custom', message: 'Each colour can only be given to one player' });
  }),
  phases: z.array(phase).min(1, 'Add at least one phase').max(C.LIMITS.phases),
});

// Board items may only use levels the chosen map has (e.g. lower on Nuke).
const checkLevels = (doc, ctx) => {
  if (doc.side !== 'T' && doc.bomb_carrier) ctx.addIssue({ code: 'custom', path: ['bomb_carrier'], message: 'Only T tactics have a bomb carrier' });
  if (doc.side !== 'CT') doc.loadouts.forEach((l, i) => { if (l.kit) ctx.addIssue({ code: 'custom', path: ['loadouts', i, 'kit'], message: 'Defuse kits are CT only' }); });
  const allowed = C.mapLevels(doc.map);
  doc.phases.forEach((p, pi) => {
    [...p.board.markers, ...p.board.routes].forEach((item) => {
      if (!allowed.includes(item.level)) {
        ctx.addIssue({
          code: 'custom',
          path: ['phases', pi, 'board', item.id, 'level'],
          message: `${doc.map} has no ${item.level} level`,
        });
      }
    });
  });
};

exports.tacticDocument = tacticDocumentBase.superRefine(checkLevels);
exports.tacticDocumentUpdate = tacticDocumentBase
  .extend({ revision: z.number().int().positive() })
  .superRefine(checkLevels);

// Legacy tactic payloads (POST/PATCH /api/tactics).
exports.legacyTactic = z.object({
  tactic_name: trimmed(60).min(1),
  economy: trimmed(40).min(1),
  grenade: utilityCount(5),
  molly: utilityCount(5),
  flash: utilityCount(10),
  smoke: utilityCount(5),
  team_id: id,
  T: z.boolean().optional(),
  CT: z.boolean().optional(),
});
exports.legacyTacticPatch = exports.legacyTactic.omit({ team_id: true }).partial();
exports.legacySteps = z.object({
  steps: z.array(z.object({
    user_id: id,
    step: z.number().int().min(0).max(1000),
    desc: trimmed(2000).optional().default(''),
    ref_img: trimmed(500).optional().default(''),
  }).passthrough()).max(500),
});

exports.legacyUserPatch = z.object({
  language: optionalText(40),
  region: optionalText(40),
  platform: optionalText(40),
  skill_level: optionalText(40),
  role: optionalText(40),
  team_id: id.optional().nullable(),
  avatar_url: optionalText(500),
  bio: optionalText(2000),
});

exports.imageId = imageId;

// Shared tactics.
exports.shareTactic = z.object({ include_images: z.boolean().optional().default(true) });
exports.vote = z.object({ value: z.union([z.literal(1), z.literal(-1), z.literal(0)]) });
exports.importShared = z.object({ team_id: id, tactic_name: trimmed(60).min(1).optional() });
exports.sharedQuery = z.object({
  map: z.enum(C.MAPS).optional(),
  side: z.enum(C.SIDES).optional(),
  economy: z.enum(C.ECONOMIES).optional(),
  sort: z.enum(['top', 'new']).optional().default('top'),
  q: z.string().trim().max(60).optional(),
});

// Demo Review.
exports.demoUploadQuery = z.object({
  title: z.string().trim().max(120).optional(),
  file_name: z.string().trim().max(255).optional(),
});
exports.shareCodeImport = z.object({
  share_code: z.string().trim().min(1, 'Paste a match share code').max(200),
  title: z.string().trim().max(120).optional(),
});
exports.demoPatch = z.object({ title: trimmed(120).min(1) });
const annPoint = z.object({ x: coord, y: coord });
exports.annotation = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('drawing'),
    round_number: z.number().int().min(1).max(200),
    tick: z.number().int().min(0),
    level: z.enum(C.LEVELS).optional().default('main'),
    data: z.object({ points: z.array(annPoint).min(2).max(400), color: color.optional().default('#ffd166') }),
  }),
  z.object({
    kind: z.literal('text'),
    round_number: z.number().int().min(1).max(200),
    tick: z.number().int().min(0),
    level: z.enum(C.LEVELS).optional().default('main'),
    data: z.object({ x: coord, y: coord, text: trimmed(200).min(1), color: color.optional().default('#ffd166') }),
  }),
  // A smoke, flash, HE or molotov placed on the radar.
  z.object({
    kind: z.literal('utility'),
    round_number: z.number().int().min(1).max(200),
    tick: z.number().int().min(0),
    level: z.enum(C.LEVELS).optional().default('main'),
    data: z.object({ x: coord, y: coord, utility: z.enum(['smoke', 'flash', 'he', 'molly']) }),
  }),
]);
// Editing a utility annotation: move it, change its type or floor.
exports.annotationPatch = z.object({
  x: coord.optional(),
  y: coord.optional(),
  utility: z.enum(['smoke', 'flash', 'he', 'molly']).optional(),
  level: z.enum(C.LEVELS).optional(),
}).refine((p) => Object.keys(p).length > 0, 'Nothing to update');
exports.reviewStart = z.object({ demo_id: id, round_number: z.number().int().min(1).optional() });
exports.reviewCommand = z.object({
  action: z.enum(['play', 'pause', 'seek', 'round', 'clear', 'speed']),
  tick: z.number().finite().min(0).optional(),
  round_number: z.number().int().min(1).optional(),
  speed: z.union([z.literal(0.5), z.literal(1), z.literal(2), z.literal(4)]).optional(),
  expected_version: z.number().int().positive(),
}).refine((c) => c.action !== 'seek' || c.tick !== undefined, 'tick is required for seek')
  .refine((c) => c.action !== 'round' || c.round_number !== undefined, 'round_number is required to change round')
  .refine((c) => c.action !== 'speed' || c.speed !== undefined, 'speed is required');
exports.startSession = z.object({ tactic_id: id });
exports.phaseChange = z.object({
  action: z.enum(['next', 'prev', 'goto']),
  index: z.number().int().min(0).optional(),
  expected_version: z.number().int().positive(),
}).refine((v) => v.action !== 'goto' || v.index !== undefined, 'index is required for goto');
exports.endSession = z.object({ expected_version: z.number().int().positive().optional() });

exports.sortQuery = (allowed, fallback) => z.object({
  sort_by: z.enum(allowed).optional().default(fallback),
  order: z.enum(['asc', 'desc']).optional().default('asc'),
});
