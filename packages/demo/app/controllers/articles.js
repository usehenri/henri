/* global Article */

// Attributes a request may set (see req.permit). `slug` is not one of them:
// henri writes it, and an application that wants to let a person choose one
// lists it here on purpose.
const FIELDS = ['title', 'body'];

/**
 * Loads the article of `:id` into `req.article`. The `:id` of a slugged
 * model is its slug, and `findById()` also still takes the public
 * identifier -- what it never takes is the primary key.
 *
 * @param {object} req Express request
 * @param {object} res Express response
 * @returns {Promise<object|undefined>} The 404 answer, or nothing
 */
const loadArticle = async (req, res) => {
  req.article = await Article.findById(req.params.id);

  if (!req.article) {
    return res.notFound(`Article ${req.params.id} not found`);
  }
};

module.exports = {
  before: { show: loadArticle },

  create: async (req, res) => {
    const article = await Article.create(req.permit(...FIELDS));

    return res.resource(article, { status: 201 });
  },

  index: async (req, res) => {
    const { page, perPage, skip, limit } = req.pagination();
    const [articles, total] = await Promise.all([
      Article.find().skip(skip).limit(limit),
      Article.countDocuments(),
    ]);

    return res.collection(articles, { page, perPage, total });
  },

  show: async (req, res) => res.resource(req.article),
};
