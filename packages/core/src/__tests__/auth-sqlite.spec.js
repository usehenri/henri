const supertest = require('supertest');
const Henri = require('../henri');

// The SQL adapter comes from the workspace: core does not depend on it, the
// suite only needs a sqlite-backed store to run the login flow against
const Sql = require('../../../sequelize');

const password = 'compiler-1952';

/**
 * Reads a cookie value from a response
 *
 * @param {object} res supertest response
 * @param {string} name cookie name
 * @returns {?string} the value or null when the cookie was not set
 */
const cookieOf = (res, name) => {
  const line = (res.headers['set-cookie'] || []).find((cookie) =>
    cookie.startsWith(`${name}=`)
  );

  return line ? line.split(';')[0].slice(name.length + 1) : null;
};

describe('auth (sequelize sqlite store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  let henri;
  let app;
  let agent;
  let disk;
  let sql;
  let csrf;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
    app = henri.server.app;
    agent = supertest.agent(app);

    // Swap the demo's disk store for a sqlite one owning the user model
    disk = henri.model.stores.default;
    sql = new Sql(
      'default',
      {
        adapter: 'sqlite',
        dialect: 'sqlite',
        logging: false,
        storage: ':memory:',
      },
      henri
    );

    const { DataTypes } = sql.Sequelize;

    sql.addModel(
      {
        globalId: 'User',
        identity: 'user',
        options: { timestamps: true },
        schema: { name: { type: DataTypes.STRING } },
      },
      'user'
    );
    await sql.start();

    henri.model.stores.default = sql;
    henri._user = sql.models.User;
    global.User = sql.models.User;
  }, 60000);

  afterAll(async () => {
    henri.model.stores.default = disk;
    henri._user = disk.getModels().User;
    global.User = henri._user;
    await sql.stop();
    await henri.stop();
    delete global.henri;
    if (typeof skipWorkers === 'undefined') {
      delete process.env.SKIP_WORKERS;
    } else {
      process.env.SKIP_WORKERS = skipWorkers;
    }
  }, 60000);

  test('registers through the demo controller', async () => {
    const res = await agent.post('/register').send({
      email: 'Grace@usehenri.io',
      name: 'Grace',
      password,
      roles: ['admin'],
    });

    csrf = cookieOf(res, 'henri.csrf');

    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({
      email: 'grace@usehenri.io',
      id: expect.any(String),
      name: 'Grace',
      roles: ['member'],
    });
  });

  test('looks users up by email (not the first row)', async () => {
    await henri._user.create({
      email: 'second@usehenri.io',
      name: 'Second',
      password: 'second-password',
    });

    const found = await henri.user.findByEmail(' SECOND@usehenri.io ');

    expect(found.name).toBe('Second');
    expect(found.password).not.toBe('second-password');
    expect(await henri.user.findByEmail('nobody@usehenri.io')).toBeNull();
  });

  test('does not accept the first user password for another email', async () => {
    const res = await agent
      .post('/login')
      .send({ email: 'second@usehenri.io', password });

    expect(res.status).toBe(401);
  });

  test('logs in, stores the session in sqlite and loads the user back', async () => {
    const login = await agent
      .post('/login')
      .send({ email: 'grace@usehenri.io', password });

    expect(login.status).toBe(200);
    expect(login.body.user).toEqual({
      email: 'grace@usehenri.io',
      id: expect.any(String),
      name: 'Grace',
      roles: ['member'],
    });
    expect(cookieOf(login, 'henri.sid')).toBeTruthy();

    const store = henri.user.sessionStore.store();

    expect(typeof store.sync).toBe('function');
    expect(await sql.connector.models.Session.count()).toBeGreaterThan(0);

    const profile = await agent
      .get('/profile')
      .set('Accept', 'application/json');

    expect(profile.status).toBe(200);
    expect(profile.body.user).toEqual(login.body.user);
    expect(profile.body.user.password).toBeUndefined();
    expect((await agent.get('/admin')).status).toBe(403);
  });

  test('finds a user by id without its password', async () => {
    const user = await henri.user.findById(
      (await henri.user.findByEmail('grace@usehenri.io')).id
    );

    expect(user.name).toBe('Grace');
    expect(user.password).toBeUndefined();
    expect(await henri.user.findById(424242)).toBeNull();
  });

  test('requires the csrf token with a session', async () => {
    const denied = await agent.post('/artwork').send({ title: 'x', year: 1 });
    const allowed = await agent
      .post('/artwork')
      .set('X-CSRF-Token', csrf)
      .send({ title: 'x', year: 1 });

    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(201);
  });

  test('logs out', async () => {
    const res = await agent.post('/logout').set('X-CSRF-Token', csrf);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await agent.get('/profile')).status).toBe(401);
  });
});
