module.exports = {
  list: async (req, res) => {
    await Artwork.create({ title: 'hello', year: 1912 });
    res.render('/', { data: { artwork: await Artwork.find() } });
  },
};
