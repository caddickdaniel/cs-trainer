// Community tactic library (/api/shared-tactics).
const sharedRouter = require('express').Router();
const sharing = require('../services/sharing');
const v = require('../validation');
const { asyncHandler, handle405, notFound } = require('../errors');

const shareId = (req) => v.parseId(req.params.share_id, 'share_id');
const me = (req) => req.user.user_id;

sharedRouter.route('/')
  .get(asyncHandler(async (req, res) => {
    res.status(200).send(await sharing.listShared(me(req), v.sharedQuery.parse(req.query)));
  }))
  .all(handle405);

sharedRouter.route('/:share_id')
  .get(asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).send(await sharing.getListing(shareId(req), me(req)));
  }))
  .delete(asyncHandler(async (req, res) => {
    res.status(200).send(await sharing.withdraw(shareId(req), me(req)));
  }))
  .all(handle405);

sharedRouter.route('/:share_id/vote')
  .put(asyncHandler(async (req, res) => {
    res.status(200).send(await sharing.vote(shareId(req), me(req), v.vote.parse(req.body).value));
  }))
  .all(handle405);

sharedRouter.route('/:share_id/import')
  .post(asyncHandler(async (req, res) => {
    res.status(201).send(await sharing.importShared(shareId(req), me(req), v.importShared.parse(req.body)));
  }))
  .all(handle405);

sharedRouter.route('/:share_id/images/:image_id')
  .get(asyncHandler(async (req, res) => {
    const parsed = v.imageId.safeParse(req.params.image_id);
    if (!parsed.success) throw notFound('Image not found');
    const img = await sharing.fetchImage(shareId(req), parsed.data);
    // No long cache: withdrawing a listing must stop access.
    res.set({
      'Content-Type': img.content_type,
      'Cache-Control': 'private, no-cache',
      ETag: `"${img.sha256}"`,
      'Content-Disposition': 'inline',
      'Content-Security-Policy': "default-src 'none'",
    });
    if (req.headers['if-none-match'] === `"${img.sha256}"`) return res.status(304).end();
    return res.status(200).send(img.data);
  }))
  .all(handle405);

module.exports = sharedRouter;
