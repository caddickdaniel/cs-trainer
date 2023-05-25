const {
    getTactics,
    getTacticsByID,
    getTacticsByName,
    getTacticsByEconomy,
    addTactic,
    deleteTacticByID,
  } = require('../models/tactics');
  
  exports.sendTactics = (req, res, next) => {
    const { sort_by, order } = req.query;
    Promise.all([getTactics(sort_by, order)])
      .then(([tactics]) => {
        res.status(200).send({ tactics });
      })
      .catch(err => next(err));
  };
  
  exports.sendTacticsByID = (req, res, next) => {
    const tacticID = req.params.tactic_id;
    getTacticsByID(tacticID)
      .then(([tactics]) => {
        if (!tactics) {
          return Promise.reject({
            status: 404,
            message: `That tactic doesn't exist`
          });
        }
        res.status(200).send({ tactics });
      })
      .catch(err => next(err));
  };

  exports.sendTacticsByName = (req, res, next) => {
    const tacticName = req.params.tactic_name;
    getTacticsByName(tacticName)
      .then(([tactics]) => {
        if (!tactics) {
          return Promise.reject({
            status: 404,
            message: `That tactic doesn't exist`
          });
        }
        res.status(200).send({ tactics });
      })
      .catch(err => next(err));
  };
  
  exports.sendTacticsByEconomy = (req, res, next) => {
    const economyName = req.params.economy;
    getTacticsByEconomy(economyName)
      .then(([tactics]) => {
        if (!tactics) {
          return Promise.reject({
            status: 404,
            message: `That tactic doesn't exist`
          });
        }
        res.status(200).send({ tactics });
      })
      .catch(err => next(err));
  };

  exports.sendNewTactic = (req, res, next) => {
    const tacticToAdd = req.body;
  
    addTactic(tacticToAdd)
      .then(([tactics]) => res.status(201).send({ tactics }))
      .catch(err => next(err));
  };
  
  exports.sendDeletedTactic = (req, res, next) => {
    const { tactic_id } = req.params;
  
    deleteTacticByID(tactic_id)
      .then(() => {
        if (!tactic_id) {
          return Promise.reject({
            status: 404,
            message: `The tactic doesn't exist`
          });
        }
        res.sendStatus(204);
      })
      .catch(err => next(err));
  };