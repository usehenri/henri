const fs = require('fs');
const path = require('path');

const { CliError } = require('../scripts/errors');
const main = require('../scripts/encryption');
const { cleanup, henri, tmpdir } = require('./helpers');

/**
 * `henri encryption`, against a real application: a drizzle store on a
 * sqlite file, a model with a randomised field and a deterministic one,
 * and the key in the environment rather than in a file -- the shape a
 * deployment uses, and the one `henri audit` does not report.
 */

const fixture = path.join(__dirname, 'fixtures', 'encrypted-app');

const FIRST =
  '11111111111111111111111111111111111111111111111111111111111111a1';
const SECOND =
  '22222222222222222222222222222222222222222222222222222222222222b2';

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

describe('henri encryption', () => {
  describe('usage', () => {
    test('an unknown command says which ones exist', async () => {
      const error = await main({ _: ['rotat'], json: true }).catch(
        (thrown) => thrown
      );

      expect(error).toBeInstanceOf(CliError);
      expect(error.code).toBe('HENRI_CLI_USAGE');
      expect(error.hint).toContain('rotate');
    });
  });

  describe('against a real application (drizzle, sqlite)', () => {
    let dir;
    let env;
    let seeded;

    /**
     * Runs the command with a set of keys in the environment
     *
     * @param {Array<string>} args The arguments
     * @param {Array<string>} keys The keys, the one that writes first
     * @returns {object} What the process answered
     */
    const run = (args, keys = [FIRST]) =>
      henri(args, {
        cwd: fixture,
        env: { ...env, HENRI_ENCRYPTION_KEYS: keys.join(',') },
        timeout: 120000,
      });

    beforeAll(() => {
      linkAdapter();
      dir = tmpdir('henri-encryption-');
      env = {
        ...process.env,
        DATABASE_URL: `file:${path.join(dir, 'app.db')}`,
      };

      const seeds = path.join(dir, 'people.js');

      fs.writeFileSync(
        seeds,
        `module.exports = async () => {
  await User.create({
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    nationalId: 'AA-123-456',
    password: 'difference-engine-1842',
    phone: '+1-555-0100',
  });
  await User.create({
    email: 'grace@example.com',
    name: 'Grace Hopper',
    nationalId: 'BB-987-654',
    password: 'nanoseconds-1906',
    phone: '+1-555-0101',
  });
  await Task.create({ name: 'Write the notes' });
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

    test('the map names the fields and the key ids, never a key', () => {
      const { status, stdout } = run(['encryption', '--json']);
      const result = JSON.parse(stdout);

      expect(status).toBe(0);
      expect(result).toMatchObject({ command: 'map', enabled: true });
      expect(result.fields).toEqual([
        { deterministic: true, field: 'nationalId', model: 'User' },
        { deterministic: false, field: 'phone', model: 'User' },
      ]);
      expect(result.keys).toEqual([
        {
          id: expect.stringMatching(/^[0-9a-f]{8}$/u),
          primary: true,
          source: 'HENRI_ENCRYPTION_KEYS',
        },
      ]);
      expect(stdout).not.toContain(FIRST);
    });

    test('nothing a command prints ever holds a key', () => {
      for (const args of [
        ['encryption', '--json'],
        ['encryption:status', '--json'],
        ['encryption:rotate', '--dry-run', '--json'],
      ]) {
        const { stderr, stdout } = run(args, [SECOND, FIRST]);

        expect(`${stdout}${stderr}`).not.toContain(FIRST);
        expect(`${stdout}${stderr}`).not.toContain(SECOND);
      }
    });

    test('the status says everything is already under the key that writes', () => {
      const { status, stdout } = run(['encryption:status', '--json']);
      const result = JSON.parse(stdout);

      expect(status).toBe(0);
      expect(result.ok).toBe(true);
      expect(result.plaintext).toBe(0);
      expect(result.stale).toBe(0);
      expect(result.fields.map((entry) => entry.field).sort()).toEqual([
        'nationalId',
        'phone',
      ]);
      expect(result.fields.every((entry) => entry.rows === 2)).toBe(true);
    });

    test('a new key in front makes every row stale, and readable', () => {
      const { status, stdout } = run(
        ['encryption:status', '--json'],
        [SECOND, FIRST]
      );
      const result = JSON.parse(stdout);

      expect(status).toBe(0);
      expect(result.ok).toBe(false);
      expect(result.stale).toBe(4);
      expect(result.keys).toHaveLength(2);
    });

    test('a dry run reports what it would rewrite and writes nothing', () => {
      const { status, stdout } = run(
        ['encryption:rotate', '--dry-run', '--json'],
        [SECOND, FIRST]
      );
      const result = JSON.parse(stdout);

      expect(status).toBe(0);
      expect(result.dryRun).toBe(true);
      expect(result.rotated).toBe(4);
      expect(
        JSON.parse(run(['encryption:status', '--json'], [SECOND, FIRST]).stdout)
          .stale
      ).toBe(4);
    });

    test('--field rotates one column and leaves the other alone', () => {
      const { status, stdout } = run(
        ['encryption:rotate', '--field=phone', '--json'],
        [SECOND, FIRST]
      );
      const result = JSON.parse(stdout);

      expect(status).toBe(0);
      expect(result.rotated).toBe(2);
      expect(result.fields.map((entry) => entry.field)).toEqual(['phone']);

      const after = JSON.parse(
        run(['encryption:status', '--json'], [SECOND, FIRST]).stdout
      );

      expect(after.stale).toBe(2);
      expect(after.fields.find((entry) => entry.field === 'phone').stale).toBe(
        0
      );
    });

    test('the rotation finishes, and the status is what says so', () => {
      expect(
        JSON.parse(run(['encryption:rotate', '--json'], [SECOND, FIRST]).stdout)
          .rotated
      ).toBe(2);

      const after = JSON.parse(
        run(['encryption:status', '--json'], [SECOND, FIRST]).stdout
      );

      expect(after.ok).toBe(true);
      expect(after.stale).toBe(0);
    });

    test('the old key may now be dropped, and the data still reads', () => {
      const status = JSON.parse(
        run(['encryption:status', '--json'], [SECOND]).stdout
      );

      expect(status.ok).toBe(true);
      expect(status.keys).toEqual([expect.any(String)]);

      // And a lookup by the deterministic field still finds the person
      const { stdout } = run(
        ['privacy:export', 'ada@example.com', '--json'],
        [SECOND]
      );
      const { document } = JSON.parse(stdout);

      expect(document.records.User[0]).toMatchObject({
        nationalId: 'AA-123-456',
        phone: '+1-555-0100',
      });
      expect(document.unreadable).toEqual([]);
    });

    test('dropping a key that still has rows is what the status prevents', () => {
      // The first key alone, after everything moved to the second: the
      // status is honest about it and the rotation refuses to guess
      const status = JSON.parse(
        run(['encryption:status', '--json'], [FIRST]).stdout
      );
      const stale = status.fields.reduce(
        (total, entry) => total + entry.stale,
        0
      );

      expect(stale).toBe(4);

      const rotate = JSON.parse(
        run(['encryption:rotate', '--json'], [FIRST]).stdout
      );

      expect(rotate.rotated).toBe(0);
      expect(rotate.ok).toBe(false);
      expect(
        rotate.failures.every(
          (failure) => failure.code === 'HENRI_ENCRYPTION_KEY_UNKNOWN'
        )
      ).toBe(true);
    });

    test('booting without a key at all is a refusal, not a plaintext write', () => {
      const { status, stderr } = henri(['encryption', '--json'], {
        cwd: fixture,
        env: { ...env, HENRI_ENCRYPTION_KEYS: '' },
        timeout: 120000,
      });

      expect(status).not.toBe(0);
      expect(stderr).toContain('HENRI_ENCRYPTION_NO_KEY');
    });

    test('a key that is not a key is refused, without being quoted', () => {
      // The configuration schema catches it before a module runs, which is
      // earlier than the keyring would; what matters is that the value
      // never reaches the message. A key with a typo in it is still a key
      const almost = `${FIRST.slice(0, 63)}\n`;
      const { status, stderr } = run(['encryption', '--json'], [almost]);

      expect(status).not.toBe(0);
      expect(stderr).toContain('encryption.keys[0]');
      expect(stderr).toContain('64 hexadecimal characters');
      // The value that arrived is a key with a typo in it: it is still a
      // key, and it is named by its type and nothing else
      expect(stderr).not.toContain(FIRST.slice(0, 63));
      expect(JSON.parse(stderr).error.problems[0].received).toBe('a string');
    });
  }, 240000);
});
