module.exports = {
  // The third identifier, and the only one a person reads: henri adds the
  // `slug` column, fills it from the title on insert and prints it in every
  // url that names the record (base/slug.js). The public identifier is
  // still there and still resolves; the primary key still does not.
  options: { slug: 'title', timestamps: true },
  schema: {
    body: { type: 'text' },
    title: { required: true, type: 'string' },
  },
};
