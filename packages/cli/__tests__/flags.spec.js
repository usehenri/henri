const fs = require('fs');
const path = require('path');

const { CliError } = require('../scripts/errors');
const { cleanup, henri, tmpdir } = require('./helpers');
const flags = require('../scripts/flags');

// An application that declares four flags and nothing else: no model, no
// migration, no adapter linked. `henri flags` boots to runlevel 2, so a
// switch can be flipped with the database unreachable -- which is exactly
// the state somebody reaching for a kill switch is often in, and this
// fixture is what proves it
const fixture = path.join(__dirname, 'fixtures', 'flags-app');

describe('henri flags', () => {
  describe('usage', () => {
    test('a write needs a flag name, and says which shape it takes', async () => {
      for (const command of ['on', 'off', 'reset', 'percentage']) {
        const error = await flags[command]({ _: [command] }).catch(
          (thrown) => thrown
        );

        expect(error).toBeInstanceOf(CliError);
        expect(error.code).toBe('HENRI_CLI_USAGE');
        expect(error.hint).toContain('henri flags');
      }
    });

    test('a percentage is a number from 0 to 100, and nothing else', async () => {
      for (const share of [undefined, 'lots', -1, 101]) {
        const error = await flags
          .percentage({ _: ['percentage', 'checkout', share] })
          .catch((thrown) => thrown);

        expect(error).toBeInstanceOf(CliError);
        expect(error.code).toBe('HENRI_CLI_USAGE');
      }
    });

    test('the phrase names every gate that is open', () => {
      const flag = {
        actors: [],
        boolean: null,
        default: false,
        group: false,
        percentage: 0,
      };

      expect(flags.gates(flag)).toBe('never flipped (default off)');
      expect(flags.gates({ ...flag, group: true })).toBe(
        'never flipped (default off, and a group)'
      );
      expect(flags.gates({ ...flag, boolean: true })).toBe('on for everyone');
      expect(flags.gates({ ...flag, boolean: false })).toBe('off for everyone');
      expect(flags.gates({ ...flag, actors: ['a'], percentage: 25 })).toBe(
        '25% of the actors, 1 named actor'
      );
      // A kill switch that somebody has since added an actor to says both
      expect(flags.gates({ ...flag, actors: ['a', 'b'], boolean: false })).toBe(
        '2 named actors'
      );
    });

    test('how long ago it moved, in words', () => {
      expect(flags.since(null)).toBe('-');
      expect(flags.since(Date.now())).toBe('just now');
      expect(flags.since(Date.now() - 3600000)).toBe('1h ago');
      expect(flags.since(Date.now() - 86400000 * 3)).toBe('3d ago');
    });
  });

  describe('against a real application', () => {
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
      henri(args, { cwd: fixture, env: { ...env, ...extra }, timeout: 120000 });

    /**
     * The parsed JSON answer of a command. With `--json` stdout is the
     * result and nothing else: the boot log goes to stderr, which is what
     * makes this parse at all.
     *
     * @param {Array<string>} args The arguments
     * @param {object} [extra={}] Extra environment
     * @returns {object} The answer
     */
    const json = (args, extra = {}) => {
      const answer = run(args, extra);

      expect(answer.status).toBe(0);

      return JSON.parse(answer.stdout);
    };

    /**
     * The error envelope of a command that failed, which `index.js` writes
     * as the last line of stderr, after the boot log
     *
     * @param {object} answer What the command answered
     * @returns {object} The envelope
     */
    const envelope = (answer) => {
      const line = answer.stderr
        .split('\n')
        .reverse()
        .find((one) => one.trim().startsWith('{'));

      return JSON.parse(line).error;
    };

    beforeAll(() => {
      dir = tmpdir('henri-flags-');
      env = {
        ...process.env,
        // A file of this run's own, outside the repository: the fixture is
        // read only as far as this suite is concerned
        HENRI_CONFIG_JSON__flags: JSON.stringify({
          store: path.join(dir, 'flags.json'),
        }),
        NODE_ENV: 'dev',
      };
    });

    afterAll(() => {
      cleanup(dir);
    });

    test('lists what the application declares, before anything is flipped', () => {
      const answer = json(['flags', '--json']);

      expect(answer.command).toBe('list');
      expect(answer.store.name).toBe('file');
      expect(answer.store.where).toMatch(/this machine only/u);
      expect(answer.flags.map((flag) => flag.name).sort()).toEqual([
        'checkout',
        'legacy-editor',
        'newBanner',
        'staffTools',
      ]);

      const checkout = answer.flags.find((flag) => flag.name === 'checkout');

      expect(checkout).toMatchObject({
        actors: [],
        at: null,
        boolean: null,
        default: false,
        everyone: false,
        percentage: 0,
      });
      // Nothing was written by a read
      expect(fs.existsSync(path.join(dir, 'flags.json'))).toBe(false);
    });

    test('one process flips it and the next one sees it', () => {
      // Two real processes over one file, which is the whole claim the
      // file store makes: this is why the default is a file and not this
      // process's memory, where the first command would report success and
      // the second would see nothing
      const flipped = json(['flags:on', 'checkout', '--json']);

      expect(flipped.command).toBe('on');
      expect(flipped.flag).toMatchObject({ boolean: true, everyone: true });
      expect(flipped.flag.at).toBeGreaterThan(0);

      const listed = json(['flags', '--json']);
      const checkout = listed.flags.find((flag) => flag.name === 'checkout');

      expect(checkout.boolean).toBe(true);
      expect(checkout.everyone).toBe(true);
    });

    test('off is a reset: the share and the named set go with it', () => {
      const actor = '018f0000-0000-7000-8000-000000000001';

      json(['flags:percentage', 'checkout', '40', '--json']);
      json(['flags:on', 'checkout', actor, '--json']);

      const before = json(['flags', '--json']).flags.find(
        (flag) => flag.name === 'checkout'
      );

      expect(before).toMatchObject({ actors: [actor], percentage: 40 });

      const after = json(['flags:off', 'checkout', '--json']).flag;

      expect(after).toMatchObject({
        actors: [],
        boolean: false,
        everyone: false,
        percentage: 0,
      });
    });

    test('an actor is added and taken out one at a time', () => {
      const one = '018f0000-0000-7000-8000-000000000002';
      const two = '018f0000-0000-7000-8000-000000000003';

      json(['flags:on', 'newBanner', one, '--json']);

      const both = json(['flags:on', 'newBanner', two, '--json']).flag;

      expect(both.actors).toEqual([one, two]);

      const left = json(['flags:off', 'newBanner', one, '--json']).flag;

      expect(left.actors).toEqual([two]);
    });

    test('reset puts a flag back to what the file declares', () => {
      json(['flags:on', 'legacy-editor', '--json']);
      json(['flags:off', 'legacy-editor', '--json']);

      const back = json(['flags:reset', 'legacy-editor', '--json']).flag;

      // Its declared default is on, so a reset is not the same as an off
      expect(back).toMatchObject({
        boolean: null,
        default: true,
        everyone: true,
      });
    });

    test('a flag nothing declares is refused, and the near miss is named', () => {
      const answer = run(['flags:on', 'chekout', '--json']);
      const failure = envelope(answer);

      expect(answer.status).toBe(2);
      expect(failure.code).toBe('HENRI_CLI_USAGE');
      expect(failure.message).toMatch(/did you mean "checkout"/u);
      expect(failure.hint).toMatch(/config\/flags\.js/u);
    });

    test('the text output says what a flag answers and what moved it', () => {
      const { status, stdout } = run(['flags', '--all']);

      expect(status).toBe(0);
      expect(stdout).toMatch(/4 flags, in file/u);
      expect(stdout).toMatch(/staffTools\s+off\s+never flipped/u);
      // --all prints the public identifiers of the named set
      expect(stdout).toMatch(/018f0000-0000-7000-8000-000000000003/u);
    });

    test('an application with no flags says how to declare one', () => {
      // The seed fixture has no config/flags.js: the module loads nothing,
      // there is no store, and the command says what to write rather than
      // printing an empty table
      const seed = path.join(__dirname, 'fixtures', 'seed-app');
      const answer = henri(['flags', '--json'], {
        cwd: seed,
        env,
        timeout: 120000,
      });

      expect(answer.status).toBe(0);

      const parsed = JSON.parse(answer.stdout);

      expect(parsed.flags).toEqual([]);
      expect(parsed.store).toEqual({
        name: 'none',
        where: 'nothing declared',
      });
      expect(
        henri(['flags'], { cwd: seed, env, timeout: 120000 }).stdout
      ).toMatch(/declares no feature flags/u);
    });

    test('an unknown subcommand prints the usage and exits 2', () => {
      const { status, stderr } = run(['flags:nope', '--json']);

      expect(status).toBe(2);
      expect(stderr).toContain('HENRI_CLI_USAGE');
    });
  });
});
