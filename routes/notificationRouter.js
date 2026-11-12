const router = require('express').Router();
const notifications = require('../services/notifications');
const v = require('../validation');
const { asyncHandler, handle405 } = require('../errors');

const me = (req) => req.user.user_id;
const id = (req) => v.parseId(req.params.notification_id, 'notification_id');

router.route('/')
  .get(asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.send(await notifications.list(me(req)));
  }))
  .all(handle405);
router.route('/read-all')
  .post(asyncHandler(async (req, res) => {
    await notifications.markAllRead(me(req));
    res.send(await notifications.list(me(req)));
  }))
  .all(handle405);
router.route('/:notification_id/dismiss')
  .post(asyncHandler(async (req, res) => {
    await notifications.dismiss(me(req), id(req));
    res.status(204).end();
  }))
  .all(handle405);
// Re-checks access and target existence; returns where to navigate.
router.route('/:notification_id/open')
  .post(asyncHandler(async (req, res) => res.send(await notifications.open(me(req), id(req)))))
  .all(handle405);

module.exports = router;
