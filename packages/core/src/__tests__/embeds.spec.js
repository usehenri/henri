/* global Memo */
const supertest = require('supertest');
const Henri = require('../henri');
const { asked, capOf, declarations, read, verify } = require('../base/embeds');

const password = 'difference-engine';
const ownerEmail = 'ada@usehenri.io';
const otherEmail = 'charles@usehenri.io';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** The reference table of an application with one declared foreign key */
const TABLE = {
  classes: new Map(),
  models: {
    Comment: {
      externalId: true,
      references: { memoId: { as: null, target: 'Memo' } },
    },
    Memo: {
      externalId: true,
      references: { ownerId: { as: null, target: 'User' } },
    },
    User: { externalId: true, references: {} },
  },
};

/**
 * Compiles one action's declaration
 *
 * @param {object} block the `embeds` export
 * @param {Array<string>} [actions=['show']] the controller's actions
 * @returns {object} the compiled relations of the first action
 */
const compile = (block, actions = ['show']) =>
  declarations({ embeds: block }, 'memos', actions)[actions[0]];

/**
 * Compiles and binds one action's declaration
 *
 * @param {object} block the `embeds` export
 * @param {string} [model='Memo'] the model the action answers
 * @returns {object} the bound declaration
 */
const bind = (block, model = 'Memo') =>
  verify(compile(block), { model, table: TABLE, where: 'memos#show' });

describe('the declaration (base/embeds.js)', () => {
  test('a relation is the foreign key it goes through', () => {
    expect(compile({ show: { owner: 'ownerId' } })).toEqual({
      owner: {
        field: 'ownerId',
        kind: 'one',
        limit: null,
        name: 'owner',
        owner: null,
        through: 'ownerId',
      },
    });
  });

  test('a `Model.field` is the other side, and it is a list', () => {
    expect(
      compile({ show: { comments: { limit: 5, through: 'Comment.memoId' } } })
    ).toEqual({
      comments: {
        field: 'memoId',
        kind: 'many',
        limit: 5,
        name: 'comments',
        owner: 'Comment',
        through: 'Comment.memoId',
      },
    });
  });

  test('`one: true` makes the other side a single record', () => {
    expect(
      compile({ show: { note: { one: true, through: 'Comment.memoId' } } }).note
        .kind
    ).toBe('one');
  });

  test('the selectors are the ones every other block uses', () => {
    const compiled = declarations(
      { embeds: { 'index,show': { owner: 'ownerId' } } },
      'memos',
      ['index', 'show', 'create']
    );

    expect(Object.keys(compiled).sort()).toEqual(['index', 'show']);
  });

  test.each([
    [{ show: { owner: 42 } }, 'a relation is the foreign key'],
    [{ show: { owner: {} } }, 'without saying what it goes through'],
    [{ show: { owner: { through: 'a.b.c' } } }, 'which is not `Model.field`'],
    [{ show: { owner: { nope: 1, through: 'ownerId' } } }, 'unknown key'],
    [{ show: { owner: { limit: 2, through: 'ownerId' } } }, 'with a "limit"'],
    [
      { show: { owner: { limit: 3, one: true, through: 'Comment.memoId' } } },
      'with a "limit"',
    ],
    [{ show: { owner: { one: 'yes', through: 'ownerId' } } }, '"one" that is'],
    [{ ghost: { owner: 'ownerId' } }, 'which is not one of its actions'],
    [{ show: 'nope' }, 'other than a list of relations'],
  ])('%o is refused at boot', (block, message) => {
    expect(() => compile(block)).toThrow(message);
  });

  test('`embeds` that is not an object is refused', () => {
    expect(() => declarations({ embeds: 7 }, 'memos', [])).toThrow(
      'something other than an object'
    );
  });
});

describe('binding a declaration to the models', () => {
  test('a declared foreign key resolves to the model it names', () => {
    expect(bind({ show: { owner: 'ownerId' } })).toEqual({
      model: 'Memo',
      relations: {
        owner: expect.objectContaining({ kind: 'one', target: 'User' }),
      },
    });
  });

  test('the other side resolves to the model holding the key', () => {
    expect(
      bind({ show: { comments: { through: 'Comment.memoId' } } }).relations
        .comments
    ).toEqual(expect.objectContaining({ kind: 'many', target: 'Comment' }));
  });

  test('a column no model declared as a reference fails the boot', () => {
    expect(() => bind({ show: { owner: 'authorId' } })).toThrow(
      'not a foreign key Memo declared'
    );
  });

  test('a key of another model that does not point back fails the boot', () => {
    expect(() =>
      bind({ show: { memos: { through: 'Memo.ownerId' } } })
    ).toThrow('which does not name Memo');
  });

  test('a model this application does not have fails the boot', () => {
    expect(() => bind({ show: { lines: { through: 'Line.memoId' } } })).toThrow(
      'is not a model of this application'
    );
  });
});

describe('what a request may ask for', () => {
  const declaration = bind({ show: { owner: 'ownerId' } });
  const limits = { maxEmbeds: 3 };

  test('names are split and deduplicated, never matched', () => {
    expect(asked(['a,b', ' c ', 'a', 7])).toEqual(['a', 'b', 'c']);
    expect(asked(undefined)).toEqual([]);
  });

  test('a declared relation is accepted', () => {
    expect(read(declaration, { query: { embed: 'owner' } }, limits)).toEqual({
      errors: {},
      names: ['owner'],
    });
  });

  test('an undeclared one is refused, and says what there is', () => {
    const { errors } = read(declaration, { query: { embed: 'body' } }, limits);

    expect(errors['embed[body]']).toContain('this action embeds owner');
  });

  test('more than config.api.maxEmbeds is refused', () => {
    const { errors } = read(
      declaration,
      { query: { embed: 'owner,owner2,owner3' } },
      { maxEmbeds: 2 }
    );

    expect(errors.embed).toContain('at most 2');
  });

  test('the cap is the declared limit, then the configured one', () => {
    const one = bind({ show: { owner: 'ownerId' } }).relations.owner;
    const many = bind({
      show: { comments: { limit: 7, through: 'Comment.memoId' } },
    }).relations.comments;

    expect(capOf(one, { maxEmbedded: 25 })).toBe(1);
    expect(capOf(many, { maxEmbedded: 25 })).toBe(7);
    expect(
      capOf(
        bind({ show: { comments: { through: 'Comment.memoId' } } }).relations
          .comments,
        { maxEmbedded: 25 }
      )
    ).toBe(25);
  });
});

describe('_embedded (demo app, disk store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  let henri;
  let app;
  let owner;
  let other;
  let ownerId;

  /**
   * Registers and signs a user in
   *
   * @param {string} email the address
   * @returns {Promise<object>} a supertest agent
   */
  const signUp = async (email) => {
    const agent = supertest.agent(app);
    const registered = await agent.post('/register').send({
      email,
      gender: 'unspecified',
      name: email.split('@')[0],
      password,
    });

    if (registered.status !== 201) {
      throw new Error(`unable to register ${email}: ${registered.status}`);
    }

    await agent.post('/login').send({ email, password });

    return agent;
  };

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
    app = henri.server.app;
    owner = await signUp(ownerEmail);
    other = await signUp(otherEmail);

    const record = await henri.user.findByEmail(ownerEmail);

    ownerId = String(record.id || record._id);

    for (const title of ['first', 'second', 'third']) {
      await Memo.create({ body: `about ${title}`, ownerId, title });
    }
  }, 60000);

  afterAll(async () => {
    await henri.stop();
    delete global.henri;
    process.env.SKIP_WORKERS = skipWorkers;
  });

  test('nothing is embedded unless it is asked for', async () => {
    const answer = await owner.get('/memos').expect(200);

    expect(answer.body._embedded.memos.length).toBe(3);
    expect(answer.body._embedded.memos[0]._embedded).toBeUndefined();
  });

  test('a client asks for a declared relation and gets it', async () => {
    const answer = await owner.get('/memos?embed=owner').expect(200);
    const [memo] = answer.body._embedded.memos;

    expect(memo._embedded.owner.externalId).toMatch(UUID);
    expect(memo._embedded.owner.email).toBe(ownerEmail);
    // The foreign key of the record it hangs off is the owner's public
    // identifier, not the document id it holds
    expect(memo.ownerId).toBe(memo._embedded.owner.externalId);
  });

  test('the exit gate runs over an embedded record', async () => {
    const answer = await owner.get('/memos?embed=owner').expect(200);
    const { owner: embedded } = answer.body._embedded.memos[0]._embedded;

    // `gender`, `phone` and `nationalId` are marked
    // `personal: { expose: false }` on the demo user model
    expect(embedded).not.toHaveProperty('gender');
    expect(embedded).not.toHaveProperty('phone');
    expect(embedded).not.toHaveProperty('nationalId');
    expect(embedded).not.toHaveProperty('password');
    // ... and the primary key never leaves either
    expect(embedded).not.toHaveProperty('_id');
    expect(embedded).not.toHaveProperty('id');
    expect(JSON.stringify(answer.body)).not.toContain('unspecified');
  });

  test('a relation the action did not declare is a 422', async () => {
    const answer = await owner.get('/memos?embed=body').expect(422);

    expect(answer.body.code).toBe('HENRI_EMBED_INVALID');
    expect(answer.body.data.errors['embed[body]']).toContain('cannot be');
  });

  test('an action that declares none has no embed surface at all', async () => {
    // The middleware is not mounted there, so `?embed=` is a query
    // parameter nothing reads -- a `?filter[...]` on an action with no
    // `filters` is ignored the same way. Nothing is embedded either way
    const answer = await owner.get('/reports/records?embed=rows').expect(200);

    expect(answer.body).not.toHaveProperty('_embedded');
  });

  test('one resource embeds too', async () => {
    const list = await owner.get('/memos').expect(200);
    const [first] = list.body._embedded.memos;
    const answer = await owner
      .get(`${first._links.self.href}?embed=owner`)
      .expect(200);

    expect(answer.body._embedded.owner.email).toBe(ownerEmail);
  });

  test('the other side is a list, capped at the declared limit', async () => {
    const answer = await owner.get('/profile/memos').expect(200);

    // Three memos, `limit: 2` on the declaration
    expect(answer.body._embedded.memos.length).toBe(2);
    expect(answer.body._embedded.memos[0].externalId).toMatch(UUID);
    // The published foreign key again, one level down
    expect(answer.body._embedded.memos[0].ownerId).toBe(answer.body.externalId);
    expect(answer.body._embedded.memos[0]).not.toHaveProperty('_id');
  });

  test('a record the policy refuses is absent, not a stub', async () => {
    const record = await henri.user.findByEmail(ownerEmail);
    const answer = await other
      .get(`/profile/memos?who=${record.externalId}`)
      .expect(200);

    // The memo policy only lets the author `show` a memo, and every
    // embedded record is asked one at a time
    expect(answer.body.externalId).toBe(record.externalId);
    expect(answer.body._embedded.memos).toEqual([]);
  });

  test('a caller naming an undeclared relation is a failure of its own', () => {
    const { wanted } = require('../base/embeds');

    expect(() =>
      wanted(
        { _embeds: { declaration: null, names: [] } },
        ['ghost'],
        'res.resource'
      )
    ).toThrow('which this action did not declare');
  });

  test('the description says what may be embedded, and no more', () => {
    const operation = henri.router.describe().paths['/memos'].get;
    const parameter = operation.parameters.find(
      (entry) => entry.name === 'embed'
    );

    expect(parameter.schema.items.enum).toEqual(['owner']);
    expect(parameter.schema.maxItems).toBe(3);
    expect(operation['x-henri'].embeds).toEqual(['owner']);
    expect(operation['x-henri'].enforced).toContain('embeds');
  });

  test('one statement per relation, whatever the page size', async () => {
    const counted = [];

    henri.queries.onQuery((event) => counted.push(event));

    try {
      await owner.get('/memos/search?embed=owner&per_page=1').expect(200);

      const one = counted.length;

      counted.length = 0;
      await owner.get('/memos/search?embed=owner&per_page=10').expect(200);

      // Three memos rather than one, and the same number of model calls:
      // the relation is loaded once for the whole page (see base/embeds.js)
      expect(counted.length).toBe(one);
    } finally {
      henri.queries.onQuery(null);
    }
  });
});
