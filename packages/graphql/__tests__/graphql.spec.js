const express = require('express');
const supertest = require('supertest');

const BaseModule = require('@usehenri/core/src/base/module');

const create = require('..');
const { fakeHenri } = require('./helpers');
const { Graphql } = require('..');
const shipped = require('../module');

const data = [
  { title: 'Le bonheur de vivre', year: 1905 },
  { title: 'Music', year: 1910 },
];

const model = {
  graphql: {
    resolvers: { Query: { artworks: () => data } },
    types: `
            type Query { artworks: [Artwork], artwork: Artwork }
          `,
  },
};

const artwork = {
  graphql: { types: `type Artwork { title: String, year: Int }` },
};

/**
 * Extract the two models the suite queries
 *
 * @param {Graphql} engine The engine
 * @returns {Graphql} The same engine
 */
const seed = (engine) => {
  engine.extract(model);
  engine.extract(artwork);

  return engine;
};

describe('graphql', () => {
  let engine;

  beforeEach(() => {
    engine = create(fakeHenri());
  });

  afterEach(async () => {
    await engine.stop();
  });

  test('should be created by the factory', () => {
    expect(engine).toBeInstanceOf(Graphql);
    expect(create.create).toBe(create);
    expect(engine.name).toEqual('graphql');
    expect(engine.runlevel).toEqual(1);
    expect(engine.reloadable).toBe(true);
  });

  // The package ships it: "henri": { "module": "./module.js" } is all core
  // reads, and an application depending on the package has it in its boot
  test('should be the henri module this package ships', () => {
    const manifest = require('../package.json');

    expect(manifest.henri).toEqual({ module: './module.js' });
    expect(manifest.files).toContain('module.js');
    expect(shipped).toBe(Graphql);
    expect(engine).toBeInstanceOf(BaseModule);
    expect(engine.needs).toEqual(['config']);
  });

  test('should match snapshot', () => {
    expect(new Graphql()).toMatchSnapshot();
  });

  test('should default to /_henri/gql', async () => {
    await engine.init();

    expect(engine.endpoint).toEqual('/_henri/gql');
  });

  test('should read the endpoint of the configuration', async () => {
    engine = create(fakeHenri({ graphql: '/_henri/graph' }));
    await engine.init();

    expect(engine.endpoint).toEqual('/_henri/graph');
  });

  describe('extract', () => {
    test('should return false on empty models', () => {
      expect(engine.extract({ abc: 'd' })).toBeFalsy();
    });

    test('should extract from model', () => {
      seed(engine);
      engine.extract({
        graphql: { resolvers: { Query: { artwork: (key) => data[key] } } },
      });

      expect(engine.typesList).toEqual(
        expect.arrayContaining([model.graphql.types])
      );

      expect(engine.typesList).toEqual(
        expect.arrayContaining([artwork.graphql.types])
      );

      expect(engine.resolversList).toHaveLength(3);
    });
  });

  describe('merge', () => {
    test('should compile schema', async () => {
      expect(engine.schema).toBeNull();
      expect(engine.active).toBeFalsy();

      seed(engine);
      engine.merge();
      await engine.init();

      expect(engine.schema).toBeTruthy();
      expect(engine.active).toBeTruthy();

      expect(await engine.run(`{ artworks { title, year }}`)).toMatchSnapshot();
    });

    test('should mount the endpoint once, whatever the number of reloads', async () => {
      seed(engine);
      engine.merge();
      await engine.ready;

      expect(engine.henri.middlewares).toHaveLength(1);
      expect(engine.henri.middlewares[0][0]).toEqual('graphql');

      await engine.reload();
      seed(engine);
      engine.merge();
      await engine.ready;

      expect(engine.henri.middlewares).toHaveLength(1);
      expect(engine.active).toBe(true);
    });

    test('should stay off when the schema does not compile', () => {
      seed(engine);
      engine.extract({ graphql: { types: `type Query { broken: Missing }` } });

      expect(engine.merge()).toBe(true);
      expect(engine.active).toBe(false);
      expect(engine.schema).toBeNull();
      expect(engine.henri.calls.some(([level]) => level === 'error')).toBe(
        true
      );
    });

    test('should clear on reload', async () => {
      seed(engine);
      engine.merge();

      await engine.reload();

      expect(engine.schema).toBeNull();
      expect(engine.active).toBeFalsy();

      expect(engine.merge()).toBe(false);
      expect(engine.schema).toBeNull();
      expect(engine.active).toBeFalsy();

      expect(await engine.run()).toEqual('No graphql schema found.');
    });
  });

  describe('run', () => {
    test('should answer without a schema', async () => {
      expect(await engine.run()).toEqual('No graphql schema found.');
    });

    test('should forward the variables and the context', async () => {
      engine.extract({
        graphql: {
          resolvers: {
            Query: {
              hello: (parent, args, context) => context.who + args.mark,
            },
          },
          types: `type Query { hello(mark: String!): String }`,
        },
      });
      engine.merge();

      const result = await engine.run(
        `query ($mark: String!) { hello(mark: $mark) }`,
        { mark: '!' },
        { who: 'henri' }
      );

      expect(result.data).toEqual({ hello: 'henri!' });
      expect(result.errors).toBeUndefined();
    });
  });

  test('should expose the error classes of the resolvers', () => {
    expect(new engine.AuthenticationError('nope').extensions.code).toEqual(
      'UNAUTHENTICATED'
    );
    expect(new engine.ForbiddenError('nope').extensions.code).toEqual(
      'FORBIDDEN'
    );
    expect(new engine.UserInputError('nope').extensions.code).toEqual(
      'BAD_USER_INPUT'
    );
    expect(new engine.ValidationError('nope').extensions.code).toEqual(
      'GRAPHQL_VALIDATION_FAILED'
    );
    expect(new engine.SyntaxError('nope').extensions.code).toEqual(
      'GRAPHQL_PARSE_FAILED'
    );
    expect(engine.toApolloError(new Error('boom')).extensions.code).toEqual(
      'INTERNAL_SERVER_ERROR'
    );

    const already = new engine.ForbiddenError('nope');

    expect(engine.toApolloError(already)).toBe(already);
  });

  // What an application installing the package gets: the endpoint answers
  describe('the endpoint', () => {
    /**
     * An express app carrying the middleware the engine registered
     *
     * @returns {import('supertest').Agent} a supertest agent
     */
    const agent = () => {
      const app = express();

      // What core's server module has already mounted by then
      app.use(express.json());

      for (const [, mount] of engine.henri.middlewares) {
        mount(app);
      }

      app.use((req, res) => res.status(404).end());

      return supertest(app);
    };

    beforeEach(async () => {
      engine = create(fakeHenri({ graphql: '/_henri/graph' }));
      seed(engine);
      engine.merge();
      await engine.init();
      await engine.ready;
    });

    test('should answer a query on the configured path', async () => {
      const { body } = await agent()
        .post('/_henri/graph')
        .send({ query: `{ artworks { title, year } }` })
        .expect(200);

      expect(body.data.artworks).toHaveLength(2);
      expect(body.data.artworks[0]).toEqual({
        title: 'Le bonheur de vivre',
        year: 1905,
      });
    });

    test('should pass the request and the response to the resolvers', async () => {
      await engine.reload();
      engine.extract({
        graphql: {
          resolvers: { Query: { path: (parent, args, { req }) => req.path } },
          types: `type Query { path: String }`,
        },
      });
      engine.merge();
      await engine.ready;

      const { body } = await agent()
        .post('/_henri/graph')
        .send({ query: `{ path }` })
        .expect(200);

      expect(body.data).toEqual({ path: '/' });
    });

    test('should let the request through when the schema is gone', async () => {
      await engine.reload();

      await agent().post('/_henri/graph').send({ query: `{ artworks }` });

      expect(engine.active).toBe(false);
    });
  });

  test('should stop the apollo server, once', async () => {
    seed(engine);
    engine.merge();
    await engine.ready;

    expect(await engine.stop()).toEqual('graphql');
    expect(await engine.stop()).toBe(false);
  });
});
