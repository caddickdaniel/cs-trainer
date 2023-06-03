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
        'tactics.team_id',
        'teams.team_name AS team_name'
    )
    .from('tactics')
    .join('teams', 'tactics.team_id', '=', 'teams.team_id')
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
        'tactics.team_id',
        'teams.team_name AS team_name'
      )
      .from('tactics')
      .join('teams', 'tactics.team_id', '=', 'teams.team_id')
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
        'tactics.team_id',
        'teams.team_name AS team_name'
      )
      .from('tactics')
      .join('teams', 'tactics.team_id', '=', 'teams.team_id')
      .where('tactics.tactic_name', '=', tacticName)
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
        'tactics.team_id',
        'teams.team_name AS team_name'
      )
      .from('tactics')
      .join('teams', 'tactics.team_id', '=', 'teams.team_id')
      .where('tactics.economy', '=', economyName)
      .returning('*');

exports.getTacticsByTeam = teamID =>
  connection
    .select(
      'tactics.tactic_id',
      'tactics.tactic_name',
      'tactics.economy',
      'tactics.grenade',
      'tactics.molly',
      'tactics.flash',
      'tactics.smoke',
      'tactics.team_id',
      'teams.team_name AS team_name'
    )
    .from('tactics')
    .join('teams', 'tactics.team_id', '=', 'teams.team_id')
    .where('tactics.team_id', '=', teamID)
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

exports.updateTacticByID = (tacticID, updatedTactic) => {
  return connection('tactics')
    .where('tactic_id', tacticID)
    .update(updatedTactic);
};