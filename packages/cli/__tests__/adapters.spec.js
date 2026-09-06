const fs = require('fs');
const path = require('path');

const { hooksFor } = require('@usehenri/core/src/base/hooks');
const { modelErrors } = require('@usehenri/core/src/base/model-errors');

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

  test('drizzle on sqlite is the default', () => {
    const { app } = scaffoldWith(dir, 'plain');

    expect(storeOf(app)).toEqual({
      adapter: 'drizzle',
      dialect: 'sqlite',
      url: 'file:.henri/app.db',
    });
    expect(storeOf(app, 'test').url).toBe(':memory:');
    expect(depsOf(app)['@usehenri/drizzle']).toBe(`^${version}`);
    expect(depsOf(app)['better-sqlite3']).toMatch(/^\^\d+\./);
    expect(depsOf(app)['@usehenri/disk']).toBeUndefined();
  });

  test('disk is still one flag away, and installs nothing', () => {
    const { app } = scaffoldWith(dir, 'zero', ['--adapter', 'disk']);

    expect(storeOf(app)).toEqual({ adapter: 'disk' });
    expect(exists(app, 'config/test.json')).toBe(false);
    expect(depsOf(app)['@usehenri/disk']).toBe(`^${version}`);
    expect(depsOf(app)['@usehenri/drizzle']).toBeUndefined();
    expect(depsOf(app)['better-sqlite3']).toBeUndefined();
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
    // --dialect alone means the default adapter, which is drizzle
    const postgres = scaffoldWith(dir, 'dzpg', ['--dialect', 'postgres']).app;

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
    expect(unknown.stderr).toContain('disk, drizzle, mongoose, mssql');
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
        'mongoose',
        '--dialect',
        'sqlite',
      ],
      { cwd: dir }
    );

    expect(misplaced.status).toBe(2);
    expect(misplaced.stderr).toContain('--dialect only applies to');
  });

  // `@usehenri/postgresql` and `@usehenri/mysql` are `@usehenri/drizzle`
  // with the dialect and the driver chosen, so these adapters write a
  // store with no `dialect` key and no driver of the application's own
  test.each([
    ['postgresql', '@usehenri/postgresql', 'pg', 'postgres://postgres@'],
    ['mysql', '@usehenri/mysql', 'mysql2', 'mysql://root@'],
  ])(
    '%s is drizzle with the dialect and the driver chosen',
    (adapter, dependency, driver, prefix) => {
      const name = `sql-${adapter}`;
      const { app } = scaffoldWith(dir, name, ['--adapter', adapter]);
      const deps = depsOf(app);

      expect(storeOf(app)).toEqual({
        adapter,
        url: expect.stringContaining(`${prefix}`),
      });
      expect(storeOf(app, 'test').url).toContain(`${name}_test`);
      expect(deps[dependency]).toBe(`^${version}`);
      // The driver comes with the adapter package
      expect(deps[driver]).toBeUndefined();
      expect(deps['@usehenri/drizzle']).toBeUndefined();
      // The migrations of a drizzle store, on a store that never names it
      expect(read(app, 'README.md')).toContain('henri db:generate');
      expect(doctor(app).summary.errors).toBe(0);

      // ... and the generators write drizzle controllers for it
      expect(read(app, 'app/controllers/tasks.js')).not.toContain('CastError');
      expect(read(app, 'app/controllers/main.js')).toContain('Task.find()');
    }
  );

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

    // The better-sqlite3 tarball carries a binding.gyp, so pnpm 11 fails
    // an install that meets it and finds no answer in allowBuilds. The
    // answer is `false`: it ships the compiled addon for every platform
    // henri runs on, and building it needs a toolchain and produces
    // nothing that gets loaded.
    const workspace = read(app, 'pnpm-workspace.yaml');

    expect(workspace).toMatch(/^ {2}better-sqlite3: false$/m);
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

  test('drizzle: findById without a cast guard, instances destroy themselves', () => {
    const { app } = scaffoldWith(dir, 'dz', ['--adapter', 'drizzle']);
    const controller = read(app, 'app/controllers/tasks.js');

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

  test('sequelize: findById and instance updates', () => {
    // The mssql store is the sequelize scaffold `henri new` still writes
    const { app } = scaffoldWith(dir, 'ms', ['--adapter', 'mssql']);
    const controller = read(app, 'app/controllers/tasks.js');

    // The lookup is `findById()`, henri's name on every store, and it takes
    // the public identifier of the row as well as its primary key
    expect(controller).toContain('Task.findById(id)');
    expect(controller).toContain('task.update(req.permit(...FIELDS))');
    expect(controller).toContain('task.destroy()');
    expect(controller).not.toContain('findByIdAndUpdate');
    // The template home page lists every task with the mongoose name
    expect(read(app, 'app/controllers/main.js')).toContain('Task.findAll()');
  });

  test('mongoose: the cast guard and the document methods', () => {
    const { app } = scaffoldWith(dir, 'mg', ['--adapter', 'mongoose']);
    const controller = read(app, 'app/controllers/tasks.js');

    expect(controller).toContain('byId(Task.findById(req.params.id))');
    expect(controller).toContain('req.task.set(req.permit(...FIELDS))');
    expect(controller).toContain('req.task.deleteOne()');
    expect(controller).toContain('CastError');
  });

  test('the index and the 422 are the same code on the three flavours', () => {
    const generator = require('../scripts/generate/controllers');
    const resource = {
      doc: 'Task',
      keys: ['name'],
      lower: 'task',
      plural: 'tasks',
    };
    const written = ['drizzle', 'mongoose', 'sequelize'].map((api) =>
      generator.resources({ ...resource, api })
    );

    for (const code of written) {
      // Model.paginate() and henri.model.errors() answer the same shape on
      // every adapter, so neither needs a flavour
      expect(code).toContain(
        'await Task.paginate(\n      req.pagination()\n    )'
      );
      expect(code).toContain('const errors = henri.model.errors(error);');
      expect(code).not.toContain('countDocuments()');
      expect(code).not.toContain('req.pagination();');
    }
  });

  test('the generators read the adapter back from the configuration', () => {
    const { app } = scaffoldWith(dir, 'gen', ['--adapter', 'drizzle']);
    const { status } = henri(['g', 'crud', 'Note', 'body:text'], { cwd: app });
    const controller = read(app, 'app/controllers/notes.js');

    expect(status).toBe(0);
    expect(controller).toContain(
      'req.note = await Note.findById(req.params.id)'
    );
    expect(controller).not.toContain('CastError');
  });

  test('AGENTS.md and the README describe the store', () => {
    const { app } = scaffoldWith(dir, 'docs', ['--adapter', 'drizzle']);
    const agents = read(app, 'AGENTS.md');

    expect(agents).toContain('store `drizzle`');
    expect(agents).toContain('henri db:generate');
    expect(agents).toContain('db/migrations');
    expect(agents).not.toContain('{{');
    // The budget of new.spec.js, on the store with the most to say
    expect(agents.split('\n').length).toBeLessThan(150);

    const readme = read(app, 'README.md');

    expect(readme).toContain('henri db:status');
    expect(readme).toContain('file:.henri/app.db');
  });

  test('the react scaffold follows the adapter and its own renderer', () => {
    const { app } = scaffoldWith(dir, 'next', [
      '--renderer',
      'react',
      '--adapter',
      'drizzle',
    ]);
    const controller = read(app, 'app/controllers/tasks.js');

    // The adapter decides the lookup, the renderer what a browser gets back
    // from a failed write: the React forms read a 422
    expect(controller).toContain(
      'req.task = await Task.findById(req.params.id)'
    );
    expect(controller).not.toContain('CastError');
    expect(controller).toContain('return invalid(res, error);');
    expect(controller).not.toContain('res.inertia');
    expect(exists(app, 'app/views/pages/tasks/index.js')).toBe(true);
    expect(exists(app, 'app/views/pages/tasks/index.jsx')).toBe(false);
    expect(doctor(app).summary.errors).toBe(0);
  });

  test('the inertia scaffold renders the page again on a failed write', () => {
    const { app } = scaffoldWith(dir, 'inertia', ['--adapter', 'drizzle']);
    const controller = read(app, 'app/controllers/tasks.js');

    expect(controller).toContain(
      'req.task = await Task.findById(req.params.id)'
    );
    expect(controller).toContain("invalid(res, error, '/tasks/new')");
    expect(controller).toContain('res.inertia.errors(errors)');
    // An API client still gets the 422, on the same route
    expect(controller).toContain('res.boom.badData(error.message, { errors })');
    expect(exists(app, 'app/views/pages/tasks/index.jsx')).toBe(true);
    expect(doctor(app).summary.errors).toBe(0);
  });
});

describe('the generated controllers run on their adapter', () => {
  let dir;
  let app;

  beforeAll(() => {
    dir = tmpdir('henri-adapter-run-');
    ({ app } = scaffoldWith(dir, 'runner', ['--adapter', 'drizzle']));
    // Every flavour answers its 422 through henri.model.errors()
    global.henri = { model: { errors: modelErrors } };
  });

  afterAll(() => {
    cleanup(dir);
    delete global.henri;
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
   * A fake drizzle model: paginate() answers the shared page shape, ids are
   * integers and an invalid write throws a ValidationError keyed by field
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
    const invalid = () => {
      const error = new Error('Task validation failed: name: is required');

      error.name = 'ValidationError';
      error.errors = { name: { message: 'is required' } };

      return error;
    };

    return {
      calls,
      model: {
        create: async (data) => {
          if (!data.name) {
            throw invalid();
          }

          return { id: 2, ...data };
        },
        findById: async (id) => (String(id) === '1' ? rows[0] : null),
        paginate: async (options) => {
          calls.paginate = options;

          return {
            page: options.page,
            pages: 1,
            perPage: options.perPage,
            records: rows,
            total: rows.length,
          };
        },
      },
    };
  };

  test('index pages with paginate() and answers a HAL collection', async () => {
    const fake = drizzleModel();

    global.Task = fake.model;

    const controller = require(path.join(app, 'app/controllers/tasks.js'));
    const res = fakeRes();

    await controller.index(fakeReq(), res);

    // One call, handed what req.pagination() returned
    expect(fake.calls.paginate).toEqual({
      limit: 25,
      page: 1,
      perPage: 25,
      skip: 0,
    });
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
    global.Task = drizzleModel().model;

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
    global.Task = drizzleModel().model;

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
    global.Task = drizzleModel().model;

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
     * destroy themselves, and a validation error carries an array of items
     * (the shape henri.model.errors() normalizes)
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
          create: async (data) => {
            calls.created = data;
            if (!data.name) {
              throw invalid();
            }

            return row(2, data);
          },
          findById: async (id) => {
            if (id === 'unknown') {
              const error = new Error('invalid input syntax for type integer');

              error.name = 'SequelizeDatabaseError';

              throw error;
            }

            return String(id) === '1' ? row(1, { name: 'one' }) : null;
          },
          paginate: async (options) => {
            calls.paginate = options;

            return {
              page: options.page,
              pages: 1,
              perPage: options.perPage,
              records: [row(1, { name: 'one' })],
              total: 1,
            };
          },
        },
      };
    };

    beforeAll(() => {
      const scaffolded = scaffoldWith(dir, 'sqlrunner', ['--adapter', 'mssql']);

      sql = path.join(scaffolded.app, 'app/controllers/tasks.js');
    });

    test('index pages with the same paginate() call', async () => {
      const fake = sequelizeModel();

      global.Task = fake.model;

      const controller = require(sql);
      const res = fakeRes();

      await controller.index(fakeReq(), res);

      expect(fake.calls.paginate).toEqual({
        limit: 25,
        page: 1,
        perPage: 25,
        skip: 0,
      });
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
