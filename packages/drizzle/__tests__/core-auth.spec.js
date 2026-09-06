const fs = require('fs');
const path = require('path');
const supertest = require('supertest');

// Core comes from the workspace: the adapter does not depend on it, the
// suite boots the fixture application on this store and runs the login
// flow of packages/core/src/__tests__/auth-sqlite.spec.js against it
const Henri = require('../../core/src/henri');
const {
  hashPassword,
  isBound,
  needsRehash,
  passwordPolicy,
} = require('../../core/src/base/password');

const fixture = path.join(__dirname, 'fixtures', 'auth-app');
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

/**
 * Core resolves `@usehenri/drizzle` from the application directory: link
 * this package into the fixture's node_modules (ignored by git)
 *
 * @returns {void}
 */
const linkAdapter = () => {
  const target = path.join(fixture, 'node_modules', '@usehenri', 'drizzle');

  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (!fs.existsSync(target)) {
    fs.symlinkSync(path.resolve(__dirname, '..'), target, 'dir');
  }
};

describe('auth (core on the drizzle sqlite store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  const cwd = process.cwd();
  let henri;
  let app;
  let agent;
  let store;
  let csrf;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    linkAdapter();
    process.chdir(fixture);
    henri = new Henri();
    await henri.init();
    global.henri = henri;
    app = henri.server.app;
    agent = supertest.agent(app);
    store = henri.model.stores.default;
  }, 60000);

  afterAll(async () => {
    await henri.stop();
    delete global.henri;
    process.chdir(cwd);
    if (typeof skipWorkers === 'undefined') {
      delete process.env.SKIP_WORKERS;
    } else {
      process.env.SKIP_WORKERS = skipWorkers;
    }
  }, 60000);

  test('loads the drizzle store and its models as globals', () => {
    expect(store.adapterName).toBe('drizzle');
    expect(store.dialect.name).toBe('sqlite');
    expect(henri._user).toBe(global.User);
    expect(global.Artwork.tableName).toBe('artworks');
    expect(henri.user.adapter().native).toBe(true);
  });

  test('registers through the controller', async () => {
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

    const sessions = await store.query(
      'SELECT COUNT(*) AS total FROM henri_sessions'
    );

    expect(sessions[0].total).toBeGreaterThan(0);
    expect(typeof henri.user.sessionStore.store().touch).toBe('function');

    const profile = await agent
      .get('/profile')
      .set('Accept', 'application/json');

    expect(profile.status).toBe(200);
    expect(profile.body.user).toEqual(login.body.user);
    expect(profile.body.user.password).toBeUndefined();
    expect((await agent.get('/admin')).status).toBe(403);
  });

  test('upgrades a stale hash on a successful sign-in', async () => {
    // A user registered before the defaults moved: bcrypt at a low cost, and
    // a password shorter than today's minimum
    const legacy = 'sixchr';
    const stale = await hashPassword(
      legacy,
      passwordPolicy({ algorithm: 'bcrypt' }, { isTest: true })
    );

    await henri._user.create(
      { email: 'legacy@usehenri.io', name: 'Legacy', password: stale },
      { passwordsHashed: true }
    );

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
    expect(isBound(after.password)).toBe(true);
  });

  describe('a hash bound to its row', () => {
    const known = 'the-password-mallory-knows';
    const mallory = 'mallory@usehenri.io';
    const victim = 'victim@usehenri.io';

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

    test('does not sign anyone in when it is copied onto another row', async () => {
      const source = await henri.user.findByEmail(mallory);
      const target = await henri.user.findByEmail(victim);

      expect(isBound(source.password)).toBe(true);
      expect(henri.user.identityOf(source)).not.toBe(
        henri.user.identityOf(target)
      );

      // The hash is a good one: Mallory signs in with it as herself
      expect(
        (
          await supertest(app)
            .post('/login')
            .send({ email: mallory, password: known })
        ).status
      ).toBe(200);

      // Copied straight onto the victim's row, hooks bypassed
      await henri._user.update(
        { email: victim },
        { password: source.password },
        { passwordsHashed: true }
      );
      expect((await henri.user.findByEmail(victim)).password).toBe(
        source.password
      );

      const res = await supertest(app)
        .post('/login')
        .send({ email: victim, password: known });

      expect(res.status).toBe(401);
    });

    test('an unbound hash still verifies, and is bound afterwards', async () => {
      const owner = 'migrating@usehenri.io';
      const secret = 'a-password-that-is-long-enough';
      const unbound = await hashPassword(
        secret,
        henri.user.passwordPolicy,
        null
      );

      await henri._user.create(
        { email: owner, name: 'Migrating', password: unbound },
        { passwordsHashed: true }
      );

      expect(isBound(unbound)).toBe(false);

      const res = await supertest(app)
        .post('/login')
        .send({ email: owner, password: secret });

      expect(res.status).toBe(200);

      const after = await henri.user.findByEmail(owner);

      expect(isBound(after.password)).toBe(true);
      await expect(henri.user.compare(secret, after)).resolves.toBe(true);
    });

    test('a mass password write that cannot name one row is refused', async () => {
      await expect(
        henri._user.update({}, { password: 'a-password-for-everyone' })
      ).rejects.toMatchObject({ name: 'ValidationError' });
    });

    test('a mass password write that names exactly one row is bound', async () => {
      const fresh = 'a-brand-new-password-here';

      await henri._user.update({ email: victim }, { password: fresh });

      const after = await henri.user.findByEmail(victim);

      expect(isBound(after.password)).toBe(true);
      await expect(henri.user.compare(fresh, after)).resolves.toBe(true);
    });

    test('findByIdAndUpdate binds to the row it names', async () => {
      const fresh = 'yet-another-good-password';
      const before = await henri.user.findByEmail(victim);

      await henri._user.findByIdAndUpdate(before.externalId, {
        password: fresh,
      });

      const after = await henri.user.findByEmail(victim);

      expect(isBound(after.password)).toBe(true);
      expect(after.externalId).toBe(before.externalId);
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
    expect(await henri.user.findById('stale-session-id')).toBeNull();
  });

  test('requires the csrf token with a session', async () => {
    const denied = await agent.post('/artwork').send({ title: 'x', year: 1 });
    const allowed = await agent
      .post('/artwork')
      .set('X-CSRF-Token', csrf)
      .send({ title: 'x', year: 1 });

    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(201);
    expect(allowed.body.artwork).toMatchObject({
      externalId: expect.any(String),
      title: 'x',
      year: 1,
    });
    expect(allowed.body.artwork.id).toBeUndefined();
  });

  test('answers 422 with one message per field on invalid data', async () => {
    const res = await agent
      .post('/artwork')
      .set('X-CSRF-Token', csrf)
      .send({ title: 'bad', year: 'not a year' });

    expect(res.status).toBe(422);
    expect(res.body.data).toEqual({ errors: { year: 'must be an integer' } });
  });

  test('logs out', async () => {
    const res = await agent.post('/logout').set('X-CSRF-Token', csrf);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await agent.get('/profile')).status).toBe(401);
  });
});
