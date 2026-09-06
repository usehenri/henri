// What a henri application actually writes: CommonJS, no TypeScript, the
// shapes named through JSDoc. `checkJs` is on for this project, so tsc checks
// this file the way an editor checks it in a scaffolded application.
//
// If this file stops compiling, the annotations documented in
// `website/src/content/docs/reference/types.md` have stopped working.

/** @type {import('@usehenri/core').Controller} */
const tasks = {
  before: {
    all: [
      (req, res, next) => {
        // `req` is typed by the annotation on the object, nothing else
        req.flash('notice', `request ${req.id}`);
        next();
      },
    ],
    'show,edit': async (req, res) => {
      if (!req.params.id) {
        return res.boom.notFound('No such task');
      }

      return undefined;
    },
  },

  index: async (req, res) => {
    const { page, perPage, skip, limit } = req.pagination();

    return res.collection([], { page, perPage, total: 0 });
  },

  create: async (req, res) => {
    const attributes = req.permit('title', 'body');

    try {
      return res.resource(attributes, { status: 201 });
    } catch (error) {
      const errors = henri.model.errors(error);

      if (!errors) {
        throw error;
      }

      return res.boom.badData('Invalid task', { errors });
    }
  },

  // An action that returns without answering renders /tasks/show with it
  show: async (req) => ({ id: req.params.id }),
};

/** @type {import('@usehenri/core').RoutesFile} */
const routes = {
  root: 'main#home',
  'get /about': 'main#about',
  'resources tasks': {
    member: { 'post archive': 'archive' },
    only: ['index', 'show', 'create'],
  },
  'namespace admin': { 'crud users': { roles: ['admin'] } },
};

/** @type {import('@usehenri/core').ModelFile} */
const model = {
  associate(models) {
    void models;
  },
  options: { paranoid: true },
  schema: {
    body: 'text',
    status: { default: 'todo', enum: ['todo', 'done'], type: 'string' },
    title: { required: true, type: 'string' },
  },
};

/** @type {import('@usehenri/core').Configuration} */
const configuration = {
  api: { maxPerPage: 100, perPage: 25 },
  renderer: 'react',
  stores: { default: { adapter: 'disk' } },
  user: 'user',
};

// The global is there without requiring anything
henri.pen.info('types', henri.release, henri.isProduction);

module.exports = { configuration, model, routes, tasks };
