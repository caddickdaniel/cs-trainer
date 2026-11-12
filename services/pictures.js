// Profile pictures and team logos (PNG, JPEG or WebP). These are discovery
// information: any signed-in user may view them. Format and dimensions are
// read from the file header; nothing is decoded server-side.
const crypto = require('crypto');
const db = require('../db/connection');
const { LIMITS } = require('../domain/constants');
const { badRequest, notFound, httpError } = require('../errors');
const { inspectPng } = require('./images');

function jpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

function webpSize(buf) {
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8 ' && buf.length >= 30) return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L' && buf.length >= 25) {
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && buf.length >= 30) return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  return null;
}

function inspectPicture(buf, contentType) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) throw badRequest('Upload an image file', 'empty_upload');
  let size = null;
  let type = null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') {
    try { size = inspectPng(buf); } catch { size = null; }
    type = 'image/png';
  } else if (buf[0] === 0xff && buf[1] === 0xd8) {
    size = jpegSize(buf);
    type = 'image/jpeg';
  } else if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    size = webpSize(buf);
    type = 'image/webp';
  }
  if (!type || !size || type !== contentType) {
    throw httpError(415, 'Pictures must be PNG, JPEG or WebP images', 'unsupported_image');
  }
  if (!size.width || !size.height || size.width > LIMITS.pictureMaxSide || size.height > LIMITS.pictureMaxSide) {
    throw badRequest(`Pictures must be at most ${LIMITS.pictureMaxSide}px on each side`, 'image_too_large');
  }
  return { ...size, contentType: type };
}

async function store(trx, purpose, userId, buf, contentType) {
  const info = inspectPicture(buf, contentType);
  const [row] = await trx('public_images')
    .insert({
      image_id: crypto.randomUUID(),
      uploaded_by: userId,
      purpose,
      content_type: info.contentType,
      byte_size: buf.length,
      width: info.width,
      height: info.height,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      data: buf,
    })
    .returning(['image_id', 'width', 'height']);
  return row;
}

// Replaces the picture referenced by table.column for one row; the previous
// picture is deleted because nothing else references it.
async function replace({ table, idColumn, id, column, purpose, userId, buf, contentType }) {
  return db.transaction(async (trx) => {
    const current = await trx(table).where(idColumn, id).forUpdate().first(column);
    const image = buf ? await store(trx, purpose, userId, buf, contentType) : null;
    await trx(table).where(idColumn, id).update({ [column]: image ? image.image_id : null });
    if (current && current[column]) await trx('public_images').where('image_id', current[column]).del();
    return image;
  });
}

async function fetch(imageId) {
  const row = await db('public_images').where('image_id', imageId).first('content_type', 'data', 'sha256');
  if (!row) throw notFound('Image not found');
  return row;
}

const pictureUrl = (imageId) => (imageId ? `/api/pictures/${imageId}` : null);

module.exports = { inspectPicture, replace, fetch, pictureUrl };
