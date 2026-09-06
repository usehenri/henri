const fs = require('fs');
const path = require('path');

const { CliError } = require('../scripts/errors');
const { erase, exportOne } = require('../scripts/privacy');
const { cleanup, henri, tmpdir } = require('./helpers');

// The same minimal application `henri db` runs against: a drizzle store, a
// Task and a User whose fields say what they are
const fixture = path.join(__dirname, 'fixtures', 'seed-app');

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

describe('henri privacy', () => {
  describe('usage', () => {
    test('every command needs a person, and says how to name one', async () => {
      for (const command of [exportOne, erase]) {
        const error = await command({ _: [] }).catch((thrown) => thrown);

        expect(error).toBeInstanceOf(CliError);
        expect(error.code).toBe('HENRI_CLI_USAGE');
        expect(error.exitCode).toBe(2);
        expect(error.hint).toContain('someone@example.com');
      }
    });
  });

  describe('against a real application (drizzle, sqlite)', () => {
    let dir;
    let env;
    let receipts;
    let seeded;

    beforeAll(() => {
      linkAdapter();
      dir = tmpdir('henri-privacy-');
      receipts = path.join(dir, 'receipts');
      env = {
        ...process.env,
        // Written by the seed below and read back by every command after it
        DATABASE_URL: `file:${path.join(dir, 'app.db')}`,
        // The receipts of this run belong in the temporary directory
        HENRI_CONFIG_JSON__privacy: JSON.stringify({ receipts }),
      };

      const seeds = path.join(dir, 'people.js');

      fs.writeFileSync(
        seeds,
        `module.exports = async () => {
  await User.create({
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    password: 'difference-engine-1842',
    phone: '+1-555-0100',
  });
  await Task.create({ name: 'Write the notes' });
};
`
      );

      seeded = henri(['db:seed', `--file=${seeds}`, '--json'], {
        cwd: fixture,
        env,
        timeout: 120000,
      });
    });

    afterAll(() => {
      cleanup(dir);
    });

    test('seeds the application it is about to read', () => {
      expect(seeded.status).toBe(0);
    });

    test('prints the map of what is personal', () => {
      const { status, stdout } = henri(['privacy', '--json'], {
        cwd: fixture,
        env,
        timeout: 120000,
      });
      const result = JSON.parse(stdout);

      expect(status).toBe(0);
      expect(result).toMatchObject({ command: 'map', subject: 'User' });
      expect(result.private).toEqual(['password', 'phone']);
      expect(
        result.models
          .find((model) => model.model === 'User')
          .fields.map((field) => field.name)
      ).toEqual(['email', 'name', 'password', 'phone']);
    });

    test('exports one person, and writes the document where asked', () => {
      const out = path.join(dir, 'ada.json');
      const { status, stdout } = henri(
        ['privacy:export', 'ada@example.com', '--json', `--out=${out}`],
        { cwd: fixture, env, timeout: 120000 }
      );
      const { document } = JSON.parse(stdout);

      expect(status).toBe(0);
      expect(document.subject.email).toBe('ada@example.com');
      expect(document.records.User[0]).toMatchObject({
        name: 'Ada Lovelace',
        phone: '+1-555-0100',
      });
      expect(document.records.User[0].password).toBeUndefined();
      expect(JSON.parse(fs.readFileSync(out, 'utf8')).subject.email).toBe(
        'ada@example.com'
      );
    });

    test('a dry run says what would happen and writes nothing', () => {
      const { status, stdout } = henri(
        ['privacy:erase', 'ada@example.com', '--dry-run', '--json'],
        { cwd: fixture, env, timeout: 120000 }
      );
      const result = JSON.parse(stdout);

      expect(status).toBe(0);
      expect(result.receipt).toBeNull();
      expect(result.plan.steps.map((step) => step.model)).toContain('User');
      expect(fs.existsSync(receipts)).toBe(false);
    });

    test('refuses to erase without a terminal to confirm in', () => {
      const { status, stderr } = henri(
        ['privacy:erase', 'ada@example.com', '--json'],
        { cwd: fixture, env, timeout: 120000 }
      );

      expect(status).toBe(4);
      expect(JSON.parse(stderr).error).toMatchObject({
        code: 'HENRI_CLI_NEEDS_TTY',
        command: 'privacy',
      });
    });

    test('erases one person and leaves a receipt behind', () => {
      const { status, stdout } = henri(
        ['privacy:erase', 'ada@example.com', '--json', '--yes'],
        { cwd: fixture, env, timeout: 120000 }
      );
      const { receipt } = JSON.parse(stdout);

      expect(status).toBe(0);
      expect(receipt.records).toMatchObject([
        { action: 'anonymize', count: 1, model: 'User', written: 1 },
      ]);
      expect(receipt.subject.digest).toHaveLength(64);

      const written = fs
        .readdirSync(receipts)
        .map((file) => JSON.parse(fs.readFileSync(path.join(receipts, file))));

      expect(written).toHaveLength(1);
      expect(written[0].id).toBe(receipt.id);
      // The proof of an erasure holds no address: that is what was erased
      expect(JSON.stringify(written[0])).not.toContain('ada@example.com');

      // And the person no longer answers to their address
      const again = henri(['privacy:export', 'ada@example.com', '--json'], {
        cwd: fixture,
        env,
        timeout: 120000,
      });

      expect(again.status).toBe(1);
      expect(JSON.parse(again.stderr).error.code).toBe(
        'HENRI_PRIVACY_UNKNOWN_SUBJECT'
      );
    });
  }, 240000);
});
