module.exports = {
  graphql: {
    resolvers: { Query: { artworks: async () => Artwork.find() } },
    types: `
      type Artwork { title: String, year: Int }
      type Query { artworks: [Artwork] }
    `,
  },
  // Nothing here is about a person, so the rule deletes rather than
  // anonymizing: there is nothing to write over
  options: { retention: { action: 'delete', after: '2y' }, timestamps: true },
  schema: { title: { type: 'string' }, year: { type: 'integer' } },
};
