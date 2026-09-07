module.exports = {
  // The third identifier, and the only one a person reads: henri adds the
  // `slug` column, fills it from the title on insert and prints it in every
  // url that names the record (base/slug.js). The public identifier is
  // still there and still resolves; the primary key still does not.
  options: { slug: 'title', timestamps: true },
  schema: {
    body: { type: 'text' },
    // An `enum` says what the column may hold, and henri spells it back as
    // methods (base/enums.js): `article.isDraft()` on the record and
    // `Article.live()` -- a condition, intersected with whatever it is
    // given -- on the model, plus `Article.enums.status`, the list
    status: {
      default: 'draft',
      enum: ['draft', 'live', 'archived'],
      type: 'string',
    },
    title: { required: true, type: 'string' },
  },
};
