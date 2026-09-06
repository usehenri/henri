/* global Memo, User */
const supertest = require('supertest');
const Henri = require('../henri');

const {
  columnOf,
  declarations,
  gate,
  includeOf,
  mismatch,
  pick,
  rule,
  verify,
} = require('../base/answers');
const { seal, sealed } = require('../base/headers');

const password = 'difference-engine';

/** A model file the way core hands one to an adapter */
const model = (globalId) => ({
  globalId,
  identity: globalId.toLowerCase(),
  options: {},
  schema: {},
});

describe('the declaration (no application)', () => {
  test('a rule is an object, or the type itself', () => {
    expect(
      declarations({ answers: { index: { total: 'integer' } } }, 'memos', [
        'index',
      ])
    ).toEqual({ index: { total: { type: 'integer' } } });

    expect(rule({ model: 'Memo' }, 'memos#show', 'memo')).toEqual({
      model: 'Memo',
      type: 'record',
    });

    expect(
      rule({ model: 'Memo', type: 'array' }, 'memos#index', 'rows')
    ).toEqual({ model: 'Memo', type: 'array' });
  });

  test('the selectors are the ones `before` and `params` use', () => {
    const compiled = declarations(
      {
        answers: {
          all: { total: 'integer' },
          'index,search': { rows: { model: 'Memo', type: 'array' } },
        },
      },
      'memos',
      ['index', 'search', 'show']
    );

    expect(Object.keys(compiled).sort()).toEqual(['index', 'search', 'show']);
    expect(Object.keys(compiled.index).sort()).toEqual(['rows', 'total']);
    expect(Object.keys(compiled.show)).toEqual(['total']);
  });

  test('`from` names a column, and says nothing about the shape on its own', () => {
    expect(columnOf('User.gender')).toEqual({ field: 'gender', model: 'User' });
    expect(columnOf('User')).toBeNull();
    expect(columnOf('a.b.c')).toBeNull();
    expect(rule({ from: 'User.email' }, 'r#profile', 'who')).toEqual({
      from: { field: 'email', model: 'User' },
      type: 'json',
    });
  });

  test('a rule henri cannot carry out fails, naming where it is', () => {
    const bad =
      (answers, actions = ['index']) =>
      () =>
        declarations({ answers }, 'memos', actions);

    expect(bad({ index: { rows: {} } })).toThrow(/names no type/u);
    expect(bad({ index: { rows: 'lasagna' } })).toThrow(
      /which henri does not have/u
    );
    expect(bad({ index: { rows: { type: 'array' } } })).toThrow(
      /no "of" and no "model"/u
    );
    expect(bad({ index: { rows: { model: 'Memo', type: 'string' } } })).toThrow(
      /a record, or an array of them/u
    );
    expect(
      bad({ index: { rows: { model: 'Memo', of: 'string', type: 'array' } } })
    ).toThrow(/both "model" and "of"/u);
    expect(bad({ index: { total: { maxLength: 2, type: 'string' } } })).toThrow(
      /unknown key "maxLength"/u
    );
    expect(
      bad({ index: { total: { required: 'yes', type: 'integer' } } })
    ).toThrow(/"required" that is not true or false/u);
    expect(bad({ index: { memo: { type: 'record' } } })).toThrow(
      /a record of something/u
    );
    expect(bad({ index: { who: { from: 'User', type: 'string' } } })).toThrow(
      /"from" that is not `Model.field`/u
    );
    expect(bad({ nope: { total: 'integer' } })).toThrow(
      /which is not one of its actions/u
    );
    expect(bad({ index: 'everything' })).toThrow(
      /something other than a list of fields/u
    );
    expect(() => declarations({ answers: 'all' }, 'memos', [])).toThrow(
      /something other than an object/u
    );
  });

  test('the second pass refuses a model or a column that is not there', () => {
    const context = {
      mark: (name, field) =>
        name === 'User' && field === 'gender' ? { expose: false } : null,
      model: (name) =>
        name === 'Memo' || name === 'User' ? model(name) : null,
      where: 'reports#index',
    };

    expect(() =>
      verify({ rows: { model: 'Ghost', type: 'array' } }, context)
    ).toThrow(/not a model of this application/u);
    expect(() =>
      verify(
        { who: { from: { field: 'x', model: 'Ghost' }, type: 'string' } },
        context
      )
    ).toThrow(/Ghost is not a model/u);
    expect(() =>
      verify(
        { g: { from: { field: 'gender', model: 'User' }, type: 'string' } },
        context
      )
    ).toThrow(/never leaves the server/u);
    // ... and lets it through when the controller said so on purpose
    expect(() =>
      verify(
        {
          g: {
            expose: true,
            from: { field: 'gender', model: 'User' },
            type: 'string',
          },
        },
        context
      )
    ).not.toThrow();
  });

  test('`expose: true` is the declared form of `include`', () => {
    expect(
      includeOf({
        g: { expose: true, from: { field: 'gender', model: 'User' } },
        total: { type: 'integer' },
      })
    ).toEqual(['g', 'gender']);
  });

  test('what does not match is said in words', () => {
    expect(mismatch({ type: 'integer' }, 'two')).toMatch(/whole number/u);
    expect(mismatch({ type: 'integer' }, 2)).toBeNull();
    expect(
      mismatch({ of: { type: 'string' }, type: 'array' }, ['a', 2])
    ).toMatch(/item 2/u);
    expect(mismatch({ model: 'Memo', type: 'record' }, [])).toMatch(/a list/u);
    // Absent and null say nothing: `required` is about the key
    expect(mismatch({ type: 'integer' }, null)).toBeNull();
  });

  test('what is not declared is dropped, and reported', () => {
    const chosen = pick(
      { total: { type: 'integer' } },
      { secret: 'x', total: 2 }
    );

    expect(chosen.picked).toEqual({ total: 2 });
    expect(chosen.problems).toEqual(['secret left the answer undeclared']);
  });

  test('a declared field that is missing is reported, not invented', () => {
    const chosen = pick({ total: { required: true, type: 'integer' } }, {});

    expect(chosen.picked).toEqual({});
    expect(chosen.problems).toEqual(['total is missing']);
  });

  test('`__proto__` is defined and never assigned', () => {
    const body = JSON.parse('{"__proto__": {"polluted": true}}');
    const chosen = pick({ __proto__: { type: 'json' } }, body);

    expect(Object.getPrototypeOf(chosen.picked)).toBe(Object.prototype);
    expect({}.polluted).toBeUndefined();
  });

  test('the seal is one answer long', () => {
    const res = {};

    expect(sealed(res)).toBe(false);
    seal(res);
    expect(sealed(res)).toBe(true);
    expect(sealed(res)).toBe(false);
  });

  test('the gate strips without an application, and stays synchronous', () => {
    const henri = { privacy: { strip: (value) => value } };
    const answered = gate(henri, null, { ok: true });

    expect(answered.settle).toBeNull();
    expect(answered.answer).toEqual({ ok: true });
  });
});

describe('the exit gate (demo app, disk store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  let henri;
  let app;
  let agent;
  let user;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
    app = henri.server.app;
    agent = supertest.agent(app);

    await agent.post('/register').send({
      age: 41,
      email: 'ada@usehenri.io',
      gender: 'she/her',
      name: 'Ada',
      password,
    });

    user = await henri.user.findByEmail('ada@usehenri.io');
    user.set({ nationalId: 'AB-123-456', phone: '+1-555-0100' });
    await user.save();
    await agent.post('/login').send({ email: 'ada@usehenri.io', password });
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

  test('the models mark three fields as never leaving', () => {
    expect([...henri.privacy.private].sort()).toEqual([
      'gender',
      'nationalId',
      'password',
      'phone',
    ]);
  });

  // The property this whole thing exists for. It fails without the floor:
  // the object below is not a record, so nothing published it and nothing
  // stripped it, and the three marked fields went out on the wire
  test('a hand-built object cannot carry a field marked expose: false', async () => {
    const answer = await agent.get('/reports/hand');
    const [row] = answer.body.rows;

    expect(answer.status).toBe(200);
    expect(row.email).toBe('ada@usehenri.io');
    expect(answer.text).not.toContain('she/her');
    expect(answer.text).not.toContain('+1-555-0100');
    expect(answer.text).not.toContain('AB-123-456');
    expect(row).not.toHaveProperty('gender');
    expect(row).not.toHaveProperty('phone');
    expect(row).not.toHaveProperty('nationalId');
  });

  // The floor publishes; what it can publish is what carries a model. A
  // primary key a controller copied under `id` is an opaque string, which is
  // the limit base/references.js states -- handing over the records instead
  // is what makes it go away, and it needs no declaration
  test('the records themselves leave without their primary key', async () => {
    await Memo.create({
      body: 'the minutes',
      ownerId: String(user.id || user._id),
      title: 'Minutes',
    });

    const copied = await agent.get('/reports/hand');
    const records = await agent.get('/reports/records');
    const owner = await User.findByKey(user.id || user._id);

    expect(copied.body.rows[0].id).toBe(String(user.id || user._id));
    expect(records.body.rows[0]).not.toHaveProperty('_id');
    expect(records.body.rows[0]).not.toHaveProperty('id');
    expect(records.body.rows[0].externalId).toEqual(expect.any(String));
    expect(records.body.rows[0].ownerId).toBe(owner.externalId);
  });

  test('a declared field naming a model publishes a hand-built row', async () => {
    const answer = await agent.get('/reports/digest');
    const [row] = answer.body.rows;
    const owner = await User.findByKey(user.id || user._id);

    expect(answer.status).toBe(200);
    expect(row.title).toBe('Minutes');
    // The declaration is what made this possible: a plain object carries no
    // model, so nothing else could know that `ownerId` names a row
    expect(row.ownerId).toBe(owner.externalId);
    expect(answer.text).not.toContain(String(user.id || user._id));
  });

  test('what is not declared does not leave', async () => {
    const answer = await agent.get('/reports/digest');

    expect(answer.body).not.toHaveProperty('secret');
    expect(answer.text).not.toContain('undeclared');
    expect(answer.body.total).toBe(1);
  });

  test('a column named by `from` obeys its marks under another name', async () => {
    const answer = await agent.get('/reports/profile');

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ age: 41, who: 'ada@usehenri.io' });
  });

  test('`expose: true` is how a private column leaves on purpose', async () => {
    const answer = await agent.get('/reports/sensitive');

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ gender: 'she/her' });
  });

  test('henri s own answers go through untouched', async () => {
    const version = await agent.get('/version');
    const missing = await agent.get('/nope').set('Accept', 'application/json');

    expect(version.body).toMatchObject({ version: null });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ statusCode: 404 });
  });

  test('a resource answer keeps its links and its shape', async () => {
    const listed = await agent.get('/memos').set('Accept', 'application/json');

    expect(listed.status).toBe(200);
    expect(listed.body._links.self.href).toBe('/memos');
    expect(listed.body._embedded.memos[0].title).toBe('Minutes');
    expect(listed.body._embedded.memos[0]._links.self.href).toMatch(
      /^\/memos\//u
    );
  });

  // The other half of the decision: a field that was declared and is not
  // there is a mistake in this application, not a leak, so it is reported
  // and only refused where the application asked to be strict
  test('a mismatch is reported, and refused with config.api.strict', async () => {
    const lines = [];
    const warn = henri.pen.warn;
    const strict = henri.api.settings.strict;

    henri.pen.warn = (...args) => lines.push(args.join(' '));

    try {
      const reported = await agent.get('/reports/digest?empty=1');

      expect(reported.status).toBe(200);

      henri.api.settings.strict = true;
      henri.api.warned.clear();

      const refused = await agent.get('/reports/digest?empty=1');

      expect(refused.status).toBe(500);
      expect(refused.body.code).toBe('HENRI_ANSWERS_MISMATCH');
    } finally {
      henri.api.settings.strict = strict;
      henri.pen.warn = warn;
      henri.api.warned.clear();
    }

    expect(lines.join('\n')).toMatch(/left the answer undeclared/u);
  });

  test('what an action answers is in the openapi document', () => {
    const document = henri.router.describe();
    const operation = document.paths['/reports/digest'].get;

    expect(operation['x-henri'].answers).toEqual(['rows', 'total']);
    expect(operation['x-henri'].known).toBe(true);
    expect(operation['x-henri'].enforced).toContain('answers');
    expect(
      operation.responses['200'].content['application/json'].schema
    ).toEqual({
      additionalProperties: false,
      properties: {
        rows: { items: { $ref: '#/components/schemas/Memo' }, type: 'array' },
        total: { type: 'integer' },
      },
      required: ['total'],
      type: 'object',
    });
  });
});
