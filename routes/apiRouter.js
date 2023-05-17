const apiRouter = require('express').Router();
const teamRouter = require('./teamRouter');
// const tacticRouter = require('./tacticRouter');
// const userRouter = require('./userRouter');
const { endpoints } = require('../endpoints');

apiRouter.use('/teams', teamRouter);

// apiRouter.use('/tactics', tacticRouter);

// apiRouter.use('/users', userRouter);

apiRouter.get('/', (req, res, next) => {
  res.status(200).send(endpoints);
});

module.exports = apiRouter;