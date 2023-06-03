exports.up = function (knex) {
    return knex.schema.createTable('teams', (teamTable) => {
      teamTable.increments('team_id').primary();
      teamTable.string('team_name').notNullable();
      teamTable.string('language');
      teamTable.string('region');
      teamTable.string('platform');
      teamTable.string('skill_level');
      teamTable.specificType('users', 'integer[]')
      teamTable.specificType('tactics', 'integer[]')
      teamTable.timestamps(true, true);
    });
  };
  
  exports.down = function (knex) {
    return knex.schema.dropTableIfExists('teams');
  };