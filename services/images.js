// Lineup screenshots: PNG only, stored per team in PostgreSQL.
const crypto = require('crypto');
const db = require('../db/connection');
const { LIMITS } = require('../domain/constants');
const { badRequest, conflict, notFound, httpError } = require('../errors');
const { requireLead, getAccess } = require('./access');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Validates the PNG signature and reads the IHDR dimensions without decoding.
function inspectPng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)
    || buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw httpError(415, 'Lineup screenshots must be PNG images', 'not_png');
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (!width || !height || width > LIMITS.imageMaxSide || height > LIMITS.imageMaxSide) {
    throw badRequest(`Images must be at most ${LIMITS.imageMaxSide}px on each side`, 'image_too_large');
  }
  return { width, height };
}

async function upload(teamId, userId, buf) {
  await requireLead(teamId, userId);
  if (!buf || !buf.length) throw badRequest('Send the PNG as the request body (Content-Type: image/png)', 'empty_upload');
  const { width, height } = inspectPng(buf);
  const { count } = await db('lineup_images').where('team_id', teamId).count('* as count').first();
  if (Number(count) >= LIMITS.imagesPerTeam) {
    throw conflict(`This team has reached its limit of ${LIMITS.imagesPerTeam} lineup images`, 'image_quota');
  }
  const [row] = await db('lineup_images')
    .insert({
      image_id: crypto.randomUUID(),
      team_id: teamId,
      uploaded_by: userId,
      content_type: 'image/png',
      byte_size: buf.length,
      width,
      height,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      data: buf,
    })
    .returning(['image_id', 'width', 'height', 'byte_size', 'created_at']);
  return row;
}

// Members of the owning team only; everyone else gets 404.
async function fetch(imageId, userId) {
  const row = await db('lineup_images').where('image_id', imageId).first('team_id', 'content_type', 'data', 'sha256');
  if (!row) throw notFound('Image not found');
  const access = await getAccess(row.team_id, userId);
  if (!access || !access.isMember) throw notFound('Image not found');
  return row;
}

// Every image referenced by a tactic must belong to the tactic's team.
async function assertTeamImages(trx, teamId, imageIds) {
  const ids = [...new Set(imageIds)];
  if (!ids.length) return;
  const found = new Set(await trx('lineup_images').where('team_id', teamId).whereIn('image_id', ids).pluck('image_id'));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    throw httpError(400, 'Some lineup images were not found for this team', 'image_not_found', { image_ids: missing });
  }
}

module.exports = { upload, fetch, assertTeamImages, inspectPng };
