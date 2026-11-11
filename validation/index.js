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

exports.signin = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().min(1).max(200),
});

const teamFields = {
  team_name: trimmed(60).min(2, 'Team name must be at least 2 characters'),
  language: optionalText(40),
  region: optionalText(40),
  platform: optionalText(40),
  skill_level: optionalText(40),
  description: optionalText(1000),
};
exports.createTeam = z.object(teamFields);
exports.patchTeam = z.object(teamFields).partial();

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

const marker = z.object({
  id: clientId,
  kind: z.enum(C.MARKER_KINDS),
  x: coord,
  y: coord,
  level,
  user_id: id.nullable().optional().default(null),
  label: trimmed(40).optional().default(''),
  // Lineup screenshots (uploaded via POST /api/teams/:team_id/lineup-images).
  images: z.array(lineupImage).max(C.LIMITS.imagesPerMarker).optional().default([]),
}).refine((m) => !m.images.length || C.LINEUP_KINDS.includes(m.kind), {
  message: 'Only utility and note markers can have lineup screenshots',
  path: ['images'],
});

const route = z.object({
  id: clientId,
  level,
  user_id: id.nullable().optional().default(null),
  color: color.optional().default('#f5a524'),
  points: z.array(point).min(2).max(C.LIMITS.routePoints),
});

const board = z.object({
  markers: z.array(marker).max(C.LIMITS.markers).default([]),
  routes: z.array(route).max(C.LIMITS.routes).default([]),
}).superRefine((b, ctx) => {
  const ids = [...b.markers, ...b.routes].map((x) => x.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Board item ids must be unique' });
});
exports.board = board;

const assignment = z.object({
  user_id: id,
  instruction: trimmed(2000).default(''),
  utility: trimmed(1000).default(''),
  reference_url: z.string().trim().max(500).optional().nullable()
    .refine((v) => !v || /^https?:\/\//i.test(v), 'Reference must be an http(s) URL'),
});

const phase = z.object({
  name: trimmed(60).min(1, 'Every phase needs a name'),
  notes: trimmed(2000).default(''),
  board: board.default({ markers: [], routes: [] }),
  assignments: z.array(assignment).max(10).default([]).superRefine((list, ctx) => {
    const ids = list.map((a) => a.user_id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'A player can only have one instruction per phase' });
  }),
});

const utilityCount = (max) => z.coerce.number().int().min(0).max(max);

const tacticDocumentBase = z.object({
  tactic_name: trimmed(60).min(1, 'Name is required'),
  map: z.enum(C.MAPS),
  side: z.enum(C.SIDES),
  economy: z.enum(C.ECONOMIES),
  grenade: utilityCount(5).default(0),
  molly: utilityCount(5).default(0),
  flash: utilityCount(10).default(0),
  smoke: utilityCount(5).default(0),
  phases: z.array(phase).min(1, 'Add at least one phase').max(C.LIMITS.phases),
});

// Board items may only use levels the chosen map has (e.g. lower on Nuke).
const checkLevels = (doc, ctx) => {
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
