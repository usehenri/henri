/* global Artwork */
const supertest = require('supertest');

const Henri = require('../henri');
const Model = require('../3.model');
const Router = require('../5.router');

const { PACKAGE, engine } = require('../base/graphql');

let henri;

/**
 * A module of core with a henri that has no graphql module: what an
 * application that never installed @usehenri/graphql runs
 *
 * @param {function} Module the module class
 * @returns {object} the module instance
 */
const without = (Module) => {
  const mod = new Module();

  mod.henri = { graphql: undefined, pen: henri.pen };

  return mod;
};

// Core carries no GraphQL: the engine is the module @usehenri/graphql ships,
// and the demo application depends on it. What is covered here is the seam --
// that the module arrives from the package, that a model's `graphql` key
// reaches it and comes back out of the endpoint and of res.render(), and that
// the two places reaching for it say what to install when it did not.
describe('graphql', () => {
  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
  }, 60000);

  afterAll(async () => {
    await henri.stop();
    delete global.henri;
    delete process.env.SKIP_WORKERS;
  });

  test('should arrive from the package the application depends on', () => {
    expect(henri.graphql).toBeDefined();
    expect(henri.graphql.name).toEqual('graphql');
    expect(henri.graphql.runlevel).toEqual(1);
    expect(henri.graphql.needs).toEqual(['config']);
    expect(henri.modules.modules.has('graphql')).toBe(true);
  });

  test('should read the endpoint of the configuration', () => {
    expect(henri.graphql.endpoint).toEqual('/_henri/graph');
  });

  test('should build the schema from the models', () => {
    expect(henri.graphql.active).toBe(true);
    expect(henri.graphql.schema).toBeTruthy();
  });

  test('should answer a query on the endpoint', async () => {
    await Artwork.create({ title: 'Music', year: 1910 });

    const { body } = await supertest(henri.server.app)
      .post('/_henri/graph')
      .send({ query: `{ artworks { title, year } }` })
      .expect(200);

    expect(body.data.artworks).toEqual(
      expect.arrayContaining([{ title: 'Music', year: 1910 }])
    );
  });

  // The view options of a render built from a query are built here
  test('should render a page from a query', async () => {
    const opts = await henri.router.viewOptions(
      { query: {} },
      {},
      { graphql: `{ artworks { title } }` }
    );

    expect(opts.data.artworks[0]).toHaveProperty('title');
    expect(opts.graphql).toEqual({
      endpoint: '/_henri/graph',
      query: `{ artworks { title } }`,
    });
  });

  test('should be reached through base/graphql.js', () => {
    expect(engine(henri, 'a query')).toBe(henri.graphql);
    expect(() => engine({ graphql: null, pen: henri.pen }, 'a query')).toThrow(
      PACKAGE
    );
  });

  // What an application that never installs @usehenri/graphql sees: nothing
  // is mounted, and anything reaching for the engine says what to install
  describe(`without ${PACKAGE}`, () => {
    // A render built from a query must say what to install, never render a
    // page with the data silently missing
    test('should fail the render of a page built from a query', async () => {
      await expect(
        without(Router).viewOptions(
          {},
          {},
          { graphql: `{ artworks { title }}` }
        )
      ).rejects.toThrow(PACKAGE);
    });

    test('should leave the graphql key out of the view options', async () => {
      const router = without(Router);

      router.henri.server = { url: 'http://127.0.0.1:3000/' };

      const opts = await router.viewOptions(
        { query: {} },
        {},
        { data: { ok: true } }
      );

      expect(opts.data).toEqual({ ok: true });
      expect(opts.graphql).toBeUndefined();
    });

    test('should fail on a model that declares types and resolvers', () => {
      const model = without(Model);

      expect(() =>
        engine(model.henri, 'Artwork declares graphql types and resolvers')
      ).toThrow(PACKAGE);
    });

    // The boot of an application that has neither the package nor a model
    // asking for it says nothing at all
    test('should stay silent when no model asks for it', () => {
      const { henri: fake } = without(Model);

      expect(fake.graphql).toBeUndefined();
      expect(() => fake.graphql && fake.graphql.merge()).not.toThrow();
    });
  });
});
