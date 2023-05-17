const { tacticData } = require('../data');

exports.seed = function(connection, Promise) {
  return connection.migrate
    .rollback()
    .then(() => connection.migrate.latest())
    .then(() =>
      connection('tactics')
        .insert(tacticData)
        .returning('*')
    );
};