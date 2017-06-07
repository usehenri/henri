module.exports = {
  index: (req, res) => {
    const photos = new Array(56).fill(0).map((v, k) => k + 1);
    res.render('/index', { photos });
  },
};
