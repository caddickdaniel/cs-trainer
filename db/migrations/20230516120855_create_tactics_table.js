exports.up = function (knex) {
    return knex.schema.createTable('tactics', (tacticTable) => {
      tacticTable.increments('tactic_id').primary();
      tacticTable.string('tactic_name').notNullable();
      tacticTable.string('economy');
      tacticTable.timestamps(true, true);
    });
  };
  
  exports.down = function (knex) {
    return knex.schema.dropTableIfExists('tactics');
  };