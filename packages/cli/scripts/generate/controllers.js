/**
 * Source of the controllers written by `henri generate scaffold|crud`.
 *
 * Every function receives the resource names: doc = 'Post' (model global),
 * lower = 'post' (data key of one document), plural = 'posts' (controller,
 * routes and pages), keys = the attributes a request may set, api = the
 * model API of the store the resource lives in ('mongoose' for the disk and
 * mongoose adapters, 'sequelize' for mysql, postgresql and mssql, 'drizzle'
 * for the drizzle adapter; see scripts/adapters.js) and renderer = the view
 * engine of the application ('inertia' or 'react'; see scripts/utils.js).
 * The output goes through prettier, so the indentation here does not matter.
 *
 * The shape is the rails one: a `before` block loads the record of `:id` once
 * for the actions that need it (a hook that answers ends the request), and
 * `new` returns instead of rendering (henri renders the page of the action
 * with what it returns).
 *
 * JSON clients get HAL: `res.collection()` for the index, `res.resource()`
 * for one document (201 + Location on create, 204 on destroy). Browsers get
 * the pages and redirects (scaffold only). `res.negotiate({ html, json })`
 * picks one from the Accept header.
 *
 * The renderer only changes what a browser gets when a write fails. The
 * Inertia client follows a redirect and renders whatever page it lands on, so
 * an invalid form comes back as the same page rendered again after
 * `res.inertia.errors()`; the React forms read the `422` instead. API clients
 * get the same `422` either way.
 *
 * `:id` is the public identifier of the record, its `externalId`: a uuid on
 * every store. `Model.findById()` takes it (and the internal id too), and a
 * redirect is built from `record.externalId`, never from the numeric id,
 * which does not leave the server.
 *
 * Two things do not need a flavour: `Model.paginate()` answers the same
 * `{ records, page, perPage, total, pages }` on the three model APIs, and
 * `henri.model.errors()` normalizes what any of them throws on an invalid
 * write, so the index and the 422 are written once for all of them.
 */

const DEFAULT_API = 'mongoose';

/**
 * The api of a resource, `mongoose` when it is not one we know
 *
 * @param {object} opts { api }
 * @returns {string} mongoose, sequelize or drizzle
 */
const apiOf = ({ api }) => (FLAVOURS[api] ? api : DEFAULT_API);

/**
 * Pick the fragment of an api
 *
 * @param {string} part The fragment name (helpers, load, create, ...)
 * @param {object} opts { doc, lower, plural, keys, api }
 * @returns {string} The source code
 */
const of = (part, opts) => FLAVOURS[apiOf(opts)][part](opts);

// --- the renderer -----------------------------------------------------------

/**
 * Whether this controller renders Inertia pages: the `crud` generator writes
 * JSON only routes, so it opts out with `pages: false` whatever the renderer
 *
 * @param {object} opts { renderer, pages }
 * @returns {boolean} True for an Inertia scaffold
 */
const rendersInertia = ({ renderer, pages }) =>
  renderer === 'inertia' && pages !== false;

/**
 * The page file an action renders, as a comment writes it
 *
 * @param {object} opts { plural, renderer }
 * @param {string} view The page (index, new, ...)
 * @returns {string} A path under app/views
 */
const pageFile = ({ plural, renderer }, view) =>
  `app/views/pages/${plural}/${view}.${renderer === 'inertia' ? 'jsx' : 'js'}`;

// --- the helpers every flavour shares --------------------------------------

const fields = ({ keys }) => `
// Attributes a request may set (see req.permit)
const FIELDS = ${JSON.stringify(keys)};
`;

const validationHelper = (opts) =>
  rendersInertia(opts) ? inertiaValidation(opts) : jsonValidation(opts);

const jsonValidation = ({ doc }) => `
/**
 * Answer a failed validation with a 422 and one message per field
 *
 * @param {object} res Express response
 * @param {Error} error The error thrown by ${doc}
 * @returns {object} The response
 */
const invalid = (res, error) => {
  // Same { field: message } whatever the store threw, null when the error
  // is not a validation failure
  const errors = henri.model.errors(error);

  if (!errors) {
    throw error;
  }

  return res.boom.badData(error.message, { errors });
};
`;

const inertiaValidation = ({ doc }) => `
/**
 * Answer a failed validation: a browser gets the form it submitted back with
 * one message per field, an API client a 422
 *
 * @param {object} res Express response
 * @param {Error} error The error thrown by ${doc}
 * @param {string} page The page to render again (its form shows the errors)
 * @param {object} [data] What that page needs to render
 * @returns {object} The response
 */
const invalid = (res, error, page, data = {}) => {
  // Same { field: message } whatever the store threw, null when the error
  // is not a validation failure
  const errors = henri.model.errors(error);

  if (!errors) {
    throw error;
  }

  return res.negotiate({
    // The Inertia client renders the page it gets back, and res.inertia
    // .errors() is what puts the messages under the fields of its form
    html: () => {
      res.inertia.errors(errors);

      return res.render(page, { data });
    },
    json: () => res.boom.badData(error.message, { errors }),
  });
};
`;

/**
 * The `invalid()` call of a failed write
 *
 * @param {object} opts { lower, plural, renderer, pages }
 * @param {string} view The page to render again (new or edit)
 * @returns {string} The source code
 */
const invalidCall = (opts, view) => {
  if (!rendersInertia(opts)) {
    return 'return invalid(res, error);';
  }

  // The edit page needs its record back; the new page renders without data
  const data =
    view === 'edit' ? `, { ${opts.lower}: req.${opts.lower} }` : '';

  return `return invalid(res, error, '/${opts.plural}/${view}'${data});`;
};

/**
 * The paginated query of an index action: one call for the page and the
 * counters `res.collection()` wants, on every adapter
 *
 * @param {object} opts { doc, plural }
 * @returns {string} The source code
 */
const page = ({ doc, plural }) => `
    // One query for the page and its counters: the page and the size come
    // from ?page=2&per_page=50, bounded by config.api.maxPerPage
    const { records: ${plural}, page, perPage, total } = await ${doc}.paginate(
      req.pagination()
    );
`;

/**
 * The `before` hook loading the record of `:id`, around the lookup of a
 * flavour
 *
 * @param {object} opts { doc, lower }
 * @param {string} lookup The source code setting `req.<lower>`
 * @returns {string} The source code
 */
const loadHelper = ({ doc, lower }, lookup) => `
/**
 * Loads the ${lower} of \`:id\` into \`req.${lower}\`, the way rails'
 * before_action does. A hook that answers ends the request: the actions
 * below only ever run with a record.
 *
 * @param {object} req Express request
 * @param {object} res Express response
 * @returns {Promise<object|undefined>} The 404 answer, or nothing
 */
const load${doc} = async (req, res) => {
  ${lookup}

  if (!req.${lower}) {
    return res.boom.notFound(\`${doc} \${req.params.id} not found\`);
  }
};
`;

// --- mongoose (disk, mongoose) ---------------------------------------------

const mongoose = {
  create: (opts) => `
    let ${opts.lower};

    try {
      ${opts.lower} = await ${opts.doc}.create(req.permit(...FIELDS));
    } catch (error) {
      ${invalidCall(opts, 'new')}
    }
`,
  destroy: ({ lower }) => `
    await req.${lower}.deleteOne();
`,
  helpers: (opts) => `${fields(opts)}
/**
 * Run a query by id, null when the id is malformed
 *
 * The id in the url is the \`externalId\` of the document (a uuid), but a
 * document id works too; anything else is not a document.
 *
 * @param {Promise} query A mongoose query
 * @returns {Promise<object|null>} The document or null
 */
const byId = async (query) => {
  try {
    return await query;
  } catch (error) {
    if (error.name === 'CastError') {
      return null;
    }
    throw error;
  }
};
${validationHelper(opts)}`,
  load: (opts) =>
    loadHelper(
      opts,
      `req.${opts.lower} = await byId(${opts.doc}.findById(req.params.id));`
    ),
  update: (opts) => `
    try {
      req.${opts.lower}.set(req.permit(...FIELDS));
      await req.${opts.lower}.save();
    } catch (error) {
      ${invalidCall(opts, 'edit')}
    }
`,
};

// --- drizzle ----------------------------------------------------------------
// The drizzle models answer to the Mongoose names too, but a malformed id is
// already null, so there is no byId helper to guard the cast.

const drizzle = {
  create: mongoose.create,
  destroy: ({ lower }) => `
    await req.${lower}.destroy();
`,
  helpers: (opts) => `${fields(opts)}${validationHelper(opts)}`,
  load: (opts) =>
    loadHelper(
      opts,
      `// findById() answers null for a malformed id, no cast to guard
  req.${opts.lower} = await ${opts.doc}.findById(req.params.id);`
    ),
  update: (opts) => `
    try {
      await req.${opts.lower}.update(req.permit(...FIELDS));
    } catch (error) {
      ${invalidCall(opts, 'edit')}
    }
`,
};

// --- sequelize (mysql, postgresql, mssql) -----------------------------------
// Sequelize has no findByIdAndUpdate/Delete: a row is loaded with findById
// then updated or destroyed, and its errors carry an array of items.

const sequelize = {
  create: (opts) => `
    let ${opts.lower};

    try {
      ${opts.lower} = await ${opts.doc}.create(req.permit(...FIELDS));
    } catch (error) {
      ${invalidCall(opts, 'new')}
    }
`,
  destroy: ({ lower }) => `
    await req.${lower}.destroy();
`,
  helpers: (opts) => `${fields(opts)}
/**
 * Load a row by id, null when the id is malformed
 *
 * The id in the url is the \`externalId\` of the row (a uuid), but the
 * primary key works too; anything else is not a row.
 *
 * @param {*} id The id from the route
 * @returns {Promise<object|null>} The row or null
 */
const byId = async (id) => {
  try {
    return await ${opts.doc}.findById(id);
  } catch (error) {
    if (error.name === 'SequelizeDatabaseError') {
      return null;
    }
    throw error;
  }
};

${validationHelper(opts)}`,
  load: (opts) =>
    loadHelper(opts, `req.${opts.lower} = await byId(req.params.id);`),
  update: (opts) => `
    try {
      await req.${opts.lower}.update(req.permit(...FIELDS));
    } catch (error) {
      ${invalidCall(opts, 'edit')}
    }
`,
};

const FLAVOURS = { drizzle, mongoose, sequelize };

// --- the actions ------------------------------------------------------------

const header = (opts) => `${of('helpers', opts)}${of('load', opts)}
/** @type {import('@usehenri/core').Controller} */
module.exports = {`;

const footer = () => `};`;

/**
 * The `before` block of a controller (henri's before_action)
 *
 * @param {object} opts { doc, actions }
 * @returns {string} The source code
 */
const before = ({ doc, actions }) => `
  // Runs before these actions, in this order (henri's before_action)
  before: { '${actions.join(',')}': load${doc} },`;

const index = (opts) => `
  index: async (req, res) => {
    ${page(opts)}
    // ${pageFile(opts, 'index')} is the /${opts.plural} page
    const html = () =>
      res.render('/${opts.plural}', {
        data: { ${[opts.plural, 'page', 'perPage', 'total'].sort().join(', ')} },
      });

    // Browsers get the page, API clients a HAL collection
    return res.negotiate({
      html,
      json: () => res.collection(${opts.plural}, { page, perPage, total }),
    });
  },`;

const indexJson = (opts) => `
  index: async (req, res) => {
    ${page(opts)}
    return res.collection(${opts.plural}, { page, perPage, total });
  },`;

const newC = (opts) => `
  // No answer, no res.render(): what an action returns is the data of its
  // own page, here ${pageFile(opts, 'new')}
  new: async () => ({}),`;

const create = (opts) => `
  create: async (req, res) => {
    ${of('create', opts)}
    // 201 with a Location header pointing at the new ${opts.lower}
    return res.negotiate({
      html: () => res.redirect(\`/${opts.plural}/\${${opts.lower}.externalId}\`),
      json: () => res.resource(${opts.lower}, { status: 201 }),
    });
  },`;

const createJson = (opts) => `
  create: async (req, res) => {
    ${of('create', opts)}
    // 201 with a Location header pointing at the new ${opts.lower}
    return res.resource(${opts.lower}, { status: 201 });
  },`;

const show = (opts) => `
  // req.${opts.lower} comes from the before hook above
  show: async (req, res) =>
    res.negotiate({
      html: () =>
        res.render('/${opts.plural}/show', { data: { ${opts.lower}: req.${opts.lower} } }),
      json: () => res.resource(req.${opts.lower}),
    }),`;

const edit = (opts) => `
  edit: async (req, res) =>
    res.negotiate({
      html: () =>
        res.render('/${opts.plural}/edit', { data: { ${opts.lower}: req.${opts.lower} } }),
      json: () => res.resource(req.${opts.lower}),
    }),`;

const update = (opts) => `
  update: async (req, res) => {
    ${of('update', opts)}
    return res.negotiate({
      html: () =>
        res.redirect(\`/${opts.plural}/\${req.${opts.lower}.externalId}\`),
      json: () => res.resource(req.${opts.lower}),
    });
  },`;

const updateJson = (opts) => `
  update: async (req, res) => {
    ${of('update', opts)}
    return res.resource(req.${opts.lower});
  },`;

const destroy = (opts) => `
  destroy: async (req, res) => {
    ${of('destroy', opts)}
    return res.negotiate({
      html: () => res.redirect('/${opts.plural}'),
      json: () => res.status(204).end(),
    });
  },`;

const destroyJson = (opts) => `
  destroy: async (req, res) => {
    ${of('destroy', opts)}
    return res.status(204).end();
  },`;

/**
 * A controller with the seven resources actions and html/json answers
 *
 * @param {object} opts { doc, lower, plural, keys, api }
 * @returns {string} The source code
 */
const resources = (opts) =>
  [
    header(opts),
    before({ actions: ['show', 'edit', 'update', 'destroy'], doc: opts.doc }),
    index(opts),
    newC(opts),
    create(opts),
    show(opts),
    edit(opts),
    update(opts),
    destroy(opts),
    footer(),
  ].join('\n');

/**
 * A json only controller with index, create, update and destroy
 *
 * @param {object} opts { doc, lower, plural, keys, api }
 * @returns {string} The source code
 */
const crud = (options) => {
  // `crud` routes answer JSON only: no page to render again, so the failed
  // validation is a 422 whatever the renderer of the application
  const opts = { ...options, pages: false };

  return [
    header(opts),
    before({ actions: ['update', 'destroy'], doc: opts.doc }),
    indexJson(opts),
    createJson(opts),
    updateJson(opts),
    destroyJson(opts),
    footer(),
  ].join('\n');
};

module.exports = { crud, resources };
