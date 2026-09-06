// A task is kept for thirty days and then deleted: the smallest retention
// rule there is, and the one `henri retention` is checked against
module.exports = {
  options: { retention: { after: '30d' } },
  schema: { name: { required: true, type: 'string' } },
};
