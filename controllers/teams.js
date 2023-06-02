const {
    getTeams,
    getTeamsByID,
    getTeamsByName,
    getTeamsByLanguage,
    getTeamsByRegion,
    getTeamsByPlatform,
    getTeamsBySkillLevel,
    addTeam,
    deleteTeamByID,
    updateTeamByID
  } = require('../models/teams');
  
  exports.sendTeams = (req, res, next) => {
    const { sort_by, order } = req.query;
    Promise.all([getTeams(sort_by, order)])
      .then(([teams]) => {
        res.status(200).send({ teams });
      })
      .catch(err => next(err));
  };

  exports.sendTeamsByID = (req, res, next) => {
    const teamID = req.params.team_id;
    getTeamsByID(teamID)
      .then(([teams]) => {
        if (!teams) {
          return Promise.reject({
            status: 404,
            message: `That team doesn't exist`
          });
        }
        res.status(200).send({ teams });
      })
      .catch(err => next(err));
  };
  
  exports.sendTeamsByName = (req, res, next) => {
    const teamName = req.params.team_name;
    getTeamsByName(teamName)
      .then(([teams]) => {
        if (!teams) {
          return Promise.reject({
            status: 404,
            message: `That team doesn't exist`
          });
        }
        res.status(200).send({ teams });
      })
      .catch(err => next(err));
  };

  exports.sendTeamsByLanguage = (req, res, next) => {
    const languageName = req.params.language;
    getTeamsByLanguage(languageName)
      .then((teams) => {
        if (teams.length === 0) {
          return Promise.reject({
            status: 404,
            message: `No teams found for the specified language`,
          });
        }
        res.status(200).send({ teams });
      })
      .catch((err) => next(err));
  };

  exports.sendTeamsByRegion = (req, res, next) => {
    const regionName = req.params.region;
    getTeamsByRegion(regionName)
    .then((teams) => {
      if (teams.length === 0) {
        return Promise.reject({
          status: 404,
          message: `No teams found for the specified region`,
        });
      }
      res.status(200).send({ teams });
    })
    .catch((err) => next(err));
};
  
  exports.sendTeamsByPlatform = (req, res, next) => {
    const platformName = req.params.platform;
    getTeamsByPlatform(platformName)
    .then((teams) => {
      if (teams.length === 0) {
        return Promise.reject({
          status: 404,
          message: `No teams found for the specified platform`,
        });
      }
      res.status(200).send({ teams });
    })
    .catch((err) => next(err));
};
  
  exports.sendTeamsBySkillLevel = (req, res, next) => {
    const skillLevelName = req.params.skill_level;
    getTeamsBySkillLevel(skillLevelName)
    .then((teams) => {
      if (teams.length === 0) {
        return Promise.reject({
          status: 404,
          message: `No teams found for the specified platform`,
        });
      }
      res.status(200).send({ teams });
    })
    .catch((err) => next(err));
};

  exports.sendNewTeam = (req, res, next) => {
    const teamToAdd = req.body;
  
    addTeam(teamToAdd)
      .then(([teams]) => res.status(201).send({ teams }))
      .catch(err => next(err));
  };
  
  exports.sendDeletedTeam = (req, res, next) => {
    const { team_id } = req.params;
  
    deleteTeamByID(team_id)
      .then(() => {
        if (!team_id) {
          return Promise.reject({
            status: 404,
            message: `The team doesn't exist`
          });
        }
        res.sendStatus(204);
      })
      .catch(err => next(err));
  };

  exports.sendPatchedTeam = (req, res, next) => {
    const {team_name, language, region, platform, skill_level} = req.body;
    const {team_id} = req.params;
  
    getTeamsByID(team_id)
      .then((team) => {
        if (!team) {
          return Promise.reject({
            status: 404,
            message: `Team not found with the ID ${team_id}`
          });
        }
  
        const updatedTeam = {
          team_name: team_name || team.team_name,
          language: language || team.language,
          region: region || team.region,
          platform: platform || team.platform,
          skill_level: skill_level || team.skill_level,
        };
  
        return updateTeamByID(team_id, updatedTeam)
          .then(() => {
            return getTeamsByID(team_id); 
          });
      })
      .then((updatedTeam) => {
        res.status(200).send(updatedTeam[0]);
      })
      .catch(err => next(err));
  };