module.exports = {
  create: async (req, res) => {
    try {
      const artwork = await Artwork.create(req.permit('title', 'year'));

      return res.status(201).send({ artwork, msg: 'success' });
    } catch (error) {
      return res.status(400).send({ error: error.message, msg: 'failed' });
    }
  },
  destroy: async (req, res) => {
    try {
      await Artwork.deleteOne({ _id: req.params.id });

      return res.send({ msg: 'success' });
    } catch (error) {
      return res.status(400).send({ error: error.message, msg: 'failed' });
    }
  },
  index: async (req, res) => {
    res.render('/artwork/index', {
      data: { artwork: await Artwork.find({}) },
    });
  },
  update: async (req, res) => {
    try {
      const result = await Artwork.updateOne(
        { _id: req.params.id },
        { $set: req.permit('title', 'year') }
      );

      if (result.matchedCount === 0) {
        return res.boom.notFound('artwork not found');
      }

      return res.send({ msg: 'success' });
    } catch (error) {
      return res.status(400).send({ error: error.message, msg: 'failed' });
    }
  },
};
