const fs = require('fs');
const path = require('path');

const { version } = require('../package.json');
const { EXIT_CODES } = require('../scripts/errors');
const { cleanup, exists, henri, scaffold } = require('./helpers');

/**
 * Parse the JSON a command printed
 *
 * @param {string} text stdout or stderr
 * @returns {object} The parsed value
 */
const parse = (text) => JSON.parse(text);

describe('--json', () => {
  let dir;
  let app;

  beforeAll(() => {
    ({ app, dir } = scaffold(['--no-git']));
  });

  afterAll(() => {
    cleanup(dir);
  });

  describe('help', () => {
    test('prints the catalogue of commands, flags and exit codes', () => {
      const { status, stdout } = henri(['help', '--json'], { cwd: dir });

      expect(status).toBe(0);

      const catalogue = parse(stdout);

      expect(catalogue.name).toBe('henri');
      expect(catalogue.version).toBe(version);
      expect(catalogue.exitCodes).toEqual(EXIT_CODES);
      expect(catalogue.exitCodes.map((entry) => entry.code)).toEqual([
        0, 1, 2, 3, 4,
      ]);
      expect(catalogue.globalFlags.map((flag) => flag.flag)).toContain(
        '--json'
      );

      const names = catalogue.commands.map((command) => command.name);

      expect(names).toEqual(
        expect.arrayContaining([
          'about',
          'clean',
          'destroy',
          'doctor',
          'generate',
          'mcp',
          'new',
          'routes',
        ])
      );

      const generate = catalogue.commands.find(
        (command) => command.name === 'generate'
      );

      expect(generate.aliases).toEqual(['g']);
      expect(generate.usage[0]).toContain('henri generate <what>');
      expect(generate.flags.map((flag) => flag.flag)).toEqual([
        '--force',
        '--json',
      ]);
      expect(generate.targets.map((target) => target.name)).toContain(
        'scaffold <Name> [field:type[!] ...]'
      );
      expect(generate.examples[0].command).toContain('henri generate model');
    });

    test('prints one command with help <command> --json and <command> --help --json', () => {
      for (const args of [
        ['help', 'routes', '--json'],
        ['routes', '--help', '--json'],
        ['help', '--json', 'routes'],
      ]) {
        const { status, stdout } = henri(args, { cwd: dir });

        expect(status).toBe(0);
        expect(parse(stdout).commands.map((command) => command.name)).toEqual([
          'routes',
        ]);
      }
    });

    test('the text help documents the exit codes and the new commands', () => {
      const { stdout } = henri([], { cwd: dir });

      expect(stdout).toContain('Exit codes');
      expect(stdout).toMatch(/0\s+success/);
      expect(stdout).toMatch(/3\s+not a henri application/);
      expect(stdout).toContain('doctor');
      expect(stdout).toContain('mcp');
      expect(stdout).toContain('AGENTS.md');
    });
  });

  describe('about', () => {
    test('prints the environment and the content of the app', () => {
      const { status, stdout } = henri(['about', '--json'], { cwd: app });

      expect(status).toBe(0);

      const about = parse(stdout);

      expect(about.henri).toBe(version);
      expect(about.node).toBe(process.version);
      expect(about.project).toBe(true);
      expect(about.packages).toHaveProperty('@usehenri/core');
      expect(about.packageManagers).toHaveProperty('npm');
      expect(about.app.models).toEqual(['Task']);
      expect(about.app.controllers).toEqual(['main', 'tasks']);
      expect(about.app.views).toContain('tasks');
    });

    test('says no outside of a project', () => {
      const { status, stdout } = henri(['about', '--json'], { cwd: dir });

      expect(status).toBe(0);
      expect(parse(stdout).project).toBe(false);
      expect(parse(stdout).app.models).toBeNull();
    });
  });

  describe('generate and destroy', () => {
    test('generate prints the files written and the routes added', () => {
      const { status, stdout, stderr } = henri(
        ['g', 'scaffold', 'Post', 'title:string!', '--json'],
        { cwd: app }
      );

      expect(status).toBe(0);
      expect(stderr).toBe('');
      expect(parse(stdout)).toEqual({
        command: 'generate',
        created: [
          'app/models/Post.js',
          'app/controllers/posts.js',
          'app/views/pages/posts/index.jsx',
          'app/views/pages/posts/_form.jsx',
          'app/views/pages/posts/new.jsx',
          'app/views/pages/posts/edit.jsx',
          'app/views/pages/posts/show.jsx',
        ],
        generator: 'scaffold',
        name: 'Post',
        routes: { added: ['resources posts'] },
        skipped: [],
        updated: [],
      });
    });

    test('generate lists the files it skipped', () => {
      const { status, stdout } = henri(
        ['g', 'model', 'Post', 'other:string', '--json'],
        { cwd: app }
      );

      expect(status).toBe(0);
      expect(parse(stdout)).toMatchObject({
        created: [],
        generator: 'model',
        skipped: ['app/models/Post.js'],
      });
    });

    test('generate controller lists the routes added', () => {
      const { stdout } = henri(
        ['g', 'controller', 'locations', 'index', 'gps', '--json'],
        { cwd: app }
      );

      expect(parse(stdout)).toMatchObject({
        created: ['app/controllers/locations.js'],
        routes: { added: ['get /locations/index', 'get /locations/gps'] },
      });
    });

    test('destroy prints the files removed, the routes removed and the backup', () => {
      const { status, stdout, stderr } = henri(
        ['d', 'scaffold', 'Post', '--json'],
        { cwd: app }
      );

      expect(status).toBe(0);
      expect(stderr).toBe('');

      const summary = parse(stdout);

      expect(summary).toMatchObject({
        command: 'destroy',
        missing: [],
        name: 'Post',
        removed: [
          'app/models/Post.js',
          'app/controllers/posts.js',
          'app/views/pages/posts',
        ],
        routes: { removed: ['resources posts'] },
        target: 'scaffold',
      });
      expect(summary.backup).toMatch(/^\.backup\/\d+$/);
      expect(exists(app, summary.backup)).toBe(true);
    });

    test('destroy lists what it could not find', () => {
      const { status, stdout } = henri(['d', 'model', 'Ghost', '--json'], {
        cwd: app,
      });

      expect(status).toBe(0);
      expect(parse(stdout)).toMatchObject({
        backup: null,
        missing: ['app/models/Ghost.js'],
        removed: [],
      });
    });

    test('generate agents writes the files coding agents read', () => {
      fs.unlinkSync(path.join(app, 'AGENTS.md'));

      const { status, stdout } = henri(['g', 'agents', '--json'], { cwd: app });

      expect(status).toBe(0);
      expect(parse(stdout)).toMatchObject({
        created: ['AGENTS.md'],
        generator: 'agents',
        name: null,
        skipped: ['CLAUDE.md', '.mcp.json'],
      });
      expect(fs.readFileSync(path.join(app, 'AGENTS.md'), 'utf8')).toContain(
        '# app: conventions for coding agents'
      );
    });
  });

  describe('errors', () => {
    test('are printed as an envelope on stderr with a stable exit code', () => {
      const { status, stdout, stderr } = henri(
        ['generate', 'nope', 'Thing', '--json'],
        { cwd: app }
      );

      expect(status).toBe(2);
      expect(stdout).toBe('');
      expect(parse(stderr)).toEqual({
        error: {
          code: 'HENRI_CLI_USAGE',
          command: 'generate',
          exitCode: 2,
          hint: expect.stringContaining('Available: agents, authentication'),
          message: 'Unknown generator "nope"',
        },
      });
    });

    test('unknown commands do not print the help in json mode', () => {
      const { status, stdout, stderr } = henri(['nope', '--json'], {
        cwd: dir,
      });

      expect(status).toBe(2);
      expect(stdout).toBe('');
      expect(parse(stderr).error).toMatchObject({
        code: 'HENRI_CLI_USAGE',
        command: 'nope',
        exitCode: 2,
      });
    });

    test('outside of a project the code is NOT_A_PROJECT and the exit code 3', () => {
      const { status, stderr } = henri(['routes', '--json'], { cwd: dir });

      expect(status).toBe(3);
      expect(parse(stderr).error).toMatchObject({
        code: 'HENRI_CLI_NOT_A_PROJECT',
        command: 'routes',
        exitCode: 3,
        hint: expect.stringContaining('henri new <name>'),
      });
    });

    test('unexpected failures are FAILED with the debug hint', () => {
      const routes = path.join(app, 'config', 'routes.js');
      const original = fs.readFileSync(routes, 'utf8');

      fs.writeFileSync(routes, 'module.exports = {');

      const { status, stderr } = henri(['routes', '--json'], { cwd: app });

      fs.writeFileSync(routes, original);

      expect(status).toBe(1);
      expect(parse(stderr).error).toMatchObject({
        code: 'HENRI_CLI_FAILED',
        command: 'routes',
        exitCode: 1,
        hint: expect.stringContaining('--debug=henri:*'),
      });
    });
  });
});

describe('henri clean without a terminal', () => {
  let dir;
  let app;

  beforeAll(() => {
    ({ app, dir } = scaffold(['--no-git']));
  });

  afterAll(() => {
    cleanup(dir);
  });

  test('says there is nothing to clean', () => {
    const { status, stdout } = henri(['clean'], { cwd: app });

    expect(status).toBe(0);
    expect(stdout).toContain('Nothing to clean');
  });

  test('fails fast with a hint instead of prompting', () => {
    fs.mkdirSync(path.join(app, '.tmp'));
    fs.writeFileSync(path.join(app, '.tmp', 'junk'), 'x');
    fs.mkdirSync(path.join(app, 'logs'));

    const { status, stderr } = henri(['clean'], { cwd: app });

    expect(status).toBe(4);
    expect(stderr).toContain('needs a terminal');
    expect(stderr).toContain('--all');
    expect(stderr).toContain('henri clean .tmp logs');
    expect(fs.existsSync(path.join(app, '.tmp', 'junk'))).toBe(true);

    const json = henri(['clean', '--json'], { cwd: app });

    expect(json.status).toBe(4);
    expect(JSON.parse(json.stderr).error).toMatchObject({
      code: 'HENRI_CLI_NEEDS_TTY',
      command: 'clean',
      exitCode: 4,
    });
  });

  test('rejects folders it does not know', () => {
    const { status, stderr } = henri(['clean', 'src'], { cwd: app });

    expect(status).toBe(2);
    expect(stderr).toContain('"src" is not something henri cleans');
  });

  test('removes the listed folders, or all of them with --all', () => {
    const listed = henri(['clean', 'logs', '--json'], { cwd: app });

    expect(listed.status).toBe(0);
    expect(JSON.parse(listed.stdout)).toEqual({ removed: ['logs'] });
    expect(fs.existsSync(path.join(app, '.tmp', 'junk'))).toBe(true);

    const all = henri(['clean', '--all', '--json'], { cwd: app });

    expect(all.status).toBe(0);
    expect(JSON.parse(all.stdout)).toEqual({ removed: ['.tmp', 'logs'] });
    expect(fs.existsSync(path.join(app, '.tmp', 'junk'))).toBe(false);
    expect(fs.existsSync(path.join(app, '.tmp'))).toBe(true);

    const yes = henri(['clean', '-y'], { cwd: app });

    expect(yes.status).toBe(0);
    expect(yes.stdout).toContain('Deleting .tmp');
  });
});
