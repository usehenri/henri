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
  create: async (req, res) => {
    let artwork;

    try {
      artwork = await Artwork.create(req.permit(...FIELDS));
    } catch (error) {
      return invalid(res, error);
    }

    return res.resource(artwork, { status: 201 });
  },
  destroy: async (req, res) => {
    const artwork = await byId(Artwork.findByIdAndDelete(req.params.id));

    if (!artwork) {
      return res.boom.notFound(`Artwork ${req.params.id} not found`);
    }

    return res.status(204).end();
  },
  index: async (req, res) => {
    res.render('/artwork/index', {
      data: { artwork: await Artwork.find() },
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

    return res.resource(artwork);
  },
};
