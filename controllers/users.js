const {
  getUsers,
  getUsersByID,
  getUsersByName,
  getUsersByLanguage,
  getUsersByRegion,
  getUsersByPlatform,
  getUsersBySkillLevel,
  getUsersByRole,
  getUsersByTeam,
  addUser,
  deleteUserByID
} = require('../models/users');

exports.sendUsers = (req, res, next) => {
  const { sort_by, order } = req.query;
  Promise.all([getUsers(sort_by, order)])
    .then(([users]) => {
      res.status(200).send({ users });
    })
    .catch(err => next(err));
};

exports.sendUsersByID = (req, res, next) => {
  const userID = req.params.user_id;
  getUsersByID(userID)
    .then(([users]) => {
      if (!users) {
        return Promise.reject({
          status: 404,
          message: `That user doesn't exist`
        });
      }
      res.status(200).send({ users });
    })
    .catch(err => next(err));
};

exports.sendUsersByName = (req, res, next) => {
  const userName = req.params.name;
  getUsersByName(userName)
    .then(([users]) => {
      if (!users) {
        return Promise.reject({
          status: 404,
          message: `That user doesn't exist`
        });
      }
      res.status(200).send({ users });
    })
    .catch(err => next(err));
};

exports.sendUsersByLanguage = (req, res, next) => {
  const languageName = req.params.language;
  getUsersByLanguage(languageName)
    .then(([users]) => {
      if (!users) {
        return Promise.reject({
          status: 404,
          message: `That language doesn't exist`
        });
      }
      res.status(200).send({ users });
    })
    .catch(err => next(err));
};

exports.sendUsersByRegion = (req, res, next) => {
  const regionName = req.params.region;
  getUsersByRegion(regionName)
    .then(([users]) => {
      if (!users) {
        return Promise.reject({
          status: 404,
          message: `That region doesn't exist`
        });
      }
      res.status(200).send({ users });
    })
    .catch(err => next(err));
};

exports.sendUsersByPlatform = (req, res, next) => {
  const platformName = req.params.platform;
  getUsersByPlatform(platformName)
    .then(([users]) => {
      if (!users) {
        return Promise.reject({
          status: 404,
          message: `That platform doesn't exist`
        });
      }
      res.status(200).send({ users });
    })
    .catch(err => next(err));
};

exports.sendUsersBySkillLevel = (req, res, next) => {
  const skillLevelName = req.params.skill_level;
  getUsersBySkillLevel(skillLevelName)
    .then(([users]) => {
      if (!users) {
        return Promise.reject({
          status: 404,
          message: `That skill level doesn't exist`
        });
      }
      res.status(200).send({ users });
    })
    .catch(err => next(err));
};

exports.sendUsersByRole = (req, res, next) => {
  const roleName = req.params.role;
  getUsersByRole(roleName)
    .then(([users]) => {
      if (!users) {
        return Promise.reject({
          status: 404,
          message: `That roll doesn't exist`
        });
      }
      res.status(200).send({ users });
    })
    .catch(err => next(err));
};

exports.sendUsersByTeam = (req, res, next) => {
  const teamName = req.params.team_name;
  getUsersByTeam(teamName)
    .then(([users]) => {
      if (!users) {
        return Promise.reject({
          status: 404,
          message: `That team doesn't exist`
        });
      }
      res.status(200).send({ users });
    })
    .catch(err => next(err));
};

exports.sendNewUser = (req, res, next) => {
  const userToAdd = req.body;

  addUser(userToAdd)
    .then(([users]) => res.status(201).send({ users }))
    .catch(err => next(err));
};

exports.sendDeletedUser = (req, res, next) => {
  const { user_id } = req.params;

  deleteUserByID(user_id)
    .then(() => {
      if (!user_id) {
        return Promise.reject({
          status: 404,
          message: `The user doesn't exist`
        });
      }
      res.sendStatus(204);
    })
    .catch(err => next(err));
};