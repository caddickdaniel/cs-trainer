const imageRouter = require('express').Router();
const images = require('../services/images');
const v = require('../validation');
const { asyncHandler, handle405, notFound } = require('../errors');

imageRouter
  .route('/:image_id')
  .get(asyncHandler(async (req, res) => {
    const parsed = v.imageId.safeParse(req.params.image_id);
    if (!parsed.success) throw notFound('Image not found');
    const image = await images.fetch(parsed.data, req.user.user_id);
    // Images never change, but access depends on the session: cache privately.
    res.set({
      'Content-Type': image.content_type,
      'Cache-Control': 'private, max-age=86400, immutable',
      ETag: `"${image.sha256}"`,
      'Content-Disposition': 'inline',
      'Content-Security-Policy': "default-src 'none'",
    });
    if (req.headers['if-none-match'] === `"${image.sha256}"`) return res.status(304).end();
    return res.status(200).send(image.data);
  }))
  .all(handle405);

module.exports = imageRouter;
