const fs = require('fs');
const path = require('path');

const { CliError } = require('../scripts/errors');
const {
  dumps,
  migrations,
  run,
  schema,
  seed,
  sow,
  status,
} = require('../scripts/db');
const {
  cleanup,
  exists,
  henri,
  linkAdapter,
  scaffold,
  tmpdir,
} = require('./helpers');

// A minimal application on a drizzle sqlite store: seeding it is a full
// boot, without a database server to start
const fixture = path.join(__dirname, 'fixtures', 'seed-app');

// The demo application of the workspace, on the disk (mongoose) adapter:
// db:seed must work on every adapter, not only on the drizzle one
const demo = path.resolve(__dirname, '../../demo');

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

    test('lists rollback and the schema commands', () => {
      const { stderr } = henri(['db', '--json'], { cwd: app });
      const { error } = JSON.parse(stderr);

      expect(error.hint).toContain('rollback');
      expect(error.hint).toContain('schema:dump');
      expect(error.hint).toContain('schema:load');
    });

    test('refuses "schema" without dump or load', () => {
      const { status, stderr } = henri(['db', 'schema', '--json'], {
        cwd: app,
      });

      expect(status).toBe(2);
      expect(JSON.parse(stderr).error.message).toBe(
        'Unknown db command "schema"'
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

    test('db:rollback reports what it undid', async () => {
      const calls = [];
      const store = {
        adapterName: 'drizzle',
        dialect: { name: 'sqlite' },
        migrations: {
          rollback: async (options) => {
            calls.push(options);

            return {
              applied: true,
              plan: [
                {
                  removes: [
                    {
                      column: 'priority',
                      kind: 'column',
                      rows: 0,
                      table: 'tasks',
                    },
                  ],
                  statements: ['ALTER TABLE `tasks` DROP COLUMN `priority`;'],
                  tag: '0001_priority',
                  when: 1,
                },
              ],
              rolledBack: ['0001_priority'],
            };
          },
        },
        name: 'default',
      };

      expect(await run('rollback', store, { step: 2 })).toMatchObject({
        command: 'rollback',
        ok: true,
        rolledBack: ['0001_priority'],
      });
      expect(calls).toEqual([{ force: false, steps: 2 }]);

      // A step that is not a number falls back to one
      await run('rollback', store, { step: 'lots' });
      expect(calls[1]).toEqual({ force: false, steps: 1 });
    });

    test('db:rollback that refuses is not ok', async () => {
      const store = {
        adapterName: 'drizzle',
        dialect: { name: 'sqlite' },
        migrations: {
          rollback: async () => ({
            applied: false,
            plan: [
              {
                removes: [
                  { column: null, kind: 'table', rows: 12, table: 'tasks' },
                ],
                statements: ['DROP TABLE `tasks`;'],
                tag: '0000_init',
                when: 1,
              },
            ],
            rolledBack: [],
          }),
        },
        name: 'default',
      };

      expect(await run('rollback', store, {})).toMatchObject({
        ok: false,
        rolledBack: [],
      });
    });

    test('db:schema:dump and db:schema:load describe what they did', async () => {
      const loads = [];
      const store = {
        adapterName: 'drizzle',
        config: {},
        dialect: { name: 'sqlite' },
        dump: {
          load: async () => {
            loads.push(true);

            return {
              at: '0000_init',
              file: '/app/db/schema.sql',
              recorded: ['0000_init'],
              statements: 3,
            };
          },
          write: async () => ({
            at: '0000_init',
            file: '/app/db/schema.sql',
            statements: 3,
            tables: ['tasks'],
          }),
        },
        name: 'default',
      };

      expect(await schema('schema:dump', store, {})).toEqual({
        at: '0000_init',
        command: 'schema:dump',
        dialect: 'sqlite',
        file: '/app/db/schema.sql',
        ok: true,
        statements: 3,
        store: 'default',
        tables: ['tasks'],
      });

      expect(await schema('schema:load', store, {})).toEqual({
        at: '0000_init',
        command: 'schema:load',
        dialect: 'sqlite',
        file: '/app/db/schema.sql',
        ok: true,
        recorded: ['0000_init'],
        statements: 3,
        store: 'default',
      });
      expect(loads).toHaveLength(1);
    });

    test('--file moves the dump for this run', async () => {
      const store = {
        adapterName: 'drizzle',
        config: {},
        dialect: { name: 'sqlite' },
        dump: {
          write: async () => ({
            at: null,
            file: '/elsewhere.sql',
            statements: 0,
            tables: [],
          }),
        },
        name: 'default',
      };

      await schema('schema:dump', store, { file: '/elsewhere.sql' });
      expect(store.config.schemaFile).toBe('/elsewhere.sql');
    });

    test('a store without a dump says so, and points somewhere', async () => {
      const sequelize = booted({
        adapterName: 'mssql',
        drift: async () => ({}),
        name: 'default',
      });

      await expect(dumps(sequelize, 'default')).rejects.toMatchObject({
        code: 'HENRI_CLI_MIGRATIONS_UNSUPPORTED',
        exitCode: 1,
      });

      const mongo = booted({ adapterName: 'mongoose', name: 'default' });
      const refused = await dumps(mongo, 'default').catch((error) => error);

      expect(refused.code).toBe('HENRI_CLI_MIGRATIONS_UNSUPPORTED');
      expect(refused.message).toContain('no schema to dump');
      expect(refused.hint).toContain('MongoDB has no schema');
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
      linkAdapter(fixture, 'drizzle');
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

  // The whole migration story through the binary: the JSON shape and the
  // exit codes are the contract, so they are exercised where a person or a
  // script would see them
  describe('the migration story, end to end', () => {
    let dir;
    let app;
    let store;

    /**
     * Runs the binary in the copied fixture, on its own sqlite file
     *
     * @param {Array<string>} args The command
     * @returns {object} The spawn result
     */
    const cli = (args) =>
      henri(args, {
        cwd: app,
        env: {
          ...process.env,
          HENRI_CONFIG__stores__default__url: store,
          NODE_ENV: 'dev',
        },
        timeout: 120000,
      });

    /**
     * The last JSON object of an output, whatever the boot logged before it
     * and whatever it printed in between (a refused command prints its
     * result and then its error)
     *
     * @param {string} output stdout or stderr
     * @returns {object} The object
     */
    const json = (output) => {
      // A top-level `{` is the only one at column zero: the pretty printed
      // result indents everything inside it
      const at = output.lastIndexOf('\n{');

      return JSON.parse(output.slice(at < 0 ? output.indexOf('{') : at + 1));
    };

    beforeAll(() => {
      dir = tmpdir('henri-db-story-');
      app = path.join(dir, 'app');
      store = `file:${path.join(dir, 'app.db')}`;
      fs.cpSync(fixture, app, { recursive: true });
      // Outside the workspace the fixture resolves nothing on its own: its
      // app module requires @usehenri/core/module
      linkAdapter(app, 'core', 'drizzle');
    });

    afterAll(() => {
      cleanup(dir);
    });

    test('generate, migrate, dump, rollback, load', () => {
      expect(
        json(cli(['db:generate', '--name=init', '--json']).stdout)
      ).toMatchObject({
        command: 'generate',
        ok: true,
      });
      expect(json(cli(['db:migrate', '--json']).stdout)).toMatchObject({
        applied: ['0000_init'],
        command: 'migrate',
      });

      const dumped = json(cli(['db:schema:dump', '--json']).stdout);

      expect(dumped).toMatchObject({
        at: '0000_init',
        command: 'schema:dump',
        ok: true,
      });
      // The command is handed a real path, and /var is a link to /private
      expect(dumped.file.endsWith(path.join('app', 'db', 'schema.sql'))).toBe(
        true
      );
      expect(dumped.tables).toContain('tasks');

      const text = fs.readFileSync(dumped.file, 'utf8');

      expect(text).toContain('-- migration: 0000_init');
      // Written the same way twice
      cli(['db:schema:dump']);
      expect(fs.readFileSync(dumped.file, 'utf8')).toBe(text);

      // Nothing was written, so undoing the migration loses nothing
      const rolled = cli(['db:rollback', '--json']);

      expect(rolled.status).toBe(0);
      expect(json(rolled.stdout)).toMatchObject({
        command: 'rollback',
        ok: true,
        rolledBack: ['0000_init'],
      });
      expect(json(cli(['db:status', '--json']).stdout)).toMatchObject({
        applied: [],
        pending: ['0000_init'],
      });

      // And the dump puts it all back, migration history included
      const loaded = cli(['db:schema:load', '--json']);

      expect(loaded.status).toBe(0);
      expect(json(loaded.stdout)).toMatchObject({
        at: '0000_init',
        command: 'schema:load',
        ok: true,
        recorded: ['0000_init'],
      });
      expect(json(cli(['db:status', '--json']).stdout)).toMatchObject({
        applied: ['0000_init'],
        pending: [],
      });
    }, 180000);

    test('a rollback that would lose rows exits 1 with its code', () => {
      cli(['db:seed']);

      const refused = cli(['db:rollback', '--json']);

      expect(refused.status).toBe(1);
      expect(json(refused.stderr).error).toMatchObject({
        code: 'HENRI_MIGRATION_DESTRUCTIVE',
        command: 'db',
        exitCode: 1,
      });
      // Nothing ran
      expect(json(cli(['db:status', '--json']).stdout)).toMatchObject({
        applied: ['0000_init'],
      });

      const forced = cli(['db:rollback', '--force', '--json']);

      expect(forced.status).toBe(0);
      expect(json(forced.stdout).rolledBack).toEqual(['0000_init']);
    }, 180000);

    test('a schema load onto its own tables exits 1 with its code', () => {
      cli(['db:schema:load']);

      const refused = cli(['db:schema:load', '--json']);

      expect(refused.status).toBe(1);
      expect(json(refused.stderr).error).toMatchObject({
        code: 'HENRI_MIGRATION_DATABASE_NOT_EMPTY',
        exitCode: 1,
      });
    }, 180000);

    test('the text output says what happened', () => {
      const { status, stdout } = cli(['db:rollback', '--force']);

      expect(status).toBe(0);
      expect(stdout).toContain('0000_init');
      expect(stdout).toContain('pending again');

      const dumped = cli(['db:schema:dump']);

      expect(dumped.stdout).toContain('Taken at no migration');
    }, 180000);
  });
});
