exports.endpoints = {
    '/api': {
      'GET /api': {
        description: 'This endpoint lists all available enpoints on the server',
      },
      '/teams': {
        'GET /api/teams': {
          description: 'This endpoint returns all the teams on the server',
        },
        'POST /api/teams': {
          description: 'This enpoint allows the user to add teams to the server',
        },
      },
    },
  };