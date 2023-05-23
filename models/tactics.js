const connection = require('../db/connection');

exports.getTactics = (sort_by = 'name', order = 'desc') =>
  connection
    .select(
        'tactics.tactic_id',
        'tactics.name',
        'tactics.economy',
    )
    .from('tactics')
    .orderBy(sort_by, order)
    .returning('*');

exports.getTacticsByID = tacticID =>
    connection
      .select(
        'tactics.tactic_id',
        'tactics.name',
        'tactics.economy',
      )
      .groupBy('tactics.tactic_id')
      .from('tactics')
      .where('tactics.tactic_id', '=', tacticID)
      .returning('*');

exports.getTacticsByName = tacticName =>
  connection
      .select(
        'tactics.tactic_id',
        'tactics.name',
        'tactics.economy',
      )
      .groupBy('tactics.name')
      .from('tactics')
      .where('tactics.name', '=', tacticName)
      .returning('*');

exports.getTacticsByEconomy = economyName =>
  connection
      .select(
        'tactics.tactic_id',
        'tactics.name',
        'tactics.economy',
      )
      .groupBy('tactics.economy')
      .from('tactics')
      .where('tactics.economy', '=', economyName)
      .returning('*');

exports.addTactic = newTactic =>
  connection
    .insert(newTactic)
    .into('tactics')
    .returning('*');

exports.deleteTacticByID = tacticID =>
  connection('tactics')
    .where('tactics.tactic_id', '=', tacticID)
    .del();