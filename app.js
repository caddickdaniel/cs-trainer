const express = require('express');

const app = express();
const cors = require('cors');
const bodyParser = require('body-parser');
const apiRouter = require('./routes/apiRouter');
const { handle400, handle422, handle404 } = require('./errors/index');

app.use(cors());

app.use(bodyParser.json());

app.use('/api', apiRouter);

app.all('/*', (req, res) => {
  res.status(404).send({
    message: 'Sorry, this page was not found! Go to /api to see a list of endpoints',
  });
});

app.use(handle400, handle422, handle404);

module.exports = app;