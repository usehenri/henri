// A task is kept for thirty days and then deleted: the smallest retention
// rule there is, and the one `henri retention` is checked against
module.exports = {
  // ... and it keeps its history, which is what `henri versions` reads
  // back. Nothing else in this application does, which is the point: the
  // table is created because one model asked
  options: { retention: { after: '30d' }, versioned: true },
  schema: { name: { required: true, type: 'string' } },
};
