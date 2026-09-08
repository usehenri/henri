/** @type {import('@usehenri/core').RoutesFile} */
module.exports = {
  root: 'main#home',

  'get /about': 'main#about',
  'namespace admin': { 'crud tasks': { roles: ['admin'] } },
  'resources notes': { only: ['index', 'show'] },
  'resources tasks': {
    member: { 'post archive': 'archive' },
  },
};
