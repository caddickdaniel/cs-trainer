exports.up = function (knex) {
    return knex.schema.createTable('teams', (teamTable) => {
      teamTable.increments('team_id').primary();
      teamTable.string('name').notNullable();
      teamTable.string('language');
      teamTable.string('region');
      teamTable.string('platform');
      teamTable.string('skill_level');
      teamTable.timestamps(true, true);
    });
  };
  
  exports.down = function (knex) {
    return knex.schema.dropTableIfExists('teams');
  };