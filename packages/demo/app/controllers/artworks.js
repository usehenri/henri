/* eslint-disable sort-keys, capitalized-comments -- written by henri generate scaffold, kept as is */
// Attributes a request may set (see req.permit)
const FIELDS = ['title', 'year'];

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
 * @param {Error} error The error thrown by Artwork
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

/**
 * Loads the artwork of `:id` into `req.artwork`, the way rails'
 * before_action does. A hook that answers ends the request: the actions
 * below only ever run with a document.
 *
 * @param {object} req Express request
 * @param {object} res Express response
 * @returns {Promise<object|undefined>} The 404 answer, or nothing
 */
const loadArtwork = async (req, res) => {
  req.artwork = await byId(Artwork.findById(req.params.id));

  if (!req.artwork) {
    return res.boom.notFound(`Artwork ${req.params.id} not found`);
  }
};

module.exports = {
  // Runs before these actions, in this order (henri's before_action)
  before: { 'show,edit,update,destroy': loadArtwork },

  index: async (req, res) => {
    // Page and size from ?page=2&per_page=50, bounded by config.api.maxPerPage
    const { page, perPage, skip, limit } = req.pagination();
    const [artworks, total] = await Promise.all([
      Artwork.find().skip(skip).limit(limit),
      Artwork.countDocuments(),
    ]);

    // app/views/pages/artworks/index.js is the /artworks page for next.js
    const html = () =>
      res.render('/artworks', {
        data: { artworks, page, perPage, total },
      });

    // Browsers get the page, API clients a HAL collection
    return res.negotiate({
      html,
      json: () => res.collection(artworks, { page, perPage, total }),
    });
  },

  // No answer, no res.render(): what an action returns is the data of its
  // own page, here app/views/pages/artworks/new.js
  new: async () => ({}),

  create: async (req, res) => {
    let artwork;

    try {
      artwork = await Artwork.create(req.permit(...FIELDS));
    } catch (error) {
      return invalid(res, error);
    }

    // 201 with a Location header pointing at the new artwork
    return res.negotiate({
      html: () => res.redirect(`/artworks/${artwork.id}`),
      json: () => res.resource(artwork, { status: 201 }),
    });
  },

  // req.artwork comes from the before hook above
  show: async (req, res) =>
    res.negotiate({
      html: () =>
        res.render('/artworks/show', { data: { artwork: req.artwork } }),
      json: () => res.resource(req.artwork),
    }),

  edit: async (req, res) =>
    res.negotiate({
      html: () =>
        res.render('/artworks/edit', { data: { artwork: req.artwork } }),
      json: () => res.resource(req.artwork),
    }),

  update: async (req, res) => {
    try {
      req.artwork.set(req.permit(...FIELDS));
      await req.artwork.save();
    } catch (error) {
      return invalid(res, error);
    }

    return res.negotiate({
      html: () => res.redirect(`/artworks/${req.artwork.id}`),
      json: () => res.resource(req.artwork),
    });
  },

  destroy: async (req, res) => {
    await req.artwork.deleteOne();

    return res.negotiate({
      html: () => res.redirect('/artworks'),
      json: () => res.status(204).end(),
    });
  },
};
