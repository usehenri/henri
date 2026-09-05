module.exports = {
  'crud artwork': { controller: 'artwork' },
  // Destroy of the versioned resource below is limited to admins
  'delete /api/v1/artworks/:id': {
    controller: 'artworks#destroy',
    roles: ['admin'],
  },
  'get /admin': { controller: 'user#admin', roles: ['admin'] },
  'get /limited': {
    controller: 'main#limited',
    rateLimit: { max: 2, windowMs: 60000 },
  },
  'get /profile': { controller: 'user#profile', roles: ['member'] },
  'get /version': 'main#version',
  // Idempotency-Key is honoured by default on mutating routes, unless the
  // route opts out (/echo)
  'post /echo': { controller: 'main#echo', idempotent: false },
  'post /once': 'main#echo',
  'post /register': 'user#create',
  // A versioned, scoped resource (/api/v1/artworks)
  'resources artworks': {
    controller: 'artworks',
    omit: ['destroy'],
    scope: 'api/v1',
    version: 'v1',
  },
};
