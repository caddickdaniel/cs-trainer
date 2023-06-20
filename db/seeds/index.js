const { tacticData, userData, teamData } = require('../data');

exports.seed = function (connection) {
    return connection
      .migrate.rollback()
      .then(() => connection.migrate.latest())
      .then(() =>
        connection('tactics')
          .insert(
            tacticData.map((tactic) => ({
              ...tactic,
              steps: JSON.stringify(tactic.steps),
            }))
          )
          .returning('*')
      )
      .then(() =>
        connection('users')
          .insert(userData)
          .returning('*')
      )
      .then(() =>
        connection('teams')
          .insert(teamData)
          .returning('*')
      );
  };