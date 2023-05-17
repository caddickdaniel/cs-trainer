const {
    getTeams,
    getTeamsByName,
    getTeamsByLanguage,
    getTeamsByRegion,
    getTeamsByPlatform,
    getTeamsBySkillLevel,
    deleteTeamByName
  } = require('../models/teams');
  
  exports.sendTeams = (req, res, next) => {
    const { sort_by, order } = req.query;
    Promise.all([getTeams(sort_by, order)])
      .then(([teams]) => {
        res.status(200).send({ teams });
      })
      .catch(err => next(err));
  };
  
  exports.sendTeamsByName = (req, res, next) => {
    const teamName = req.params.name;
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
      .then(([teams]) => {
        if (!teams) {
          return Promise.reject({
            status: 404,
            message: `That language doesn't exist`
          });
        }
        res.status(200).send({ teams });
      })
      .catch(err => next(err));
  };
  
  exports.sendTeamsByRegion = (req, res, next) => {
    const regionName = req.params.region;
    getTeamsByRegion(regionName)
      .then(([teams]) => {
        if (!teams) {
          return Promise.reject({
            status: 404,
            message: `That region doesn't exist`
          });
        }
        res.status(200).send({ teams });
      })
      .catch(err => next(err));
  };
  
  exports.sendTeamsByPlatform = (req, res, next) => {
    const platformName = req.params.platform;
    getTeamsByPlatform(platformName)
      .then(([teams]) => {
        if (!teams) {
          return Promise.reject({
            status: 404,
            message: `That platform doesn't exist`
          });
        }
        res.status(200).send({ teams });
      })
      .catch(err => next(err));
  };
  
  exports.sendTeamsBySkillLevel = (req, res, next) => {
    const skillLevelName = req.params.skill_level;
    getTeamsBySkillLevel(skillLevelName)
      .then(([teams]) => {
        if (!teams) {
          return Promise.reject({
            status: 404,
            message: `That skill level doesn't exist`
          });
        }
        res.status(200).send({ teams });
      })
      .catch(err => next(err));
  };

  exports.sendNewTeam = (req, res, next) => {
    const teamToAdd = req.body;
  
    addTeam(teamToAdd)
      .then(([teams]) => res.status(201).send({ teams }))
      .catch(err => next(err));
  };
  
  exports.sendDeletedTeam = (req, res, next) => {
    const { name } = req.params;
  
    deleteTeamByName(name)
      .then(() => {
        if (!name) {
          return Promise.reject({
            status: 404,
            message: `The team doesn't exist`
          });
        }
        res.sendStatus(204);
      })
      .catch(err => next(err));
  };