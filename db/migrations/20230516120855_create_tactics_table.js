exports.up = function (knex) {
    return knex.schema.createTable('tactics', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('economy');
      table.timestamps(true, true);
    });
  };
  
  exports.down = function (knex) {
    return knex.schema.dropTableIfExists('tactics');
  };