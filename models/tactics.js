const connection = require('../db/connection');

exports.getTactics = (sort_by = 'tactic_name', order = 'asc') =>
  connection
    .select(
        'tactics.tactic_id',
        'tactics.tactic_name',
        'tactics.economy',
        'tactics.grenade',
        'tactics.molly',
        'tactics.flash',
        'tactics.smoke',
    )
    .from('tactics')
    .orderBy(sort_by, order)
    .returning('*');

exports.getTacticsByID = tacticID =>
    connection
      .select(
        'tactics.tactic_id',
        'tactics.tactic_name',
        'tactics.economy',
        'tactics.grenade',
        'tactics.molly',
        'tactics.flash',
        'tactics.smoke',
      )
      .groupBy('tactics.tactic_id')
      .from('tactics')
      .where('tactics.tactic_id', '=', tacticID)
      .returning('*');

exports.getTacticsByName = tacticName =>
  connection
      .select(
        'tactics.tactic_id',
        'tactics.tactic_name',
        'tactics.economy',
        'tactics.grenade',
        'tactics.molly',
        'tactics.flash',
        'tactics.smoke',
      )
      .from('tactics')
      .where('tactics.tactic_name', '=', tacticName)
      .groupBy('tactics.tactic_id')
      .returning('*');

exports.getTacticsByEconomy = economyName =>
  connection
      .select(
        'tactics.tactic_id',
        'tactics.tactic_name',
        'tactics.economy',
        'tactics.grenade',
        'tactics.molly',
        'tactics.flash',
        'tactics.smoke',
      )
      .from('tactics')
      .where('tactics.economy', '=', economyName)
      .groupBy('tactics.tactic_id', 'tactics.tactic_name', 'tactics.economy')
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