exports.endpoints = {
  '/api': {
    'GET /api': {
      description: 'This endpoint lists all available enpoints on the server',
    },
    '/teams': {
      'GET /api/teams': {
        description: 'This endpoint returns all the teams on the server',
      },
      'GET /api/teams/:team_id': {
          description: 'This enpoint returns teams that matches given team ID',
        },
      'POST /api/teams': {
        description: 'This enpoint allows the user to add a team to the server',
      },
      'DELETE /api/teams/:team_id': {
          description: 'This endpoint allows the user to delete an team, referencing team ID',
        },
    },
    '/tactics': {
      'GET /api/tactics': {
        description: 'This enpoint returns all the tactics on the server',
      },
      'GET /api/tactics/:tactic_id': {
        description: 'This enpoint returns tactics that matches given tactic ID',
      },
      'POST /api/tactics': {
        description:
          'This endpoint allows the user to add an tactic to the server, referencing tactic ID',
      },
      'DELETE /api/tactics/:tactic_id': {
        description: 'This endpoint allows the user to delete a tactic, referencing tactic ID',
      },
    },
    '/users': {
      'GET /api/users': {
        description: 'This endpoint returns all the users on the server',
      },
      'POST /api/users': {
        description: 'This endpoint allows the user to add a new user to the server',
      },
      'GET /api/users/:user_id': {
        description: 'This endpoint returns a single user, referencing user ID',
      },
      'DELETE /api/users/:user_id': {
        description: 'This endpoint allows the user to delete a user, referencing user ID',
      },
    },
  },
};
