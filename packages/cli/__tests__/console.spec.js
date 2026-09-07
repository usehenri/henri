const path = require('path');

const { CliError } = require('../scripts/errors');
const { cleanup, henri, linkAdapter, tmpdir } = require('./helpers');
const console_ = require('../scripts/console');

// The same minimal application the other command suites run against: a
// drizzle store on sqlite, a Task and a User
const fixture = path.join(__dirname, 'fixtures', 'seed-app');

/**
 * A booted instance with the stores given
 *
 * @param {object} stores `{ [name]: adapter }`
 * @returns {object} a henri look-alike
 */
const withStores = (stores) => ({ model: { stores } });

/** A store that can hold a sandbox, and remembers what was asked of it */
const supporting = (name, log) => ({
  adapterName: name,
  sandbox: async () => ({
    rollback: async () => {
      log.push(`rollback:${name}`);

      return true;
    },
    run: (fn) => {
      log.push(`run:${name}`);

      return fn();
    },
  }),
});

describe('henri console --sandbox', () => {
  describe('which stores can hold one', () => {
    test('a store whose adapter has no sandbox() is refused by name', async () => {
      const error = await console_
        .open(
          withStores({
            default: { adapterName: 'mongoose' },
            reporting: supporting('drizzle', []),
          })
        )
        .catch((thrown) => thrown);

      expect(error).toBeInstanceOf(CliError);
      expect(error.code).toBe('HENRI_STORE_SANDBOX_UNSUPPORTED');
      expect(error.message).toContain('default (mongoose)');
      // The refusal says what to do, and does not suggest a way to force it
      expect(error.hint).toContain('without --sandbox');
      expect(error.hint).not.toMatch(/--force|anyway/u);
    });

    test('an application with no store at all is refused too', async () => {
      const error = await console_
        .open(withStores({}))
        .catch((thrown) => thrown);

      expect(error).toBeInstanceOf(CliError);
      expect(error.code).toBe('HENRI_STORE_SANDBOX_UNSUPPORTED');
    });

    test('every store is opened, not only the default one', async () => {
      const log = [];
      const opened = await console_.open(
        withStores({
          default: supporting('drizzle', log),
          reporting: supporting('postgresql', log),
        })
      );

      expect(opened.map((entry) => entry.name)).toEqual([
        'default',
        'reporting',
      ]);

      console_.inside(opened, () => log.push('evaluated'));

      // Nested, so a model call on either store joins its own transaction
      expect(log).toEqual(['run:drizzle', 'run:postgresql', 'evaluated']);

      expect(await console_.rollback(opened)).toEqual([]);
      expect(log).toContain('rollback:drizzle');
      expect(log).toContain('rollback:postgresql');
    });

    test('one store that cannot open rolls back the ones that did', async () => {
      const log = [];
      const error = await console_
        .open(
          withStores({
            default: supporting('drizzle', log),
            reporting: {
              adapterName: 'drizzle',
              sandbox: async () => {
                throw new Error('the pool is exhausted');
              },
            },
          })
        )
        .catch((thrown) => thrown);

      expect(error).toBeInstanceOf(CliError);
      expect(error.message).toContain('the pool is exhausted');
      // Nothing is left holding a transaction open
      expect(log).toContain('rollback:drizzle');
    });

    test('a rollback that fails is reported rather than swallowed', async () => {
      const failing = [
        {
          adapter: { adapterName: 'drizzle' },
          handle: {
            rollback: async () => {
              throw new Error('connection lost');
            },
          },
          name: 'default',
        },
      ];

      expect(await console_.rollback(failing)).toEqual([
        'default: connection lost',
      ]);
    });

    test('without a sandbox, inside() just runs the function', () => {
      expect(console_.inside([], () => 'ran')).toBe('ran');
    });
  });

  describe('against a real application (drizzle, sqlite)', () => {
    let dir;
    let env;

    /**
     * Runs a command against the fixture
     *
     * @param {Array<string>} args The arguments
     * @param {object} [extra={}] Extra options for the spawn
     * @returns {object} The result of the command
     */
    const run = (args, extra = {}) =>
      henri(args, { cwd: fixture, env, timeout: 120000, ...extra });

    beforeAll(() => {
      linkAdapter(fixture, 'drizzle');
      dir = tmpdir('henri-console-');
      env = {
        ...process.env,
        DATABASE_URL: `file:${path.join(dir, 'app.db')}`,
        // A busy port is replaced by the next free one in development, so
        // this only keeps the console off whatever else answers on 3000
        HENRI_CONFIG__port: '34567',
      };
    });

    afterAll(() => {
      cleanup(dir);
    });

    test('what the session writes is gone when it leaves', () => {
      run(['runner', 'await Task.create({ name: "kept" })']);

      const session = run(['console', '--sandbox'], {
        input:
          'await Task.create({ name: "doomed" })\n' +
          '(await Task.find({})).length\n' +
          '.exit\n',
      });

      expect(session.status).toBe(0);
      expect(session.stdout).toContain('sandbox');
      // Inside the session both rows were there
      expect(session.stdout).toContain('2');
      expect(session.stdout).toContain('rolled back');

      const after = run(['runner', '--json', '(await Task.find({})).length']);

      expect(after.status).toBe(0);
      // Only the row written outside the sandbox survived
      expect(
        JSON.parse(
          after.stdout
            .split('\n')
            .filter((line) => !line.includes('✏'))
            .join('\n')
        ).value
      ).toBe(1);
    });

    test('the prompt says it is a sandbox', () => {
      const session = run(['console', '--sandbox'], { input: '.exit\n' });

      expect(session.status).toBe(0);
      expect(session.stdout).toContain('(sandbox)');
      expect(session.stdout).toContain('rolled back when you leave');
    });

    test('--help documents the flag without booting', () => {
      const { status, stdout } = run(['console', '--help']);

      expect(status).toBe(0);
      expect(stdout).toContain('--sandbox');
      expect(stdout).toContain('drizzle');
    });
  });
});
