const teamRouter = require('express').Router();
const c = require('../controllers/teams');
const { handle405 } = require('../errors');

teamRouter.route('/').get(c.sendTeams).post(c.sendNewTeam).all(handle405);

teamRouter
  .route('/:team_id')
  .get(c.sendTeamsByID)
  .patch(c.sendPatchedTeam)
  .delete(c.sendDeletedTeam)
  .all(handle405);

teamRouter.route('/name/:team_name').get(c.sendTeamsByName).all(handle405);
teamRouter.route('/lang/:language').get(c.sendTeamsByLanguage).all(handle405);
teamRouter.route('/reg/:region').get(c.sendTeamsByRegion).all(handle405);
teamRouter.route('/plat/:platform').get(c.sendTeamsByPlatform).all(handle405);
teamRouter.route('/skill/:skill_level').get(c.sendTeamsBySkillLevel).all(handle405);
teamRouter.route('/:team_id/owner').get(c.sendTeamOwner).all(handle405);
teamRouter.route('/:team_id/users/:user_id').patch(c.removeUserFromTeam).all(handle405);

// Milestone 1
teamRouter.route('/:team_id/roster').get(c.sendRoster).all(handle405);
teamRouter.route('/:team_id/members/:user_id').patch(c.patchMember).delete(c.deleteMember).all(handle405);
teamRouter.route('/:team_id/leave').post(c.leaveTeam).all(handle405);
teamRouter.route('/:team_id/invites').get(c.sendInvites).post(c.sendNewInvite).all(handle405);
teamRouter.route('/:team_id/invites/:invite_id').delete(c.revokeInvite).all(handle405);
teamRouter.route('/:team_id/tactics').get(c.sendTeamTactics).post(c.sendNewTacticDocument).all(handle405);
teamRouter.route('/:team_id/game-session').get(c.sendGameSession).post(c.startGameSession).all(handle405);

module.exports = teamRouter;
