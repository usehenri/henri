const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

const { hooksFor } = require('@usehenri/core/src/base/hooks');
const { modelErrors } = require('@usehenri/core/src/base/model-errors');

const { TYPES, parseAttributes } = require('../scripts/generate');
const {
  cleanup,
  exists,
  henri,
  read,
  routesOf,
  scaffold,
} = require('./helpers');

/**
 * Parse a generated file, throws on a syntax error
 *
 * @param {string} app Application directory
 * @param {string} file Relative path
 * @returns {object} The AST
 */
const parseFile = (app, file) =>
  parse(read(app, file), { plugins: ['jsx'], sourceType: 'unambiguous' });

/**
 * A fake express response recording what the controller does with it
 *
 * @returns {object} The response
 */
const fakeRes = () => {
  const res = { calls: [], statusCode: 200 };

  res.status = (code) => {
    res.statusCode = code;

    return res;
  };
  res.json = (body) => {
    res.calls.push(['json', res.statusCode, body]);

    return res;
  };
  res.render = (route, opts) => res.calls.push(['render', route, opts]);
  res.redirect = (url) => res.calls.push(['redirect', url]);
  res.format = (handlers) => handlers.json();
  res.negotiate = (handlers) => handlers.json();
  res.end = () => {
    res.calls.push(['end', res.statusCode]);

    return res;
  };
  res.resource = (record, opts = {}) => {
    res.calls.push(['resource', opts.status || 200, record]);

    return res;
  };
  res.collection = (records, opts = {}) => {
    res.calls.push(['collection', records, opts]);

    return res;
  };
  res.boom = {
    badData: (message, data) => {
      res.calls.push(['badData', 422, message, data]);

      return res;
    },
    notFound: (message) => {
      res.calls.push(['notFound', 404, message]);

      return res;
    },
  };

  return res;
};

/**
 * A fake request with req.permit like core's
 *
 * @param {object} [body={}] Request body
 * @param {object} [params={}] Route params
 * @returns {object} The request
 */
const fakeReq = (body = {}, params = {}) => ({
  body,
  pagination: () => ({ limit: 25, offset: 0, page: 1, perPage: 25, skip: 0 }),
  params,
  permit: (...fields) =>
    Object.fromEntries(
      fields
        .filter((field) => typeof body[field] !== 'undefined')
        .map((field) => [field, body[field]])
    ),
});

/**
 * A fake model with the mongoose methods the controllers use
 *
 * @returns {object} The model and the calls it received
 */
const fakeModel = () => {
  const calls = {};
  const validation = () => {
    const error = new Error('Post validation failed: title: required');

    error.name = 'ValidationError';
    error.errors = { title: { message: 'Path `title` is required.' } };

    return error;
  };
  const cast = () => {
    const error = new Error('Cast to ObjectId failed');

    error.name = 'CastError';

    return error;
  };

  // A document with the mongoose methods the controllers call on it; the
  // methods are hidden so the document still compares to its attributes
  const document = (attributes) => {
    const doc = { ...attributes };
    const hidden = {
      deleteOne: async () => {
        calls.deleted = doc.id;

        return { deletedCount: 1 };
      },
      save: async () => {
        if (!doc.title && !doc.name) {
          throw validation();
        }
        calls.saved = doc.id;

        return doc;
      },
      set: (data) => {
        calls.update = data;
        Object.assign(doc, data);

        return doc;
      },
    };

    for (const [name, value] of Object.entries(hidden)) {
      Object.defineProperty(doc, name, { enumerable: false, value });
    }

    return doc;
  };

  const rows = [{ id: '1', title: 'one' }];

  return {
    calls,
    model: {
      create: async (data) => {
        calls.create = data;
        if (!data.title && !data.name) {
          throw validation();
        }

        return { id: '2', ...data };
      },
      findById: async (id) => {
        if (id === 'bad') {
          throw cast();
        }

        return id === '1' ? document({ id: '1', title: 'one' }) : null;
      },
      // The same shape on every adapter, whatever req.pagination() holds
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

describe('attribute parsing', () => {
  test('accepts every henri type and the required marker', () => {
    const schema = parseAttributes(
      TYPES.map((type, index) => `f${index}:${type}${index % 2 ? '!' : ''}`)
    );

    TYPES.forEach((type, index) => {
      expect(schema[`f${index}`]).toEqual(
        index % 2 ? { required: true, type } : { type }
      );
    });
    expect(parseAttributes(['name'])).toEqual({ name: { type: 'string' } });
    expect(parseAttributes(['name!'])).toEqual({
      name: { required: true, type: 'string' },
    });
    expect(parseAttributes(['Age:Integer'])).toEqual({
      Age: { type: 'integer' },
    });
  });

  test('rejects unknown types with the list of valid ones', () => {
    expect(() => parseAttributes(['score:bigint'])).toThrow(
      /Unknown type "bigint" for attribute "score"\. Valid types: string, text/
    );
    expect(() => parseAttributes([':string'])).toThrow(/Invalid attribute/);
  });
});

describe('henri generate', () => {
  let dir;
  let app;

  beforeAll(() => {
    ({ app, dir } = scaffold());
    // The generated controllers answer a 422 through henri.model.errors()
    global.henri = { model: { errors: modelErrors } };
  });

  afterAll(() => {
    cleanup(dir);
    delete global.henri;
  });

  test('prints the usage without a generator', () => {
    const { status, stdout } = henri(['generate'], { cwd: app });

    expect(status).toBe(0);
    expect(stdout).toContain('$ henri generate <what>');
  });

  test('requires a name', () => {
    const { status, stderr } = henri(['g', 'model'], { cwd: app });

    expect(status).toBe(2);
    expect(stderr).toContain('Missing name');
  });

  describe('model', () => {
    test('writes every type in the henri format', () => {
      const { status, stdout } = henri(
        [
          'g',
          'model',
          'thing',
          'a:string',
          'b:text!',
          'c:number',
          'd:integer',
          'e:float',
          'f:boolean!',
          'g:date',
          'h:json',
          'i:uuid',
        ],
        { cwd: app }
      );

      expect(status).toBe(0);
      expect(stdout).toContain('created model "Thing.js"');

      const model = require(path.join(app, 'app/models/Thing.js'));

      expect(model.options).toEqual({ timestamps: true });
      expect(model.store).toBe('default');
      expect(model.schema).toEqual({
        a: { type: 'string' },
        b: { required: true, type: 'text' },
        c: { type: 'number' },
        d: { type: 'integer' },
        e: { type: 'float' },
        f: { required: true, type: 'boolean' },
        g: { type: 'date' },
        h: { type: 'json' },
        i: { type: 'uuid' },
      });
    });

    test('rejects an unknown type and writes nothing', () => {
      const { status, stderr } = henri(['g', 'model', 'Bad', 'x:bogus'], {
        cwd: app,
      });

      expect(status).toBe(2);
      expect(stderr).toContain('Unknown type "bogus" for attribute "x"');
      expect(stderr).toContain('Valid types: string, text, number');
      expect(exists(app, 'app/models/Bad.js')).toBe(false);
    });

    test('skips an existing file unless --force is given', () => {
      const before = read(app, 'app/models/Thing.js');
      const skipped = henri(['g', 'model', 'Thing', 'other:string'], {
        cwd: app,
      });

      expect(skipped.status).toBe(0);
      expect(skipped.stdout).toContain('skipped model "Thing.js"');
      expect(skipped.stdout).toContain('--force');
      expect(read(app, 'app/models/Thing.js')).toBe(before);

      const forced = henri(['g', 'model', 'Thing', 'other:string', '--force'], {
        cwd: app,
      });

      expect(forced.status).toBe(0);
      expect(forced.stdout).toContain('created model "Thing.js"');
      expect(read(app, 'app/models/Thing.js')).toContain('other');
    });
  });

  describe('controller', () => {
    test('writes the actions and one route per action', () => {
      const { status, stdout } = henri(
        ['g', 'controller', 'Locations', 'index', 'gps'],
        { cwd: app }
      );

      expect(status).toBe(0);
      expect(stdout).toContain('added route "get /locations/index"');

      const controller = require(
        path.join(app, 'app/controllers/locations.js')
      );

      expect(Object.keys(controller)).toEqual(['index', 'gps']);
      expect(routesOf(app)).toMatchObject({
        'get /locations/gps': 'locations#gps',
        'get /locations/index': 'locations#index',
      });
    });
  });

  describe('worker, job and test', () => {
    test('writes a job with perform and a retry policy', () => {
      const { status } = henri(['g', 'job', 'welcome'], { cwd: app });

      expect(status).toBe(0);

      const job = require(path.join(app, 'app/jobs/welcome.js'));

      expect(typeof job.perform).toBe('function');
      expect(job.queue).toBe('default');
      expect(job.maxAttempts).toBe(5);
      expect(read(app, 'app/jobs/welcome.js')).toContain(
        "henri.jobs.perform('welcome', args)"
      );
    });

    test('writes a worker with start and stop', () => {
      const { status } = henri(['g', 'worker', 'cleanup'], { cwd: app });

      expect(status).toBe(0);

      const worker = require(path.join(app, 'app/workers/cleanup.js'));

      expect(worker.name).toBe('cleanup');
      expect(typeof worker.start).toBe('function');
      expect(typeof worker.stop).toBe('function');
    });

    test('writes a mailer, its views and the shared layout', () => {
      const { status } = henri(['g', 'mailer', 'welcome', 'confirm', 'reset'], {
        cwd: app,
      });

      expect(status).toBe(0);
      expect(() => parseFile(app, 'app/mailers/welcome.js')).not.toThrow();

      const mailer = require(path.join(app, 'app/mailers/welcome.js'));

      expect(typeof mailer.confirm).toBe('function');
      expect(typeof mailer.reset).toBe('function');
      expect(mailer.defaults.from).toContain('@');
      expect(mailer.previews.confirm()).toEqual([
        { email: 'ada@example.com', name: 'Ada' },
      ]);
      expect(mailer.confirm({ email: 'a@b.c' })).toMatchObject({
        subject: 'Confirm',
        to: 'a@b.c',
      });

      for (const file of [
        'app/views/mailers/welcome/confirm.hbs',
        'app/views/mailers/welcome/reset.hbs',
        'app/views/mailers/layouts/mailer.hbs',
        'app/views/mailers/layouts/mailer.text.hbs',
      ]) {
        expect(exists(app, file)).toBe(true);
      }

      // The layout is where the signature and the footer live
      expect(read(app, 'app/views/mailers/layouts/mailer.hbs')).toContain(
        '{{{body}}}'
      );
    });

    test('a mailer without actions still gets a view', () => {
      const { status } = henri(['g', 'mailer', 'alerts'], { cwd: app });

      expect(status).toBe(0);
      expect(exists(app, 'app/views/mailers/alerts/notify.hbs')).toBe(true);
    });

    test('writes a test using @usehenri/testing', () => {
      const { status } = henri(['g', 'test', 'things'], { cwd: app });

      expect(status).toBe(0);
      expect(() => parseFile(app, 'test/things.test.js')).not.toThrow();
      expect(read(app, 'test/things.test.js')).toContain(
        "const { request, setup } = require('@usehenri/testing');"
      );
      expect(read(app, 'test/things.test.js')).toContain("get('/things')");
    });
  });

  describe('authentication', () => {
    let auth;
    let authDir;

    beforeAll(() => {
      ({ app: auth, dir: authDir } = scaffold());
      global.henri.accounts = {
        policy: () => ({ maxBytes: 72, minLength: 12 }),
        settings: { signup: { fields: ['name'] } },
      };

      const { status, stdout, stderr } = henri(['g', 'authentication'], {
        cwd: auth,
      });

      if (status !== 0) {
        throw new Error(`henri g authentication failed: ${stdout}${stderr}`);
      }
    }, 120000);

    afterAll(() => {
      cleanup(authDir);
      delete global.henri.accounts;
    });

    test('turns the three flows on in the configuration', () => {
      const config = JSON.parse(read(auth, 'config/default.json'));

      expect(config.user).toMatchObject({
        confirmation: true,
        model: 'user',
        passwordReset: true,
        signup: { fields: ['name'] },
      });
    });

    test('writes the model, the controller, the pages, the mailer and the tests', () => {
      const files = [
        'app/models/User.js',
        'app/controllers/accounts.js',
        'app/views/pages/accounts/login.js',
        'app/views/pages/accounts/new.js',
        'app/views/pages/accounts/forgot.js',
        'app/views/pages/accounts/reset.js',
        'app/views/pages/accounts/confirm.js',
        'app/mailers/auth.js',
        'app/views/mailers/auth/confirm.hbs',
        'app/views/mailers/auth/reset.hbs',
        'app/views/mailers/auth/emailChange.hbs',
        'test/authentication.test.js',
      ];

      for (const file of files) {
        expect(exists(auth, file)).toBe(true);
      }

      for (const file of files.filter((one) => one.endsWith('.js'))) {
        expect(() => parseFile(auth, file)).not.toThrow();
      }
    });

    test('routes the pages, and leaves the endpoints to henri', () => {
      const routes = routesOf(auth);

      expect(routes['get /login']).toBe('accounts#login');
      expect(routes['get /signup']).toBe('accounts#new');
      expect(routes['get /password/forgot']).toBe('accounts#forgot');
      expect(routes['get /password/reset']).toBe('accounts#reset');
      expect(routes['get /confirm']).toBe('accounts#confirm');
      // The mutating half is mounted by the user module, not by the app
      expect(routes['post /signup']).toBeUndefined();
      expect(routes['post /password/forgot']).toBeUndefined();
    });

    test('the forms post to the endpoints henri mounts', () => {
      expect(read(auth, 'app/views/pages/accounts/new.js')).toContain(
        'action="/signup"'
      );
      expect(read(auth, 'app/views/pages/accounts/forgot.js')).toContain(
        'action="/password/forgot"'
      );
      expect(read(auth, 'app/views/pages/accounts/reset.js')).toContain(
        'action="/password/reset"'
      );
      expect(read(auth, 'app/views/pages/accounts/login.js')).toContain(
        'action="/login"'
      );
    });

    test('the controller only renders, and reads the policy for the form', () => {
      const accounts = require(path.join(auth, 'app/controllers/accounts.js'));

      expect(accounts.new()).toEqual({ fields: ['name'], minLength: 12 });
      expect(accounts.reset()).toEqual({ minLength: 12 });
      expect(accounts.confirm({})).toEqual({ email: null });
      expect(accounts.create).toBeUndefined();
      expect(accounts.update).toBeUndefined();
    });

    test('the mailer replaces henri.s messages action by action', () => {
      const mailer = require(path.join(auth, 'app/mailers/auth.js'));
      const message = mailer.reset({ email: 'ada@example.com' }, 'https://x/y');

      expect(message.to).toBe('ada@example.com');
      expect(message.data.url).toBe('https://x/y');
      expect(Object.keys(mailer.previews).sort()).toEqual([
        'confirm',
        'emailChange',
        'reset',
      ]);
    });

    test('writes jsx pages under the inertia renderer', () => {
      const { app: other, dir: otherDir } = scaffold([
        '--no-git',
        '--renderer',
        'inertia',
      ]);

      try {
        expect(henri(['g', 'authentication'], { cwd: other }).status).toBe(0);
        expect(exists(other, 'app/views/pages/accounts/new.jsx')).toBe(true);
        expect(read(other, 'app/views/pages/accounts/new.jsx')).toContain(
          "from '@usehenri/inertia'"
        );
        expect(() =>
          parseFile(other, 'app/views/pages/accounts/new.jsx')
        ).not.toThrow();
      } finally {
        cleanup(otherDir);
      }
    }, 120000);
  });

  describe('scaffold', () => {
    const files = [
      'app/models/Post.js',
      'app/controllers/posts.js',
      'app/views/pages/posts/index.jsx',
      'app/views/pages/posts/new.jsx',
      'app/views/pages/posts/edit.jsx',
      'app/views/pages/posts/show.jsx',
      'app/views/pages/posts/_form.jsx',
    ];

    beforeAll(() => {
      const result = henri(
        ['g', 'scaffold', 'Post', 'title:string!', 'body:text'],
        { cwd: app }
      );

      if (result.status !== 0) {
        throw new Error(result.stdout + result.stderr);
      }
    });

    test('writes a plural, unscoped resource that parses', () => {
      for (const file of files) {
        expect(exists(app, file)).toBe(true);
        expect(() => parseFile(app, file)).not.toThrow();
      }

      expect(routesOf(app)['resources posts']).toBe('posts');
      expect(read(app, 'app/controllers/posts.js')).not.toContain('_scaffold');
    });

    describe('the controller', () => {
      let controller;
      let fake;

      beforeAll(() => {
        fake = fakeModel();
        global.Post = fake.model;
        controller = require(path.join(app, 'app/controllers/posts.js'));
      });

      afterAll(() => {
        delete global.Post;
      });

      test('has the seven resources actions and a before block', () => {
        expect(Object.keys(controller).sort()).toEqual([
          'before',
          'create',
          'destroy',
          'edit',
          'index',
          'new',
          'show',
          'update',
        ]);
        expect(Object.keys(controller.before)).toEqual([
          'show,edit,update,destroy',
        ]);
        expect(hooksFor(controller.before, 'index', controller)).toEqual([]);
        expect(hooksFor(controller.before, 'show', controller)).toHaveLength(1);
      });

      test('new returns instead of answering: henri renders its page', async () => {
        expect(await controller.new()).toEqual({});
      });

      test('index answers a paginated HAL collection to JSON clients', async () => {
        const res = fakeRes();

        await controller.index(fakeReq(), res);

        // One Model.paginate(req.pagination()) call, not a find and a count
        expect(fake.calls.paginate).toEqual({
          limit: 25,
          offset: 0,
          page: 1,
          perPage: 25,
          skip: 0,
        });
        expect(res.calls).toEqual([
          [
            'collection',
            [{ id: '1', title: 'one' }],
            { page: 1, perPage: 25, total: 1 },
          ],
        ]);
      });

      test('index renders the page for browsers', async () => {
        const res = fakeRes();

        res.negotiate = (handlers) => handlers.html();
        await controller.index(fakeReq(), res);

        expect(res.calls).toEqual([
          [
            'render',
            '/posts',
            {
              data: {
                page: 1,
                perPage: 25,
                posts: [{ id: '1', title: 'one' }],
                total: 1,
              },
            },
          ],
        ]);
      });

      test('create permits the attributes and answers 201 with the resource', async () => {
        const res = fakeRes();

        await controller.create(
          fakeReq({ admin: true, body: 'b', title: 't' }),
          res
        );

        expect(fake.calls.create).toEqual({ body: 'b', title: 't' });
        expect(res.calls).toEqual([
          ['resource', 201, { body: 'b', id: '2', title: 't' }],
        ]);
      });

      test('create answers 422 with the errors per field', async () => {
        const res = fakeRes();

        await controller.create(fakeReq({ body: 'b' }), res);

        expect(res.calls).toEqual([
          [
            'badData',
            422,
            'Post validation failed: title: required',
            { errors: { title: 'Path `title` is required.' } },
          ],
        ]);
      });

      test('the before hook answers a 404 for a missing or malformed id', async () => {
        const missing = fakeRes();
        const malformed = fakeRes();
        const req = fakeReq({}, { id: '9' });

        await run(controller, 'show', req, missing);
        await run(controller, 'destroy', fakeReq({}, { id: 'bad' }), malformed);

        expect(missing.calls).toEqual([['notFound', 404, 'Post 9 not found']]);
        expect(malformed.calls).toEqual([
          ['notFound', 404, 'Post bad not found'],
        ]);
      });

      test('show answers the resource loaded by the hook, or renders it', async () => {
        const found = fakeRes();
        const page = fakeRes();

        page.negotiate = (handlers) => handlers.html();

        await run(controller, 'show', fakeReq({}, { id: '1' }), found);
        await run(controller, 'show', fakeReq({}, { id: '1' }), page);

        expect(found.calls).toEqual([
          ['resource', 200, { id: '1', title: 'one' }],
        ]);
        expect(page.calls).toEqual([
          [
            'render',
            '/posts/show',
            { data: { post: { id: '1', title: 'one' } } },
          ],
        ]);
      });

      test('update runs the validators and answers the resource', async () => {
        const res = fakeRes();

        await run(
          controller,
          'update',
          fakeReq({ title: 'new', unknown: 1 }, { id: '1' }),
          res
        );

        expect(fake.calls.update).toEqual({ title: 'new' });
        expect(fake.calls.saved).toBe('1');
        expect(res.calls).toEqual([
          ['resource', 200, { id: '1', title: 'new' }],
        ]);
      });

      test('update answers 422 when the document does not validate', async () => {
        const res = fakeRes();
        const req = fakeReq({ title: '' }, { id: '1' });

        await run(controller, 'update', req, res);

        expect(res.calls).toEqual([
          [
            'badData',
            422,
            'Post validation failed: title: required',
            { errors: { title: 'Path `title` is required.' } },
          ],
        ]);
      });

      test('destroy answers 204', async () => {
        const found = fakeRes();

        await run(controller, 'destroy', fakeReq({}, { id: '1' }), found);

        expect(fake.calls.deleted).toBe('1');
        expect(found.calls).toEqual([['end', 204]]);
      });
    });

    test('the test generator checks the HAL links of a scaffolded resource', () => {
      const { status } = henri(['g', 'test', 'posts'], { cwd: app });

      expect(status).toBe(0);
      expect(() => parseFile(app, 'test/posts.test.js')).not.toThrow();

      const code = read(app, 'test/posts.test.js');

      expect(code).toContain("_links.self.href).toBe('/posts')");
      expect(code).toContain('_embedded.posts');
      expect(code).toContain("get('/posts/unknown')");
    });
  });

  describe('crud', () => {
    test('writes a json controller and the crud route', () => {
      const { status } = henri(['g', 'crud', 'category', 'name:string!'], {
        cwd: app,
      });

      expect(status).toBe(0);
      expect(exists(app, 'app/models/Category.js')).toBe(true);
      expect(exists(app, 'app/views/pages/categories')).toBe(false);

      const controller = require(
        path.join(app, 'app/controllers/categories.js')
      );

      expect(Object.keys(controller).sort()).toEqual([
        'before',
        'create',
        'destroy',
        'index',
        'update',
      ]);
      expect(Object.keys(controller.before)).toEqual(['update,destroy']);
      expect(routesOf(app)['crud categories']).toBe('categories');
      expect(read(app, 'app/controllers/categories.js')).not.toContain(
        'res.render'
      );
    });

    test('the json controller answers HAL with pagination', async () => {
      const fake = fakeModel();
      const controller = require(
        path.join(app, 'app/controllers/categories.js')
      );

      global.Category = fake.model;

      try {
        const index = fakeRes();
        const create = fakeRes();
        const destroy = fakeRes();

        await controller.index(fakeReq(), index);
        await controller.create(fakeReq({ name: 'n', title: 't' }), create);
        await run(controller, 'destroy', fakeReq({}, { id: '1' }), destroy);

        expect(index.calls).toEqual([
          [
            'collection',
            [{ id: '1', title: 'one' }],
            { page: 1, perPage: 25, total: 1 },
          ],
        ]);
        // Only the model's attributes (name) are permitted
        expect(create.calls).toEqual([
          ['resource', 201, { id: '2', name: 'n' }],
        ]);
        expect(destroy.calls).toEqual([['end', 204]]);
      } finally {
        delete global.Category;
      }
    });
  });

  test('keeps config/routes.js valid after every change', () => {
    expect(() => parseFile(app, 'config/routes.js')).not.toThrow();
    expect(fs.existsSync(path.join(app, 'config', 'routes.js'))).toBe(true);
  });
});
