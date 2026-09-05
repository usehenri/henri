const fs = require('fs');
const os = require('os');
const path = require('path');

const Henri = require('../henri');
const BaseModule = require('../base/module');

/**
 * A module built from a bag of properties
 */
class Mod extends BaseModule {
  constructor(opts) {
    super();
    Object.assign(this, opts);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('lifecycle', () => {
  describe('init', () => {
    test('modules.init rejects with the original plain Error', async () => {
      const henri = new Henri({ runlevel: 1 });
      const boom = new Error(
        'There is no default store and artwork is missing one'
      );

      henri.modules.add(
        new Mod({
          init: async () => {
            throw boom;
          },
          name: 'broken',
          runlevel: 1,
        })
      );

      await expect(henri.modules.init()).rejects.toBe(boom);
      expect(henri.modules.initialized).toBe(false);
    });

    test('henri.init rethrows with the module error as cause', async () => {
      const henri = new Henri({ runlevel: 0 });
      const boom = new Error('bad config');

      henri.modules.init = async () => {
        throw boom;
      };

      await expect(henri.init()).rejects.toMatchObject({
        cause: boom,
        message: expect.stringContaining('bad config'),
      });
    });

    test('init rejects when no module is registered', async () => {
      const henri = new Henri({ runlevel: 0 });

      await expect(henri.modules.init()).rejects.toThrow(
        /no modules loaded before init/
      );
    });

    test('pen.fatal returns an Error the caller can throw', () => {
      const henri = new Henri({ runlevel: 0 });
      const error = henri.pen.fatal('test', 'something broke', 'details');

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(/something broke/);
      expect(error.message).toMatch(/details/);
      expect(error.module).toBe('test');

      const original = new Error('original');

      expect(henri.pen.fatal('test', original)).toBe(original);
    });
  });

  describe('stop', () => {
    test('continues past a failing module and returns the errors', async () => {
      const henri = new Henri({ runlevel: 2 });
      const order = [];

      henri.modules.add(
        new Mod({
          init: async () => 'later',
          name: 'later',
          runlevel: 2,
          stop: async () => {
            order.push('later');
            throw new Error('later failed to stop');
          },
        })
      );
      henri.modules.add(
        new Mod({
          init: async () => 'earlier',
          name: 'earlier',
          runlevel: 1,
          stop: async () => {
            order.push('earlier');

            return 'earlier';
          },
        })
      );

      await henri.modules.init();

      const errors = await henri.stop();

      // Reverse runlevel order, and the failure did not stop the loop
      expect(order).toEqual(['later', 'earlier']);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('later failed to stop');
      expect(errors[0].module).toBe('later');
    });

    test('returns an empty array when everything stops', async () => {
      const henri = new Henri({ runlevel: 1 });

      henri.modules.add(
        new Mod({
          init: async () => 'quiet',
          name: 'quiet',
          runlevel: 1,
          stop: async () => 'quiet',
        })
      );

      await henri.modules.init();

      await expect(henri.stop()).resolves.toEqual([]);
    });
  });

  describe('reload', () => {
    /**
     * A henri with one slow reloadable module
     *
     * @param {number} delay reload duration in ms
     * @returns {{henri: Henri, calls: function, maxConcurrent: function}} helpers
     */
    const slowHenri = async (delay = 20) => {
      const henri = new Henri({ runlevel: 1 });
      let calls = 0;
      let running = 0;
      let max = 0;

      henri.modules.add(
        new Mod({
          init: async () => 'slow',
          name: 'slow',
          reload: async () => {
            calls++;
            running++;
            max = Math.max(max, running);
            await sleep(delay);
            running--;

            return 'slow';
          },
          reloadable: true,
          runlevel: 1,
        })
      );

      await henri.modules.init();

      return { calls: () => calls, henri, maxConcurrent: () => max };
    };

    test('two concurrent reloads run once and queue exactly one more', async () => {
      const { henri, calls, maxConcurrent } = await slowHenri();

      const first = henri.reload();
      const second = henri.reload();
      const third = henri.reload();

      // The second and third callers share the single queued run
      expect(second).toBe(third);
      expect(first).not.toBe(second);

      await expect(Promise.all([first, second, third])).resolves.toEqual([
        true,
        true,
        true,
      ]);

      expect(calls()).toBe(2);
      expect(maxConcurrent()).toBe(1);

      // Nothing left in flight: a new call starts a fresh run
      await expect(henri.reload()).resolves.toBe(true);
      expect(calls()).toBe(3);
    });

    test('rejects with the module error and still runs the queued reload', async () => {
      const henri = new Henri({ runlevel: 1 });
      let calls = 0;

      henri.modules.add(
        new Mod({
          init: async () => 'flaky',
          name: 'flaky',
          reload: async () => {
            calls++;
            await sleep(5);
            if (calls === 1) {
              throw new Error('first reload failed');
            }

            return 'flaky';
          },
          reloadable: true,
          runlevel: 1,
        })
      );

      await henri.modules.init();

      const first = henri.reload();
      const second = henri.reload();

      await expect(first).rejects.toThrow('first reload failed');
      await expect(second).resolves.toBe(true);
      expect(calls).toBe(2);
    });

    test('returns false before init', async () => {
      const henri = new Henri({ runlevel: 1 });

      await expect(henri.reload()).resolves.toBe(false);
    });

    test('evicts only the application files outside node_modules', () => {
      const henri = new Henri({ runlevel: 1 });
      const cwd = path.resolve(henri.cwd());
      const app = path.join(cwd, 'app', 'models', 'Fake.js');
      const dep = path.join(cwd, 'node_modules', 'dep', 'index.js');
      const elsewhere = path.join(path.dirname(cwd), 'core', 'src', 'x.js');
      const cache = {
        [app]: { id: app },
        [dep]: { id: dep },
        [elsewhere]: { id: elsewhere },
      };

      expect(henri.modules.evictCache(cache)).toBe(1);

      expect(cache[app]).toBeUndefined();
      expect(cache[dep]).toBeDefined();
      expect(cache[elsewhere]).toBeDefined();
    });
  });

  describe('application check', () => {
    test('refuses to start outside of an application', () => {
      const henri = new Henri({ runlevel: 0 });
      const previousCwd = process.cwd();
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-empty-'));

      expect(henri.checkApplication()).toBe(true);

      process.chdir(empty);

      try {
        expect(() => henri.checkApplication()).toThrow(
          /not a henri application/
        );
      } finally {
        process.chdir(previousCwd);
        fs.rmSync(empty, { force: true, recursive: true });
      }
    });
  });
});
