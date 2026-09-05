const fs = require('fs');
const path = require('path');

const { hooksFor } = require('@usehenri/core/src/base/hooks');

const { version } = require('../package.json');
const { cleanup, exists, henri, read, tmpdir } = require('./helpers');

/**
 * Runs the `before` hooks of an action and then the action, the way henri's
 * router does (a hook that answers ends the request)
 *
 * @param {object} controller The generated controller
 * @param {string} action The action name
 * @param {object} req The request
 * @param {object} res The response
 * @returns {Promise<*>} What the action returned, or nothing
 */
const run = async (controller, action, req, res) => {
  for (const hook of hooksFor(controller.before, action, controller)) {
    await hook(req, res);

    if (res.calls.length > 0) {
      return undefined;
    }
  }

  return controller[action](req, res);
};

/**
 * Scaffold an application on an adapter in a temporary directory
 *
 * @param {string} dir The parent directory
 * @param {string} name The application folder
 * @param {string[]} [flags=[]] Extra flags (--adapter, --dialect, ...)
 * @returns {{app: string, result: object}} The path and the spawn result
 */
const scaffoldWith = (dir, name, flags = []) => {
  const result = henri(['new', name, '--skip-install', '--no-git', ...flags], {
    cwd: dir,
  });

  if (result.status !== 0) {
    throw new Error(`henri new failed: ${result.stdout}${result.stderr}`);
  }

  return { app: path.join(dir, name), result };
};

/**
 * The store of config/default.json
 *
 * @param {string} app Application directory
 * @param {string} [file='default'] The configuration file
 * @returns {object} The default store
 */
const storeOf = (app, file = 'default') =>
  JSON.parse(read(app, `config/${file}.json`)).stores.default;

/**
 * Every dependency of the application, dev included
 *
 * @param {string} app Application directory
 * @returns {object} name -> range
 */
const depsOf = (app) => {
  const pkg = JSON.parse(read(app, 'package.json'));

  return { ...pkg.dependencies, ...pkg.devDependencies };
};

/**
 * Run henri doctor on an application
 *
 * @param {string} app Application directory
 * @returns {object} The report
 */
const doctor = (app) => {
  const { stdout } = henri(['doctor', '--json'], { cwd: app });

  return JSON.parse(stdout);
};

describe('henri new --adapter', () => {
  let dir;

  beforeAll(() => {
    dir = tmpdir('henri-adapters-');
  });

  afterAll(() => {
    cleanup(dir);
  });

  test('disk stays the default', () => {
    const { app } = scaffoldWith(dir, 'plain');

    expect(storeOf(app)).toEqual({ adapter: 'disk' });
    expect(exists(app, 'config/test.json')).toBe(false);
    expect(depsOf(app)['@usehenri/disk']).toBe(`^${version}`);
    expect(depsOf(app)['@usehenri/drizzle']).toBeUndefined();
  });

  test('drizzle writes a sqlite store, its driver and a test database', () => {
    const { app } = scaffoldWith(dir, 'dz', ['--adapter', 'drizzle']);

    expect(storeOf(app)).toEqual({
      adapter: 'drizzle',
      dialect: 'sqlite',
      url: 'file:.henri/app.db',
    });
    expect(storeOf(app, 'test')).toEqual({
      adapter: 'drizzle',
      dialect: 'sqlite',
      url: ':memory:',
    });

    const deps = depsOf(app);

    expect(deps['@usehenri/drizzle']).toBe(`^${version}`);
    expect(deps['better-sqlite3']).toMatch(/^\^\d+\./);
    expect(deps['@usehenri/disk']).toBeUndefined();
    expect(doctor(app).summary.errors).toBe(0);
  });

  test('drizzle --dialect postgres and mysql pick the driver and the url', () => {
    const postgres = scaffoldWith(dir, 'dzpg', [
      '--adapter',
      'drizzle',
      '--dialect',
      'postgres',
    ]).app;

    expect(storeOf(postgres)).toEqual({
      adapter: 'drizzle',
      dialect: 'postgres',
      url: 'postgres://postgres@127.0.0.1:5432/dzpg',
    });
    expect(storeOf(postgres, 'test').url).toBe(
      'postgres://postgres@127.0.0.1:5432/dzpg_test'
    );
    expect(depsOf(postgres).pg).toMatch(/^\^\d+\./);
    expect(depsOf(postgres)['better-sqlite3']).toBeUndefined();

    const mysql = scaffoldWith(dir, 'dzmy', [
      '--adapter',
      'drizzle',
      '--dialect',
      'mysql',
    ]).app;

    expect(storeOf(mysql).url).toBe('mysql://root@127.0.0.1:3306/dzmy');
    expect(depsOf(mysql).mysql2).toMatch(/^\^\d+\./);
    expect(doctor(mysql).summary.errors).toBe(0);
  });

  test.each([
    ['mongoose', '@usehenri/mongoose', 'mongodb://127.0.0.1:27017/'],
    ['mysql', '@usehenri/mysql', 'mysql://root@127.0.0.1:3306/'],
    [
      'postgresql',
      '@usehenri/postgresql',
      'postgres://postgres@127.0.0.1:5432/',
    ],
    ['mssql', '@usehenri/mssql', 'mssql://sa@127.0.0.1:1433/'],
  ])(
    '%s writes its store, its package and a test database',
    (adapter, dependency, prefix) => {
      const name = `app-${adapter}`;
      const { app } = scaffoldWith(dir, name, ['--adapter', adapter]);

      expect(storeOf(app)).toEqual({ adapter, url: `${prefix}${name}` });
      expect(storeOf(app, 'test').url).toBe(`${prefix}${name}_test`);
      expect(depsOf(app)[dependency]).toBe(`^${version}`);
      expect(depsOf(app)['@usehenri/disk']).toBeUndefined();
      expect(doctor(app).summary.errors).toBe(0);
    }
  );

  test('rejects an unknown adapter and a misplaced dialect', () => {
    const unknown = henri(
      ['new', 'nope', '--skip-install', '--no-git', '--adapter', 'redis'],
      { cwd: dir }
    );

    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain("Unknown adapter 'redis'");
    expect(unknown.stderr).toContain('disk, drizzle, mongoose');
    expect(fs.existsSync(path.join(dir, 'nope', 'package.json'))).toBe(false);

    const dialect = henri(
      [
        'new',
        'nope2',
        '--skip-install',
        '--no-git',
        '--adapter',
        'drizzle',
        '--dialect',
        'oracle',
      ],
      { cwd: dir }
    );

    expect(dialect.status).toBe(2);
    expect(dialect.stderr).toContain("Unknown dialect 'oracle'");
    expect(dialect.stderr).toContain('mysql, postgres, sqlite');

    const misplaced = henri(
      [
        'new',
        'nope3',
        '--skip-install',
        '--no-git',
        '--adapter',
        'mysql',
        '--dialect',
        'sqlite',
      ],
      { cwd: dir }
    );

    expect(misplaced.status).toBe(2);
    expect(misplaced.stderr).toContain('--dialect only applies to');
  });

  test('henri init takes the same flags and allows the driver build for pnpm', () => {
    const app = path.join(dir, 'initialized');

    fs.mkdirSync(app);
    fs.writeFileSync(
      path.join(app, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@11.25.0' })
    );

    const { status } = henri(
      ['init', '--skip-install', '--no-git', '--adapter', 'drizzle'],
      { cwd: app }
    );

    expect(status).toBe(0);
    expect(storeOf(app).dialect).toBe('sqlite');

    // The better-sqlite3 native addon compiles: pnpm 11 fails the install
    // when the build script is not allow-listed
    const workspace = read(app, 'pnpm-workspace.yaml');

    expect(workspace).toMatch(/^ {2}better-sqlite3: true$/m);
    expect(workspace.indexOf('better-sqlite3')).toBeLessThan(
      workspace.indexOf('esbuild')
    );
  });
});

describe('the scaffolded resource follows the adapter', () => {
  let dir;

  beforeAll(() => {
    dir = tmpdir('henri-adapter-code-');
  });

  afterAll(() => {
    cleanup(dir);
  });

  test('drizzle: a relation for the page, no cast guard', () => {
    const { app } = scaffoldWith(dir, 'dz', ['--adapter', 'drizzle']);
    const controller = read(app, 'app/controllers/tasks.js');

    expect(controller).toContain('Task.query().offset(skip).limit(limit)');
    expect(controller).toContain('Task.count()');
    // The before hook loads the record; findById() already answers null for
    // a malformed id, so there is no cast to guard
    expect(controller).toContain(
      'req.task = await Task.findById(req.params.id)'
    );
    expect(controller).toContain('req.task.destroy()');
    expect(controller).not.toContain('countDocuments');
    expect(controller).not.toContain('CastError');
    expect(read(app, 'app/controllers/main.js')).toContain('Task.find()');
  });

  test('sequelize: findAll, findByPk and instance updates', () => {
    const { app } = scaffoldWith(dir, 'pg', ['--adapter', 'postgresql']);
    const controller = read(app, 'app/controllers/tasks.js');

    expect(controller).toContain('Task.findAll({ limit, offset: skip })');
    expect(controller).toContain('Task.findByPk(id)');
    expect(controller).toContain('task.update(req.permit(...FIELDS))');
    expect(controller).toContain('task.destroy()');
    expect(controller).not.toContain('findByIdAndUpdate');
    // The template home page lists every task with the mongoose name
    expect(read(app, 'app/controllers/main.js')).toContain('Task.findAll()');
  });

  test('mongoose: the scaffold is unchanged', () => {
    const { app } = scaffoldWith(dir, 'mg', ['--adapter', 'mongoose']);
    const controller = read(app, 'app/controllers/tasks.js');

    expect(controller).toContain('Task.find().skip(skip).limit(limit)');
    expect(controller).toContain('Task.countDocuments()');
    expect(controller).toContain('CastError');
  });

  test('the generators read the adapter back from the configuration', () => {
    const { app } = scaffoldWith(dir, 'gen', ['--adapter', 'drizzle']);
    const { status } = henri(['g', 'crud', 'Note', 'body:text'], { cwd: app });

    expect(status).toBe(0);
    expect(read(app, 'app/controllers/notes.js')).toContain(
      'Note.query().offset(skip).limit(limit)'
    );
  });

  test('AGENTS.md and the README describe the store', () => {
    const { app } = scaffoldWith(dir, 'docs', ['--adapter', 'drizzle']);
    const agents = read(app, 'AGENTS.md');

    expect(agents).toContain('store `drizzle`');
    expect(agents).toContain('henri db:generate|migrate|push|status');
    expect(agents).not.toContain('{{');
    // The longest combination (inertia + drizzle); see new.spec.js
    expect(agents.split('\n').length).toBeLessThan(160);

    const readme = read(app, 'README.md');

    expect(readme).toContain('henri db:status');
    expect(readme).toContain('file:.henri/app.db');
  });

  test('the inertia sample is ported to the store too', () => {
    const { app } = scaffoldWith(dir, 'inertia', [
      '--renderer',
      'inertia',
      '--adapter',
      'drizzle',
    ]);
    const controller = read(app, 'app/controllers/tasks.js');

    expect(controller).toContain("Task.order('createdAt desc')");
    expect(controller).toContain('Task.findByIdAndDelete(req.params.id)');
    expect(controller).not.toContain('.lean()');
    expect(controller).not.toContain('deleteOne');
    expect(doctor(app).summary.errors).toBe(0);
  });
});

describe('the generated controllers run on their adapter', () => {
  let dir;
  let app;

  beforeAll(() => {
    dir = tmpdir('henri-adapter-run-');
    ({ app } = scaffoldWith(dir, 'runner', ['--adapter', 'drizzle']));
  });

  afterAll(() => {
    cleanup(dir);
  });

  /**
   * A fake response recording what the controller answered
   *
   * @returns {object} The response
   */
  const fakeRes = () => {
    const res = { calls: [] };

    res.json = (body) => res.calls.push(['json', body]) && res;
    res.negotiate = (handlers) => handlers.json();
    res.render = (route, opts) =>
      res.calls.push(['render', route, opts]) && res;
    res.redirect = (url) => res.calls.push(['redirect', url]) && res;
    res.resource = (record, opts = {}) =>
      res.calls.push(['resource', opts.status || 200, record]) && res;
    res.collection = (records, meta) =>
      res.calls.push(['collection', records, meta]) && res;
    res.status = (code) => ({
      end: () => res.calls.push(['end', code]) && res,
    });
    res.boom = {
      badData: (message, data) =>
        res.calls.push(['badData', 422, message, data]) && res,
      notFound: (message) => res.calls.push(['notFound', 404, message]) && res,
    };

    return res;
  };

  /**
   * A fake request with req.permit and req.pagination
   *
   * @param {object} [body={}] Request body
   * @param {object} [params={}] Route params
   * @returns {object} The request
   */
  const fakeReq = (body = {}, params = {}) => ({
    body,
    pagination: () => ({ limit: 25, page: 1, perPage: 25, skip: 0 }),
    params,
    permit: (...fields) =>
      Object.fromEntries(
        fields
          .filter((field) => typeof body[field] !== 'undefined')
          .map((field) => [field, body[field]])
      ),
  });

  /**
   * A fake drizzle model: a chainable relation, ids that are integers and
   * a ValidationError with one entry per field
   *
   * @returns {object} The model
   */
  const drizzleModel = () => {
    const calls = {};
    // The methods are hidden so a row still compares to its attributes
    const row = (attrs) => {
      const instance = { ...attrs };
      const hidden = {
        destroy: async () => {
          calls.destroyed = instance.id;
        },
        update: async (data) => {
          if (data.name === '') {
            throw invalid();
          }
          calls.updated = data;
          Object.assign(instance, data);

          return instance;
        },
      };

      for (const [name, value] of Object.entries(hidden)) {
        Object.defineProperty(instance, name, { enumerable: false, value });
      }

      return instance;
    };
    const rows = [row({ id: 1, name: 'one' })];
    const relation = {
      limit: () => relation,
      offset: () => relation,
      then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
    };
    const invalid = () => {
      const error = new Error('Task validation failed: name: is required');

      error.name = 'ValidationError';
      error.errors = { name: { message: 'is required' } };

      return error;
    };

    return {
      count: async () => rows.length,
      create: async (data) => {
        if (!data.name) {
          throw invalid();
        }

        return { id: 2, ...data };
      },
      findById: async (id) => (String(id) === '1' ? rows[0] : null),
      findByIdAndDelete: async (id) => (String(id) === '1' ? rows[0] : null),
      findByIdAndUpdate: async (id, data) => {
        if (data.name === '') {
          throw invalid();
        }

        return String(id) === '1' ? { id: 1, ...data } : null;
      },
      query: () => relation,
    };
  };

  test('index pages with a relation and answers a HAL collection', async () => {
    global.Task = drizzleModel();

    const controller = require(path.join(app, 'app/controllers/tasks.js'));
    const res = fakeRes();

    await controller.index(fakeReq(), res);

    expect(res.calls).toEqual([
      [
        'collection',
        [{ id: 1, name: 'one' }],
        { page: 1, perPage: 25, total: 1 },
      ],
    ]);

    delete global.Task;
  });

  test('the before hook answers 404 for an id the store does not know', async () => {
    global.Task = drizzleModel();

    const controller = require(path.join(app, 'app/controllers/tasks.js'));
    const missing = fakeRes();
    const found = fakeRes();

    await run(controller, 'show', fakeReq({}, { id: 'unknown' }), missing);
    await run(controller, 'show', fakeReq({}, { id: '1' }), found);

    expect(missing.calls).toEqual([
      ['notFound', 404, 'Task unknown not found'],
    ]);
    expect(found.calls).toEqual([['resource', 200, { id: 1, name: 'one' }]]);

    delete global.Task;
  });

  test('create answers 201, or 422 with one message per field', async () => {
    global.Task = drizzleModel();

    const controller = require(path.join(app, 'app/controllers/tasks.js'));
    const created = fakeRes();
    const rejected = fakeRes();

    await controller.create(
      fakeReq({ name: 'two', roles: ['admin'] }),
      created
    );
    await controller.create(fakeReq({}), rejected);

    expect(created.calls).toEqual([['resource', 201, { id: 2, name: 'two' }]]);
    expect(rejected.calls).toEqual([
      [
        'badData',
        422,
        'Task validation failed: name: is required',
        { errors: { name: 'is required' } },
      ],
    ]);

    delete global.Task;
  });

  test('destroy answers 204 and 404', async () => {
    global.Task = drizzleModel();

    const controller = require(path.join(app, 'app/controllers/tasks.js'));
    const gone = fakeRes();
    const missing = fakeRes();

    await run(controller, 'destroy', fakeReq({}, { id: '1' }), gone);
    await run(controller, 'destroy', fakeReq({}, { id: '9' }), missing);

    expect(gone.calls).toEqual([['end', 204]]);
    expect(missing.calls).toEqual([['notFound', 404, 'Task 9 not found']]);

    delete global.Task;
  });

  describe('on a sequelize store', () => {
    let sql;

    /**
     * A fake Sequelize model: findByPk on an integer key throws a
     * SequelizeDatabaseError for a malformed id, instances update and
     * destroy themselves, and errors carry an array of items
     *
     * @returns {object} The model
     */
    const sequelizeModel = () => {
      const calls = {};
      const invalid = () => {
        const error = new Error('notNull Violation: Task.name cannot be null');

        error.name = 'SequelizeValidationError';
        error.errors = [{ message: 'Task.name cannot be null', path: 'name' }];

        return error;
      };
      const row = (id, attrs) => ({
        destroy: async () => {
          calls.destroyed = id;
        },
        id,
        update: async (data) => {
          if (data.name === '') {
            throw invalid();
          }
          calls.updated = data;

          return { id, ...attrs, ...data };
        },
        ...attrs,
      });

      return {
        calls,
        model: {
          count: async () => 1,
          create: async (data) => {
            calls.created = data;
            if (!data.name) {
              throw invalid();
            }

            return row(2, data);
          },
          findAll: async (options) => {
            calls.findAll = options;

            return [row(1, { name: 'one' })];
          },
          findByPk: async (id) => {
            if (id === 'unknown') {
              const error = new Error('invalid input syntax for type integer');

              error.name = 'SequelizeDatabaseError';

              throw error;
            }

            return String(id) === '1' ? row(1, { name: 'one' }) : null;
          },
        },
      };
    };

    beforeAll(() => {
      const scaffolded = scaffoldWith(dir, 'sqlrunner', [
        '--adapter',
        'postgresql',
      ]);

      sql = path.join(scaffolded.app, 'app/controllers/tasks.js');
    });

    test('index pages with limit and offset', async () => {
      const fake = sequelizeModel();

      global.Task = fake.model;

      const controller = require(sql);
      const res = fakeRes();

      await controller.index(fakeReq(), res);

      expect(fake.calls.findAll).toEqual({ limit: 25, offset: 0 });
      expect(res.calls[0][0]).toBe('collection');
      expect(res.calls[0][2]).toEqual({ page: 1, perPage: 25, total: 1 });

      delete global.Task;
    });

    test('a malformed id is a 404, not a 500', async () => {
      global.Task = sequelizeModel().model;

      const controller = require(sql);
      const res = fakeRes();

      await run(controller, 'show', fakeReq({}, { id: 'unknown' }), res);

      expect(res.calls).toEqual([['notFound', 404, 'Task unknown not found']]);

      delete global.Task;
    });

    test('the hook loads the row, then update updates it and destroy destroys it', async () => {
      const fake = sequelizeModel();

      global.Task = fake.model;

      const controller = require(sql);
      const updated = fakeRes();
      const gone = fakeRes();

      await run(
        controller,
        'update',
        fakeReq({ name: 'two' }, { id: '1' }),
        updated
      );
      await run(controller, 'destroy', fakeReq({}, { id: '1' }), gone);

      expect(fake.calls.updated).toEqual({ name: 'two' });
      expect(updated.calls[0][0]).toBe('resource');
      expect(fake.calls.destroyed).toBe(1);
      expect(gone.calls).toEqual([['end', 204]]);

      delete global.Task;
    });

    test('a validation error is a 422 with one message per field', async () => {
      global.Task = sequelizeModel().model;

      const controller = require(sql);
      const res = fakeRes();

      await controller.create(fakeReq({}), res);

      expect(res.calls).toEqual([
        [
          'badData',
          422,
          'notNull Violation: Task.name cannot be null',
          { errors: { name: 'Task.name cannot be null' } },
        ],
      ]);

      delete global.Task;
    });
  });
});
