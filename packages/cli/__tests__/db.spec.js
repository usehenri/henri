const fs = require('fs');
const path = require('path');

const { CliError } = require('../scripts/errors');
const { migrations, seed, sow, status } = require('../scripts/db');
const { cleanup, exists, henri, scaffold, tmpdir } = require('./helpers');

// A minimal application on a drizzle sqlite store: seeding it is a full
// boot, without a database server to start
const fixture = path.join(__dirname, 'fixtures', 'seed-app');

// The demo application of the workspace, on the disk (mongoose) adapter:
// db:seed must work on every adapter, not only on the drizzle one
const demo = path.resolve(__dirname, '../../demo');

/**
 * Core resolves `@usehenri/drizzle` from the application directory: link
 * the workspace package into the fixture's node_modules (ignored by git)
 *
 * @returns {void}
 */
const linkAdapter = () => {
  const target = path.join(fixture, 'node_modules', '@usehenri', 'drizzle');

  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (!fs.existsSync(target)) {
    fs.symlinkSync(
      path.resolve(__dirname, '../../drizzle'),
      target,
      'junction'
    );
  }
};

describe('henri db', () => {
  describe('usage', () => {
    let dir;
    let app;

    beforeAll(() => {
      ({ app, dir } = scaffold(['--no-git']));
    });

    afterAll(() => {
      cleanup(dir);
    });

    test('henri new scaffolds db/seeds.js', () => {
      expect(exists(app, 'db/seeds.js')).toBe(true);

      const code = fs.readFileSync(path.join(app, 'db/seeds.js'), 'utf8');

      expect(code).toContain('module.exports');
      expect(code).toContain('henri db:seed');
      // The documented idempotent idiom
      expect(code).toContain('findOne');
      expect(code).toContain('create');
    });

    test('lists seed among the commands', () => {
      const { status, stderr } = henri(['db', '--json'], { cwd: app });
      const { error } = JSON.parse(stderr);

      expect(status).toBe(2);
      expect(error).toMatchObject({
        code: 'HENRI_CLI_USAGE',
        command: 'db',
        exitCode: 2,
        message: 'Missing db command',
      });
      expect(error.hint).toContain('seed');
    });

    test('refuses an unknown db command', () => {
      const { status, stderr } = henri(['db:nope', '--json'], { cwd: app });

      expect(status).toBe(2);
      expect(JSON.parse(stderr).error.message).toBe(
        'Unknown db command "nope"'
      );
    });

    test('says where the seed file should be, without booting', () => {
      fs.rmSync(path.join(app, 'db/seeds.js'));

      const { status, stderr } = henri(['db:seed', '--json'], { cwd: app });
      const { error } = JSON.parse(stderr);

      expect(status).toBe(2);
      expect(error.code).toBe('HENRI_CLI_USAGE');
      expect(error.message).toBe('No seed file at db/seeds.js');
      expect(error.hint).toContain('db/seeds.js');
    });
  });

  describe('the schema of a store', () => {
    /**
     * A booted henri stand-in holding one store
     *
     * @param {object} store The store adapter
     * @returns {object} The instance
     */
    const booted = (store) => ({
      model: { stores: { default: store } },
      stop: async () => undefined,
    });

    test('db:status reports the migrations of a drizzle store', async () => {
      const store = {
        adapterName: 'drizzle',
        dialect: { name: 'postgres' },
        migrations: {
          status: async () => ({
            applied: ['0000_init'],
            folder: '/app/db/migrations',
            pending: ['0001_priority'],
          }),
        },
        name: 'default',
      };

      expect(await status(store, {})).toEqual({
        applied: ['0000_init'],
        command: 'status',
        dialect: 'postgres',
        folder: '/app/db/migrations',
        ok: true,
        pending: ['0001_priority'],
        schema: 'migrations',
        store: 'default',
      });
    });

    test('db:status reports the drift of a Sequelize store', async () => {
      const difference = {
        column: 'priority',
        description: 'tasks.priority: the column is missing',
        index: null,
        kind: 'column-missing',
        model: 'Task',
        statement: 'ALTER TABLE "tasks" ADD COLUMN "priority" INTEGER;',
        table: 'tasks',
      };
      const store = {
        adapterName: 'postgresql',
        drift: async () => ({
          clean: false,
          dialect: 'postgres',
          differences: [difference],
          statements: [difference.statement],
          store: 'default',
          unsupported: [],
        }),
        name: 'default',
      };

      expect(await status(store, { sql: true })).toEqual({
        clean: false,
        command: 'status',
        dialect: 'postgres',
        differences: [difference],
        ok: true,
        schema: 'models',
        sql: true,
        statements: [difference.statement],
        store: 'default',
        unsupported: [],
      });
    });

    test('db:status has nothing to compare on a store with no schema', async () => {
      const store = { adapterName: 'disk', name: 'default' };

      await expect(status(store, {})).rejects.toMatchObject({
        code: 'HENRI_CLI_MIGRATIONS_UNSUPPORTED',
      });
    });

    test('the migration commands say what a Sequelize store can do instead', async () => {
      const store = {
        adapterName: 'postgresql',
        drift: async () => ({ clean: true }),
        name: 'default',
      };

      const error = await migrations(booted(store), 'default').catch(
        (thrown) => thrown
      );

      expect(error).toBeInstanceOf(CliError);
      expect(error.code).toBe('HENRI_CLI_MIGRATIONS_UNSUPPORTED');
      expect(error.message).toContain('has no migrations');
      expect(error.hint).toContain('henri db:status --sql');
      expect(error.hint).toContain('drizzle');
    });

    test('and points a store that has neither at the drizzle adapter', async () => {
      const store = { adapterName: 'mongoose', name: 'default' };
      const error = await migrations(booted(store), 'default').catch(
        (thrown) => thrown
      );

      expect(error.code).toBe('HENRI_CLI_MIGRATIONS_UNSUPPORTED');
      expect(error.hint).toContain('@usehenri/drizzle');
    });
  });

  describe('the seed runner', () => {
    let dir;

    beforeEach(() => {
      dir = tmpdir('henri-seeds-');
    });

    afterEach(() => {
      cleanup(dir);
    });

    /**
     * Writes a seed file and returns its path
     *
     * @param {string} code The module source
     * @returns {string} The absolute path
     */
    const write = (code) => {
      const file = path.join(dir, `seeds-${Math.random()}.js`);

      fs.writeFileSync(file, code);

      return file;
    };

    test('awaits a function and hands it the henri instance', async () => {
      const instance = { marker: 'henri' };
      const file = write(
        'module.exports = async (henri) => { global.__seeded = henri.marker; };'
      );

      await sow(instance, file);

      expect(global.__seeded).toBe('henri');
      delete global.__seeded;
    });

    test('awaits anything else the file exports', async () => {
      const file = write(
        'module.exports = new Promise((resolve) => { global.__awaited = true; resolve(); });'
      );

      await sow({}, file);

      expect(global.__awaited).toBe(true);
      delete global.__awaited;
    });

    test('turns a seed failure into a FAILED error with a hint', async () => {
      const file = write(
        'module.exports = async () => { throw new Error("duplicate key"); };'
      );
      const error = await sow({}, file).catch((thrown) => thrown);

      expect(error).toBeInstanceOf(CliError);
      expect(error.code).toBe('HENRI_CLI_FAILED');
      expect(error.exitCode).toBe(1);
      expect(error.message).toBe('Seeding failed: duplicate key');
      expect(error.hint).toContain('idempotent');
    });

    test('turns a broken seed file into a FAILED error', async () => {
      const file = write('module.exports = = ;');
      const error = await sow({}, file).catch((thrown) => thrown);

      expect(error).toBeInstanceOf(CliError);
      expect(error.code).toBe('HENRI_CLI_FAILED');
      expect(error.hint).toContain('seed file');
    });

    test('refuses a missing file before booting anything', async () => {
      const error = await seed({ file: 'db/nowhere.js' }).catch(
        (thrown) => thrown
      );

      expect(error).toBeInstanceOf(CliError);
      expect(error.code).toBe('HENRI_CLI_USAGE');
      expect(error.message).toBe('No seed file at db/nowhere.js');
    });
  });

  describe('seeding a real application', () => {
    let dir;
    let report;

    beforeAll(() => {
      linkAdapter();
      dir = tmpdir('henri-seed-run-');
      report = path.join(dir, 'report.json');
    });

    afterAll(() => {
      cleanup(dir);
    });

    test('runs db/seeds.js with the models loaded (drizzle, sqlite)', () => {
      const { status, stdout } = henri(['db:seed', '--json'], {
        cwd: fixture,
        env: { ...process.env, HENRI_SEED_REPORT: report },
        timeout: 120000,
      });

      expect(status).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({
        command: 'seed',
        file: path.join('db', 'seeds.js'),
        ok: true,
      });
      // The seed file runs its find-or-create twice: one row, no duplicate,
      // and createdAt is there without the model asking for it
      expect(JSON.parse(fs.readFileSync(report, 'utf8'))).toEqual({
        count: 1,
        henri: true,
        timestamps: true,
      });
    });

    test('prints a human readable line without --json', () => {
      const { status, stdout } = henri(['db:seed'], {
        cwd: fixture,
        timeout: 120000,
      });

      expect(status).toBe(0);
      expect(stdout).toContain(`Seeded from ${path.join('db', 'seeds.js')}`);
    });

    test('seeds the mongoose adapter too', () => {
      const file = path.join(dir, 'demo-seeds.js');

      fs.writeFileSync(
        file,
        `const fs = require('fs');

module.exports = async () => {
  const existing = await Artwork.findOne({ title: 'Seeded' });

  if (!existing) {
    await Artwork.create({ title: 'Seeded', year: 2026 });
  }

  fs.writeFileSync(
    ${JSON.stringify(report)},
    JSON.stringify({ count: await Artwork.countDocuments() })
  );
};
`
      );

      const { status, stdout } = henri(
        ['db:seed', `--file=${file}`, '--json'],
        {
          cwd: demo,
          env: { ...process.env, NODE_ENV: 'test' },
          timeout: 120000,
        }
      );

      expect(status).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({ command: 'seed', ok: true });
      expect(JSON.parse(fs.readFileSync(report, 'utf8')).count).toBe(1);
    });
  }, 180000);
});
