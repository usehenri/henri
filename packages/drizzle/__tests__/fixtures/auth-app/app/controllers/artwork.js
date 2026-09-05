/* global Artwork */
// A crud controller in the shape `henri generate crud` writes
const FIELDS = ['title', 'year'];

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

    return res.status(201).json({ artwork });
  },
  destroy: async (req, res) => {
    const artwork = await Artwork.findByIdAndDelete(req.params.id);

    if (!artwork) {
      return res.boom.notFound(`Artwork ${req.params.id} not found`);
    }

    return res.json({ artwork });
  },
  index: async (req, res) => {
    res.json({ artwork: await Artwork.find() });
  },
  update: async (req, res) => {
    let artwork;

    try {
      artwork = await Artwork.findByIdAndUpdate(
        req.params.id,
        req.permit(...FIELDS),
        { new: true, runValidators: true }
      );
    } catch (error) {
      return invalid(res, error);
    }

    if (!artwork) {
      return res.boom.notFound(`Artwork ${req.params.id} not found`);
    }

    return res.json({ artwork });
  },
};
