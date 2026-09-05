/**
 * Source of the controllers written by `henri generate scaffold|crud`.
 *
 * Every function receives the resource names: doc = 'Post' (model global),
 * lower = 'post' (data key of one document), plural = 'posts' (controller,
 * routes and pages) and keys = the attributes a request may set.
 * The output goes through prettier, so the indentation here does not matter.
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

const index = ({ doc, plural }) => `
  index: async (req, res) => {
    // app/views/pages/${plural}/index.js is the /${plural} page for next.js
    res.render('/${plural}', {
      data: { ${plural}: await ${doc}.find() },
    });
  },`;

const indexJson = ({ doc, plural }) => `
  index: async (req, res) => {
    res.json({ ${plural}: await ${doc}.find() });
  },`;

const newC = ({ plural }) => `
  new: async (req, res) => {
    res.render('/${plural}/new');
  },`;

const create = ({ doc, lower, plural }) => `
  create: async (req, res) => {
    let ${lower};

    try {
      ${lower} = await ${doc}.create(req.permit(...FIELDS));
    } catch (error) {
      return invalid(res, error);
    }

    return res.format({
      html: () => res.redirect(\`/${plural}/\${${lower}.id}\`),
      json: () => res.status(201).json({ ${lower} }),
      default: () => res.status(201).json({ ${lower} }),
    });
  },`;

const createJson = ({ doc, lower }) => `
  create: async (req, res) => {
    let ${lower};

    try {
      ${lower} = await ${doc}.create(req.permit(...FIELDS));
    } catch (error) {
      return invalid(res, error);
    }

    return res.status(201).json({ ${lower} });
  },`;

const show = ({ doc, lower, plural }) => `
  show: async (req, res) => {
    const ${lower} = await byId(${doc}.findById(req.params.id));

    if (!${lower}) {
      return res.boom.notFound(\`${doc} \${req.params.id} not found\`);
    }

    return res.render('/${plural}/show', { data: { ${lower} } });
  },`;

const edit = ({ doc, lower, plural }) => `
  edit: async (req, res) => {
    const ${lower} = await byId(${doc}.findById(req.params.id));

    if (!${lower}) {
      return res.boom.notFound(\`${doc} \${req.params.id} not found\`);
    }

    return res.render('/${plural}/edit', { data: { ${lower} } });
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
    return res.format({
      html: () => res.redirect(\`/${opts.plural}/\${${opts.lower}.id}\`),
      json: () => res.json({ ${opts.lower} }),
      default: () => res.json({ ${opts.lower} }),
    });
  },`;

const updateJson = (opts) => `
  update: async (req, res) => {
    ${updateBody(opts)}
    return res.json({ ${opts.lower} });
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
    return res.format({
      html: () => res.redirect('/${opts.plural}'),
      json: () => res.json({ ${opts.lower} }),
      default: () => res.json({ ${opts.lower} }),
    });
  },`;

const destroyJson = (opts) => `
  destroy: async (req, res) => {
    ${destroyBody(opts)}
    return res.json({ ${opts.lower} });
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
