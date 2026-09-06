const express = require('express');
const supertest = require('supertest');

const Controllers = require('../2.controllers');
const Henri = require('../henri');
const boom = require('../base/boom');
const flash = require('../base/flash');
const { params, permitMiddleware } = require('../base/params');
const {
  declarations,
  fieldsFor,
  guard,
  inspect,
} = require('../base/params-schema');

/**
 * The compiled rules of one action, as a controller would declare them
 *
 * @param {object} block what the controller exports as `params`
 * @param {Array<string>} [actions=['index']] the actions it exports
 * @param {string} [action='index'] the action to compile for
 * @returns {?object} the rules, by field
 */
const compile = (block, actions = ['index'], action = 'index') => {
  const controller = { params: block };

  for (const name of actions) {
    controller[name] = () => {};
  }

  return declarations(controller, 'tests', actions)[action] || null;
};

/**
 * What compiling a declaration threw
 *
 * @param {object} block the `params` export
 * @param {Array<string>} [actions=['index']] the actions of the controller
 * @returns {Error} the error
 */
const refused = (block, actions = ['index']) => {
  try {
    compile(block, actions);
  } catch (error) {
    return error;
  }

  throw new Error('the declaration was accepted');
};

/** What an action answers with, to see what reached it */
const echo = (req, res) =>
  res.json({
    accepted: req.permit(),
    body: req.body,
    named: req.permit('page', 'title'),
    query: req.query,
  });

/**
 * An application whose only route checks the fields of one action
 *
 * @param {object} fields the declaration of the action
 * @param {object} [options={}] `verb` and the `action` to run
 * @returns {object} a supertest agent
 */
const app = (fields, options = {}) => {
  const { action = echo, verb = 'get' } = options;
  const server = express();

  server.use(express.json());
  server.use(express.urlencoded({ extended: false }));
  server.use(boom());
  server.use(flash());
  server.use(permitMiddleware());
  server[verb](['/it', '/it/:id'], guard(compile({ index: fields })), action);
  server.use((error, req, res, next) => res.status(500).send(error.message));

  return supertest(server);
};

describe('declared parameters', () => {
  describe('the declaration', () => {
    test('takes the selectors `before` takes', () => {
      const block = {
        all: { format: 'string' },
        'edit,update': { title: 'string' },
        update: { title: { maxLength: 10, type: 'string' } },
      };
      const actions = ['edit', 'index', 'update'];

      expect(Object.keys(fieldsFor(block, 'index'))).toEqual(['format']);
      expect(Object.keys(fieldsFor(block, 'edit')).sort()).toEqual([
        'format',
        'title',
      ]);
      expect(compile(block, actions, 'index')).toEqual({
        format: { type: 'string' },
      });
      // The action's own key wins over the comma list before it
      expect(compile(block, actions, 'update').title).toEqual({
        maxLength: 10,
        type: 'string',
      });
      expect(compile(block, actions, 'edit').title).toEqual({
        type: 'string',
      });
    });

    test('`*` is an alias of `all`, and an action with nothing gets nothing', () => {
      expect(compile({ '*': { page: 'integer' } })).toEqual({
        page: { type: 'integer' },
      });
      expect(compile({ show: { page: 'integer' } }, ['index', 'show'])).toBe(
        null
      );
      expect(declarations({}, 'tests', ['index'])).toEqual({});
      expect(declarations({ params: null }, 'tests', ['index'])).toEqual({});
    });

    test('the short form is the type itself', () => {
      expect(compile({ index: { year: 'integer' } })).toEqual({
        year: { type: 'integer' },
      });
    });

    test('refuses a rule with no type, or a type henri does not have', () => {
      expect(refused({ index: { year: { required: true } } }).message).toMatch(
        /"year", which names no type/u
      );
      expect(refused({ index: { year: 'intger' } }).message).toMatch(
        /names the type "intger", which henri does not have/u
      );
      expect(refused({ index: { year: 42 } }).message).toMatch(
        /declares "year" as number/u
      );
    });

    test('refuses a constraint the type does not take', () => {
      expect(
        refused({ index: { title: { min: 2, type: 'string' } } }).message
      ).toMatch(/with "min", which a string does not take/u);
      expect(
        refused({ index: { year: { of: 'string', type: 'integer' } } }).message
      ).toMatch(/with "of", which an integer does not take/u);
    });

    test('refuses an unknown key, which is the typo this exists to catch', () => {
      expect(
        refused({ index: { title: { requird: true, type: 'string' } } }).message
      ).toMatch(/with the unknown key "requird"/u);
    });

    test('refuses a constraint that is not what it says it is', () => {
      expect(
        refused({ index: { title: { maxLength: '10', type: 'string' } } })
          .message
      ).toMatch(/a "maxLength" that is not a number/u);
      expect(
        refused({ index: { title: { pattern: '^a', type: 'string' } } }).message
      ).toMatch(/a "pattern" that is not a regular expression/u);
      expect(
        refused({ index: { title: { required: 'yes', type: 'string' } } })
          .message
      ).toMatch(/a "required" that is not true or false/u);
      expect(
        refused({ index: { title: { enum: 'draft', type: 'string' } } }).message
      ).toMatch(/an "enum" that is not a list of values/u);
    });

    test('refuses a default or an enum value the rule itself refuses', () => {
      expect(
        refused({ index: { page: { default: 'ten', type: 'integer' } } })
          .message
      ).toMatch(
        /a "default" that the rule itself refuses: it must be a whole/u
      );
      expect(
        refused({ index: { page: { default: 0, min: 1, type: 'integer' } } })
          .message
      ).toMatch(/must be at least 1/u);
      expect(
        refused({ index: { state: { enum: ['draft', 2], type: 'string' } } })
          .message
      ).toMatch(/the value 2 in its "enum", which must be text/u);
    });

    test('a default that is a function is left alone until the request', () => {
      expect(
        compile({ index: { at: { default: () => new Date(), type: 'date' } } })
          .at.default
      ).toBeInstanceOf(Function);
    });

    test('refuses a list that does not say what it holds', () => {
      expect(refused({ index: { tags: 'array' } }).message).toMatch(
        /no "of": a list says what it holds/u
      );
      expect(
        refused({ index: { tags: { of: 'nope', type: 'array' } } }).message
      ).toMatch(/"tags\[\]", which names the type "nope"/u);
      expect(
        compile({ index: { tags: { of: 'uuid', type: 'array' } } })
      ).toEqual({ tags: { of: { type: 'uuid' }, type: 'array' } });
    });

    test('refuses a selector naming something that is not an action', () => {
      expect(refused({ creat: { title: 'string' } }, ['create']).message).toBe(
        'tests declares parameters for "creat", which is not one of its actions (create)'
      );
      expect(refused({ index: 'nope' }).message).toMatch(
        /declares "index" as something other than a list of fields/u
      );
      expect(
        (() => {
          try {
            declarations({ params: [] }, 'tests', []);
          } catch (error) {
            return error.message;
          }

          return null;
        })()
      ).toMatch(/declares `params` as something other than an object/u);
    });

    test('every refusal carries the same code', () => {
      expect(refused({ index: { year: 'nope' } }).code).toBe(
        'HENRI_PARAMS_DECLARATION_INVALID'
      );
    });
  });

  describe('a textual source: the query string, a form, a path', () => {
    test('parses the types a string can carry', async () => {
      const res = await app({
        active: 'boolean',
        at: 'date',
        page: 'integer',
        ratio: 'float',
        title: 'string',
      }).get('/it?page=2&ratio=1.5&active=yes&at=2024-01-02&title=hello');

      expect(res.status).toBe(200);
      expect(res.body.accepted).toEqual({
        active: true,
        at: '2024-01-02T00:00:00.000Z',
        page: 2,
        ratio: 1.5,
        title: 'hello',
      });
    });

    test('every spelling of true and false, and nothing else', async () => {
      const yes = await app({ ok: 'boolean' }).get('/it?ok=ON');
      const no = await app({ ok: 'boolean' }).get('/it?ok=0');
      const nope = await app({ ok: 'boolean' }).get('/it?ok=maybe');

      expect(yes.body.accepted.ok).toBe(true);
      expect(no.body.accepted.ok).toBe(false);
      expect(nope.status).toBe(422);
      expect(nope.body.data.errors).toEqual({ ok: 'must be true or false' });
    });

    test('refuses what is not a number, hexadecimal and infinity included', async () => {
      for (const value of ['banana', '0x10', 'Infinity', '2n', '']) {
        const res = await app({
          year: { required: true, type: 'integer' },
        }).get(`/it?year=${value}`);

        expect(res.status).toBe(422);
      }

      expect(
        (await app({ year: 'integer' }).get('/it?year=2.5')).body.data.errors
      ).toEqual({ year: 'must be a whole number' });
    });

    test('a repeated key where one value was declared is refused', async () => {
      const res = await app({ year: 'integer' }).get('/it?year=1&year=2');

      expect(res.status).toBe(422);
      expect(res.body.data.errors.year).toBe(
        'must be a whole number (it was sent more than once)'
      );
    });

    test('a list takes one value or many, and checks every item', async () => {
      const one = await app({ tags: { of: 'string', type: 'array' } }).get(
        '/it?tags=a'
      );
      const many = await app({ tags: { of: 'integer', type: 'array' } }).get(
        '/it?tags=1&tags=2'
      );
      const wrong = await app({ tags: { of: 'integer', type: 'array' } }).get(
        '/it?tags=1&tags=x'
      );

      expect(one.body.accepted.tags).toEqual(['a']);
      expect(many.body.accepted.tags).toEqual([1, 2]);
      expect(wrong.status).toBe(422);
      expect(wrong.body.data.errors.tags).toBe('item 2 must be a whole number');
    });

    test('an empty field is an absent one, unless it is text', async () => {
      const empty = await app({ note: 'string', year: 'integer' }).get(
        '/it?note=&year='
      );

      expect(empty.status).toBe(200);
      expect(empty.body.accepted).toEqual({ note: '' });

      const required = await app({
        year: { required: true, type: 'integer' },
      }).get('/it?year=');

      expect(required.status).toBe(422);
      expect(required.body.data.errors).toEqual({ year: 'is required' });
    });

    test('a form body is textual too', async () => {
      const res = await app({ page: 'integer' }, { verb: 'post' })
        .post('/it')
        .type('form')
        .send('page=2');

      expect(res.body.accepted).toEqual({ page: 2 });
      expect(res.body.body).toEqual({ page: 2 });
    });

    test('a path parameter is checked and coerced like the rest', async () => {
      const res = await app({ id: 'uuid' }).get('/it/nope');

      expect(res.status).toBe(422);
      expect(res.body.data.errors).toEqual({ id: 'must be a uuid' });

      const coerced = await app(
        { id: 'integer' },
        {
          action: (req, res_) => res_.json({ id: req.params.id }),
        }
      ).get('/it/42');

      expect(coerced.body).toEqual({ id: 42 });
    });

    test('the bounds of a number, of a length and of an enum', async () => {
      const rules = {
        page: { max: 10, min: 1, type: 'integer' },
        state: { enum: ['draft', 'sent'], type: 'string' },
        title: { maxLength: 4, minLength: 2, type: 'string' },
      };

      expect((await app(rules).get('/it?page=0')).body.data.errors.page).toBe(
        'must be at least 1'
      );
      expect((await app(rules).get('/it?page=11')).body.data.errors.page).toBe(
        'must be at most 10'
      );
      expect((await app(rules).get('/it?title=a')).body.data.errors.title).toBe(
        'must be at least 2 characters'
      );
      expect(
        (await app(rules).get('/it?title=abcde')).body.data.errors.title
      ).toBe('must be at most 4 characters');
      expect(
        (await app(rules).get('/it?state=gone')).body.data.errors.state
      ).toBe('must be one of draft, sent');
      expect(
        (
          await app({
            tags: { maxLength: 1, of: 'string', type: 'array' },
          }).get('/it?tags=a&tags=b')
        ).body.data.errors.tags
      ).toBe('must be at most 1 items');
      expect(
        (
          await app({ code: { pattern: /^[a-z]+$/u, type: 'string' } }).get(
            '/it?code=A1'
          )
        ).body.data.errors.code
      ).toBe('is not in the expected format');
    });

    test('json in a query string is parsed, and refused when it is not json', async () => {
      const good = await app({ meta: 'json' }).get(
        '/it?meta=%7B%22a%22%3A1%7D'
      );
      const bad = await app({ meta: 'json' }).get('/it?meta=nope');

      expect(good.body.accepted.meta).toEqual({ a: 1 });
      expect(bad.status).toBe(422);
    });
  });

  describe('a typed source: a JSON body', () => {
    /**
     * Posts a JSON body against a declaration
     *
     * @param {object} fields the declaration
     * @param {object} body the body
     * @returns {Promise<object>} the answer
     */
    const post = (fields, body) =>
      app(fields, { verb: 'post' }).post('/it').send(body);

    test('takes the types JSON carries, and refuses their string form', async () => {
      expect(
        (await post({ page: 'integer' }, { page: 2 })).body.accepted
      ).toEqual({ page: 2 });

      const wrong = await post({ page: 'integer' }, { page: '2' });

      expect(wrong.status).toBe(422);
      expect(wrong.body.data.errors.page).toBe(
        'must be a whole number (json sent a string)'
      );
      expect((await post({ ok: 'boolean' }, { ok: 'true' })).status).toBe(422);
      expect(
        (await post({ ok: 'boolean' }, { ok: false })).body.accepted
      ).toEqual({ ok: false });
    });

    test('a date and a uuid are strings there, because JSON has no others', async () => {
      const res = await post(
        { at: 'date', id: 'uuid' },
        {
          at: '2024-01-02T03:04:05.000Z',
          id: '018f1e5e-4c2f-7a3a-9e3c-2b9a4a5c6d7e',
        }
      );

      expect(res.body.accepted.at).toBe('2024-01-02T03:04:05.000Z');
      expect((await post({ at: 'date' }, { at: 'nope' })).status).toBe(422);
      expect((await post({ at: 'date' }, { at: 17 })).status).toBe(422);
    });

    test('a list has to be a list, and every item is checked', async () => {
      const wrapped = await post(
        { tags: { of: 'string', type: 'array' } },
        { tags: 'a' }
      );

      expect(wrapped.status).toBe(422);
      expect(wrapped.body.data.errors.tags).toBe('must be a list');
      expect(
        (await post({ tags: { of: 'string', type: 'array' } }, { tags: ['a'] }))
          .body.accepted.tags
      ).toEqual(['a']);
      expect(
        (
          await post(
            { tags: { of: 'integer', type: 'array' } },
            { tags: ['1'] }
          )
        ).body.data.errors.tags
      ).toBe('item 1 must be a whole number');
    });

    test('null is an absent field, and json takes whatever it is given', async () => {
      expect(
        (
          await post(
            { title: { required: true, type: 'string' } },
            { title: null }
          )
        ).body.data.errors
      ).toEqual({ title: 'is required' });
      expect(
        (await post({ meta: 'json' }, { meta: { deep: [1, 2] } })).body.accepted
          .meta
      ).toEqual({ deep: [1, 2] });
    });

    test('the query string of a JSON request is still textual', async () => {
      const res = await app({ page: 'integer' }, { verb: 'post' })
        .post('/it?page=3')
        .send({ other: true });

      expect(res.body.accepted).toEqual({ page: 3 });
    });
  });

  describe('what reaches the action', () => {
    test('every source holds the coerced value, `req.query` included', async () => {
      const res = await app({ page: 'integer' }).get('/it?page=2&utm=news');

      expect(res.body.query).toEqual({ page: 2, utm: 'news' });
      expect(res.body.accepted).toEqual({ page: 2 });
    });

    test('a default lands in the request, and a function is called per request', async () => {
      const res = await app({ page: { default: 1, type: 'integer' } }).get(
        '/it'
      );

      expect(res.body.query).toEqual({ page: 1 });
      expect(res.body.accepted).toEqual({ page: 1 });

      const posted = await app(
        { at: { default: () => new Date(), type: 'date' } },
        { verb: 'post' }
      )
        .post('/it')
        .send({});

      expect(typeof posted.body.body.at).toBe('string');
    });

    test('`req.permit()` answers the declaration, and names still work', async () => {
      const res = await app({ page: 'integer' }).get('/it?page=2&title=kept');

      expect(res.body.accepted).toEqual({ page: 2 });
      expect(res.body.named).toEqual({ page: 2, title: 'kept' });
    });

    test('`req.permit()` still answers nothing without a declaration', () => {
      const req = { query: { title: 'kept' } };

      expect(params(req).permit()).toEqual({});
      expect(params(req).permit('title')).toEqual({ title: 'kept' });
    });

    test('the action never runs when the shape is wrong', async () => {
      const action = vi.fn((req, res) => res.json({ reached: true }));
      const res = await app({ page: 'integer' }, { action }).get('/it?page=x');

      expect(res.status).toBe(422);
      expect(action).not.toHaveBeenCalled();
    });

    test('an action with no declaration is untouched', async () => {
      const server = express();

      server.use(permitMiddleware());
      server.get('/it', echo);

      const res = await supertest(server).get('/it?page=2');

      expect(res.body.query).toEqual({ page: '2' });
      expect(res.body.accepted).toEqual({});
    });
  });

  describe('the answer', () => {
    test('JSON gets the 422 envelope, with the code and one message per field', async () => {
      const res = await app({
        page: 'integer',
        title: { required: true, type: 'string' },
      })
        .get('/it?page=x')
        .set('Accept', 'application/json');

      expect(res.status).toBe(422);
      expect(res.body).toEqual({
        code: 'HENRI_PARAMS_INVALID',
        data: {
          errors: { page: 'must be a whole number', title: 'is required' },
        },
        error: 'Unprocessable Entity',
        message: 'the parameters are invalid',
        statusCode: 422,
      });
    });

    test('a browser gets a page naming the fields', async () => {
      const res = await app({ page: 'integer' })
        .get('/it?page=x')
        .set('Accept', 'text/html');

      expect(res.status).toBe(422);
      expect(res.headers['content-type']).toMatch(/text\/html/u);
      expect(res.text).toMatch(/HENRI_PARAMS_INVALID/u);
      expect(res.text).toMatch(/page must be a whole number/u);
    });

    test('a form post goes back to the page it came from, with the errors', async () => {
      const sessions = [];
      const server = express();

      server.use(express.urlencoded({ extended: false }));
      server.use(boom());
      server.use((req, res, next) => {
        req.session = {};
        sessions.push(req.session);
        next();
      });
      server.use(flash());
      server.post(
        '/it',
        guard(compile({ index: { year: 'integer' } })),
        (req, res) => res.json({ reached: true })
      );

      const res = await supertest(server)
        .post('/it')
        .set('Accept', 'text/html')
        .set('Referer', '/notes/new?draft=1')
        .type('form')
        .send('year=banana');

      expect(res.status).toBe(303);
      expect(res.headers.location).toBe('/notes/new?draft=1');
      expect(sessions[0].flash).toEqual({
        errors: [{ year: 'must be a whole number' }],
      });
    });

    test('a referer somewhere else is not where a browser is sent', async () => {
      const res = await app({ year: 'integer' }, { verb: 'post' })
        .post('/it')
        .set('Accept', 'text/html')
        .set('Referer', 'https://example.test/elsewhere')
        .type('form')
        .send('year=banana');

      expect(res.status).toBe(422);
    });
  });

  describe('inspect, without a request of express’s own', () => {
    test('answers the values, the errors and where each came from', () => {
      const rules = compile({
        index: { id: 'uuid', page: { default: 1, type: 'integer' } },
      });
      const req = { params: { id: 'nope' }, query: {} };

      expect(inspect(rules, req)).toEqual({
        errors: { id: 'must be a uuid' },
        origin: { page: null },
        values: { page: 1 },
      });
    });
  });

  describe('the controllers module', () => {
    test('compiles the declarations when the controllers load', async () => {
      const controllers = new Controllers();

      await controllers.configure({
        tasks: {
          create: () => {},
          index: () => {},
          params: { create: { title: { required: true, type: 'string' } } },
        },
      });

      expect(controllers.accepts('tasks#create')).toEqual({
        title: { required: true, type: 'string' },
      });
      expect(controllers.accepts('tasks#index')).toBeNull();
      expect(controllers.checks('tasks#create')).toHaveLength(1);
      expect(controllers.checks('tasks#index')).toEqual([]);
      // `params` describes the controller; it is never routable
      expect(controllers.get('tasks#params')).toBeUndefined();
    });

    test('a declaration henri cannot carry out fails the boot', async () => {
      const controllers = new Controllers();
      const loading = controllers.configure({
        'admin/tasks': {
          create: () => {},
          params: { create: { title: { maxLenght: 2, type: 'string' } } },
        },
      });

      await expect(loading).rejects.toThrow(
        'admin/tasks#create declares "title" with the unknown key "maxLenght"'
      );
      await expect(loading).rejects.toMatchObject({
        code: 'HENRI_PARAMS_DECLARATION_INVALID',
      });
    });
  });
});

describe('declared parameters (demo app, disk store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  let henri;
  let request;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
    request = supertest(henri.server.app);
  }, 60000);

  afterAll(async () => {
    await henri.stop();
    delete global.henri;
    if (typeof skipWorkers === 'undefined') {
      delete process.env.SKIP_WORKERS;
    } else {
      process.env.SKIP_WORKERS = skipWorkers;
    }
  }, 60000);

  test('the controller declarations are compiled at boot', () => {
    expect(henri.controllers.accepts('notes#search').limit).toEqual({
      default: 10,
      max: 50,
      min: 1,
      type: 'integer',
    });
    expect(henri.controllers.accepts('notes#index')).toBeNull();
    expect(henri.controllers.checks('notes#search')).toHaveLength(1);
    expect(henri.controllers.checks('notes#index')).toEqual([]);
  });

  test('`params` is never an action', () => {
    expect(henri.controllers.get('notes#params')).toBeUndefined();
    expect(henri.router.routes['get /notes/params']).toBeUndefined();
  });

  test('the action reads the coerced values', async () => {
    await request
      .post('/notes')
      .set('Accept', 'application/json')
      .send({ title: 'Declared' });

    const res = await request
      .get('/notes/search?q=Declared&limit=1&exact=false')
      .set('Accept', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.data.notes).toHaveLength(1);
    expect(res.body.query).toEqual({ exact: false, limit: 1, q: 'Declared' });
  });

  test('a value of the wrong shape never reaches the action', async () => {
    const res = await request
      .get('/notes/search?limit=banana')
      .set('Accept', 'application/json');

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('HENRI_PARAMS_INVALID');
    expect(res.body.data.errors).toEqual({ limit: 'must be a whole number' });
  });

  test('a bound the action declared is enforced at the boundary', async () => {
    const res = await request
      .get('/notes/search?limit=500')
      .set('Accept', 'application/json');

    expect(res.body.data.errors).toEqual({ limit: 'must be at most 50' });
  });

  test('a JSON body sending the wrong type is refused', async () => {
    const res = await request
      .post('/notes')
      .set('Accept', 'application/json')
      .send({ title: 42 });

    expect(res.status).toBe(422);
    expect(res.body.data.errors).toEqual({
      title: 'must be text (json sent a number)',
    });
  });

  test('a required field nobody sent is refused', async () => {
    const res = await request
      .post('/notes')
      .set('Accept', 'application/json')
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.data.errors).toEqual({ title: 'is required' });
  });

  test('the check runs ahead of the `before` hooks', async () => {
    const refused = await request
      .get('/notes/search?limit=banana')
      .set('Accept', 'application/json');
    const accepted = await request
      .get('/notes/search')
      .set('Accept', 'application/json');

    // The `all` hook of the controller sets X-Notes: it never ran on the
    // refused request, and the hooks of an accepted one see the coerced
    // values
    expect(refused.headers['x-notes']).toBeUndefined();
    expect(accepted.headers['x-notes']).toBe('loaded');
  });

  test('an action that declared nothing is untouched', async () => {
    const res = await request.get('/notes').set('Accept', 'application/json');

    expect(res.status).toBe(200);
  });
});
