module.exports = {
  graphql: {
    resolvers: { Query: { artworks: async () => Artwork.find() } },
    types: `
      type Artwork { title: String, year: Int }
      type Query { artworks: [Artwork] }
    `,
  },
  options: { timestamps: true },
  schema: { title: { type: 'string' }, year: { type: 'integer' } },
};
