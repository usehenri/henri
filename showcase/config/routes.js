// The whole url surface of the application, in henri's routes DSL.
//
//   henri routes            prints the expanded table
//   henri routes --json     the same as JSON
//
// Every key is a verb and a path (`get /about`) or one of the keywords
// `root`, `resources`, `crud` and `namespace`. See usehenri.io/guides/routes.
module.exports = {
  root: 'main#home',

  'get /about': 'main#about',

  // The hypermedia explorer: a page that calls the JSON API of this same
  // application and shows the answers (see app/views/pages/api.jsx)
  'get /api': 'main#api',

  // POST /login and POST /logout are mounted by henri; the page is ours
  'get /login': 'sessions#new',

  // The account flows are henri's: POST /signup, POST /password/forgot,
  // GET /password/reset/:token, POST /password/reset, GET /confirm/:token,
  // POST /confirm and POST /account/email are mounted by the user module
  // because config.user turned them on. What is left for the application is
  // the pages those forms live on.
  'get /signup': 'accounts#new',

  'get /confirm': 'accounts#confirm',
  'get /password/forgot': 'accounts#forgot',
  'get /password/reset': 'accounts#reset',

  // A plain route behind a role: every signed-in speaker may edit their own
  // profile, an anonymous visitor is redirected to the login page
  'get /account': { controller: 'accounts#show', roles: ['speaker'] },
  'patch /account': { controller: 'accounts#update', roles: ['speaker'] },

  // The public program. `only` keeps two of the seven actions, and the
  // nested resource lives under one event: GET /events/:event_id/tracks
  'resources events': {
    only: ['index', 'show'],
    nested: {
      'resources tracks': { only: ['index'] },
    },
  },

  // The proposals a speaker writes and the committee reviews.
  //
  //   `except`     no DELETE: withdrawing is a member route that soft
  //                deletes the proposal, so the committee keeps its reviews
  //   `collection` GET /proposals/mine, the proposals of the current user
  //   `member`     POST /proposals/:id/submit and /withdraw, the two state
  //                transitions a speaker may trigger
  //   `nested`     GET and POST /proposals/:proposal_id/reviews, admin only
  //   `version`    clients asking for another `application/vnd.henri.vN+json`
  //                get a 406; the ones asking for none are served v1
  //
  // index, show, new, create, edit and update carry no `roles`: reading is
  // public and writing is guarded by the `before` hooks of the controller,
  // which is where ownership lives anyway. The three routes that only make
  // sense for a signed-in speaker say so here, so they disappear from the
  // `paths` an anonymous page receives.
  'resources proposals': {
    version: 'v1',
    except: ['destroy'],
    collection: { 'get mine': { action: 'mine', roles: ['speaker'] } },
    member: {
      'post submit': { action: 'submit', roles: ['speaker'] },
      'post withdraw': { action: 'withdraw', roles: ['speaker'] },
    },
    nested: {
      'resources reviews': { only: ['index', 'create'], roles: ['admin'] },
    },
  },

  // The program committee. Every route is prefixed with /admin and every
  // controller with admin/ (app/controllers/admin/*.js). Options are not
  // inherited from the namespace, so each entry declares its own roles.
  'namespace admin': {
    root: { controller: 'dashboard#index', roles: ['admin'] },

    'resources proposals': {
      roles: ['admin'],
      only: ['index', 'show'],
      collection: { 'get withdrawn': 'withdrawn' },
      member: {
        'post decide': 'decide',
        'post restore': 'restore',
      },
    },

    'resources users': {
      roles: ['admin'],
      only: ['index'],
      member: { 'post role': 'role' },
    },
  },
};
