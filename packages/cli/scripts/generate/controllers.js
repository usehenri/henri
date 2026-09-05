/**
 * Source of the controllers written by `henri generate scaffold|crud`.
 *
 * Every function receives the resource names: doc = 'Post' (model global),
 * lower = 'post' (data key of one document), plural = 'posts' (controller,
 * routes and pages) and keys = the attributes a request may set.
 * The output goes through prettier, so the indentation here does not matter.
 *
 * JSON clients get HAL: `res.collection()` for the index, `res.resource()`
 * for one document (201 + Location on create, 204 on destroy). Browsers get
 * the pages and redirects (scaffold only). `res.negotiate({ html, json })`
 * picks one from the Accept header.
 */

const header = ({ doc, keys }) => `
// Attributes a request may set (see req.permit)
const FIELDS = ${JSON.stringify(keys)};

/**
 * Run a query by id, null when the id is malformed
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

/**
 * Answer a failed validation with a 422 and one message per field
 *
 * @param {object} res Express response
 * @param {Error} error The error thrown by ${doc}
 * @returns {object} The response
 */
const invalid = (res, error) => {
  if (error.name !== 'ValidationError') {
    throw error;
  }

  const errors = Object.fromEntries(
    Object.entries(error.errors || {}).map(([field, detail]) => [
      field,
      detail.message,
    ])
  );

  return res.boom.badData(error.message, { errors });
};

module.exports = {`;

const footer = () => `};`;

/**
 * The paginated query of an index action
 *
 * @param {object} opts { doc, plural }
 * @returns {string} The source code
 */
const page = ({ doc, plural }) => `
    // Page and size from ?page=2&per_page=50, bounded by config.api.maxPerPage
    const { page, perPage, skip, limit } = req.pagination();
    const [${plural}, total] = await Promise.all([
      ${doc}.find().skip(skip).limit(limit),
      ${doc}.countDocuments(),
    ]);
`;

const index = (opts) => `
  index: async (req, res) => {
    ${page(opts)}
    // app/views/pages/${opts.plural}/index.js is the /${opts.plural} page for next.js
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

const newC = ({ plural }) => `
  new: async (req, res) => {
    res.render('/${plural}/new');
  },`;

const createBody = ({ doc, lower }) => `
    let ${lower};

    try {
      ${lower} = await ${doc}.create(req.permit(...FIELDS));
    } catch (error) {
      return invalid(res, error);
    }
`;

const create = (opts) => `
  create: async (req, res) => {
    ${createBody(opts)}
    // 201 with a Location header pointing at the new ${opts.lower}
    return res.negotiate({
      html: () => res.redirect(\`/${opts.plural}/\${${opts.lower}.id}\`),
      json: () => res.resource(${opts.lower}, { status: 201 }),
    });
  },`;

const createJson = (opts) => `
  create: async (req, res) => {
    ${createBody(opts)}
    // 201 with a Location header pointing at the new ${opts.lower}
    return res.resource(${opts.lower}, { status: 201 });
  },`;

const findBody = ({ doc, lower }) => `
    const ${lower} = await byId(${doc}.findById(req.params.id));

    if (!${lower}) {
      return res.boom.notFound(\`${doc} \${req.params.id} not found\`);
    }
`;

const show = (opts) => `
  show: async (req, res) => {
    ${findBody(opts)}
    return res.negotiate({
      html: () => res.render('/${opts.plural}/show', { data: { ${opts.lower} } }),
      json: () => res.resource(${opts.lower}),
    });
  },`;

const edit = (opts) => `
  edit: async (req, res) => {
    ${findBody(opts)}
    return res.negotiate({
      html: () => res.render('/${opts.plural}/edit', { data: { ${opts.lower} } }),
      json: () => res.resource(${opts.lower}),
    });
  },`;

const updateBody = ({ doc, lower }) => `
    let ${lower};

    try {
      ${lower} = await byId(
        ${doc}.findByIdAndUpdate(req.params.id, req.permit(...FIELDS), {
          new: true,
          runValidators: true,
        })
      );
    } catch (error) {
      return invalid(res, error);
    }

    if (!${lower}) {
      return res.boom.notFound(\`${doc} \${req.params.id} not found\`);
    }
`;

const update = (opts) => `
  update: async (req, res) => {
    ${updateBody(opts)}
    return res.negotiate({
      html: () => res.redirect(\`/${opts.plural}/\${${opts.lower}.id}\`),
      json: () => res.resource(${opts.lower}),
    });
  },`;

const updateJson = (opts) => `
  update: async (req, res) => {
    ${updateBody(opts)}
    return res.resource(${opts.lower});
  },`;

const destroyBody = ({ doc, lower }) => `
    const ${lower} = await byId(${doc}.findByIdAndDelete(req.params.id));

    if (!${lower}) {
      return res.boom.notFound(\`${doc} \${req.params.id} not found\`);
    }
`;

const destroy = (opts) => `
  destroy: async (req, res) => {
    ${destroyBody(opts)}
    return res.negotiate({
      html: () => res.redirect('/${opts.plural}'),
      json: () => res.status(204).end(),
    });
  },`;

const destroyJson = (opts) => `
  destroy: async (req, res) => {
    ${destroyBody(opts)}
    return res.status(204).end();
  },`;

/**
 * A controller with the seven resources actions and html/json answers
 *
 * @param {object} opts { doc, lower, plural, keys }
 * @returns {string} The source code
 */
const resources = (opts) =>
  [
    header(opts),
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
 * @param {object} opts { doc, lower, plural, keys }
 * @returns {string} The source code
 */
const crud = (opts) =>
  [
    header(opts),
    indexJson(opts),
    createJson(opts),
    updateJson(opts),
    destroyJson(opts),
    footer(),
  ].join('\n');

module.exports = { crud, resources };
