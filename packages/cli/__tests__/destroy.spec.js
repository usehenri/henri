const fs = require('fs');
const path = require('path');

const { cleanup, exists, henri, routesOf, scaffold } = require('./helpers');

/**
 * Generate a Post scaffold and a locations controller in an app
 *
 * @param {string} app Application directory
 * @returns {void}
 */
const populate = (app) => {
  for (const args of [
    ['g', 'scaffold', 'Post', 'title:string'],
    ['g', 'controller', 'locations', 'index', 'gps'],
    ['g', 'worker', 'cleanup'],
    ['g', 'job', 'welcome'],
    ['g', 'mailer', 'welcome', 'confirm'],
    ['g', 'test', 'things'],
  ]) {
    const result = henri(args, { cwd: app });

    if (result.status !== 0) {
      throw new Error(result.stdout + result.stderr);
    }
  }
};

describe('henri destroy without git', () => {
  let dir;
  let app;

  beforeAll(() => {
    ({ app, dir } = scaffold(['--no-git']));
    populate(app);
  });

  afterAll(() => {
    cleanup(dir);
  });

  test('prints the usage without a target', () => {
    const { status, stdout } = henri(['destroy'], { cwd: app });

    expect(status).toBe(0);
    expect(stdout).toContain('$ henri destroy <what>');
  });

  test('rejects an unknown target', () => {
    const { status, stderr } = henri(['d', 'nope', 'x'], { cwd: app });

    expect(status).toBe(2);
    expect(stderr).toContain('Unknown target "nope"');
  });

  test('scaffold removes the model, controller, routes and views into a backup', () => {
    const { status, stdout } = henri(['d', 'scaffold', 'Post'], { cwd: app });

    expect(status).toBe(0);
    expect(stdout).toContain('moved to .backup/');
    expect(stdout).toContain('removed route "resources posts"');

    for (const file of [
      'app/models/Post.js',
      'app/controllers/posts.js',
      'app/views/pages/posts',
    ]) {
      expect(exists(app, file)).toBe(false);
    }
    expect(routesOf(app)['resources posts']).toBeUndefined();
    expect(routesOf(app)['get /']).toBe('main#home');

    const [stamp] = fs.readdirSync(path.join(app, '.backup'));
    const backup = path.join(app, '.backup', stamp);

    expect(fs.existsSync(path.join(backup, 'app/models/Post.js'))).toBe(true);
    expect(fs.existsSync(path.join(backup, 'app/controllers/posts.js'))).toBe(
      true
    );
    expect(
      fs.existsSync(path.join(backup, 'app/views/pages/posts/index.js'))
    ).toBe(true);
    expect(fs.existsSync(path.join(backup, 'config/routes.js'))).toBe(true);
  });

  test('controller removes its routes', () => {
    const { status, stdout } = henri(['d', 'controller', 'locations'], {
      cwd: app,
    });

    expect(status).toBe(0);
    expect(stdout).toContain('removed route "get /locations/index"');
    expect(stdout).toContain('removed route "get /locations/gps"');
    expect(exists(app, 'app/controllers/locations.js')).toBe(false);
    expect(Object.keys(routesOf(app))).toEqual(['get /', 'resources tasks']);
  });

  test('route removes one key', () => {
    const { status, stdout } = henri(['d', 'route', 'get', '/'], { cwd: app });

    expect(status).toBe(0);
    expect(stdout).toContain('removed route "get /"');
    expect(routesOf(app)).toEqual({ 'resources tasks': 'tasks' });

    const missing = henri(['d', 'route', 'get /nothing'], { cwd: app });

    expect(missing.status).toBe(0);
    expect(missing.stdout).toContain('no route "get /nothing"');
  });

  test('view, worker, job and test remove their files', () => {
    for (const [args, file] of [
      [['d', 'view', 'tasks'], 'app/views/pages/tasks'],
      [['d', 'worker', 'cleanup'], 'app/workers/cleanup.js'],
      [['d', 'job', 'welcome'], 'app/jobs/welcome.js'],
      [['d', 'test', 'things'], 'test/things.test.js'],
    ]) {
      const { status, stdout } = henri(args, { cwd: app });

      expect(status).toBe(0);
      expect(stdout).toContain(`backed up ${args[1]} @ ${file}`);
      expect(exists(app, file)).toBe(false);
    }
  });

  test('mailer removes the file and its views, keeping the layout', () => {
    const { status, stdout } = henri(['d', 'mailer', 'welcome'], { cwd: app });

    expect(status).toBe(0);
    expect(stdout).toContain('backed up mailer @ app/mailers/welcome.js');
    expect(exists(app, 'app/mailers/welcome.js')).toBe(false);
    expect(exists(app, 'app/views/mailers/welcome')).toBe(false);
    // The layout is shared by every mailer
    expect(exists(app, 'app/views/mailers/layouts/mailer.hbs')).toBe(true);
  });

  test('reports a missing file without failing', () => {
    const { status, stdout } = henri(['d', 'model', 'Ghost'], { cwd: app });

    expect(status).toBe(0);
    expect(stdout).toContain('unable to locate model @ app/models/Ghost.js');
  });
});

describe('henri destroy inside git', () => {
  let dir;
  let app;

  beforeAll(() => {
    ({ app, dir } = scaffold([]));
  });

  afterAll(() => {
    cleanup(dir);
  });

  test('deletes without backups', () => {
    const { status, stdout } = henri(['d', 'scaffold', 'Task'], { cwd: app });

    expect(status).toBe(0);
    expect(stdout).toContain('skipping backups');
    expect(stdout).toContain('removed model @ app/models/Task.js');
    expect(exists(app, '.backup')).toBe(false);
    expect(exists(app, 'app/controllers/tasks.js')).toBe(false);
    expect(exists(app, 'app/views/pages/tasks')).toBe(false);
    expect(routesOf(app)).toEqual({ 'get /': 'main#home' });
  });
});
