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

module.exports = {
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

  new: async (req, res) => {
    res.render('/artworks/new');
  },

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

  show: async (req, res) => {
    const artwork = await byId(Artwork.findById(req.params.id));

    if (!artwork) {
      return res.boom.notFound(`Artwork ${req.params.id} not found`);
    }

    return res.negotiate({
      html: () => res.render('/artworks/show', { data: { artwork } }),
      json: () => res.resource(artwork),
    });
  },

  edit: async (req, res) => {
    const artwork = await byId(Artwork.findById(req.params.id));

    if (!artwork) {
      return res.boom.notFound(`Artwork ${req.params.id} not found`);
    }

    return res.negotiate({
      html: () => res.render('/artworks/edit', { data: { artwork } }),
      json: () => res.resource(artwork),
    });
  },

  update: async (req, res) => {
    let artwork;

    try {
      artwork = await byId(
        Artwork.findByIdAndUpdate(req.params.id, req.permit(...FIELDS), {
          new: true,
          runValidators: true,
        })
      );
    } catch (error) {
      return invalid(res, error);
    }

    if (!artwork) {
      return res.boom.notFound(`Artwork ${req.params.id} not found`);
    }

    return res.negotiate({
      html: () => res.redirect(`/artworks/${artwork.id}`),
      json: () => res.resource(artwork),
    });
  },

  destroy: async (req, res) => {
    const artwork = await byId(Artwork.findByIdAndDelete(req.params.id));

    if (!artwork) {
      return res.boom.notFound(`Artwork ${req.params.id} not found`);
    }

    return res.negotiate({
      html: () => res.redirect('/artworks'),
      json: () => res.status(204).end(),
    });
  },
};
