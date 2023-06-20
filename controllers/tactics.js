const {
    getTactics,
    getTacticsByID,
    getTacticsByName,
    getTacticsByEconomy,
    getTacticsByTeam,
    addTactic,
    deleteTacticByID,
    updateTacticByID,
    getStepsByUserAndTactic
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
      .then((tactics) => {
        if (tactics.length === 0) {
          return Promise.reject({
            status: 404,
            message: `No tactics found for the specified language`,
          });
        }
        res.status(200).send({ tactics });
      })
      .catch((err) => next(err));
};

exports.sendTacticsByTeam = (req, res, next) => {
  const teamID = req.params.team_id;
  getTacticsByTeam(teamID)
    .then((tactics) => {
      if (tactics.length === 0) {
        return Promise.reject({
          status: 404,
          message: `No tactics found for the specified team`,
        });
      }
      res.status(200).send({ tactics });
    })
    .catch((err) => next(err));
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

  exports.sendPatchedTactic = (req, res, next) => {
    const {tactic_name, economy, grenade, molly, flash, smoke} = req.body;
    const {tactic_id} = req.params;
  
    getTacticsByID(tactic_id)
      .then((tactic) => {
        if (!tactic) {
          return Promise.reject({
            status: 404,
            message: `Tactic not found with the ID ${tactic_id}`
          });
        }
  
        const updatedTactic = {
          tactic_name: tactic_name || tactic.tactic_name,
          economy: economy || tactic.economy,
          grenade: grenade || tactic.grenade,
          molly: molly || tactic.molly,
          flash: flash || tactic.flash,
          smoke: smoke || tactic.smoke,
        };
  
        return updateTacticByID(tactic_id, updatedTactic)
          .then(() => {
            return getTacticsByID(tactic_id); 
          });
      })
      .then((updatedTactic) => {
        res.status(200).send(updatedTactic[0]);
      })
      .catch(err => next(err));
  };

exports.sendStepsByUserAndTactic = (req, res, next) => {
  const tacticID = req.params.tactic_id;
  const userID = req.params.user_id;

  getStepsByUserAndTactic(userID, tacticID)
    .then(steps => {
      res.status(200).json({ steps });
    })
    .catch(err => {
      next(err);
    });
};  