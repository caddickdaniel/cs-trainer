// Community tactic library. A team publishes a snapshot of one of its tactics;
// any signed-in user can browse, preview and vote on it, and a team lead can
// import it as an independent copy.
//
// Privacy: the snapshot never contains user ids, user names, team identity or
// reference URLs. Players become stable slots (Player 1-5). Lineup screenshots
// are copied into the listing (shared_tactic_images) when the publisher opts
// in, so a team's private image endpoint is never referenced; importing copies
// them again into the importing team's private library.
const crypto = require('crypto');
const db = require('../db/connection');
const C = require('../domain/constants');
const { badRequest, conflict, forbidden, notFound } = require('../errors');
const { getAccess, requireLead } = require('./access');
const { loadTactic, loadPhases, writePhases, tacticRow } = require('./tactics');

const LISTING_COLUMNS = [
  's.share_id', 's.tactic_name', 's.map', 's.side', 's.economy', 's.phase_count', 's.import_count',
  's.published_at', 's.updated_at',
];

const keyOf = (item) => {
  if (item.user_id != null) return `u${item.user_id}`;
  if (item.slot != null) return `s${item.slot}`;
  return null;
};

// Builds the public snapshot of a tactic document. Players are numbered in
// order of first appearance; anyone beyond the fifth player loses their
// identity (their items stay, unassigned, and their instructions are dropped).
function buildSnapshot(tactic, phases, { includeImages }) {
  const slots = new Map();
  const visit = (item) => {
    const key = keyOf(item);
    if (key && !slots.has(key) && slots.size < C.LIMITS.slots) slots.set(key, slots.size + 1);
  };
  for (const p of phases) {
    p.assignments.forEach(visit);
    p.board.markers.filter((m) => m.kind === 'player').forEach(visit);
    p.board.markers.forEach(visit);
    p.board.routes.forEach(visit);
  }
  // Buy lists and the bomb carrier keep their player's slot (or take the next one).
  (tactic.loadouts || []).forEach(visit);
  if (tactic.bomb_carrier) visit(tactic.bomb_carrier);
  const slotOf = (item) => {
    const key = keyOf(item);
    return key ? slots.get(key) ?? null : null;
  };
  const allPlayers = new Set();
  phases.forEach((p) => [...p.assignments, ...p.board.markers, ...p.board.routes].forEach((i) => keyOf(i) && allPlayers.add(keyOf(i))));
  const imageIds = new Set();

  const snapshotPhases = phases.map((p) => ({
    name: p.name,
    notes: p.notes,
    board: {
      markers: p.board.markers.map((m) => {
        const images = includeImages ? (m.images || []) : [];
        images.forEach((i) => imageIds.add(i.image_id));
        const out = {
          id: m.id, kind: m.kind, x: m.x, y: m.y, level: m.level || 'main',
          user_id: null, slot: slotOf(m), label: m.kind === 'player' ? '' : m.label || '',
          images: images.map((i) => ({ image_id: i.image_id, caption: i.caption || '' })),
        };
        if (m.size != null) out.size = m.size;
        if (m.reference) out.reference = true;
        return out;
      }),
      routes: p.board.routes.map((r) => ({
        id: r.id, level: r.level || 'main', user_id: null, slot: slotOf(r), color: r.color, points: r.points,
      })),
      holds: (p.board.holds || []).map((h) => ({ id: h.id, marker_id: h.marker_id, angle: h.angle, spread: h.spread, length: h.length })),
    },
    assignments: p.assignments
      .map((a) => ({ slot: slotOf(a), instruction: a.instruction, utility: a.utility }))
      .filter((a) => a.slot != null)
      .sort((a, b) => a.slot - b.slot),
  }));

  return {
    snapshot: {
      tactic: {
        tactic_name: tactic.tactic_name,
        map: tactic.map,
        side: tactic.side,
        economy: tactic.economy,
        grenade: tactic.grenade,
        molly: tactic.molly,
        flash: tactic.flash,
        smoke: tactic.smoke,
        loadouts: (tactic.loadouts || []).map((l) => ({ ...l, user_id: null, slot: slotOf(l) })).filter((l) => l.slot != null),
        bomb_carrier: tactic.side === 'T' && tactic.bomb_carrier && slotOf(tactic.bomb_carrier) != null
          ? { user_id: null, slot: slotOf(tactic.bomb_carrier) } : null,
      },
      slot_count: slots.size,
      phases: snapshotPhases,
    },
    imageIds: [...imageIds],
    droppedPlayers: Math.max(0, allPlayers.size - slots.size),
  };
}

async function loadForLead(tacticId, userId, trx = db) {
  const tactic = await loadTactic(tacticId, trx).catch(() => null);
  if (!tactic) throw notFound('Tactic not found');
  await requireLead(tactic.team_id, userId, trx).catch((err) => {
    if (err.status === 404) throw notFound('Tactic not found');
    throw err;
  });
  if (!tactic.map || !tactic.side || !C.ECONOMIES.includes(tactic.economy)) {
    throw badRequest('Set the map, side and economy before sharing this tactic', 'tactic_incomplete');
  }
  return tactic;
}

const activeListing = (trx, tacticId) => trx('shared_tactics')
  .where({ source_tactic_id: tacticId }).whereNull('withdrawn_at').first();

const imagePath = (shareId, imageId) => `/api/shared-tactics/${shareId}/images/${imageId}`;

// What would be published, for the Share dialog.
async function sharePreview(tacticId, userId, { include_images: includeImages = true } = {}) {
  const tactic = await loadForLead(tacticId, userId);
  const phases = await loadPhases(tacticId);
  const { snapshot, imageIds, droppedPlayers } = buildSnapshot(tactic, phases, { includeImages });
  // Screenshots get new ids when copied into the listing; never show the
  // team's private image ids in the preview.
  const placeholder = new Map(imageIds.map((id, i) => [id, `copied-screenshot-${i + 1}`]));
  for (const p of snapshot.phases) {
    for (const m of p.board.markers) m.images = m.images.map((i) => ({ ...i, image_id: placeholder.get(i.image_id) }));
  }
  const listing = await activeListing(db, tacticId);
  return {
    listing: listing ? await presentListing(listing, userId) : null,
    preview: snapshot,
    image_count: imageIds.length,
    dropped_players: droppedPlayers,
    out_of_date: Boolean(listing && listing.source_revision !== tactic.revision),
  };
}

// Publishes a new listing, or replaces the snapshot of the tactic's listing.
async function publish(tacticId, userId, { include_images: includeImages = true } = {}) {
  const shareId = await db.transaction(async (trx) => {
    const tactic = await loadForLead(tacticId, userId, trx);
    await trx('tactics').where('tactic_id', tacticId).forUpdate().first('tactic_id');
    const phases = await loadPhases(tacticId, trx);
    const { snapshot, imageIds } = buildSnapshot(tactic, phases, { includeImages });
    const row = {
      tactic_name: tactic.tactic_name,
      map: tactic.map,
      side: tactic.side,
      economy: tactic.economy,
      phase_count: phases.length,
      source_revision: tactic.revision,
      published_by: userId,
    };
    let listing = await activeListing(trx, tacticId);
    if (listing) {
      await trx('shared_tactic_images').where('share_id', listing.share_id).del();
    } else {
      [listing] = await trx('shared_tactics')
        .insert({ ...row, source_team_id: tactic.team_id, source_tactic_id: tacticId, snapshot: JSON.stringify({}) })
        .returning('*');
    }
    // Copy screenshots into the listing under new ids.
    const rename = new Map();
    if (imageIds.length) {
      const images = await trx('lineup_images').where('team_id', tactic.team_id).whereIn('image_id', imageIds)
        .select('image_id', 'content_type', 'byte_size', 'width', 'height', 'sha256', 'data');
      for (const img of images) {
        const newId = crypto.randomUUID();
        rename.set(img.image_id, newId);
        await trx('shared_tactic_images').insert({ ...img, image_id: newId, share_id: listing.share_id });
      }
    }
    for (const p of snapshot.phases) {
      for (const m of p.board.markers) {
        m.images = m.images.filter((i) => rename.has(i.image_id)).map((i) => ({ ...i, image_id: rename.get(i.image_id) }));
      }
    }
    await trx('shared_tactics').where('share_id', listing.share_id)
      .update({ ...row, snapshot: JSON.stringify(snapshot), updated_at: trx.fn.now() });
    return listing.share_id;
  });
  return getListing(shareId, userId);
}

// Withdrawing stops browsing, previews, votes and new imports. Copies already
// imported are independent and keep working.
async function withdraw(shareId, userId) {
  const listing = await db('shared_tactics').where('share_id', shareId).whereNull('withdrawn_at').first();
  if (!listing) throw notFound('Shared tactic not found');
  const access = await getAccess(listing.source_team_id, userId);
  if (!access || !access.isMember) throw notFound('Shared tactic not found');
  if (!access.canLead) throw forbidden('Only the team owner or an IGL can withdraw a shared tactic');
  await db.transaction(async (trx) => {
    await trx('shared_tactics').where('share_id', shareId).update({ withdrawn_at: trx.fn.now(), updated_at: trx.fn.now() });
    await trx('shared_tactic_images').where('share_id', shareId).del();
  });
  return { withdrawn: true };
}

function scoreColumns(userId) {
  return [
    db.raw('coalesce((select sum(v.value)::int from shared_tactic_votes v where v.share_id = s.share_id), 0) as score'),
    db.raw('(select count(*)::int from shared_tactic_votes v where v.share_id = s.share_id and v.value = 1) as upvotes'),
    db.raw('(select count(*)::int from shared_tactic_votes v where v.share_id = s.share_id and v.value = -1) as downvotes'),
    db.raw('(select v.value from shared_tactic_votes v where v.share_id = s.share_id and v.user_id = ?) as my_vote', [userId]),
    db.raw(`exists(select 1 from team_memberships m where m.team_id = s.source_team_id and m.user_id = ?) as is_mine`, [userId]),
  ];
}

async function presentListing(row, userId) {
  const full = row.score === undefined
    ? await db('shared_tactics as s').where('s.share_id', row.share_id).first([...LISTING_COLUMNS, ...scoreColumns(userId)])
    : row;
  return {
    share_id: full.share_id,
    tactic_name: full.tactic_name,
    map: full.map,
    side: full.side,
    economy: full.economy,
    phase_count: full.phase_count,
    import_count: full.import_count,
    published_at: full.published_at,
    updated_at: full.updated_at,
    score: full.score,
    upvotes: full.upvotes,
    downvotes: full.downvotes,
    my_vote: full.my_vote ?? 0,
    is_mine: Boolean(full.is_mine),
  };
}

async function listShared(userId, { map, side, economy, sort = 'top', q } = {}) {
  let query = db('shared_tactics as s').whereNull('s.withdrawn_at')
    .select([...LISTING_COLUMNS, ...scoreColumns(userId)]);
  if (map) query = query.where('s.map', map);
  if (side) query = query.where('s.side', side);
  if (economy) query = query.where('s.economy', economy);
  if (q) query = query.whereILike('s.tactic_name', `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  query = sort === 'new'
    ? query.orderBy([{ column: 's.published_at', order: 'desc' }, { column: 's.share_id', order: 'desc' }])
    : query.orderByRaw('score desc, s.published_at desc, s.share_id desc');
  const rows = await query.limit(200);
  return { tactics: await Promise.all(rows.map((r) => presentListing(r, userId))) };
}

async function loadActive(shareId) {
  const row = await db('shared_tactics').where('share_id', shareId).whereNull('withdrawn_at').first();
  if (!row) throw notFound('Shared tactic not found');
  return row;
}

async function getListing(shareId, userId) {
  const row = await loadActive(shareId);
  const snapshot = row.snapshot;
  for (const p of snapshot.phases) {
    for (const m of p.board.markers) {
      m.images = (m.images || []).map((i) => ({ ...i, url: imagePath(shareId, i.image_id) }));
    }
  }
  return { tactic: { ...(await presentListing(row, userId)), ...snapshot.tactic, slot_count: snapshot.slot_count, phases: snapshot.phases } };
}

async function vote(shareId, userId, value) {
  const row = await loadActive(shareId);
  const access = await getAccess(row.source_team_id, userId);
  if (access && access.isMember) throw forbidden("You can't vote on your own team's tactic", 'own_listing');
  if (value === 0) {
    await db('shared_tactic_votes').where({ share_id: shareId, user_id: userId }).del();
  } else {
    await db('shared_tactic_votes')
      .insert({ share_id: shareId, user_id: userId, value })
      .onConflict(['share_id', 'user_id'])
      .merge({ value, updated_at: db.fn.now() });
  }
  return { tactic: await presentListing(row, userId) };
}

async function fetchImage(shareId, imageId) {
  await loadActive(shareId);
  const img = await db('shared_tactic_images').where({ share_id: shareId, image_id: imageId })
    .first('content_type', 'data', 'sha256');
  if (!img) throw notFound('Image not found');
  return img;
}

// Copies a listing into the team's library as an independent tactic whose
// players are slots until the team maps them in the editor.
async function importShared(shareId, userId, { team_id: teamId, tactic_name: name }) {
  await requireLead(teamId, userId);
  const tacticId = await db.transaction(async (trx) => {
    const row = await trx('shared_tactics').where('share_id', shareId).whereNull('withdrawn_at').forUpdate().first();
    if (!row) throw notFound('Shared tactic not found');
    const snap = row.snapshot;
    const imageIds = [...new Set(snap.phases.flatMap((p) => p.board.markers.flatMap((m) => (m.images || []).map((i) => i.image_id))))];
    const rename = new Map();
    if (imageIds.length) {
      const { count } = await trx('lineup_images').where('team_id', teamId).count('* as count').first();
      if (Number(count) + imageIds.length > C.LIMITS.imagesPerTeam) {
        throw conflict(`Importing would exceed this team's limit of ${C.LIMITS.imagesPerTeam} lineup images`, 'image_quota');
      }
      const images = await trx('shared_tactic_images').where('share_id', shareId).whereIn('image_id', imageIds)
        .select('image_id', 'content_type', 'byte_size', 'width', 'height', 'sha256', 'data');
      for (const img of images) {
        const newId = crypto.randomUUID();
        rename.set(img.image_id, newId);
        await trx('lineup_images').insert({ ...img, image_id: newId, team_id: teamId, uploaded_by: userId });
      }
    }
    const phases = snap.phases.map((p) => ({
      name: p.name,
      notes: p.notes,
      board: {
        markers: p.board.markers.map((m) => ({
          ...m,
          user_id: null,
          images: (m.images || []).filter((i) => rename.has(i.image_id)).map((i) => ({ image_id: rename.get(i.image_id), caption: i.caption })),
        })),
        routes: p.board.routes.map((r) => ({ ...r, user_id: null })),
        holds: p.board.holds || [],
      },
      assignments: p.assignments.map((a) => ({ user_id: null, slot: a.slot, instruction: a.instruction, utility: a.utility, reference_url: null })),
    }));
    const doc = { ...snap.tactic, tactic_name: name || snap.tactic.tactic_name };
    const [{ tactic_id }] = await trx('tactics')
      .insert({
        ...tacticRow(doc),
        team_id: teamId,
        steps: JSON.stringify([]),
        created_by: userId,
        updated_by: userId,
        imported_from_share_id: shareId,
      })
      .returning('tactic_id');
    await writePhases(trx, tactic_id, phases);
    await trx('shared_tactics').where('share_id', shareId).increment('import_count', 1);
    return tactic_id;
  });
  return { tactic_id: tacticId };
}

module.exports = {
  buildSnapshot, sharePreview, publish, withdraw, listShared, getListing, vote, fetchImage, importShared,
};
