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
  deleteUserByID,
  updateUserByID
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
  const userName = req.params.user_name;
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
    .then((users) => {
      if (users.length === 0) {
        return Promise.reject({
          status: 404,
          message: `No users found for the specified language`,
        });
      }
      res.status(200).send({ users });
    })
    .catch((err) => next(err));
};

exports.sendUsersByRegion = (req, res, next) => {
  const regionName = req.params.region;
  getUsersByRegion(regionName)
    .then((users) => {
      if (users.length === 0) {
        return Promise.reject({
          status: 404,
          message: `No users found for the specified region`,
        });
      }
      res.status(200).send({ users });
    })
    .catch((err) => next(err));
};

exports.sendUsersByPlatform = (req, res, next) => {
  const platformName = req.params.platform;
  getUsersByPlatform(platformName)
    .then((users) => {
      if (users.length === 0) {
        return Promise.reject({
          status: 404,
          message: `No users found for the specified region`,
        });
      }
      res.status(200).send({ users });
    })
    .catch((err) => next(err));
};

exports.sendUsersBySkillLevel = (req, res, next) => {
  const skillLevelName = req.params.skill_level;
  getUsersBySkillLevel(skillLevelName)
    .then((users) => {
      if (users.length === 0) {
        return Promise.reject({
          status: 404,
          message: `No users found for the specified skill level`,
        });
      }
      res.status(200).send({ users });
    })
    .catch((err) => next(err));
};

exports.sendUsersByRole = (req, res, next) => {
  const roleName = req.params.role;
  getUsersByRole(roleName)
    .then((users) => {
      if (users.length === 0) {
        return Promise.reject({
          status: 404,
          message: `No users found for the specified role`,
        });
      }
      res.status(200).send({ users });
    })
    .catch((err) => next(err));
};

exports.sendUsersByTeam = (req, res, next) => {
  const teamID = req.params.team_id;
  getUsersByTeam(teamID)
    .then((users) => {
      if (users.length === 0) {
        return Promise.reject({
          status: 404,
          message: `No users found for the specified team`,
        });
      }
      res.status(200).send({ users });
    })
    .catch((err) => next(err));
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

exports.sendPatchedUser = (req, res, next) => {
  const {language, region, platform, skill_level, role, team_id, avatar_url, bio} = req.body;
  const {user_id} = req.params;

  getUsersByID(user_id)
    .then((user) => {
      if (!user) {
        return Promise.reject({
          status: 404,
          message: `User not found with the ID ${user_id}`
        });
      }

      const updatedUser = {
        language: language || user.language,
        region: region || user.region,
        platform: platform || user.platform,
        skill_level: skill_level || user.skill_level,
        role: role || user.role,
        team_id: team_id || user.team_id,
        avatar_url: avatar_url || user.avatar_url,
        bio: bio || user.bio,
      };

      return updateUserByID(user_id, updatedUser);
    })
    .then(() => {
      res.sendStatus(204);
    })
    .catch(err => next(err));
}