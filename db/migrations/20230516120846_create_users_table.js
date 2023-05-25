exports.up = function (knex) {
    return knex.schema.createTable('users', (userTable) => {
      userTable.increments('user_id').primary();
      userTable.string('user_name').notNullable();
      userTable.string('language');
      userTable.string('region');
      userTable.string('platform');
      userTable.string('skill_level');
      userTable.string('role');
      userTable.string('team_name');
      userTable.timestamps(true, true);
    });
  };
  
  exports.down = function (knex) {
    return knex.schema.dropTableIfExists('users');
  };