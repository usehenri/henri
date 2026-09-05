module.exports = {
  'crud artwork': { controller: 'artwork' },
  'get /admin': { controller: 'user#admin', roles: ['admin'] },
  'get /profile': { controller: 'user#profile', roles: ['member'] },
  'post /register': 'user#create',
};
