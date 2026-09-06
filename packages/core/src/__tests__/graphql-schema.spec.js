const {
  KEYS,
  MUTATIONS,
  TYPES,
  declarationOf,
  describe: describeModels,
  mergeResolvers,
  sdlOf,
} = require('../base/graphql-schema');
const { conditionOf, pageOf } = require('../base/graphql-resolvers');

/** A configuration with a user model and nothing else to say */
const config = { user: { model: 'user' } };

/**
 * A model file, with the two keys every one of them carries
 *
 * @param {string} name the global id
 * @param {object} model the rest of the file
 * @returns {object} the model file
 */
const file = (name, model) => ({
  globalId: name,
  identity: name.toLowerCase(),
  ...model,
});

/**
 * The description of one model, alone in its application
 *
 * @param {object} model a model file
 * @param {Array<object>} [others=[]] the other models of the application
 * @returns {object} the description
 */
const only = (model, others = []) =>
  describeModels([model, ...others], config)[0];

/** One model declaring every type henri knows, and every mark it reads */
const everything = file('Thing', {
  graphql: { generate: true, mutations: true },
  options: { paranoid: true, timestamps: true },
  schema: {
    at: { type: 'date' },
    blob: { type: 'json' },
    body: { type: 'text' },
    count: { type: 'integer' },
    key: { type: 'uuid' },
    okay: { type: 'boolean' },
    price: { type: 'float' },
    size: { type: 'number' },
    state: { enum: ['draft', 'published'], type: 'string' },
    title: { required: true, type: 'string' },
  },
});

describe('the graphql definition derived from a model', () => {
  describe('every henri type', () => {
    const fields = Object.fromEntries(
      only(everything).fields.map((field) => [field.name, field.type])
    );

    test('becomes the GraphQL type of the same shape', () => {
      expect(fields).toMatchObject({
        at: 'String',
        body: 'String',
        count: 'Int',
        key: 'String',
        okay: 'Boolean',
        price: 'Float',
        size: 'Float',
        title: 'String',
      });
    });

    test('is the whole table, so nothing is mapped twice', () => {
      expect(Object.keys(TYPES).sort()).toEqual([
        'boolean',
        'date',
        'float',
        'integer',
        'number',
        'string',
        'text',
        'uuid',
      ]);
    });

    test('makes a required field non-null', () => {
      const sdl = sdlOf(only(everything));

      expect(sdl).toContain('  title: String!');
      expect(sdl).toContain('  count: Int\n');
    });

    test('makes an enum an enum type of its own', () => {
      const sdl = sdlOf(only(everything));

      expect(sdl).toContain('enum ThingState {\n  draft\n  published\n}');
      expect(fields.state).toBe('ThingState');
    });

    test('leaves an enum whose values are not GraphQL names a String', () => {
      const description = only(
        file('Thing', {
          graphql: true,
          schema: { state: { enum: ['in-progress', 'done'], type: 'string' } },
        })
      );

      expect(description.enums).toEqual([]);
      expect(description.fields).toContainEqual(
        expect.objectContaining({ name: 'state', type: 'String' })
      );
    });

    test('leaves a json column out: it has no shape to state', () => {
      expect(fields.blob).toBeUndefined();
      expect(only(everything).refusals).toContainEqual({
        field: 'blob',
        reason: 'unshaped',
        what: 'field',
      });
    });

    test('publishes the timestamps and the soft delete stamp', () => {
      expect(fields).toMatchObject({
        createdAt: 'String',
        deletedAt: 'String',
        updatedAt: 'String',
      });
    });
  });

  describe('identifiers', () => {
    test('the record identifier is ID! and it is the externalId', () => {
      const sdl = sdlOf(only(everything));

      expect(sdl).toContain('type Thing {\n  id: ID!');
      expect(only(everything).fields.map((field) => field.name)).not.toContain(
        'externalId'
      );
    });

    test('a declared foreign key is an ID, never the number it holds', () => {
      const description = only(
        file('Memo', {
          graphql: true,
          schema: { ownerId: { ref: 'User', type: 'string' } },
        }),
        [file('User', { schema: {} })]
      );

      expect(description.fields).toContainEqual(
        expect.objectContaining({
          name: 'ownerId',
          reference: 'User',
          type: 'ID',
        })
      );
    });

    test('a foreign key is never a filter: matching one is a lookup', () => {
      const description = only(
        file('Memo', {
          graphql: true,
          schema: {
            ownerId: { references: { model: 'User' }, type: 'string' },
          },
        }),
        [file('User', { schema: {} })]
      );

      expect(description.filters).toEqual([]);
      expect(description.refusals).toContainEqual({
        field: 'ownerId',
        reason: 'reference',
        what: 'filter',
      });
    });

    test('a reference to a model that is not there is not an input', () => {
      const description = only(
        file('Memo', {
          graphql: { generate: true, mutations: true },
          schema: { ownerId: { ref: 'Nobody', type: 'string' } },
        })
      );

      expect(description.input.map((field) => field.name)).not.toContain(
        'ownerId'
      );
      expect(description.refusals).toContainEqual({
        field: 'ownerId',
        reason: 'unknown-model',
        what: 'input',
      });
    });
  });

  describe('what is never generated', () => {
    const guarded = file('Person', {
      graphql: { generate: true, mutations: true },
      schema: {
        // `personal: false`, so the personal rule below does not reach it
        // first: what refuses an encrypted argument is the scheme
        badge: {
          encrypted: { deterministic: true },
          personal: false,
          type: 'string',
        },
        name: { personal: true, type: 'string' },
        secret: { personal: { expose: false }, type: 'string' },
        ssn: { encrypted: true, personal: false, type: 'string' },
      },
    });

    test('a field marked expose: false is not a field', () => {
      const description = only(guarded);

      expect(description.fields.map((field) => field.name)).not.toContain(
        'secret'
      );
      expect(description.refusals).toContainEqual({
        field: 'secret',
        reason: 'private',
        what: 'field',
      });
    });

    test('the password of the user model, from the same mark', () => {
      const description = only(
        file('User', { graphql: true, schema: { name: { type: 'string' } } })
      );

      expect(description.fields.map((field) => field.name)).not.toContain(
        'password'
      );
      expect(description.fields.map((field) => field.name)).toContain('email');
    });

    test('a randomised encrypted field is never an argument', () => {
      const description = only(guarded);

      expect(description.filters.map((filter) => filter.name)).not.toContain(
        'ssn'
      );
      expect(description.refusals).toContainEqual({
        field: 'ssn',
        reason: 'not-queryable',
        what: 'filter',
      });
    });

    test('a deterministic encrypted field may be one: the adapter answers it', () => {
      expect(only(guarded).filters.map((filter) => filter.name)).toContain(
        'badge'
      );
    });

    // `encrypted` implies `personal`, so the personal rule covers almost
    // every encrypted column on its own; the scheme is what decides the
    // ones a model deliberately unmarked
    test('an encrypted field that is personal is refused as personal', () => {
      const description = only(
        file('Person', {
          graphql: true,
          schema: {
            ssn: { encrypted: { deterministic: true }, type: 'string' },
          },
        })
      );

      expect(description.refusals).toContainEqual({
        field: 'ssn',
        reason: 'personal',
        what: 'filter',
      });
    });

    test('a personal field is a field and never an argument', () => {
      const description = only(guarded);

      expect(description.fields.map((field) => field.name)).toContain('name');
      expect(description.filters.map((filter) => filter.name)).not.toContain(
        'name'
      );
    });

    test('what the model asked to leave out', () => {
      const description = only(
        file('Thing', {
          graphql: { except: 'title', generate: true },
          schema: { title: { type: 'string' }, year: { type: 'integer' } },
        })
      );

      expect(description.fields.map((field) => field.name)).not.toContain(
        'title'
      );
      expect(description.refusals).toContainEqual({
        field: 'title',
        reason: 'excluded',
        what: 'field',
      });
    });
  });

  describe('the operations', () => {
    test('queries by default, and no mutation', () => {
      const sdl = sdlOf(
        only(file('Artwork', { graphql: true, schema: { title: {} } }))
      );

      expect(sdl).toContain('type Query {');
      expect(sdl).toContain('  artwork(id: ID!): Artwork');
      expect(sdl).toContain('  artworks(page: Int, perPage: Int');
      expect(sdl).not.toContain('type Mutation');
    });

    test('mutations only when the model asks for them', () => {
      const sdl = sdlOf(
        only(
          file('Artwork', {
            graphql: { generate: true, mutations: true },
            schema: { title: { type: 'string' } },
          })
        )
      );

      expect(sdl).toContain('  createArtwork(input: ArtworkInput!): Artwork');
      expect(sdl).toContain(
        '  updateArtwork(id: ID!, input: ArtworkInput!): Artwork'
      );
      expect(sdl).toContain('  deleteArtwork(id: ID!): Artwork');
    });

    test('the mutations a model names, and only those', () => {
      const sdl = sdlOf(
        only(
          file('Artwork', {
            graphql: { generate: true, mutations: ['create'] },
            schema: { title: { type: 'string' } },
          })
        )
      );

      expect(sdl).toContain('  createArtwork(');
      expect(sdl).not.toContain('  deleteArtwork(');
    });

    test('the list is a page, so no query is unbounded', () => {
      const sdl = sdlOf(
        only(file('Artwork', { graphql: true, schema: { title: {} } }))
      );

      expect(sdl).toContain(
        'type ArtworkPage {\n  records: [Artwork!]!\n  page: Int!'
      );
    });

    test('the names are pluralized, keeping the case of the model', () => {
      const description = only(
        file('BlogEntry', { graphql: true, schema: { title: {} } })
      );

      expect(description.queries).toEqual({
        many: 'blogEntries',
        one: 'blogEntry',
        page: 'BlogEntryPage',
      });
    });

    test('no filter argument when nothing may be filtered', () => {
      const sdl = sdlOf(
        only(
          file('Memo', {
            graphql: true,
            schema: { body: { personal: true, type: 'text' } },
          })
        )
      );

      expect(sdl).not.toContain('MemoFilter');
      expect(sdl).toContain('  memos(page: Int, perPage: Int): MemoPage!');
    });
  });

  describe('a declaration henri cannot read', () => {
    /**
     * The failure of a `graphql` key
     *
     * @param {*} graphql what the model declares
     * @returns {Error} the error it raised
     */
    const failure = (graphql) => {
      try {
        declarationOf(file('Thing', { graphql, schema: {} }));
      } catch (error) {
        return error;
      }

      throw new Error('the declaration was accepted');
    };

    test.each([
      ['a string', 'yes'],
      ['a number', 3],
      ['an unknown key', { generate: true, mutation: true }],
      ['an unknown mutation', { generate: true, mutations: ['frobnicate'] }],
      ['a queries flag that is not a boolean', { generate: true, queries: 1 }],
      ['types that are not SDL', { types: {} }],
      ['resolvers that are not an object', { resolvers: 'nope', types: 'x' }],
      ['a block that asks for nothing', {}],
    ])('fails the boot: %s', (what, graphql) => {
      expect(failure(graphql).code).toBe(
        'HENRI_API_GRAPHQL_INVALID_DECLARATION'
      );
    });

    test('fails on a model whose name is not a GraphQL name', () => {
      const model = {
        globalId: 'my-model',
        graphql: true,
        identity: 'my-model',
      };

      expect(() => declarationOf(model)).toThrow(/not a GraphQL type name/u);
    });

    test('takes a name of its own instead', () => {
      const model = {
        globalId: 'my-model',
        graphql: { generate: true, name: 'MyModel' },
        identity: 'my-model',
      };

      expect(declarationOf(model).name).toBe('MyModel');
    });

    test('lists the keys it knows', () => {
      expect(KEYS).toEqual([...KEYS].sort());
      expect(MUTATIONS).toEqual(['create', 'update', 'destroy']);
    });
  });

  describe('a model that writes its own', () => {
    const written = file('Artwork', {
      graphql: {
        resolvers: { Query: { artworks: () => [] } },
        types: 'type Artwork { title: String }',
      },
      schema: { title: { type: 'string' } },
    });

    test('is left exactly as it wrote it', () => {
      const description = only(written);

      expect(description.generate).toBe(false);
      expect(description.fields).toEqual([]);
      expect(sdlOf(description)).toBe('');
      expect(description.declaration.types).toContain('type Artwork');
    });

    test('wins over what henri would have derived', () => {
      const merged = mergeResolvers(
        { Artwork: { id: () => 'derived' }, Query: { artwork: () => null } },
        { Query: { artwork: () => 'mine' } }
      );

      expect(merged.Query.artwork()).toBe('mine');
      expect(merged.Artwork.id()).toBe('derived');
    });
  });

  describe('the pieces the resolvers are built from', () => {
    test('a filter narrows a scope, and never widens it', () => {
      expect(conditionOf({ ownerId: 'me' }, { title: 'x' })).toEqual({
        ownerId: 'me',
        title: 'x',
      });
      expect(conditionOf({ ownerId: 'me' }, { ownerId: 'you' })).toEqual({
        ownerId: 'me',
      });
    });

    test('a scope henri cannot narrow refuses the filter', () => {
      expect(() => conditionOf('everything', { title: 'x' })).toThrow(
        /narrow/u
      );
      expect(conditionOf('everything', null)).toBe('everything');
    });

    test('the page is bounded by config.api', () => {
      const settings = { maxPerPage: 100, perPage: 25 };

      expect(pageOf({}, settings)).toEqual({ page: 1, perPage: 25 });
      expect(pageOf({ page: 3, perPage: 5000 }, settings)).toEqual({
        page: 3,
        perPage: 100,
      });
      expect(pageOf({ page: -1, perPage: 0 }, settings)).toEqual({
        page: 1,
        perPage: 25,
      });
    });
  });
});
