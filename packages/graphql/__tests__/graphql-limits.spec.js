const supertest = require('supertest');
const express = require('express');
const { parse } = require('graphql');

const create = require('..');
const { accessGuard, graphqlConfig, measure } = require('../src/graphql-guard');
const { fakeHenri } = require('./helpers');

/**
 * The `res.boom` core mounts on every response, as much of it as the access
 * guard uses. The guard answers through it, so a bare express app needs one.
 *
 * @returns {function} express middleware
 */
const boom = () => (req, res, next) => {
  const answer = (statusCode, error) => (message) =>
    res.status(statusCode).json({ error, message, statusCode });

  res.boom = {
    forbidden: answer(403, 'Forbidden'),
    unauthorized: answer(401, 'Unauthorized'),
  };

  return next();
};

/**
 * The measurements of a query document
 *
 * @param {string} query a graphql query
 * @param {object} [limits] the limits the walk stops at
 * @returns {{aliases: number, complexity: number, depth: number}} measurements
 */
const measured = (
  query,
  limits = { maxAliases: 1e6, maxComplexity: 1e6, maxDepth: 1e6 }
) => {
  const document = parse(query);
  const fragments = new Map();

  for (const definition of document.definitions) {
    if (definition.kind === 'FragmentDefinition') {
      fragments.set(definition.name.value, definition);
    }
  }

  const operation = document.definitions.find(
    (definition) => definition.kind === 'OperationDefinition'
  );

  return measure(operation, fragments, limits);
};

describe('graphqlConfig', () => {
  test('a string is still the endpoint, and the limits have defaults', () => {
    expect(graphqlConfig('/gql', '/_henri/gql')).toMatchObject({
      authenticated: false,
      endpoint: '/gql',
      loopbackOnly: false,
      maxAliases: 15,
      maxComplexity: 1000,
      maxDepth: 10,
      maxTokens: 5000,
      roles: [],
    });
    expect(graphqlConfig(null, '/_henri/gql').endpoint).toBe('/_henri/gql');
  });

  test('an object configures the limits and the access rules', () => {
    expect(
      graphqlConfig(
        {
          endpoint: '/api/graphql',
          maxAliases: 3,
          maxDepth: 4,
          roles: ['admin'],
        },
        '/_henri/gql'
      )
    ).toMatchObject({
      // Asking for a role implies asking for a signed-in user
      authenticated: true,
      endpoint: '/api/graphql',
      maxAliases: 3,
      maxDepth: 4,
      roles: ['admin'],
    });
  });

  test('a limit can be lifted, and nonsense is ignored', () => {
    expect(graphqlConfig({ maxDepth: false }, '/x').maxDepth).toBe(Infinity);
    expect(graphqlConfig({ maxDepth: -3 }, '/x').maxDepth).toBe(10);
    expect(() => graphqlConfig(42, '/x')).toThrow(TypeError);
  });
});

describe('accessGuard', () => {
  /**
   * A response stand-in recording what it answered
   *
   * @returns {object} the response
   */
  const responseOf = () => {
    const answered = [];

    return {
      answered,
      boom: {
        forbidden: (message) => answered.push(['403', message]),
        unauthorized: (message) => answered.push(['401', message]),
      },
    };
  };

  test('lets everyone through when nothing was asked for', async () => {
    const res = responseOf();
    let passed = false;

    await accessGuard(graphqlConfig(null, '/x'))({}, res, () => {
      passed = true;
    });

    expect(passed).toBe(true);
    expect(res.answered).toEqual([]);
  });

  test('refuses anonymous requests when the endpoint asks to be signed in', async () => {
    const settings = graphqlConfig({ authenticated: true }, '/x');
    const res = responseOf();

    await accessGuard(settings)({ isAuthenticated: () => false }, res, () => {
      throw new Error('should not pass');
    });

    expect(res.answered).toEqual([['401', 'Authentication required']]);
  });

  test('refuses a signed-in user missing the roles, and lets one through', async () => {
    const settings = graphqlConfig({ roles: ['admin'] }, '/x');
    const denied = responseOf();

    await accessGuard(settings)(
      { isAuthenticated: () => true, user: { roles: ['member'] } },
      denied,
      () => {
        throw new Error('should not pass');
      }
    );

    expect(denied.answered).toEqual([['403', 'Insufficient roles']]);

    const allowed = responseOf();
    let passed = false;

    await accessGuard(settings)(
      { isAuthenticated: () => true, user: { roles: ['admin', 'member'] } },
      allowed,
      () => {
        passed = true;
      }
    );

    expect(passed).toBe(true);
    expect(allowed.answered).toEqual([]);
  });

  // The guard used to reach for res.boom unguarded. Core always mounts it,
  // but core is a different package now and nothing declares that, so the
  // answer has to stand on its own -- and match base/boom.js byte for byte.
  describe('without res.boom', () => {
    /**
     * A response with only what express itself gives you: chainable
     * status(), and json() recording the body
     *
     * @returns {object} the response, with what it answered in `sent`
     */
    const bare = () => {
      const sent = {};
      const res = {
        json: (body) => {
          sent.body = body;

          return res;
        },
        sent,
        status: (statusCode) => {
          sent.statusCode = statusCode;

          return res;
        },
      };

      return res;
    };

    test('falls back to a plain 401', async () => {
      const res = bare();

      await accessGuard(graphqlConfig({ authenticated: true }, '/x'))(
        {},
        res,
        () => {
          throw new Error('should not pass');
        }
      );

      expect(res.sent).toEqual({
        body: {
          error: 'Unauthorized',
          message: 'Authentication required',
          statusCode: 401,
        },
        statusCode: 401,
      });
    });

    test('falls back to a plain 403', async () => {
      const res = bare();

      await accessGuard(graphqlConfig({ roles: ['admin'] }, '/x'))(
        { isAuthenticated: () => true, user: { roles: ['member'] } },
        res,
        () => {
          throw new Error('should not pass');
        }
      );

      expect(res.sent).toEqual({
        body: {
          error: 'Forbidden',
          message: 'Insufficient roles',
          statusCode: 403,
        },
        statusCode: 403,
      });
    });
  });
});

describe('measuring a query', () => {
  test('counts depth, aliases and fields', () => {
    expect(measured('{ a { b { c } } }')).toEqual({
      aliases: 0,
      complexity: 3,
      depth: 3,
    });

    expect(measured('{ one: a two: a three: a }')).toMatchObject({
      aliases: 3,
      complexity: 3,
    });
  });

  test('expands fragments, so a fragment bomb is counted for what it costs', () => {
    const query = `
      { a { ...F ...F ...F } }
      fragment F on T { x y z }
    `;

    // One field for `a`, then three fields three times over
    expect(measured(query)).toMatchObject({ complexity: 10, depth: 2 });
  });

  test('an inline fragment is not a level of its own', () => {
    expect(measured('{ a { ... on T { b } } }')).toMatchObject({ depth: 2 });
  });

  test('a fragment cycle does not hang the walk', () => {
    const query = `
      { a { ...F } }
      fragment F on T { b ...G }
      fragment G on T { c ...F }
    `;

    expect(measured(query).complexity).toBe(3);
  });

  test('stops walking as soon as a limit is passed', () => {
    const wide = `{ ${Array.from({ length: 5000 }, (unused, index) => `f${index}: a`).join(' ')} }`;
    const totals = measured(wide, {
      maxAliases: 15,
      maxComplexity: 1000,
      maxDepth: 10,
    });

    // It stops just past the limit rather than counting all five thousand
    expect(totals.aliases).toBeLessThan(100);
  });
});

describe('the graphql endpoint', () => {
  let engine;
  let agent;

  beforeAll(async () => {
    engine = create(fakeHenri());
    await engine.init();

    engine.extract({
      graphql: {
        resolvers: {
          Query: {
            root: () => ({ name: 'root' }),
          },
        },
        types: `
          type Node { name: String, child: Node, other: Node }
          type Query { root: Node }
        `,
      },
    });
    engine.merge();
    await engine.ready;

    // The module registers its middleware through henri.addMiddleware, which
    // needs core's server module; mount the handler on a bare app instead,
    // with what core would have put in front of it
    const app = express();

    app.use(express.json());
    app.use(boom());
    app.use('/_henri/gql', (req, res, next) => engine._handler(req, res, next));
    agent = supertest(app);
  }, 60000);

  afterAll(async () => {
    await engine.stop();
  });

  /**
   * Posts a query the way a graphql client does
   *
   * @param {string} query the query
   * @returns {object} the supertest request
   */
  const post = (query) =>
    agent
      .post('/_henri/gql')
      .set('content-type', 'application/json')
      .send({ query });

  test('answers a reasonable query', async () => {
    const res = await post('{ root { name } }');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ root: { name: 'root' } });
    expect(res.body.errors).toBeUndefined();
  });

  test('refuses a deeply nested query before a resolver runs', async () => {
    let query = 'name';

    for (let level = 0; level < 20; level += 1) {
      query = `child { ${query} }`;
    }

    const res = await post(`{ root { ${query} } }`);

    expect(res.body.data).toBeUndefined();
    expect(res.body.errors[0].message).toMatch(/too deep/);
  });

  test('refuses alias amplification, which needs no deep schema at all', async () => {
    const aliases = Array.from(
      { length: 200 },
      (unused, index) => `a${index}: root { name }`
    ).join(' ');

    const res = await post(`{ ${aliases} }`);

    expect(res.body.data).toBeUndefined();
    expect(res.body.errors[0].message).toMatch(/too many aliases/);
  });

  test('refuses a fragment bomb', async () => {
    const spreads = Array.from({ length: 150 }, () => '...F').join(' ');
    const res = await post(`
      { root { ${spreads} } }
      fragment F on Node {
        name
        child { name other { name child { name other { name } } } }
      }
    `);

    expect(res.body.data).toBeUndefined();
    expect(res.body.errors[0].message).toMatch(/too complex|too many aliases/);
  });

  test('refuses a document with too many tokens, before parsing it', async () => {
    const huge = Array.from({ length: 4000 }, () => 'root { name }').join(' ');
    const res = await post(`{ ${huge} }`);

    expect(res.body.data).toBeUndefined();
    expect(res.body.errors[0].message).toMatch(/tokens/);
  });

  test("Apollo's own csrf prevention refuses a simple cross-site form post", async () => {
    const res = await agent
      .post('/_henri/gql')
      .set('content-type', 'application/x-www-form-urlencoded')
      .send('query={ root { name } }');

    expect(res.status).toBe(400);
    expect(String(res.text)).toMatch(/preflight|content-type/i);
  });
});
