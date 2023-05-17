exports.up = function (knex) {
    return knex.schema.createTable('users', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('language');
      table.string('region');
      table.string('platform');
      table.string('skill_level');
      table.string('role');
      table.string('team');
      table.timestamps(true, true);
    });
  };
  
  exports.down = function (knex) {
    return knex.schema.dropTableIfExists('users');
  };