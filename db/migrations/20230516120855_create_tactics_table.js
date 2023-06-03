exports.up = function (knex) {
    return knex.schema.createTable('tactics', (tacticTable) => {
      tacticTable.increments('tactic_id').primary();
      tacticTable.string('tactic_name').notNullable();
      tacticTable.string('economy').notNullable();
      tacticTable.integer('grenade').notNullable().unsigned().checkIn([0, 1, 2, 3, 4, 5]);
      tacticTable.integer('molly').notNullable().unsigned().checkIn([0, 1, 2, 3, 4, 5]);
      tacticTable.integer('flash').notNullable().unsigned().checkIn([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      tacticTable.integer('smoke').notNullable().unsigned().checkIn([0, 1, 2, 3, 4, 5]);
      tacticTable.integer('team_id');
      tacticTable.timestamps(true, true);
    });
  };
  
  exports.down = function (knex) {
    return knex.schema.dropTableIfExists('tactics');
  };