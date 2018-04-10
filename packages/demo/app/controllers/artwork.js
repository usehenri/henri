module.exports = {
  index: async (req, res) => {
    res.render('/artwork/index', {
      data: { artwork: await Artwork.find({}) },
    });
  },
  create: async (req, res) => {
    const data = req.body;
    const doc = new Artwork(data);
    const errors = await doc.validate();

    if (errors) {
      return res.status(400).send({ msg: 'failed', error: errors.message });
    }
    await doc.save();
    return res.send({ msg: 'success' });
  },
  update: async (req, res) => {
    if (!req.params.id) {
      return res.status(400).send({ msg: 'invalid id' });
    }
    Artwork.update({ _id: req.params.id }, { $set: req.body }, err => {
      if (err) {
        return res.status(400).send({ msg: 'failed', error: err.message });
      }
      return res.send({ msg: 'success' });
    });
  },
  destroy: async (req, res) => {
    if (!req.params.id) {
      return res.status(400).send({ msg: 'invalid id' });
    }
    Artwork.remove({ _id: req.params.id }, err => {
      if (err) {
        return res.status(400).send({ msg: 'failed', error: err.message });
      }
      return res.send({ msg: 'success' });
    });
  },
};
