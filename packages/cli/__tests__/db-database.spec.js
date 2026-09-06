const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DIALECTS,
  connection,
  databaseOf,
  describe: describeStore,
  dialectOf,
  sqliteFile,
} = require('../scripts/db-database');
const { CliError } = require('../scripts/errors');
const { henri } = require('./helpers');

// A minimal application on a drizzle sqlite store, the same fixture the
// seed tests boot: its url is overridden per test so the database is a file
const fixture = path.join(__dirname, 'fixtures', 'seed-app');

/**
 * The JSON of a --json run, which the boot log shares stderr with
 *
 * @param {string} output stdout or stderr
 * @returns {object} the parsed object
 */
const json = (output) => {
  const line = output
    .split('\n')
    .reverse()
    .find((entry) => entry.trim().startsWith('{'));

  return JSON.parse(output.slice(output.indexOf(line)));
};

/**
 * Runs a db command against the fixture with the sqlite store pointed at a
 * file of its own
 *
 * @param {Array<string>} args The command and its flags
 * @param {string} file Where the sqlite database should live
 * @returns {object} The spawn result
 */
const run = (args, file) =>
  henri(args, {
    cwd: fixture,
    env: {
      ...process.env,
      HENRI_CONFIG__stores__default__url: file,
      NODE_ENV: 'dev',
    },
  });

describe('the database behind a store', () => {
  test('reads a url and a set of fields the same way', () => {
    expect(
      connection({ url: 'postgres://someone:s3cret@db.example.com:6000/shop' })
    ).toEqual({
      database: 'shop',
      host: 'db.example.com',
      password: 's3cret',
      port: 6000,
      user: 'someone',
    });

    expect(
      connection({ database: 'shop', host: 'db.example.com', port: '6000' })
    ).toMatchObject({ database: 'shop', host: 'db.example.com', port: 6000 });
  });

  test('names the dialect from the dialect, the url or the adapter', () => {
    expect(dialectOf({ dialect: 'postgresql' }, 'default')).toBe('postgres');
    expect(dialectOf({ url: 'mysql://root@127.0.0.1/shop' }, 'default')).toBe(
      'mysql'
    );
    expect(dialectOf({ adapter: 'disk' }, 'default')).toBe('mongodb');
    expect(() => dialectOf({ adapter: 'cassandra' }, 'default')).toThrow(
      CliError
    );
  });

  test('refuses a database name that is not an identifier', () => {
    expect(databaseOf({ url: 'postgres://h@127.0.0.1/shop' }, 'default')).toBe(
      'shop'
    );
    // The name is an identifier, so it is quoted rather than bound: it has
    // to be checked before it reaches a statement
    expect(() =>
      databaseOf({ url: 'postgres://h@127.0.0.1/shop%22%3B%20drop' }, 'x')
    ).toThrow(CliError);
    expect(() => databaseOf({ url: 'postgres://h@127.0.0.1/' }, 'x')).toThrow(
      CliError
    );
  });

  test('describes a store without its password', () => {
    const said = describeStore({
      url: 'postgres://someone:s3cret@db.example.com:6000/shop',
    });

    expect(said).toContain('shop');
    expect(said).toContain('db.example.com:6000');
    expect(said).toContain('someone');
    expect(said).not.toContain('s3cret');
  });

  test('resolves the file of a sqlite store, and knows an in-memory one', () => {
    expect(sqliteFile({ url: ':memory:' })).toBeNull();
    expect(sqliteFile({ url: 'file::memory:' })).toBeNull();
    expect(sqliteFile({ url: 'file:./db/app.sqlite' })).toBe(
      path.resolve(process.cwd(), 'db/app.sqlite')
    );
  });

  test('mongodb makes its database on the first write', async () => {
    await expect(DIALECTS.mongodb.create({}, 'shop')).resolves.toEqual({
      created: false,
      reason: 'first-write',
    });
  });
});

describe('henri db:create and db:drop', () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-db-create-'));
    file = path.join(dir, 'data', 'app.sqlite');
  });

  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

  test('creates the database, says so once, and drops it', () => {
    const created = run(['db:create'], file);

    expect(created.status).toBe(0);
    expect(created.stdout).toContain('Created');
    expect(fs.existsSync(file)).toBe(true);

    const again = run(['db:create'], file);

    expect(again.status).toBe(0);
    expect(again.stdout).toContain('already there');

    const dropped = run(['db:drop'], file);

    expect(dropped.status).toBe(0);
    expect(dropped.stdout).toContain('Dropped');
    expect(fs.existsSync(file)).toBe(false);
  });

  test('--json says what it did', () => {
    const { status, stdout } = run(['db:create', '--json'], file);
    const result = json(stdout);

    expect(status).toBe(0);
    expect(result).toMatchObject({
      command: 'create',
      created: true,
      dialect: 'sqlite',
      ok: true,
      store: 'default',
    });
  });

  test('an unknown store is a usage error naming the ones there are', () => {
    const { status, stderr } = run(
      ['db:create', '--store', 'reporting', '--json'],
      file
    );
    const { error } = json(stderr);

    expect(status).toBe(2);
    expect(error.message).toContain('reporting');
    expect(error.hint).toContain('default');
  });

  test('dropping a production database needs --force', () => {
    run(['db:create'], file);

    const refused = henri(['db:drop', '--json'], {
      cwd: fixture,
      env: {
        ...process.env,
        HENRI_CONFIG__stores__default__url: file,
        NODE_ENV: 'production',
      },
    });

    expect(refused.status).toBe(1);
    expect(json(refused.stderr).error.message).toContain('production');
    expect(fs.existsSync(file)).toBe(true);
  });
});
