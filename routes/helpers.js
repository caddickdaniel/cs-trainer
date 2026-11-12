const express = require('express');
const { LIMITS } = require('../domain/constants');
const { httpError } = require('../errors');

const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Raw body parser for profile pictures and team logos.
const pictureBody = express.raw({ type: PICTURE_TYPES, limit: LIMITS.pictureBytes });

function pictureUpload(req) {
  const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!PICTURE_TYPES.includes(type) || !Buffer.isBuffer(req.body)) {
    throw httpError(415, 'Upload a PNG, JPEG or WebP image', 'unsupported_image');
  }
  return { buf: req.body, contentType: type };
}

module.exports = { pictureBody, pictureUpload };
