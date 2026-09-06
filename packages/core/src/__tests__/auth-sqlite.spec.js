const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const Henri = require('../henri');
const {
  BOUND,
  hashPassword,
  isBound,
  needsRehash,
} = require('../base/password');

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
      externalId: expect.any(String),
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
      externalId: expect.any(String),
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

  test('upgrades a stale hash on a successful sign-in', async () => {
    // A user this application registered before the defaults moved: bcrypt
    // at a low cost, and a password shorter than today's minimum
    const legacy = 'sixchr';
    const stale = await bcrypt.hash(legacy, await bcrypt.genSalt(4));
    const created = await henri._user.create(
      { email: 'legacy@usehenri.io', name: 'Legacy', password: stale },
      { passwordsHashed: true }
    );

    expect(created.password).toBe(stale);
    expect(needsRehash(stale, henri.user.passwordPolicy)).toBe(true);

    const res = await supertest(app)
      .post('/login')
      .send({ email: 'legacy@usehenri.io', password: legacy });

    expect(res.status).toBe(200);

    const after = await henri.user.findByEmail('legacy@usehenri.io');

    expect(after.password).not.toBe(stale);
    expect(needsRehash(after.password, henri.user.passwordPolicy)).toBe(false);
    // The user, not the hash: the rewrite bound it to this record
    await expect(henri.user.compare(legacy, after)).resolves.toBe(true);

    // ... and it is bound now, which is what the next sign-in relies on
    expect(isBound(after.password)).toBe(true);
    expect(after.password).toContain(BOUND);
  });

  test('an unbound hash written today is bound after its owner signs in', async () => {
    // Exactly the shape of an application upgrading: the hash is current in
    // every other way, it just predates the binding
    const owner = 'migrating@usehenri.io';
    const secret = 'a-password-that-is-long-enough';
    const unbound = await hashPassword(secret, henri.user.passwordPolicy, null);

    await henri._user.create(
      { email: owner, name: 'Migrating', password: unbound },
      { passwordsHashed: true }
    );

    expect(isBound(unbound)).toBe(false);

    // It verifies, so nobody is locked out by the upgrade
    const res = await supertest(app)
      .post('/login')
      .send({ email: owner, password: secret });

    expect(res.status).toBe(200);

    const after = await henri.user.findByEmail(owner);

    expect(isBound(after.password)).toBe(true);
    await expect(henri.user.compare(secret, after)).resolves.toBe(true);

    // And it stays bound: signing in again does not rewrite it
    const again = await supertest(app)
      .post('/login')
      .send({ email: owner, password: secret });

    expect(again.status).toBe(200);
    expect((await henri.user.findByEmail(owner)).password).toBe(after.password);
  });

  describe('a hash copied onto another row', () => {
    const known = 'the-password-mallory-knows';
    const mallory = 'mallory@usehenri.io';
    const victim = 'victim@usehenri.io';

    /**
     * Writes a hash straight onto a row, the way someone with write access
     * to the database would: no hooks, no hashing, just the bytes
     *
     * @param {string} email whose row
     * @param {string} hash what to put in the column
     * @returns {Promise<void>} nothing
     */
    const plant = async (email, hash) => {
      await henri._user.update(
        { password: hash },
        { passwordsHashed: true, where: { email } }
      );
    };

    beforeAll(async () => {
      await henri._user.create({
        email: mallory,
        name: 'Mallory',
        password: known,
      });
      await henri._user.create({
        email: victim,
        name: 'Victim',
        password: 'a-password-nobody-else-knows',
      });
    });

    test('does not sign anyone in', async () => {
      const source = await henri.user.findByEmail(mallory);
      const target = await henri.user.findByEmail(victim);

      // Two rows, two identities, and a hash that belongs to the first
      expect(isBound(source.password)).toBe(true);
      expect(henri.user.identityOf(source)).not.toBe(
        henri.user.identityOf(target)
      );

      // Mallory can sign in as herself: the hash is a good one
      expect(
        (
          await supertest(app)
            .post('/login')
            .send({ email: mallory, password: known })
        ).status
      ).toBe(200);

      // She copies it onto the victim's row
      await plant(victim, source.password);
      expect((await henri.user.findByEmail(victim)).password).toBe(
        source.password
      );

      // And it buys her nothing
      const res = await supertest(app)
        .post('/login')
        .send({ email: victim, password: known });

      expect(res.status).toBe(401);
    });

    test('would have signed her in without the binding', async () => {
      // The control: the same move against an unbound hash works, which is
      // what says the test above is testing something
      const binding = henri.user.settings.password.binding;

      henri.user.settings.password.binding = {
        allowUnbound: true,
        enabled: false,
      };

      try {
        const source = await henri.user.findByEmail(mallory);
        const unbound = await hashPassword(
          known,
          henri.user.passwordPolicy,
          null
        );

        expect(isBound(unbound)).toBe(false);
        await plant(mallory, unbound);
        await plant(victim, unbound);

        const res = await supertest(app)
          .post('/login')
          .send({ email: victim, password: known });

        expect(res.status).toBe(200);
        expect(source).toBeTruthy();
      } finally {
        henri.user.settings.password.binding = binding;
      }
    });

    test('refuses a mass password write it cannot pin to one row', async () => {
      // One password handed to an unknown number of rows: there is no row to
      // bind to, and writing an unbound hash instead would reopen the door
      await expect(
        henri._user.update(
          { password: 'a-password-for-everyone' },
          { where: {} }
        )
      ).rejects.toMatchObject({
        errors: { password: { message: expect.any(String) } },
        name: 'ValidationError',
      });
    });

    test('compare() with the bare hash throws instead of denying', async () => {
      // Its own row: the tests above deliberately leave unbound hashes behind
      const alone = 'compare@usehenri.io';

      await henri._user.create({
        email: alone,
        name: 'Compare',
        password: known,
      });

      const user = await henri.user.findByEmail(alone);

      expect(isBound(user.password)).toBe(true);

      // Handing over the hash alone used to be fine and now cannot be: the
      // answer has to be an error that names the problem, not "Invalid
      // credentials", or a caller that catches everything (base/accounts.js
      // did) turns a right password into a wrong one
      await expect(henri.user.compare(known, user.password)).rejects.toThrow(
        /bound to the record it belongs to/u
      );

      // The user is what it wants
      await expect(henri.user.compare(known, user)).resolves.toBe(true);
    });

    test('allows a mass password write that names exactly one row', async () => {
      const fresh = 'a-brand-new-password-here';

      await henri._user.update(
        { password: fresh },
        { where: { email: victim } }
      );

      const after = await henri.user.findByEmail(victim);

      expect(isBound(after.password)).toBe(true);
      await expect(henri.user.compare(fresh, after)).resolves.toBe(true);
    });
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

  test('a session whose user is gone is anonymous, not an error (#65)', async () => {
    const ghost = supertest.agent(app);

    await henri._user.create({
      email: 'ghost@usehenri.io',
      name: 'Ghost',
      password,
    });

    const login = await ghost
      .post('/login')
      .send({ email: 'ghost@usehenri.io', password });

    expect(login.status).toBe(200);

    const user = await henri.user.findByEmail('ghost@usehenri.io');

    await henri._user.destroy({ force: true, where: { id: user.id } });

    // Passport answers `done(null, false)` for a row that is no longer
    // there, so the request is anonymous rather than failing to
    // deserialize, and signing out of it works
    const profile = await ghost
      .get('/profile')
      .set('Accept', 'application/json');

    expect(profile.status).toBe(401);

    const out = await ghost
      .post('/logout')
      .set('X-CSRF-Token', cookieOf(login, 'henri.csrf'));

    expect(out.status).toBe(200);
  });
});
