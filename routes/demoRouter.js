// Demo Review library (/api/demos). Team-scoped: non-members get 404.
const demoRouter = require('express').Router();
const demos = require('../services/demos');
const v = require('../validation');
const { asyncHandler, handle405 } = require('../errors');

const demoId = (req) => v.parseId(req.params.demo_id, 'demo_id');
const me = (req) => req.user.user_id;

demoRouter.route('/:demo_id')
  .get(asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).send(await demos.getDemo(demoId(req), me(req)));
  }))
  .patch(asyncHandler(async (req, res) => {
    res.status(200).send(await demos.renameDemo(demoId(req), me(req), v.demoPatch.parse(req.body)));
  }))
  .delete(asyncHandler(async (req, res) => {
    res.status(200).send(await demos.deleteDemo(demoId(req), me(req)));
  }))
  .all(handle405);

demoRouter.route('/:demo_id/retry')
  .post(asyncHandler(async (req, res) => {
    res.status(200).send(await demos.retryDemo(demoId(req), me(req)));
  }))
  .all(handle405);

// Replay data for one round (gzip-compressed JSON).
demoRouter.route('/:demo_id/rounds/:round')
  .get(asyncHandler(async (req, res) => {
    const data = await demos.roundData(demoId(req), v.parseId(req.params.round, 'round'), me(req));
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Encoding': 'gzip',
      'Cache-Control': 'private, max-age=3600',
      Vary: 'Cookie',
    });
    res.status(200).end(data);
  }))
  .all(handle405);

demoRouter.route('/:demo_id/annotations')
  .get(asyncHandler(async (req, res) => {
    const round = req.query.round ? v.parseId(req.query.round, 'round') : null;
    res.status(200).send(await demos.listAnnotations(demoId(req), me(req), round));
  }))
  .post(asyncHandler(async (req, res) => {
    res.status(201).send(await demos.createAnnotation(demoId(req), me(req), v.annotation.parse(req.body)));
  }))
  .all(handle405);

demoRouter.route('/:demo_id/annotations/:annotation_id')
  .delete(asyncHandler(async (req, res) => {
    res.status(200).send(await demos.deleteAnnotation(demoId(req), v.parseId(req.params.annotation_id, 'annotation_id'), me(req)));
  }))
  .patch(asyncHandler(async (req, res) => {
    res.status(200).send(await demos.updateAnnotation(demoId(req), v.parseId(req.params.annotation_id, 'annotation_id'), me(req), v.annotationPatch.parse(req.body)));
  }))
  .all(handle405);

module.exports = demoRouter;
