exports.up = function (knex) {
    return knex.schema.createTable('teams', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('language');
      table.string('region');
      table.string('platform');
      table.string('skill_level');
      table.timestamps(true, true);
    });
  };
  
  exports.down = function (knex) {
    return knex.schema.dropTableIfExists('teams');
  };