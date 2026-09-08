const path = require('path');

const { install, uninstall, upgrade } = require('../src/store/schema');
const { keyOf, load, validate } = require('../src/definitions');
const { normalize } = require('../src/config');
const { storeFor } = require('../src/store');

const APP = path.join(__dirname, 'fixtures', 'app');

describe('configuration', () => {
  test('fills in the defaults', () => {
    const config = normalize();

    expect(config.queue).toBe('default');
    expect(config.queues).toEqual([]);
    expect(config.concurrency).toBe(5);
    expect(config.maxAttempts).toBe(5);
    expect(config.pollInterval).toBe(1000);
    expect(config.stuckAfter).toBe(300000);
    expect(config.keepCompleted).toBe(86400000);
    expect(config.install).toBe(true);
    expect(config.tables).toEqual({
      batches: 'henri_jobs_batches',
      jobs: 'henri_jobs',
      limits: 'henri_jobs_limits',
      schedules: 'henri_jobs_schedules',
    });
    expect(config.backoff).toEqual({
      base: 5000,
      factor: 4,
      jitter: 0.15,
      max: 3600000,
    });
  });

  test('reads the durations of the application', () => {
    const config = normalize({
      backoff: { base: '10s', max: '30m' },
      keepCompleted: '7d',
      pollInterval: '250ms',
      stuckAfter: '10m',
      table: 'queue',
      timeout: '2m',
    });

    expect(config.backoff.base).toBe(10000);
    expect(config.backoff.max).toBe(1800000);
    expect(config.keepCompleted).toBe(604800000);
    expect(config.pollInterval).toBe(250);
    expect(config.stuckAfter).toBe(600000);
    expect(config.timeout).toBe(120000);
    expect(config.tables).toEqual({
      batches: 'queue_batches',
      jobs: 'queue',
      limits: 'queue_limits',
      schedules: 'queue_schedules',
    });
  });

  test('reads the queues of a runner from a string or a list', () => {
    expect(normalize({ queues: 'a, b' }).queues).toEqual(['a', 'b']);
    expect(normalize({ queues: ['a', 'b'] }).queues).toEqual(['a', 'b']);
  });

  test('never polls faster than 50ms', () => {
    expect(normalize({ pollInterval: 1 }).pollInterval).toBe(50);
  });

  test('normalizes the recurring schedules, sorted by name', () => {
    const config = normalize({
      recurring: {
        nightly: { cron: '0 3 * * *', job: 'cleanup', queue: 'maintenance' },
        often: { every: '5m' },
      },
    });

    expect(config.recurring.map((entry) => entry.name)).toEqual([
      'nightly',
      'often',
    ]);
    expect(config.recurring[0].job).toBe('cleanup');
    expect(config.recurring[0].queue).toBe('maintenance');
    expect(config.recurring[0].spec).toBe('cron:0 3 * * *');
    // A schedule with no `job` runs the job of the same name
    expect(config.recurring[1].job).toBe('often');
    expect(config.recurring[1].every).toBe(300000);
    expect(config.recurring[1].spec).toBe('every:300000');
  });
});

describe('the configuration refuses', () => {
  test('a cron expression the runner could not read', () => {
    // It has to fail here: a runner that threw on its first tick would
    // claim nothing, ever, and only log one line a second
    expect(() =>
      normalize({ recurring: { broken: { cron: 'not a cron', job: 'ok' } } })
    ).toThrow('the recurring schedule "broken" is invalid');
  });

  test('a cron expression that can never come round', () => {
    expect(() =>
      normalize({ recurring: { never: { cron: '0 0 30 2 *', job: 'ok' } } })
    ).toThrow('can never come round');
  });

  test('an interval under a second', () => {
    expect(() =>
      normalize({ recurring: { hot: { every: '0s', job: 'ok' } } })
    ).toThrow('which is under a second');
  });

  test('a table name that is not a plain identifier', () => {
    expect(() => normalize({ table: 'jobs"; DROP TABLE users; --' })).toThrow(
      'invalid table name'
    );
    expect(() => normalize({ table: 'app.jobs' })).toThrow(
      'invalid table name'
    );
  });

  test('and keeps a schedule it can read', () => {
    const config = normalize({
      recurring: {
        leap: { cron: '0 0 29 2 *', job: 'ok' },
        nightly: { cron: '0 3 * * mon-fri', job: 'ok' },
      },
    });

    expect(config.recurring).toHaveLength(2);
  });
});

describe('definitions', () => {
  test('loads every file, filling in the defaults of the queue', () => {
    const definitions = load(path.join(APP, 'app', 'jobs'), normalize());

    expect(Object.keys(definitions).sort()).toEqual([
      'batch/finished',
      'batch/member',
      'boom',
      'counter',
      'exclusive',
      'mailers',
      'nested/deep',
      'ok',
      'scope',
      'slow',
      'tenanted',
    ]);
    expect(definitions['nested/deep'].queue).toBe('default');
    expect(definitions.slow.timeout).toBe(40);
    expect(definitions.ok.timeout).toBeNull();
  });

  test('is empty when there is no app/jobs', () => {
    expect(load(path.join(APP, 'nowhere'), normalize())).toEqual({});
  });

  describe('concurrency', () => {
    /**
     * A definition with a concurrency declaration
     *
     * @param {*} value What the file declared
     * @returns {?object} The normalized limit
     */
    const declare = (value) =>
      validate(
        'import',
        { concurrency: value, perform: () => null },
        normalize()
      ).concurrency;

    test('a number is a limit on the job itself', () => {
      expect(declare(1)).toMatchObject({
        group: 'import',
        key: null,
        limit: 1,
      });
      expect(declare({ limit: 4 })).toMatchObject({
        group: 'import',
        limit: 4,
      });
    });

    test('a job that declares none is unbounded', () => {
      expect(declare(undefined)).toBeNull();
      expect(declare(null)).toBeNull();
      expect(declare(false)).toBeNull();
    });

    test('the key is the group, and a value under it', () => {
      const named = declare({ key: 'tenantId', limit: 2 });
      const own = declare({ group: 'tenant-work', key: 'tenantId', limit: 2 });

      expect(
        keyOf({ concurrency: named, name: 'import' }, { tenantId: 7 })
      ).toBe('import:7');
      expect(keyOf({ concurrency: own, name: 'import' }, { tenantId: 7 })).toBe(
        'tenant-work:7'
      );
    });

    test('a key that resolves to nothing is the group itself', () => {
      const bound = declare({ key: 'tenantId', limit: 2 });
      const definition = { concurrency: bound, name: 'import' };

      // The bucket a job enqueued before the limit was declared falls into,
      // so the two do not each get a bound of their own
      expect(keyOf(definition, {})).toBe('import');
      expect(keyOf(definition, { tenantId: null })).toBe('import');
      expect(keyOf(definition, { tenantId: '' })).toBe('import');
    });

    test('a function reads whatever it likes of the arguments', () => {
      const bound = declare({ key: (args) => args.account.id, limit: 3 });

      expect(
        keyOf({ concurrency: bound, name: 'import' }, { account: { id: 'a' } })
      ).toBe('import:a');
    });

    test('refuses a limit it cannot honour', () => {
      for (const value of [0, -1, 1.5, 'three', { limit: 0 }, { limit: 'x' }]) {
        expect(() => declare(value)).toThrow(/concurrency limit/u);
      }

      expect(() => declare({ key: 12, limit: 1 })).toThrow(
        /neither the name of an argument nor a function/u
      );
      expect(() => declare({ group: '', limit: 1 })).toThrow(
        /group is not a name/u
      );
    });

    test('refuses a key it cannot store', () => {
      const definition = {
        concurrency: declare({ key: 'id', limit: 1 }),
        name: 'import',
      };

      expect(() => keyOf(definition, { id: 'x'.repeat(200) })).toThrow(
        /over the 190 that are stored/u
      );
      expect(() => keyOf(definition, { id: { a: 1 } })).toThrow(
        /has to be a value that names one bound/u
      );
      expect(() =>
        keyOf(
          {
            concurrency: declare({
              key: () => {
                throw new Error('no such tenant');
              },
              limit: 1,
            }),
            name: 'import',
          },
          {}
        )
      ).toThrow(/no such tenant/u);
    });
  });

  test('refuses a file that is not a job', () => {
    expect(() =>
      load(path.join(__dirname, 'fixtures', 'broken'), normalize())
    ).toThrow('does not export a perform(args, context) function');
  });
});

describe('the store backend', () => {
  test('refuses an adapter that can neither query nor speak MongoDB', () => {
    expect(() => storeFor({ adapterName: 'weird' }, {})).toThrow(
      'has neither query() nor a MongoDB connection'
    );
    expect(() => storeFor(null, {})).toThrow('no store to back the queue');
  });

  test('refuses a SQL dialect it does not know', () => {
    const adapter = {
      adapterName: 'oracle',
      dialect: { name: 'oracle', placeholder: () => '?' },
      query: () => null,
    };

    expect(() => storeFor(adapter, {})).toThrow(
      'the oracle dialect is not supported'
    );
  });
});

describe('starting', () => {
  test('says what to do when it cannot create the tables', async () => {
    const { Jobs } = require('../src/jobs');
    const { fakeHenri } = require('./helpers');
    const henri = fakeHenri({ cwd: APP });
    const adapter = {
      adapterName: 'sequelize',
      ensureConnector: () => ({ getDialect: () => 'postgres' }),
      query: async () => {
        throw new Error('permission denied for schema public');
      },
    };
    const error = await new Jobs(henri, { adapter, cwd: APP })
      .start()
      .catch((thrown) => thrown);

    expect(error.code).toBe('HENRI_JOB_UNSUPPORTED_STORE');
    expect(error.message).toContain('permission denied');
    expect(error.hint).toContain('henri jobs:install');
  });
});

describe('the claim statement', () => {
  const { SqlStore } = require('../src/store/sql');
  const tables = {
    batches: 'henri_jobs_batches',
    jobs: 'henri_jobs',
    limits: 'henri_jobs_limits',
    schedules: 'henri_jobs_schedules',
  };

  /**
   * The claim of a dialect, as it is sent to the database
   *
   * @param {string} dialect sqlite, postgres, mysql or mssql
   * @returns {object} `{ sql, params }`
   */
  const claim = (dialect) => {
    const store = new SqlStore(
      { query: () => null },
      { dialect, dollars: dialect === 'postgres', tables }
    );
    const built = store.claimStatement({
      limit: 5,
      now: 1000,
      queues: ['default', 'mailers'],
      runner: 'runner-1',
      token: 'a-token',
    });

    return { params: built.params, sql: store.prepare(built.sql) };
  };

  // MSSQL is the one dialect no server in CI exercises: the statement is
  // snapshotted so a change to it is at least visible in review
  test.each(['sqlite', 'postgres', 'mysql', 'mssql'])(
    'claims with one statement on %s',
    (dialect) => {
      expect(claim(dialect)).toMatchSnapshot();
    }
  );

  test('every dialect counts the attempt and stamps the token', () => {
    for (const dialect of ['sqlite', 'postgres', 'mysql', 'mssql']) {
      const { params, sql } = claim(dialect);

      expect(sql).toContain('attempts = attempts + 1');
      expect(sql).toContain(`state = 'running'`);
      expect(sql).toContain(`state = 'pending'`);
      // The claim is one statement, so it is its own transaction
      expect(sql.split(';')).toHaveLength(1);
      expect(params).toContain('a-token');
      expect(params).toContain('runner-1');
      expect(params).toContain(5);
    }
  });

  test('takes everything but the limited jobs on the unlimited pass', () => {
    const store = new SqlStore(
      { query: () => null },
      { dialect: 'postgres', dollars: true, tables }
    );
    const built = store.claimStatement({
      except: ['import', 'export'],
      limit: 4,
      now: 1,
      queues: [],
      runner: 'r',
      token: 't',
    });
    const { params } = built;
    const sql = store.prepare(built.sql);

    expect(sql).toContain('name NOT IN ($8, $9)');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).not.toContain('concurrency_key');
    expect(params).toContain('import');
  });

  test('takes one row of one key on the limited pass', () => {
    const store = new SqlStore(
      { query: () => null },
      { dialect: 'postgres', dollars: true, tables }
    );
    const built = store.claimStatement({
      key: { own: false, value: 'import:acme' },
      limit: 1,
      names: ['import'],
      now: 1,
      queues: [],
      runner: 'r',
      token: 't',
    });
    const { params } = built;
    const sql = store.prepare(built.sql);

    expect(sql).toContain('name IN ($8)');
    expect(sql).toContain('concurrency_key = $9');
    expect(sql).not.toContain('IS NULL');
    expect(params).toContain('import:acme');
  });

  test('the group bucket also takes the rows enqueued before the limit', () => {
    const store = new SqlStore(
      { query: () => null },
      { dialect: 'sqlite', tables }
    );
    const { sql } = store.claimStatement({
      key: { own: true, value: 'import' },
      limit: 1,
      names: ['import'],
      now: 1,
      queues: [],
      runner: 'r',
      token: 't',
    });

    expect(sql).toContain('(concurrency_key = ? OR concurrency_key IS NULL)');
  });

  test('every dialect claims one row per slot on the limited pass', () => {
    for (const dialect of ['sqlite', 'postgres', 'mysql', 'mssql']) {
      const store = new SqlStore(
        { query: () => null },
        { dialect, dollars: dialect === 'postgres', tables }
      );
      const { sql } = store.claimStatement({
        key: { own: false, value: 'import:acme' },
        limit: 1,
        names: ['import'],
        now: 1,
        queues: [],
        runner: 'r',
        token: 't',
      });

      // Still one statement, so still its own transaction
      expect(store.prepare(sql).split(';')).toHaveLength(1);
      expect(sql).toContain('concurrency_key');
      expect(sql).toContain(`state = 'pending'`);
    }
  });

  test('leaves the queue filter out when no queue was named', () => {
    const store = new SqlStore(
      { query: () => null },
      { dialect: 'postgres', dollars: true, tables }
    );
    const { sql } = store.claimStatement({
      limit: 1,
      now: 1,
      queues: [],
      runner: 'r',
      token: 't',
    });

    expect(sql).not.toContain('queue IN');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
  });
});

describe('the schema', () => {
  const tables = {
    batches: 'henri_jobs_batches',
    jobs: 'henri_jobs',
    limits: 'henri_jobs_limits',
    schedules: 'henri_jobs_schedules',
  };

  test.each(['sqlite', 'postgres', 'mysql', 'mssql'])(
    'writes the DDL of %s',
    (dialect) => {
      expect(install(dialect, tables).join(';\n')).toMatchSnapshot();
    }
  );

  test('drops the tables newest first', () => {
    expect(uninstall('postgres', tables)).toEqual([
      'DROP TABLE IF EXISTS "henri_jobs_batches"',
      'DROP TABLE IF EXISTS "henri_jobs_limits"',
      'DROP TABLE IF EXISTS "henri_jobs_schedules"',
      'DROP TABLE IF EXISTS "henri_jobs"',
    ]);
  });

  test('refuses a dialect it does not know', () => {
    expect(() => install('oracle', tables)).toThrow(
      'unsupported SQL dialect "oracle"'
    );

    expect(() => upgrade('oracle', tables)).toThrow(
      'unsupported SQL dialect "oracle"'
    );
  });

  test('adds the columns an older henri did not write', () => {
    for (const dialect of ['sqlite', 'postgres', 'mysql', 'mssql']) {
      const statements = upgrade(dialect, tables);

      // The three columns and the indexes they serve, and nothing else: an
      // upgrade touches an existing table, so it says exactly what it
      // changes. The batches table itself is a *new* table, so the guarded
      // CREATE of the install is all it needs
      expect(statements).toHaveLength(6);
      expect(statements[0]).toContain('concurrency_key');
      expect(statements[0]).toMatch(/ALTER TABLE/u);
      expect(statements[1]).toContain('batch_id');
      expect(statements[1]).toMatch(/ALTER TABLE/u);
      expect(statements[2]).toContain('tenant');
      expect(statements[2]).toMatch(/ALTER TABLE/u);
      expect(statements[3]).toContain('henri_jobs_limited');
      expect(statements[4]).toContain('henri_jobs_batch');
      expect(statements[5]).toContain('henri_jobs_tenant');

      // Every one of them is part of the install, so a fresh database and an
      // upgraded one end up with the same table
      expect(install(dialect, tables)).toEqual(
        expect.arrayContaining(statements)
      );
    }
  });

  test('the limited index is never inlined, so mysql upgrades too', () => {
    // MySQL declares its indexes inside the guarded CREATE TABLE, which does
    // nothing for a table that is already there
    const statements = install('mysql', tables);

    expect(statements.join('\n')).not.toContain('KEY `henri_jobs_limited`');
    expect(statements).toContain(
      'CREATE INDEX `henri_jobs_limited` ON `henri_jobs` (state, concurrency_key, run_at)'
    );
  });

  test('refuses a table name that is not a plain identifier', () => {
    expect(() =>
      install('postgres', {
        batches: 'b',
        jobs: 'jobs"; DROP TABLE users; --',
        limits: 'l',
        schedules: 's',
      })
    ).toThrow('invalid table name');
  });
});
