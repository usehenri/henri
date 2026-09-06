const Lockout = require('../base/lockout');
const { lockoutConfig } = require('../base/lockout');

/**
 * Waits
 *
 * @param {number} ms milliseconds
 * @returns {Promise<void>} nothing
 */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('lockoutConfig', () => {
  test('defaults to ten failures per fifteen minutes', () => {
    expect(lockoutConfig(undefined)).toEqual({
      max: 10,
      store: null,
      windowMs: 15 * 60 * 1000,
    });
  });

  test('is configurable and can be turned off', () => {
    expect(lockoutConfig({ max: 3, windowMs: 1000 })).toMatchObject({
      max: 3,
      windowMs: 1000,
    });
    expect(lockoutConfig(false)).toBeNull();
    expect(() => lockoutConfig('yes')).toThrow(TypeError);
  });

  test('ignores nonsense rather than disabling itself', () => {
    expect(lockoutConfig({ max: -1, windowMs: 0 })).toMatchObject({
      max: 10,
      windowMs: 15 * 60 * 1000,
    });
  });
});

describe('lockout', () => {
  let lockout;

  afterEach(() => {
    lockout && lockout.shutdown();
    lockout = null;
  });

  test('locks an account after the threshold and releases it after the window', async () => {
    lockout = new Lockout({ max: 3, secret: 'shh', windowMs: 200 });

    await expect(lockout.check('ada@usehenri.io')).resolves.toMatchObject({
      locked: false,
    });

    expect((await lockout.fail('ada@usehenri.io')).locked).toBe(false);
    expect((await lockout.fail('ada@usehenri.io')).locked).toBe(false);

    const third = await lockout.fail('ada@usehenri.io');

    expect(third.locked).toBe(true);
    expect(third.retryAfter).toBeGreaterThan(0);
    expect((await lockout.check('ada@usehenri.io')).locked).toBe(true);

    await wait(250);

    expect((await lockout.check('ada@usehenri.io')).locked).toBe(false);
  });

  test('a successful sign-in clears the count', async () => {
    lockout = new Lockout({ max: 2, secret: 'shh', windowMs: 10000 });

    await lockout.fail('grace@usehenri.io');
    await lockout.succeed('grace@usehenri.io');
    await lockout.fail('grace@usehenri.io');

    expect((await lockout.check('grace@usehenri.io')).locked).toBe(false);
  });

  test('counts each account separately', async () => {
    lockout = new Lockout({ max: 2, secret: 'shh', windowMs: 10000 });

    await lockout.fail('ada@usehenri.io');
    await lockout.fail('ada@usehenri.io');

    expect((await lockout.check('ada@usehenri.io')).locked).toBe(true);
    expect((await lockout.check('grace@usehenri.io')).locked).toBe(false);
  });

  test('the store never holds the address, and the key depends on the secret', () => {
    const one = new Lockout({ max: 2, secret: 'one', windowMs: 1000 });
    const two = new Lockout({ max: 2, secret: 'two', windowMs: 1000 });

    expect(one.key('ada@usehenri.io')).not.toContain('ada');
    expect(one.key('ada@usehenri.io')).not.toBe(two.key('ada@usehenri.io'));
    expect(one.key('ada@usehenri.io')).toBe(one.key('ada@usehenri.io'));

    one.shutdown();
    two.shutdown();
  });

  test('takes a shared store, which is what makes it real across processes', async () => {
    const calls = [];
    const shared = {
      get: async (key) => {
        calls.push(['get', key]);

        return { resetTime: new Date(Date.now() + 1000), totalHits: 9 };
      },
      increment: async (key) => {
        calls.push(['increment', key]);

        return { resetTime: new Date(Date.now() + 1000), totalHits: 10 };
      },
      init: () => calls.push(['init']),
      resetKey: async (key) => calls.push(['resetKey', key]),
    };

    lockout = new Lockout({
      max: 10,
      secret: 'shh',
      store: shared,
      windowMs: 1000,
    });

    expect((await lockout.check('ada@usehenri.io')).locked).toBe(false);
    expect((await lockout.fail('ada@usehenri.io')).locked).toBe(true);
    await lockout.succeed('ada@usehenri.io');

    expect(calls.map(([name]) => name)).toEqual([
      'init',
      'get',
      'increment',
      'resetKey',
    ]);
  });
});
