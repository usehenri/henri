/* global Artwork, Memo, User */
const fs = require('fs');
const path = require('path');
const Henri = require('../henri');
// The SQL adapters come from the workspace: core does not depend on them,
// the suite only needs a sqlite-backed store of each to sweep real
// Sequelize and Drizzle models
const Sql = require('../../../sequelize');
const Drizzle = require('../../../drizzle');

const {
  gateOf,
  matches,
  period,
  planOf,
  retentionConfig,
  ruleOf,
  rulesOf,
  sweepOf,
  tokenOf,
} = require('../base/retention');
const { fieldsOf } = require('../base/privacy');

/** A model file the way core hands one to an adapter */
const model = (globalId, schema, options = {}) => ({
  globalId,
  identity: globalId.toLowerCase(),
  options,
  schema,
});

/** The henri a store adapter needs to be built outside of a boot */
const shim = () => ({
  _user: null,
  config: { get: () => undefined, has: () => false },
  cwd: () => process.cwd(),
  isProduction: false,
  pen: {
    error: () => {},
    fatal: () => new Error('x'),
    info: () => {},
    warn: () => {},
  },
  user: { encrypt: async (value) => `hashed:${value}` },
});

/** Long enough ago that every rule of this suite has come for it */
const ago = (days) => new Date(Date.now() - days * 86400000);

describe('the rule (no application)', () => {
  test('a period is read in the units a retention promise is written in', () => {
    expect(period('90d')).toBe(7776000000);
    expect(period('18mo')).toBe(46656000000);
    expect(period('2y')).toBe(63072000000);
    expect(period('30s')).toBe(30000);
    expect(period(1000)).toBe(1000);
    expect(period('nope')).toBeNull();
    expect(period(0)).toBeNull();
    expect(period(null)).toBeNull();
  });

  test('a model says how long it keeps its records', () => {
    const file = model(
      'Proposal',
      { decidedAt: { type: 'date' }, title: { type: 'string' } },
      { retention: { action: 'delete', after: '2y', from: 'decidedAt' } }
    );

    expect(
      ruleOf(file, file.options.retention, { fields: {}, index: 0 })
    ).toEqual({
      action: 'delete',
      after: 63072000000,
      from: 'decidedAt',
      model: 'Proposal',
      name: 'default',
      where: {},
    });
  });

  test('the clock is createdAt only when nothing else is named', () => {
    const file = model('Note', { body: { type: 'text' } }, {});

    expect(ruleOf(file, { after: '1y' }, { fields: {}, index: 0 }).from).toBe(
      'createdAt'
    );
  });

  test('a rule henri cannot carry out fails the boot, and says why', () => {
    const dated = model('Note', { closedAt: { type: 'date' } }, {});
    const plain = model('Note', { body: { type: 'text' } }, {});
    const paranoid = model(
      'Note',
      { body: { type: 'text' } },
      { paranoid: true }
    );

    const refused = (file, rule) => {
      try {
        ruleOf(file, rule, { fields: {}, index: 0 });
      } catch (error) {
        return error;
      }

      return null;
    };

    expect(refused(dated, { after: 'soon' }).code).toBe(
      'HENRI_RETENTION_INVALID_RULE'
    );
    // A period under a minute is a typo, not a policy
    expect(refused(dated, { after: '30s' }).message).toMatch(/under a minute/u);
    expect(refused(dated, { after: '1y', from: 'nope' }).message).toMatch(
      /not a date field/u
    );
    expect(refused(dated, { action: 'archive', after: '1y' }).message).toMatch(
      /anonymize, delete, soft-delete/u
    );
    // A soft delete on a model that has no soft delete would be a delete
    // wearing a different word
    expect(
      refused(plain, { action: 'soft-delete', after: '1y' }).message
    ).toMatch(/paranoid: true/u);
    // Anonymizing a model with nothing personal would touch nothing and
    // report success
    expect(
      refused(paranoid, { action: 'anonymize', after: '1y' }).message
    ).toMatch(/nothing to write over/u);
    expect(refused(dated, 'two years').message).toMatch(/is an object/u);
    expect(refused(dated, { after: '1y', where: 'draft' }).message).toMatch(
      /has to be an object/u
    );
  });

  test('a model with more than one class of records names its rules', () => {
    const file = model(
      'Proposal',
      { decidedAt: { type: 'date' }, state: { type: 'string' } },
      {
        retention: [
          { after: '30d', name: 'drafts', where: { state: 'draft' } },
          { after: '2y', from: 'decidedAt', name: 'decided' },
        ],
      }
    );

    expect(rulesOf([file]).map((rule) => rule.name)).toEqual([
      'drafts',
      'decided',
    ]);

    const clash = model(
      'Proposal',
      { state: { type: 'string' } },
      { retention: [{ after: '30d' }, { after: '2y', name: 'default' }] }
    );

    expect(() => rulesOf([clash])).toThrow(/two rules are called/u);
  });

  test('a model that says nothing has no rules', () => {
    expect(rulesOf([model('Note', {}, {})])).toEqual([]);
    expect(rulesOf([model('Note', {}, { retention: false })])).toEqual([]);
    expect(rulesOf(null)).toEqual([]);
  });

  test('the token covers the terms, so a changed rule is a new rule', () => {
    const rule = {
      action: 'delete',
      after: 63072000000,
      from: 'decidedAt',
      model: 'Proposal',
      name: 'default',
      where: {},
    };
    const token = tokenOf(rule);

    expect(token).toMatch(/^Proposal:default:[0-9a-f]{12}$/u);
    expect(tokenOf(rule)).toBe(token);
    // Two hours where two years was meant is a different rule
    expect(tokenOf({ ...rule, after: 7200000 })).not.toBe(token);
    expect(tokenOf({ ...rule, action: 'anonymize' })).not.toBe(token);
    expect(tokenOf({ ...rule, where: { state: 'draft' } })).not.toBe(token);
    // The digest is plain, so a token committed to config/<env>.json means
    // the same thing in every environment
    expect(token).toBe('Proposal:default:cfb99ef62f75');
  });

  test('the gate is what stands between a new rule and a deleted table', () => {
    const rule = { token: 'Proposal:default:abc123abc123' };

    expect(gateOf(rule, { approve: true, approved: [] })).toBe('pending');
    expect(gateOf(rule, { approve: true, approved: [rule.token] })).toBeNull();
    // An application may decide the deployment is the review
    expect(gateOf(rule, { approve: false, approved: [] })).toBeNull();
  });

  test('--only names a model, or one rule of it', () => {
    const rule = { model: 'Proposal', name: 'drafts' };

    expect(matches(rule, 'Proposal')).toBe(true);
    expect(matches(rule, 'proposal')).toBe(true);
    expect(matches(rule, 'Proposal:drafts')).toBe(true);
    expect(matches(rule, 'Proposal:decided')).toBe(false);
    expect(matches(rule, 'Review')).toBe(false);
  });

  test('the configuration fills in what it does not say', () => {
    expect(retentionConfig(null)).toEqual({
      approve: true,
      approved: [],
      batch: 1000,
      receipts: 'privacy',
      schedule: false,
    });

    const config = (value) => ({
      get: () => value,
      has: () => true,
    });

    expect(retentionConfig(config({ approve: false, batch: false }))).toEqual({
      approve: false,
      approved: [],
      batch: false,
      receipts: 'privacy',
      schedule: false,
    });
    expect(
      retentionConfig(config({ receipts: false, schedule: '0 3 * * *' }))
    ).toMatchObject({ receipts: false, schedule: '0 3 * * *' });
  });
});

describe('a sweep on sequelize', () => {
  let sql = null;
  let modelOf = null;
  const models = [
    model(
      'Ticket',
      {
        closedAt: { type: 'date' },
        note: { personal: true, type: 'string' },
        state: { type: 'string' },
      },
      {
        paranoid: true,
        retention: [
          { after: '30d', from: 'closedAt', name: 'closed' },
          {
            action: 'anonymize',
            after: '90d',
            from: 'createdAt',
            name: 'old',
            where: { state: 'open' },
          },
        ],
        timestamps: true,
      }
    ),
    model(
      'Log',
      { line: { type: 'string' }, writtenAt: { type: 'date' } },
      { retention: { after: '30d', from: 'writtenAt' }, timestamps: true }
    ),
  ];

  const context = (settings = {}) => ({
    fieldsOf: (name) =>
      fieldsOf(models.find((entry) => entry.globalId === name)),
    modelOf,
    rules: rulesOf(models, {
      fields: (name) =>
        fieldsOf(models.find((entry) => entry.globalId === name)),
    }),
    settings: { ...retentionConfig(null), approve: false, ...settings },
  });

  beforeAll(async () => {
    sql = new Sql(
      'default',
      {
        adapter: 'sqlite',
        dialect: 'sqlite',
        logging: false,
        storage: ':memory:',
      },
      shim()
    );

    models.forEach((entry) => sql.addModel(entry, 'nobody'));
    await sql.start();

    const orm = sql.getModels();

    modelOf = (name) => orm[name];
  }, 30000);

  afterAll(async () => {
    await sql.stop();
  });

  beforeEach(async () => {
    await modelOf('Ticket').destroy({ force: true, truncate: true });
    await modelOf('Log').destroy({ force: true, truncate: true });
  });

  test('a record whose clock has not started is never swept', async () => {
    const Ticket = modelOf('Ticket');

    await Ticket.create({ note: 'open forever', state: 'open' });
    await Ticket.create({ closedAt: ago(90), note: 'gone', state: 'closed' });

    const plan = await planOf(context(), { only: 'Ticket:closed' });
    const [step] = plan.steps;

    expect(step.matched).toBe(1);
    // The open ticket is counted, not swept: a rule that quietly matches
    // nothing has to be visible
    expect(step.waiting).toBe(1);
    expect(await Ticket.count()).toBe(2);
  });

  test('a delete takes the row, soft deleted or not', async () => {
    const Ticket = modelOf('Ticket');
    const hidden = await Ticket.create({
      closedAt: ago(60),
      note: 'withdrawn',
      state: 'closed',
    });

    await hidden.destroy();
    await Ticket.create({ closedAt: ago(60), note: 'closed', state: 'closed' });
    await Ticket.create({ closedAt: ago(1), note: 'recent', state: 'closed' });

    const receipt = await sweepOf(context(), { only: 'Ticket:closed' });

    expect(receipt.rules[0].written).toBe(2);
    expect(receipt.rules[0].sample).toHaveLength(2);
    // The recent one is still there, and so is nothing else
    expect(await Ticket.count({ paranoid: false })).toBe(1);
  });

  test('an anonymize writes what an erasure writes, and keeps the row', async () => {
    const Ticket = modelOf('Ticket');

    await Ticket.create({
      createdAt: ago(120),
      note: 'a name and a number',
      state: 'open',
    });

    const receipt = await sweepOf(context(), { only: 'Ticket:old' });

    expect(receipt.rules[0].action).toBe('anonymize');
    expect(receipt.rules[0].fields).toEqual(['note']);
    expect(receipt.rules[0].written).toBe(1);

    const [row] = await Ticket.findAll();

    expect(row.note).toBeNull();
    expect(row.state).toBe('open');
  });

  test('a batch bounds one run, and says what is left', async () => {
    const Ticket = modelOf('Ticket');

    for (let index = 0; index < 5; index += 1) {
      await Ticket.create({
        closedAt: ago(60),
        note: `ticket ${index}`,
        state: 'closed',
      });
    }

    const receipt = await sweepOf(context({ batch: 2 }), {
      only: 'Ticket:closed',
    });

    expect(receipt.rules[0].matched).toBe(5);
    expect(receipt.rules[0].written).toBe(2);
    expect(receipt.rules[0].remaining).toBe(3);
    expect(await Ticket.count()).toBe(3);
  });

  test('a rule nobody approved plans, counts and writes nothing', async () => {
    const Ticket = modelOf('Ticket');

    await Ticket.create({ closedAt: ago(60), note: 'kept', state: 'closed' });

    const settings = { ...retentionConfig(null), approve: true, approved: [] };
    const receipt = await sweepOf(
      { ...context(), settings },
      { only: 'Ticket:closed' }
    );

    expect(receipt.pending).toBe(1);
    expect(receipt.rules[0].skipped).toBe('not approved');
    expect(receipt.rules[0].would).toBe(1);
    expect(receipt.rules[0].written).toBe(0);
    expect(await Ticket.count()).toBe(1);

    // The same run, with the token in the configuration
    const approved = {
      ...settings,
      approved: [context().rules[0].token],
    };

    expect(
      (
        await sweepOf(
          { ...context(), settings: approved },
          { only: 'Ticket:closed' }
        )
      ).rules[0].written
    ).toBe(1);
  });

  test('a dry run counts and writes nothing', async () => {
    const Ticket = modelOf('Ticket');

    await Ticket.create({ closedAt: ago(60), note: 'kept', state: 'closed' });

    const receipt = await sweepOf(context(), {
      dryRun: true,
      only: 'Ticket:closed',
    });

    expect(receipt.dryRun).toBe(true);
    expect(receipt.rules[0].would).toBe(1);
    expect(receipt.rules[0].written).toBe(0);
    expect(receipt.rules[0].skipped).toBe('dry run');
    expect(await Ticket.count()).toBe(1);
  });

  test('a rule that fails stops that rule and nothing else', async () => {
    const Ticket = modelOf('Ticket');
    const Log = modelOf('Log');

    await Ticket.create({ closedAt: ago(60), note: 'one', state: 'closed' });
    await Log.create({ line: 'old', writtenAt: ago(60) });

    // A model that answers the plan and then refuses to be read: the
    // database went away between the count and the write
    const broken = {
      ...context(),
      modelOf: (name) =>
        name === 'Log'
          ? Log
          : {
              count: async () => 1,
              findAll: () => {
                throw new Error('the database went away');
              },
              findByPk: () => null,
              sequelize: Ticket.sequelize,
            },
    };
    const receipt = await sweepOf(broken, {});

    expect(receipt.interrupted).toBe(true);
    expect(
      receipt.rules.find((rule) => rule.model === 'Ticket').failed
    ).toMatch(/went away/u);
    // The other rule still ran: a sweep is a list of independent queries
    expect(receipt.rules.find((rule) => rule.model === 'Log').written).toBe(1);
  });
});

describe('a sweep on drizzle', () => {
  let store = null;
  let modelOf = null;
  const models = [
    model(
      'Booking',
      {
        bookedAt: { type: 'date' },
        guest: { personal: { erase: 'anonymize' }, type: 'string' },
        leftAt: { type: 'date' },
      },
      {
        paranoid: true,
        retention: [
          { action: 'anonymize', after: '1y', from: 'leftAt', name: 'left' },
          {
            action: 'soft-delete',
            after: '30d',
            from: 'bookedAt',
            name: 'stale',
          },
        ],
        timestamps: true,
      }
    ),
  ];

  const context = () => ({
    fieldsOf: (name) =>
      fieldsOf(models.find((entry) => entry.globalId === name)),
    modelOf,
    rules: rulesOf(models, {
      fields: (name) =>
        fieldsOf(models.find((entry) => entry.globalId === name)),
    }),
    settings: { ...retentionConfig(null), approve: false },
  });

  beforeAll(async () => {
    store = new Drizzle(
      'default',
      { dialect: 'sqlite', url: ':memory:' },
      shim()
    );

    models.forEach((entry) => store.addModel(entry, 'nobody'));
    await store.start();

    const orm = store.getModels();

    modelOf = (name) => orm[name];
  }, 30000);

  afterAll(async () => {
    await store.stop();
  });

  beforeEach(async () => {
    await modelOf('Booking').withDeleted().where({}).destroy({ force: true });
  });

  test('an anonymize keeps the row and writes over the person', async () => {
    const Booking = modelOf('Booking');

    await Booking.create({ guest: 'Ada Lovelace', leftAt: ago(400) });
    await Booking.create({ guest: 'Still here', leftAt: ago(10) });

    const receipt = await sweepOf(context(), { only: 'Booking:left' });

    expect(receipt.rules[0].written).toBe(1);

    const rows = await Booking.find({});

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.guest).sort()).toEqual([
      'Still here',
      '[erased]',
    ]);
  });

  test('a soft delete hides the row, and never comes for a hidden one', async () => {
    const Booking = modelOf('Booking');

    await Booking.create({ bookedAt: ago(60), guest: 'Old' });
    await Booking.create({ bookedAt: ago(1), guest: 'New' });

    const first = await sweepOf(context(), { only: 'Booking:stale' });

    expect(first.rules[0].written).toBe(1);
    expect(await Booking.find({})).toHaveLength(1);
    expect(await Booking.withDeleted().where({}).count()).toBe(2);

    // The stamp is not moved on a second pass: the row is already hidden
    const second = await sweepOf(context(), { only: 'Booking:stale' });

    expect(second.rules[0].matched).toBe(0);
  });
});

describe('the module, in the demo application', () => {
  let henri = null;
  const skipWorkers = process.env.SKIP_WORKERS;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
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

  beforeEach(async () => {
    await Memo.deleteMany({}, { force: true });
    await Artwork.deleteMany({}, { force: true });
    henri.retention.settings.approved = [];
  });

  test('the rules are what the models said', () => {
    const described = henri.retention.describe();

    expect(
      described.rules.map((rule) => `${rule.model}:${rule.rule}`).sort()
    ).toEqual(['Artwork:default', 'Memo:default']);

    const memo = described.rules.find((rule) => rule.model === 'Memo');

    expect(memo.action).toBe('delete');
    expect(memo.from).toBe('archivedAt');
    expect(memo.after).toBe(2592000000);
    expect(memo.approved).toBe(false);
    expect(memo.token).toMatch(/^Memo:default:[0-9a-f]{12}$/u);
  });

  test('nothing runs the sweep here, and the module says so', () => {
    // The demo has no @usehenri/jobs and no retention.schedule: the line
    // names the command a cron entry would run
    expect(henri.retention.schedule()).toMatch(/henri retention:sweep --yes/u);
  });

  test('a sweep writes a receipt, and the trail carries it', async () => {
    const user = await User.create({
      email: 'keeper@demo.test',
      name: 'Keeper',
      password: 'longenoughpassword',
    });

    await Memo.create({
      archivedAt: new Date(Date.now() - 60 * 86400000),
      body: 'archived long ago',
      ownerId: String(user._id),
      title: 'Old',
    });
    await Memo.create({
      body: 'still in use',
      ownerId: String(user._id),
      title: 'Open',
    });

    const token = henri.retention
      .describe()
      .rules.find((rule) => rule.model === 'Memo').token;

    henri.retention.settings.approved = [token];

    const receipt = await henri.retention.sweep({ only: 'Memo' });
    const rule = receipt.rules[0];

    expect(rule.written).toBe(1);
    expect(rule.waiting).toBe(1);
    expect(await Memo.countDocuments()).toBe(1);

    expect(receipt.file).toMatch(/^\.tmp\/privacy\/retention-/u);
    const written = JSON.parse(
      fs.readFileSync(path.join(henri.cwd(), receipt.file), 'utf8')
    );

    expect(written.rules[0].written).toBe(1);
    // The receipt is a sample, never an index: no body, no title, no owner
    expect(JSON.stringify(written)).not.toMatch(/archived long ago/u);

    const [entry] = await henri.trail.list({ action: 'retention.sweep' });

    expect(entry.model).toBe('Memo');
    expect(entry.records).toBe(1);
    expect(entry.meta.rule).toBe('default');
    expect(entry.source).toBe('app');
  });

  test('a pending rule is planned and never written', async () => {
    await Artwork.create({
      createdAt: new Date(Date.now() - 800 * 86400000),
      title: 'Very old',
      year: 1890,
    });

    const receipt = await henri.retention.sweep({ only: 'Artwork' });

    expect(receipt.pending).toBe(1);
    expect(receipt.rules[0].would).toBe(1);
    expect(receipt.rules[0].written).toBe(0);
    expect(receipt.rules[0].skipped).toBe('not approved');
    expect(await Artwork.countDocuments()).toBe(1);
  });
});
