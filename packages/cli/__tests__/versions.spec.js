const path = require('path');

const { CliError } = require('../scripts/errors');
const { cleanup, henri, linkAdapter, tmpdir } = require('./helpers');
const versions = require('../scripts/versions');

// The same minimal application `henri db`, `henri privacy`, `henri calls`
// and `henri retention` run against: a drizzle store on sqlite. Its `Task`
// is the one model that says `versioned: true`, so what this proves is the
// whole path -- one model asking creates the table, a write through
// `henri db:seed` puts a row in it, and the command reads it back,
// reconstructs the record and writes it back.
const fixture = path.join(__dirname, 'fixtures', 'seed-app');

describe('henri versions', () => {
  describe('usage', () => {
    test('show needs the id of a version', async () => {
      const error = await versions
        .show({ _: ['show'] })
        .catch((thrown) => thrown);

      expect(error).toBeInstanceOf(CliError);
      expect(error.code).toBe('HENRI_CLI_USAGE');
      expect(error.hint).toContain('lists them with their ids');
    });

    test('restore needs one too', async () => {
      const error = await versions
        .restore({ _: ['restore'] })
        .catch((thrown) => thrown);

      expect(error).toBeInstanceOf(CliError);
      expect(error.code).toBe('HENRI_CLI_USAGE');
    });
  });

  describe('against a real application (drizzle, sqlite)', () => {
    let dir;
    let env;

    /**
     * Runs a command against the fixture
     *
     * @param {Array<string>} args The arguments
     * @returns {object} The result of the command
     */
    const run = (args) => henri(args, { cwd: fixture, env, timeout: 120000 });

    beforeAll(() => {
      linkAdapter(fixture, 'drizzle');
      dir = tmpdir('henri-versions-');
      env = {
        ...process.env,
        DATABASE_URL: `file:${path.join(dir, 'app.db')}`,
      };

      // The seed creates one Task, which is the model that asked
      const seeded = run(['db:seed']);

      if (seeded.status !== 0) {
        throw new Error(`unable to seed the fixture: ${seeded.stderr}`);
      }
    }, 180000);

    afterAll(() => {
      cleanup(dir);
    });

    test('the table holds the create, with no actor outside a request', () => {
      const { status, stdout } = run(['versions', 'Task', '--json']);
      const result = JSON.parse(stdout);

      expect(status).toBe(0);
      expect(result.versions).toHaveLength(1);
      expect(result.versions[0]).toMatchObject({
        actor: null,
        event: 'create',
        model: 'Task',
        source: 'system',
      });
      expect(result.versions[0].changes.name).toEqual([null, 'Seeded']);
    });

    test('show reconstructs the record and touches nothing', () => {
      const [version] = JSON.parse(
        run(['versions', 'Task', '--json']).stdout
      ).versions;
      const { status, stdout } = run(['versions:show', version.id, '--json']);
      const result = JSON.parse(stdout);

      expect(status).toBe(0);
      expect(result.complete).toBe(true);
      expect(result.existed).toBe(true);
      expect(result.attributes.name).toBe('Seeded');

      // ... and the record is where it was
      expect(
        JSON.parse(run(['versions', 'Task', '--json']).stdout).versions
      ).toHaveLength(1);
    });

    test('the text output prints the change', () => {
      const { status, stdout } = run(['versions', 'Task']);

      expect(status).toBe(0);
      expect(stdout).toContain('create');
      expect(stdout).toContain('name: (none) -> Seeded');
      expect(stdout).toContain('source system');
    });

    test('a filter that matches nothing says so', () => {
      const { status, stdout } = run(['versions', 'Task', '--event=destroy']);

      expect(status).toBe(0);
      expect(stdout).toContain('Nothing is versioned matching that');
    });

    test('a lowercase word is a command, and an unknown one says so', () => {
      const { status, stderr } = run(['versions:nope']);

      expect(status).toBe(2);
      expect(stderr).toContain('Unknown versions command "nope"');
      expect(stderr).toContain('A model name is capitalised');
    });

    test('an unknown version id is a coded failure', () => {
      const { status, stderr } = run([
        'versions:show',
        '018f0000-0000-7000-8000-00000000ffff',
        '--json',
      ]);

      expect(status).toBeGreaterThan(0);
      expect(JSON.parse(stderr).error.code).toBe('HENRI_VERSION_UNKNOWN');
    });
  });
});
