const fs = require('fs');
const path = require('path');
const net = require('net');

const { CliError } = require('../scripts/errors');
const { cleanup, henri, linkAdapter, tmpdir } = require('./helpers');
const runner = require('../scripts/runner');

// The same minimal application `henri db`, `henri privacy` and
// `henri retention` run against: a drizzle store on sqlite, a Task and a User
const fixture = path.join(__dirname, 'fixtures', 'seed-app');

/** Everything the boot printed, taken out of what the command answered */
const output = (result) =>
  result.stdout
    .split('\n')
    .filter((line) => !line.includes('✏'))
    .join('\n')
    .trim();

describe('henri runner', () => {
  describe('what it is asked to run', () => {
    test('a bare - is stdin, a file is a file, anything else is code', async () => {
      const dir = tmpdir('henri-runner-');
      const file = path.join(dir, 'script.js');

      fs.writeFileSync(file, 'module.exports = 1;');

      expect(await runner.target({ _: [file] }, dir)).toMatchObject({
        file,
        source: null,
      });
      expect(await runner.target({ _: ['script.js'] }, dir)).toMatchObject({
        file,
      });
      expect(
        await runner.target({ _: ['await Task.count()'] }, dir)
      ).toMatchObject({
        file: null,
        source: 'await Task.count()',
        what: 'the expression',
      });

      cleanup(dir);
    });

    test('nothing to run is a usage error, with the three forms', async () => {
      const error = await runner.target({ _: [] }).catch((thrown) => thrown);

      expect(error).toBeInstanceOf(CliError);
      expect(error.code).toBe('HENRI_CLI_USAGE');
      expect(error.hint).toContain('henri runner -');
    });
  });

  describe('evaluating', () => {
    test('an expression answers its value', async () => {
      expect(await runner.evaluate('1 + 1', 'test', process.cwd())).toBe(2);
      expect(
        await runner.evaluate('Promise.resolve(7)', 'test', process.cwd())
      ).toBe(7);
      expect(
        await runner.evaluate('await Promise.resolve(9)', 'test', process.cwd())
      ).toBe(9);
    });

    test('statements run too, and answer nothing', async () => {
      expect(
        await runner.evaluate(
          'const a = 1;\nconst b = a + 1;',
          'test',
          process.cwd()
        )
      ).toBeUndefined();
    });

    test('it has a require of the application directory', async () => {
      const answer = await runner.evaluate(
        "require('path').basename('/a/b.js')",
        'test',
        process.cwd()
      );

      expect(answer).toBe('b.js');
    });

    test('what it throws is what comes back, not a wrapper', async () => {
      await expect(
        runner.evaluate('throw new TypeError("nope")', 'test', process.cwd())
      ).rejects.toThrow(TypeError);
      await expect(
        runner.evaluate(
          'Promise.reject(new Error("rejected"))',
          'test',
          process.cwd()
        )
      ).rejects.toThrow('rejected');
      await expect(
        runner.evaluate('this is not javascript', 'test', process.cwd())
      ).rejects.toThrow(SyntaxError);
    });
  });

  describe('against a real application (drizzle, sqlite)', () => {
    let dir;
    let env;

    /**
     * Runs the command against the fixture
     *
     * @param {Array<string>} args The arguments
     * @param {object} [extra={}] Extra options for the spawn
     * @returns {object} The result of the command
     */
    const run = (args, extra = {}) =>
      henri(args, { cwd: fixture, env, timeout: 120000, ...extra });

    beforeAll(() => {
      linkAdapter(fixture, 'drizzle');
      dir = tmpdir('henri-runner-app-');
      env = {
        ...process.env,
        DATABASE_URL: `file:${path.join(dir, 'app.db')}`,
      };
    });

    afterAll(() => {
      cleanup(dir);
    });

    test('runs an expression and prints what it answered', () => {
      const result = run(['runner', '1 + 1']);

      expect(result.status).toBe(0);
      expect(output(result)).toBe('2');
    });

    test('the globals are the ones an application has', () => {
      const result = run(['runner', 'typeof Task + " " + henri.release']);

      expect(result.status).toBe(0);
      expect(output(result)).toContain('function');
    });

    test('a model call reaches the database', () => {
      const written = run([
        'runner',
        'await Task.create({ name: "from the runner" })',
      ]);

      expect(written.status).toBe(0);

      const counted = run(['runner', '(await Task.find({})).length']);

      expect(counted.status).toBe(0);
      expect(Number(output(counted))).toBeGreaterThan(0);
    });

    test('a file is required, and a function it exports gets henri', () => {
      const file = path.join(dir, 'work.js');

      fs.writeFileSync(
        file,
        'module.exports = async (henri) => `ran in ${henri.env}`;\n'
      );

      const result = run(['runner', file]);

      expect(result.status).toBe(0);
      expect(output(result)).toContain('ran in');
    });

    test('stdin is the third form', () => {
      const result = run(['runner', '-'], { input: '40 + 2' });

      expect(result.status).toBe(0);
      expect(output(result)).toBe('42');
    });

    test('--json prints the value and nothing else on stdout', () => {
      const result = run(['runner', '--json', '"the answer"']);

      expect(result.status).toBe(0);
      expect(JSON.parse(output(result))).toEqual({
        ok: true,
        value: 'the answer',
      });
    });

    test('a thrown error exits 1 with the error, not a summary', () => {
      const result = run(['runner', 'throw new Error("the backfill failed")']);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Error: the backfill failed');
      // The stack, so a cron mail says where
      expect(result.stderr).toContain('at ');
    });

    test('a rejected promise exits 1 as well', () => {
      const result = run([
        'runner',
        'Promise.reject(new Error("rejected on purpose"))',
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('rejected on purpose');
    });

    test('a script that resolves exits 0 and leaves nothing running', () => {
      const started = Date.now();
      const result = run(['runner', 'await Task.find({})']);

      expect(result.status).toBe(0);
      // It stopped on its own rather than being killed by the timeout: an
      // open pool would hold the event loop and hang the crontab entry
      expect(Date.now() - started).toBeLessThan(110000);
    });

    test('no port is bound at any point: several of these share a machine', async () => {
      // Hold the port the application asks for. A runner that started the
      // server would fail to listen (or, worse, take somebody else's port)
      const guard = net.createServer();

      await new Promise((resolve) => guard.listen(0, '127.0.0.1', resolve));

      const { port } = guard.address();

      try {
        const result = run(['runner', '1 + 1'], {
          env: { ...env, HENRI_CONFIG__port: String(port) },
        });

        expect(result.status).toBe(0);
        expect(output(result)).toBe('2');
        expect(result.stderr).not.toContain('already in use');
      } finally {
        await new Promise((resolve) => guard.close(resolve));
      }
    });

    test('outside a henri application it says so, with exit code 3', () => {
      const elsewhere = tmpdir('henri-runner-nowhere-');
      const result = henri(['runner', '1 + 1'], { cwd: elsewhere });

      expect(result.status).toBe(3);
      expect(result.stderr).toContain('is not an henri project');

      cleanup(elsewhere);
    });
  });
});
