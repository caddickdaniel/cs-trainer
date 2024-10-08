exports.up = function (knex) {
    return knex.schema.createTable('teams', (teamTable) => {
      teamTable.increments('team_id').primary();
      teamTable.string('team_name').notNullable();
      teamTable.integer('owner').unsigned().notNullable();
      teamTable.foreign('owner').references('user_id').inTable('users')
      teamTable.string('language');
      teamTable.string('region');
      teamTable.string('platform');
      teamTable.string('skill_level');
      teamTable.string('description');
      teamTable.specificType('users', 'integer[]');
      teamTable.specificType('tactics', 'integer[]');
      teamTable.timestamps(true, true);
    });
  };
  
  exports.down = function (knex) {
    return knex.schema.dropTableIfExists('teams');
  };