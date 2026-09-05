const session = require('express-session');
const { build, sessions, target, taskModel, userModel } = require('./helpers');

// `?` on sqlite and mysql, `$1` on postgres
const EXPIRES = `SELECT expires_at FROM henri_sessions WHERE sid = ${target.dialect.placeholder(1)}`;

/**
 * The expiry stored for a session, as a timestamp (an integer of
 * milliseconds on sqlite, a date on postgres and mysql)
 *
 * @param {object} adapter The store
 * @param {string} sid A session id
 * @returns {Promise<number>} The expiry
 */
const expiresAt = async (adapter, sid) =>
  new Date((await adapter.query(EXPIRES, [sid]))[0].expires_at).getTime();

describe('session store', () => {
  let adapter;
  let store;
  let api;

  beforeAll(async () => {
    ({ adapter } = build(
      { baseRole: 'member' },
      {
        session: { checkExpirationInterval: 0, expiration: 60 * 1000 },
      }
    ));
    adapter.addModel(userModel, 'user');
    await adapter.start();
    store = await adapter.getSessionConnector(session);
    api = sessions(store);
  });

  afterAll(async () => {
    await adapter.stop();
  });

  afterEach(async () => {
    await api.clear();
  });

  test('is an express-session store on the henri_sessions table, built once', async () => {
    expect(store).toBeInstanceOf(session.Store);
    expect(await adapter.getSessionConnector(session)).toBe(store);
    expect(await adapter.listTables()).toContain('henri_sessions');
    expect(store.timer).toBeNull();
  });

  test('round-trips sessions and answers undefined for unknown ids', async () => {
    const data = { cookie: { maxAge: 60000 }, passport: { user: '1' } };

    await api.set('sid-1', data);
    expect(await api.get('sid-1')).toEqual(data);
    expect(await api.get('sid-missing')).toBeUndefined();
    expect(await api.length()).toBe(1);

    await api.set('sid-1', { ...data, extra: true });
    expect((await api.get('sid-1')).extra).toBe(true);
    expect(await api.length()).toBe(1);

    await api.destroy('sid-1');
    expect(await api.get('sid-1')).toBeUndefined();
  });

  test('expires with the cookie and sweeps expired rows', async () => {
    await api.set('live', { cookie: { maxAge: 60000 } });
    await api.set('dead', { cookie: { expires: new Date(Date.now() - 1000) } });
    await api.set('default-ttl', { cookie: {} });

    expect(await api.length()).toBe(3);
    expect(await api.get('dead')).toBeUndefined();
    expect(await api.length()).toBe(2);
    expect(Object.keys(await api.all()).sort()).toEqual([
      'default-ttl',
      'live',
    ]);

    await api.set('soon', { cookie: { expires: new Date(Date.now() - 1) } });

    const swept = await new Promise((resolve, reject) =>
      store.clearExpiredSessions((error, count) =>
        error ? reject(error) : resolve(count)
      )
    );

    expect(swept).toBe(1);
    expect(await api.length()).toBe(2);
  });

  test('touch extends the expiry', async () => {
    await api.set('touched', { cookie: { maxAge: 1000 } });

    const before = await expiresAt(adapter, 'touched');

    await api.touch('touched', { cookie: { maxAge: 100000 } });

    const after = await expiresAt(adapter, 'touched');

    expect(after).toBeGreaterThan(before);
  });

  test('creates the sessions table on demand for a store without a user model', async () => {
    const { adapter: bare } = build();

    bare.addModel(taskModel, 'user');
    await expect(bare.getSessionConnector(session)).rejects.toThrow(
      'is not started'
    );
    await bare.start();
    expect(await bare.listTables()).not.toContain('henri_sessions');

    const late = await bare.getSessionConnector(session);
    const calls = sessions(late);

    await calls.set('x', { cookie: {} });
    expect(await calls.get('x')).toEqual({ cookie: {} });
    expect(await bare.listTables()).toContain('henri_sessions');
    await bare.stop();
  });

  test('stops the sweep with the adapter', async () => {
    const { adapter: timed } = build({ baseRole: 'member' });

    timed.addModel(userModel, 'user');
    await timed.start();

    const swept = await timed.getSessionConnector(session);

    expect(swept.timer).not.toBeNull();
    await timed.stop();
    expect(swept.timer).toBeNull();
    expect(timed.sessionStore).toBeNull();
  });
});
