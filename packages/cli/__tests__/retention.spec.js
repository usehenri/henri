const fs = require('fs');
const path = require('path');

const { CliError } = require('../scripts/errors');
const { cleanup, henri, linkAdapter, tmpdir } = require('./helpers');
const trail = require('../scripts/trail');

// The same minimal application `henri db` and `henri privacy` run against:
// a drizzle store, a Task that says how long it is kept and a User
const fixture = path.join(__dirname, 'fixtures', 'seed-app');

/** The token of the Task rule, which `config.retention.approved` holds */
const TOKEN = 'Task:default:4c94f8c8576e';

describe('henri retention and henri trail', () => {
  describe('usage', () => {
    test('trail:about needs a person, and says how to name one', async () => {
      const error = await trail
        .about({ _: ['about'] })
        .catch((thrown) => thrown);

      expect(error).toBeInstanceOf(CliError);
      expect(error.code).toBe('HENRI_CLI_USAGE');
      expect(error.hint).toContain('someone@example.com');
    });
  });

  describe('against a real application (drizzle, sqlite)', () => {
    let dir;
    let env;
    let receipts;
    let seeded;

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
      dir = tmpdir('henri-retention-');
      receipts = path.join(dir, 'receipts');
      env = {
        ...process.env,
        DATABASE_URL: `file:${path.join(dir, 'app.db')}`,
        HENRI_CONFIG_JSON__retention: JSON.stringify({ receipts }),
        // The trail is off unless an application asks for it
        HENRI_CONFIG_JSON__trail: JSON.stringify({}),
      };

      const seeds = path.join(dir, 'tasks.js');

      fs.writeFileSync(
        seeds,
        `module.exports = async () => {
  await Task.create({ name: 'Write the notes' });
  await Task.create({ name: 'Read them back' });
};
`
      );

      seeded = run(['db:seed', `--file=${seeds}`, '--json']);
    });

    afterAll(() => {
      cleanup(dir);
    });

    test('seeds the application it is about to read', () => {
      expect(seeded.status).toBe(0);
    });

    test('prints the rules the models declare, and their tokens', () => {
      const { status, stdout } = run(['retention', '--json']);
      const result = JSON.parse(stdout);

      expect(status).toBe(0);
      expect(result.command).toBe('map');
      expect(result.rules).toEqual([
        {
          action: 'delete',
          after: 2592000000,
          approved: false,
          from: 'createdAt',
          model: 'Task',
          rule: 'default',
          token: TOKEN,
          where: {},
        },
      ]);
    });

    test('a sweep writes nothing without --yes', () => {
      const { status, stdout } = run(['retention:sweep', '--json']);
      const result = JSON.parse(stdout);

      expect(status).toBe(0);
      expect(result.dryRun).toBe(true);
      expect(result.receipt.rules[0].skipped).toBe('not approved');
      expect(result.receipt.rules[0].written).toBe(0);
    });

    test('and nothing with --yes either, until the rule is approved', () => {
      const refused = JSON.parse(
        run(['retention:sweep', '--yes', '--json']).stdout
      );

      expect(refused.receipt.pending).toBe(1);
      expect(refused.receipt.rules[0].skipped).toBe('not approved');
      expect(refused.receipt.rules[0].written).toBe(0);

      // Nothing is old enough here either, so approving it changes the
      // reason rather than the outcome: the rule runs and finds nothing
      const approved = JSON.parse(
        run(['retention:sweep', '--yes', '--json'], {
          HENRI_CONFIG_JSON__retention: JSON.stringify({
            approved: [TOKEN],
            receipts,
          }),
        }).stdout
      );

      expect(approved.receipt.pending).toBe(0);
      expect(approved.receipt.rules[0].skipped).toBeNull();
      expect(approved.receipt.rules[0].matched).toBe(0);
      expect(approved.receipt.file).toMatch(/retention-/u);
    });

    test('a sweep that ran is in the trail, and the chain holds', () => {
      const entries = JSON.parse(run(['trail', '--json']).stdout);

      expect(entries.command).toBe('list');
      expect(
        entries.entries.every((entry) => entry.action === 'retention.sweep')
      ).toBe(true);
      expect(entries.entries.length).toBeGreaterThan(0);
      expect(entries.entries[0].model).toBe('Task');
      // Names and counts, never a value
      expect(JSON.stringify(entries)).not.toContain('Write the notes');

      const verified = JSON.parse(run(['trail:verify', '--json']).stdout);

      expect(verified.ok).toBe(true);
      expect(verified.broken).toBeNull();
      expect(verified.entries).toBe(entries.entries.length);
    });

    test('reading a trail an application does not keep says so', () => {
      const { status, stderr } = run(['trail', '--json'], {
        HENRI_CONFIG_JSON__trail: 'false',
      });

      expect(status).toBe(1);
      expect(stderr).toContain('HENRI_TRAIL_DISABLED');
    });

    test('an unknown subcommand prints the usage and exits 2', () => {
      for (const command of ['retention:nope', 'trail:nope']) {
        const { status, stderr } = run([command, '--json']);

        expect(status).toBe(2);
        expect(stderr).toContain('HENRI_CLI_USAGE');
      }
    });
  });
});
