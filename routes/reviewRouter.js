// Live demo reviews (/api/reviews). Reads: team members. Commands: the IGL.
const reviewRouter = require('express').Router();
const reviews = require('../services/reviews');
const v = require('../validation');
const { asyncHandler, handle405 } = require('../errors');

const reviewId = (req) => v.parseId(req.params.review_id, 'review_id');
const me = (req) => req.user.user_id;

reviewRouter.route('/:review_id')
  .get(asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).send(await reviews.getReview(reviewId(req), me(req)));
  }))
  .all(handle405);

reviewRouter.route('/:review_id/command')
  .post(asyncHandler(async (req, res) => {
    res.status(200).send(await reviews.command(reviewId(req), me(req), v.reviewCommand.parse(req.body)));
  }))
  .all(handle405);

reviewRouter.route('/:review_id/annotations')
  .post(asyncHandler(async (req, res) => {
    res.status(201).send(await reviews.annotate(reviewId(req), me(req), v.annotation.parse(req.body)));
  }))
  .all(handle405);

reviewRouter.route('/:review_id/annotations/:annotation_id')
  .delete(asyncHandler(async (req, res) => {
    res.status(200).send(await reviews.removeAnnotation(reviewId(req), v.parseId(req.params.annotation_id, 'annotation_id'), me(req)));
  }))
  .all(handle405);

reviewRouter.route('/:review_id/end')
  .post(asyncHandler(async (req, res) => {
    res.status(200).send(await reviews.end(reviewId(req), me(req)));
  }))
  .all(handle405);

module.exports = reviewRouter;
