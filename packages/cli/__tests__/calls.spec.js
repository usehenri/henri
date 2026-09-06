const path = require('path');

const { CliError } = require('../scripts/errors');
const { cleanup, henri, linkAdapter, tmpdir } = require('./helpers');
const calls = require('../scripts/calls');

// The same minimal application `henri db`, `henri privacy` and
// `henri retention` run against: a drizzle store on sqlite. What it proves
// here is the SQL half of the call log -- the table is created through
// `adapter.query()` on a real adapter, the command reads it back, and the
// sweep runs -- and that a log an application does not keep says so.
const fixture = path.join(__dirname, 'fixtures', 'seed-app');

describe('henri calls', () => {
  describe('usage', () => {
    test('a sweep removes rows, so it needs to be told twice', async () => {
      const error = await calls
        .sweep({ _: ['sweep'] })
        .catch((thrown) => thrown);

      expect(error).toBeInstanceOf(CliError);
      expect(error.code).toBe('HENRI_CLI_USAGE');
      expect(error.hint).toContain('--yes');
    });
  });

  describe('against a real application (drizzle, sqlite)', () => {
    let dir;
    let env;

    /**
     * Runs a command against the fixture
     *
     * @param {Array<string>} args The arguments
     * @param {object} [extra={}] Extra environment
     * @returns {object} The result of the command
     */
    const run = (args, extra = {}) =>
      henri(args, {
        cwd: fixture,
        env: { ...env, ...extra },
        timeout: 120000,
      });

    beforeAll(() => {
      linkAdapter(fixture, 'drizzle');
      dir = tmpdir('henri-calls-');
      env = {
        ...process.env,
        DATABASE_URL: `file:${path.join(dir, 'app.db')}`,
        // The call log is off unless an application asks for it
        HENRI_CONFIG_JSON__calls: JSON.stringify({ keep: '1d' }),
      };
    });

    afterAll(() => {
      cleanup(dir);
    });

    test('the table is created on the store, and it is empty', () => {
      const { status, stdout } = run(['calls:stats', '--json']);
      const result = JSON.parse(stdout);

      expect(status).toBe(0);
      expect(result).toMatchObject({
        buffered: 0,
        enabled: true,
        partitions: [],
        total: 0,
        written: 0,
      });
    });

    test('a request nobody recorded answers nothing rather than everything', () => {
      const result = JSON.parse(
        run(['calls', '018f5c2e-1f2a-7c31-9f0a-2b7c1d3e4f56', '--json']).stdout
      );

      expect(result.command).toBe('list');
      expect(result.requestId).toBe('018f5c2e-1f2a-7c31-9f0a-2b7c1d3e4f56');
      expect(result.calls).toEqual([]);
    });

    test('a listing is a listing, and takes the filters', () => {
      const result = JSON.parse(
        run(['calls', '--direction=out', '--limit=5', '--json']).stdout
      );

      expect(result.requestId).toBeNull();
      expect(result.filter).toMatchObject({ direction: 'out', limit: 5 });
      expect(result.calls).toEqual([]);
    });

    test('a sweep runs, and says what it took and what it dropped', () => {
      const { status, stdout } = run(['calls:sweep', '--yes', '--json']);
      const result = JSON.parse(stdout);

      expect(status).toBe(0);
      expect(result.removed).toBe(0);
      // Sqlite has no range partitions: the delete path, and the guide says so
      expect(result.partitions).toEqual([]);
      expect(result.before).toEqual(expect.any(Number));
    });

    test('a partition scheme sqlite cannot carry out fails the boot', () => {
      const { status, stderr } = run(['calls:stats', '--json'], {
        HENRI_CONFIG_JSON__calls: JSON.stringify({ partition: 'day' }),
      });

      expect(status).not.toBe(0);
      expect(stderr).toContain('HENRI_CALLS_PARTITION_UNSUPPORTED');
    });

    test('reading a call log an application does not keep says so', () => {
      const { status, stderr } = run(['calls', '--json'], {
        HENRI_CONFIG_JSON__calls: 'false',
      });

      expect(status).toBe(1);
      expect(stderr).toContain('HENRI_CALLS_DISABLED');
    });

    test('an unknown subcommand prints the usage and exits 2', () => {
      const { status, stderr } = run(['calls:nope', '--json']);

      expect(status).toBe(2);
      expect(stderr).toContain('HENRI_CLI_USAGE');
    });
  });
});
