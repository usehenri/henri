const fs = require('fs');
const path = require('path');

const { CliError } = require('../scripts/errors');
const { seed, sow } = require('../scripts/db');
const { cleanup, exists, henri, scaffold, tmpdir } = require('./helpers');

// The demo application of the workspace: a real henri app on the disk
// (mongoose) adapter, with @usehenri/* linked, so `henri db:seed` can be
// run against it for real
const demo = path.resolve(__dirname, '../../demo');

/**
 * Runs the henri binary inside the demo application
 *
 * @param {string[]} args Arguments
 * @returns {object} The spawn result
 */
const inDemo = (args) =>
  henri(args, {
    cwd: demo,
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 120000,
  });

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
        code: 'USAGE',
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

    test('says where the seed file should be, without booting', () => {
      fs.rmSync(path.join(app, 'db/seeds.js'));

      const { status, stderr } = henri(['db:seed', '--json'], { cwd: app });
      const { error } = JSON.parse(stderr);

      expect(status).toBe(2);
      expect(error.code).toBe('USAGE');
      expect(error.message).toBe('No seed file at db/seeds.js');
      expect(error.hint).toContain('db/seeds.js');
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
      expect(error.code).toBe('FAILED');
      expect(error.exitCode).toBe(1);
      expect(error.message).toBe('Seeding failed: duplicate key');
      expect(error.hint).toContain('idempotent');
    });

    test('turns a broken seed file into a FAILED error', async () => {
      const file = write('module.exports = = ;');
      const error = await sow({}, file).catch((thrown) => thrown);

      expect(error).toBeInstanceOf(CliError);
      expect(error.code).toBe('FAILED');
      expect(error.hint).toContain('seed file');
    });

    test('refuses a missing file before booting anything', async () => {
      const error = await seed({ file: 'db/nowhere.js' }).catch(
        (thrown) => thrown
      );

      expect(error).toBeInstanceOf(CliError);
      expect(error.code).toBe('USAGE');
      expect(error.message).toBe('No seed file at db/nowhere.js');
    });
  });

  describe('seeding a real application (disk adapter)', () => {
    let dir;
    let file;
    let report;

    beforeAll(() => {
      dir = tmpdir('henri-seed-run-');
      file = path.join(dir, 'seeds.js');
      report = path.join(dir, 'report.json');

      fs.writeFileSync(
        file,
        `const fs = require('fs');

// The idempotent idiom of the documentation
const plant = async () => {
  const existing = await Artwork.findOne({ title: 'Seeded' });

  if (!existing) {
    await Artwork.create({ title: 'Seeded', year: 2026 });
  }
};

module.exports = async (henri) => {
  await plant();
  await plant();

  fs.writeFileSync(
    ${JSON.stringify(report)},
    JSON.stringify({
      count: await Artwork.countDocuments({ title: 'Seeded' }),
      henri: typeof henri.stop === 'function',
      models: typeof Artwork,
    })
  );
};
`
      );
    });

    afterAll(() => {
      cleanup(dir);
    });

    test('runs the seeds with the models loaded', () => {
      const first = inDemo(['db:seed', `--file=${file}`, '--json']);

      expect(first.status).toBe(0);
      expect(JSON.parse(first.stdout)).toMatchObject({
        command: 'seed',
        file,
        ok: true,
      });
      expect(JSON.parse(fs.readFileSync(report, 'utf8'))).toEqual({
        count: 1,
        henri: true,
        models: 'function',
      });

      // The seed file runs its find-or-create twice: one row, no duplicate
      const second = inDemo(['db:seed', `--file=${file}`, '--json']);

      expect(second.status).toBe(0);
      expect(JSON.parse(fs.readFileSync(report, 'utf8')).count).toBe(1);
    });

    test('prints a human readable line without --json', () => {
      const { status, stdout } = inDemo(['db:seed', `--file=${file}`]);

      expect(status).toBe(0);
      expect(stdout).toContain('Seeded from');
    });
  }, 180000);
});
