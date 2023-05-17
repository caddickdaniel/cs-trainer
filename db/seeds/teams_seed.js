const { teamData } = require('../data');

exports.seed = function(connection, Promise) {
  return connection.migrate
    .rollback()
    .then(() => connection.migrate.latest())
    .then(() =>
      connection('teams')
        .insert(teamData)
        .returning('*')
    );
};