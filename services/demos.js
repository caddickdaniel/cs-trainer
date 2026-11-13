// Team demo library. Uploads stream to disk (never buffered in memory), are
// checked for the CS2 demo signature and queued for background parsing.
// Every route checks team membership; other teams get 404.
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const db = require('../db/connection');
const config = require('../config/env');
const C = require('../domain/constants');
const { badRequest, conflict, forbidden, httpError, notFound } = require('../errors');
const { requireMember, getAccess } = require('./access');
const { checkMagic } = require('./demoParse');
const demoJobs = require('./demoJobs');

const present = (d, names) => ({
  demo_id: d.demo_id,
  team_id: d.team_id,
  title: d.title,
  original_name: d.original_name,
  source: d.source || 'upload',
  share_code: d.share_code || null,
  byte_size: Number(d.byte_size),
  status: d.status,
  error_code: d.error_code,
  error_message: d.error_message,
  map: d.map,
  tickrate: d.tickrate,
  round_count: d.round_count,
  uploaded_by: d.uploaded_by ? { user_id: d.uploaded_by, user_name: names.get(d.uploaded_by) ?? null } : null,
  created_at: d.created_at,
  processed_at: d.processed_at,
});

async function userNames(ids) {
  const list = [...new Set(ids.filter((x) => x != null))];
  if (!list.length) return new Map();
  const rows = await db('users').whereIn('user_id', list).select('user_id', 'user_name');
  return new Map(rows.map((r) => [r.user_id, r.user_name]));
}

async function loadDemo(demoId, userId) {
  const demo = await db('demos').where('demo_id', demoId).first();
  if (!demo) throw notFound('Demo not found');
  const access = await getAccess(demo.team_id, userId);
  if (!access || !access.isMember) throw notFound('Demo not found');
  return { demo, access };
}

async function listDemos(teamId, userId) {
  const access = await requireMember(teamId, userId);
  const rows = await db('demos').where('team_id', teamId).orderBy('created_at', 'desc');
  const names = await userNames(rows.map((r) => r.uploaded_by));
  return {
    demos: rows.map((r) => present(r, names)),
    can_upload: true,
    can_manage: access.canLead,
    limits: { max_bytes: config.demoMaxBytes, per_team: config.demoDemosPerTeam },
    share_codes: require('./replayProvider').configured(),
  };
}

async function getDemo(demoId, userId) {
  const { demo, access } = await loadDemo(demoId, userId);
  const names = await userNames([demo.uploaded_by]);
  const rounds = demo.status === 'ready'
    ? await db('demo_rounds').where('demo_id', demoId).orderBy('round_number')
      .select('round_number', 'start_tick', 'freeze_end_tick', 'end_tick', 'winner', 'reason', 'ct_score', 't_score')
    : [];
  return {
    demo: {
      ...present(demo, names),
      players: (demo.meta && demo.meta.players) || [],
      rounds,
    },
    can_manage: access.canLead || demo.uploaded_by === userId,
    can_control_review: access.canControl,
  };
}

// Gzipped JSON for one round, sent as-is with Content-Encoding: gzip.
async function roundData(demoId, roundNumber, userId) {
  const { demo } = await loadDemo(demoId, userId);
  if (demo.status !== 'ready') throw conflict('This demo is not ready yet', 'demo_not_ready');
  const row = await db('demo_rounds').where({ demo_id: demoId, round_number: roundNumber }).first('data');
  if (!row) throw notFound('Round not found');
  return row.data;
}

const cleanName = (name) => path.basename(String(name || 'demo.dem')).replace(/[^\w .()[\]-]+/g, '_').slice(0, 255) || 'demo.dem';

// Streams the request body to a temporary file, enforcing the size limit and
// checking the CS2 demo signature from the first bytes.
async function upload(teamId, userId, req, { title, file_name: fileName } = {}) {
  await requireMember(teamId, userId);
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > config.demoMaxBytes) {
    throw httpError(413, `Demos can be at most ${Math.round(config.demoMaxBytes / 1048576)} MB`, 'demo_too_large');
  }
  const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type && type !== 'application/octet-stream') {
    throw httpError(415, 'Send the .dem file as application/octet-stream', 'unsupported_media_type');
  }
  const { count } = await db('demos').where('team_id', teamId).count('* as count').first();
  if (Number(count) >= config.demoDemosPerTeam) {
    throw conflict(`This team has reached its limit of ${config.demoDemosPerTeam} demos. Delete one to upload another.`, 'demo_quota');
  }
  await fsp.mkdir(config.demoStorageDir, { recursive: true });
  const key = `${crypto.randomUUID()}.dem`;
  const file = path.join(config.demoStorageDir, key);
  const hash = crypto.createHash('sha256');
  let size = 0;
  let head = Buffer.alloc(0);
  const out = fs.createWriteStream(file, { flags: 'wx' });
  try {
    await new Promise((resolve, reject) => {
      const fail = (err) => { req.unpipe(out); out.destroy(); reject(err); };
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > config.demoMaxBytes) {
          fail(httpError(413, `Demos can be at most ${Math.round(config.demoMaxBytes / 1048576)} MB`, 'demo_too_large'));
          req.resume();
          return;
        }
        if (head.length < 8) {
          head = Buffer.concat([head, chunk]).subarray(0, 8);
          if (head.length >= 8) {
            try { checkMagic(head); } catch (err) { fail(httpError(415, err.message, err.code)); req.resume(); return; }
          }
        }
        hash.update(chunk);
      });
      req.on('error', fail);
      req.on('aborted', () => fail(badRequest('The upload was interrupted', 'upload_aborted')));
      out.on('error', fail);
      out.on('finish', resolve);
      req.pipe(out);
    });
    if (size < 8) throw badRequest('The file is empty or too small to be a demo', 'not_a_demo');
  } catch (err) {
    await fsp.rm(file, { force: true });
    throw err;
  }
  const sha256 = hash.digest('hex');
  const existing = await db('demos').where({ team_id: teamId, sha256 }).first('demo_id', 'title', 'status');
  if (existing && existing.status === 'failed') {
    // Uploading a failed demo again retries the existing import (same file,
    // same id) instead of being blocked as a duplicate.
    await fsp.rm(file, { force: true });
    const [again] = await db('demos').where('demo_id', existing.demo_id)
      .update({ status: 'queued', attempts: 0, error_code: null, error_message: null }).returning('*');
    demoJobs.notifyQueued();
    return { demo: present(again, await userNames([again.uploaded_by])), retried: true };
  }
  if (existing) {
    await fsp.rm(file, { force: true });
    throw conflict(`This demo is already in your library as "${existing.title}"`, 'demo_exists', { demo_id: existing.demo_id });
  }
  const original = cleanName(fileName);
  const [demo] = await db('demos').insert({
    team_id: teamId,
    uploaded_by: userId,
    title: (title && title.trim()) || original.replace(/\.dem$/i, '').slice(0, 120) || 'Demo',
    original_name: original,
    byte_size: size,
    sha256,
    storage_key: key,
  }).returning('*');
  demoJobs.notifyQueued();
  const names = await userNames([userId]);
  return { demo: present(demo, names) };
}

// Queues a demo from a CS2 match share code. The code is checked here; the
// replay itself is fetched by the processing job through the replay
// provider, then processed exactly like an upload. A match already in the
// team's library is reused rather than imported twice.
async function importShareCode(teamId, userId, { share_code: input, title }) {
  await requireMember(teamId, userId);
  const { decodeShareCode } = require('./shareCode');
  const ids = (() => {
    try { return decodeShareCode(input); } catch (err) { throw badRequest(err.message, err.code); }
  })();
  const existing = await db('demos').where({ team_id: teamId, valve_match_id: ids.match_id }).first();
  if (existing) {
    if (existing.status === 'failed') {
      const [again] = await db('demos').where('demo_id', existing.demo_id)
        .update({ status: 'queued', attempts: 0, error_code: null, error_message: null }).returning('*');
      demoJobs.notifyQueued();
      return { demo: present(again, await userNames([again.uploaded_by])), existing: true, retried: true };
    }
    return { demo: present(existing, await userNames([existing.uploaded_by])), existing: true };
  }
  const provider = require('./replayProvider');
  try { provider.assertConfigured(); } catch (err) { throw httpError(err.status, err.message, err.code); }
  const { count } = await db('demos').where('team_id', teamId).count('* as count').first();
  if (Number(count) >= config.demoDemosPerTeam) {
    throw conflict(`This team has reached its limit of ${config.demoDemosPerTeam} demos. Delete one to upload another.`, 'demo_quota');
  }
  const [demo] = await db('demos').insert({
    team_id: teamId,
    uploaded_by: userId,
    title: (title && title.trim()) || `Match ${ids.share_code}`,
    original_name: `${ids.share_code}.dem`,
    byte_size: 0,
    sha256: `share-code:${ids.match_id}`,
    storage_key: `${crypto.randomUUID()}.dem`,
    source: 'share_code',
    share_code: ids.share_code,
    valve_match_id: ids.match_id,
  }).returning('*');
  demoJobs.notifyQueued();
  return { demo: present(demo, await userNames([userId])), existing: false };
}

async function requireManage(demoId, userId) {
  const { demo, access } = await loadDemo(demoId, userId);
  if (!access.canLead && demo.uploaded_by !== userId) {
    throw forbidden('Only the uploader, the team owner or the IGL can change this demo');
  }
  return demo;
}

async function renameDemo(demoId, userId, { title }) {
  await requireManage(demoId, userId);
  await db('demos').where('demo_id', demoId).update({ title });
  return getDemo(demoId, userId);
}

// Failed demos can be queued again (e.g. after a parser upgrade).
async function retryDemo(demoId, userId) {
  const demo = await requireManage(demoId, userId);
  if (demo.status !== 'failed') throw conflict('Only failed demos can be retried', 'demo_not_failed');
  await db('demos').where('demo_id', demoId).update({ status: 'queued', attempts: 0, error_code: null, error_message: null });
  demoJobs.notifyQueued();
  return getDemo(demoId, userId);
}

async function deleteDemo(demoId, userId) {
  const demo = await requireManage(demoId, userId);
  const live = await db('review_sessions').where({ demo_id: demoId, status: 'active' }).first('review_id');
  if (live) throw conflict('End the live review of this demo before deleting it', 'review_active');
  await db('demos').where('demo_id', demoId).del();
  await fsp.rm(path.join(config.demoStorageDir, demo.storage_key), { force: true });
  return { deleted: true };
}

// ---- Annotations (outside live reviews) --------------------------------------

const presentAnnotation = (a, names) => ({
  annotation_id: a.annotation_id,
  round_number: a.round_number,
  tick: a.tick,
  level: a.level,
  kind: a.kind,
  data: a.data,
  review_id: a.review_id,
  author: a.author_id ? { user_id: a.author_id, user_name: names.get(a.author_id) ?? null } : null,
  created_at: a.created_at,
});

async function listAnnotations(demoId, userId, roundNumber, reviewId = null) {
  await loadDemo(demoId, userId);
  let q = db('demo_annotations').where('demo_id', demoId).orderBy([{ column: 'tick' }, { column: 'annotation_id' }]);
  q = reviewId ? q.where('review_id', reviewId) : q.whereNull('review_id');
  if (roundNumber) q = q.where('round_number', roundNumber);
  const rows = await q;
  const names = await userNames(rows.map((r) => r.author_id));
  return { annotations: rows.map((r) => presentAnnotation(r, names)) };
}

async function insertAnnotation(trx, demo, userId, body, reviewId = null) {
  const round = await trx('demo_rounds').where({ demo_id: demo.demo_id, round_number: body.round_number })
    .first('start_tick', 'end_tick');
  if (!round) throw badRequest('That round is not in this demo', 'round_not_found');
  const { count } = await trx('demo_annotations').where({ demo_id: demo.demo_id, round_number: body.round_number })
    .count('* as count').first();
  if (Number(count) >= C.LIMITS.annotationsPerRound) {
    throw conflict(`A round can have at most ${C.LIMITS.annotationsPerRound} annotations`, 'annotation_quota');
  }
  const tick = Math.min(round.end_tick, Math.max(round.start_tick, Math.round(body.tick)));
  const [row] = await trx('demo_annotations').insert({
    demo_id: demo.demo_id,
    review_id: reviewId,
    author_id: userId,
    round_number: body.round_number,
    tick,
    level: body.level,
    kind: body.kind,
    data: JSON.stringify(body.data),
  }).returning('*');
  return row;
}

async function createAnnotation(demoId, userId, body) {
  const { demo } = await loadDemo(demoId, userId);
  if (demo.status !== 'ready') throw conflict('This demo is not ready yet', 'demo_not_ready');
  const row = await insertAnnotation(db, demo, userId, body);
  return { annotation: presentAnnotation(row, await userNames([userId])) };
}

// Applies an edit to a utility annotation row (shared by solo and live reviews).
async function applyAnnotationPatch(trx, row, patch) {
  if (row.kind !== 'utility') throw badRequest('Only utility markers can be moved or changed; remove and redraw other annotations', 'not_editable');
  const data = { ...row.data, ...(patch.x !== undefined ? { x: patch.x } : {}), ...(patch.y !== undefined ? { y: patch.y } : {}),
    ...(patch.utility ? { utility: patch.utility } : {}) };
  const [updated] = await trx('demo_annotations').where('annotation_id', row.annotation_id)
    .update({ data: JSON.stringify(data), ...(patch.level ? { level: patch.level } : {}) }).returning('*');
  return updated;
}

async function updateAnnotation(demoId, annotationId, userId, patch) {
  const { access } = await loadDemo(demoId, userId);
  const row = await db('demo_annotations').where({ demo_id: demoId, annotation_id: annotationId }).whereNull('review_id').first();
  if (!row) throw notFound('Annotation not found');
  if (row.author_id !== userId && !access.canLead) throw forbidden('You can only change your own annotations');
  const updated = await applyAnnotationPatch(db, row, patch);
  return { annotation: presentAnnotation(updated, await userNames([updated.author_id])) };
}

async function deleteAnnotation(demoId, annotationId, userId) {
  const { access } = await loadDemo(demoId, userId);
  const row = await db('demo_annotations').where({ demo_id: demoId, annotation_id: annotationId }).whereNull('review_id').first();
  if (!row) throw notFound('Annotation not found');
  if (row.author_id !== userId && !access.canLead) throw forbidden('You can only remove your own annotations');
  await db('demo_annotations').where('annotation_id', annotationId).del();
  return { deleted: true };
}

module.exports = {
  listDemos, getDemo, roundData, upload, importShareCode, renameDemo, retryDemo, deleteDemo,
  listAnnotations, createAnnotation, updateAnnotation, applyAnnotationPatch, deleteAnnotation, insertAnnotation, presentAnnotation, userNames, loadDemo,
};
