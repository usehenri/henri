const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

const { hooksFor } = require('@usehenri/core/src/base/hooks');
const { modelErrors } = require('@usehenri/core/src/base/model-errors');
const {
  coerce,
  declarations,
  inspect,
} = require('@usehenri/core/src/base/params-schema');

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
  // The negotiated 404 of a record lookup, which the generated `before`
  // hook answers with rather than `res.boom.notFound` -- a policy refusal
  // answers the same 404 and the two must not be told apart
  // (packages/core/src/base/http.js)
  res.notFound = (why) => {
    res.calls.push(['notFound', 404, why]);

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
 * A fake model with the drizzle methods the controllers use, the store a
 * scaffolded application has. `findById()` answers null for an id the
 * store cannot hold, so there is no cast error to guard here; the mongoose
 * and sequelize flavours are exercised in adapters.spec.js.
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

  // A row with the model methods the controllers call on it; the methods
  // are hidden so the row still compares to its attributes
  const record = (attributes) => {
    const row = { ...attributes };
    const hidden = {
      destroy: async () => {
        calls.deleted = row.id;

        return row;
      },
      update: async (data) => {
        if (data.title === '' || data.name === '') {
          throw validation();
        }
        calls.update = data;
        Object.assign(row, data);

        return row;
      },
    };

    for (const [name, value] of Object.entries(hidden)) {
      Object.defineProperty(row, name, { enumerable: false, value });
    }

    return row;
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
      findById: async (id) =>
        id === '1' ? record({ id: '1', title: 'one' }) : null,
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
      // A decimal is written with a precision and a scale: the default
      // (19, 4) is not what somebody who typed `price:decimal` meant
      const settings = type === 'decimal' ? { precision: 12, scale: 2 } : {};

      expect(schema[`f${index}`]).toEqual(
        index % 2
          ? { required: true, ...settings, type }
          : { ...settings, type }
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

  test('takes the one setting a name:type pair carries: enum=', () => {
    expect(parseAttributes(['status:string:enum=draft,in_review'])).toEqual({
      status: { enum: ['draft', 'in_review'], type: 'string' },
    });
    expect(parseAttributes(['status!:string:enum=draft,live'])).toEqual({
      status: { enum: ['draft', 'live'], required: true, type: 'string' },
    });
  });

  test('rejects a setting it cannot carry out', () => {
    expect(() => parseAttributes(['status:string:unique'])).toThrow(
      /Unknown setting "unique".+The only one is enum=/
    );
    expect(() => parseAttributes(['count:integer:enum=1,2'])).toThrow(
      /only for a string or a text column/
    );
    expect(() => parseAttributes(['status:string:enum=live,live'])).toThrow(
      /each value once/
    );
    expect(() => parseAttributes(['status:string:enum='])).toThrow(
      /each value once/
    );
  });

  test('rejects unknown types with the list of valid ones', () => {
    expect(() => parseAttributes(['score:varchar'])).toThrow(
      /Unknown type "varchar" for attribute "score"\. Valid types: string, text/
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
          'j:decimal',
          'k:bigint!',
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
        j: { precision: 12, scale: 2, type: 'decimal' },
        k: { required: true, type: 'bigint' },
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

    test('writes a policy that refuses everything it was not told about', () => {
      const { status } = henri(['g', 'policy', 'Proposal', 'speakerId'], {
        cwd: app,
      });

      expect(status).toBe(0);
      expect(() => parseFile(app, 'app/policies/proposal.js')).not.toThrow();

      const policy = require(path.join(app, 'app/policies/proposal.js'));
      const owner = { id: 7 };
      const stranger = { id: 8 };
      const proposal = { speakerId: 7 };

      // The seven actions of a resource, all of them written: an action a
      // policy leaves out is refused, so the stub leaves none out
      for (const action of [
        'index',
        'new',
        'create',
        'show',
        'edit',
        'update',
        'destroy',
      ]) {
        expect(typeof policy[action]).toBe('function');
      }

      expect(policy.update(owner, proposal)).toBe(true);
      expect(policy.update(stranger, proposal)).toBe(false);
      expect(policy.show(null, proposal)).toBe(false);
      expect(policy.index(null)).toBe(false);
      // The rules that need a record declare one, which is what keeps them
      // from being answered without it
      expect(policy.update.length).toBe(2);
      expect(policy.index.length).toBe(1);
      // The other half: which records a list may hold
      expect(policy.scope(owner)).toEqual({ speakerId: 7 });

      expect(() =>
        parseFile(app, 'test/proposal-policy.test.js')
      ).not.toThrow();
      expect(read(app, 'test/proposal-policy.test.js')).toContain(
        "henri.can(stranger, 'update'"
      );
    });

    test('a policy defaults to a userId column', () => {
      const { status } = henri(['g', 'policy', 'Note'], { cwd: app });

      expect(status).toBe(0);

      const policy = require(path.join(app, 'app/policies/note.js'));

      expect(policy.show({ id: 3 }, { userId: 3 })).toBe(true);
      expect(policy.show({ id: 4 }, { userId: 3 })).toBe(false);
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
      // The generated controller reads the providers back out of the
      // configuration; an application with none renders no button
      global.henri.identities = {
        forUser: async () => [
          { linkedAt: 1767225600000, provider: 'acme', subject: 'never-shown' },
        ],
        providers: () => [
          { allows: 'signin', label: 'Acme', name: 'acme', trusted: false },
          { allows: 'verify', label: 'Bank', name: 'bank', trusted: false },
        ],
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
      delete global.henri.identities;
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
        'app/views/pages/accounts/login.jsx',
        'app/views/pages/accounts/new.jsx',
        'app/views/pages/accounts/forgot.jsx',
        'app/views/pages/accounts/reset.jsx',
        'app/views/pages/accounts/confirm.jsx',
        'app/views/pages/accounts/connections.jsx',
        'app/mailers/auth.js',
        'app/views/mailers/auth/confirm.hbs',
        'app/views/mailers/auth/reset.hbs',
        'app/views/mailers/auth/emailChange.hbs',
        'test/authentication.test.js',
      ];

      for (const file of files) {
        expect(exists(auth, file)).toBe(true);
      }

      for (const file of files.filter((one) => !one.endsWith('.hbs'))) {
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
      expect(routes['get /account/connections']).toBe('accounts#connections');
      // The mutating half is mounted by the user module, not by the app
      expect(routes['post /signup']).toBeUndefined();
      expect(routes['post /password/forgot']).toBeUndefined();
    });

    test('the forms post to the endpoints henri mounts', () => {
      expect(read(auth, 'app/views/pages/accounts/new.jsx')).toContain(
        'action="/signup"'
      );
      expect(read(auth, 'app/views/pages/accounts/forgot.jsx')).toContain(
        'action="/password/forgot"'
      );
      expect(read(auth, 'app/views/pages/accounts/reset.jsx')).toContain(
        'action="/password/reset"'
      );
      expect(read(auth, 'app/views/pages/accounts/login.jsx')).toContain(
        'action="/login"'
      );
      // Leaving for a provider is a POST, so it is a form and not a link:
      // henri answers 405 to a GET precisely so a third-party page cannot
      // start an authentication in a visitor's browser
      expect(read(auth, 'app/views/pages/accounts/login.jsx')).toContain(
        'method="post"'
      );
      expect(read(auth, 'app/views/pages/accounts/connections.jsx')).toContain(
        '/unlink'
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

    test('the sign-in page only offers a provider that may open a session', () => {
      const accounts = require(path.join(auth, 'app/controllers/accounts.js'));

      expect(accounts.login().providers).toEqual([
        { allows: 'signin', label: 'Acme', name: 'acme', trusted: false },
      ]);
    });

    test('the connections page never sees the subject a provider issued', async () => {
      const accounts = require(path.join(auth, 'app/controllers/accounts.js'));
      const props = await accounts.connections({ user: {} });

      expect(props.linked).toEqual([
        { label: 'Acme', linkedAt: '2026-01-01', provider: 'acme' },
      ]);
      expect(props.available.map((one) => one.name)).toEqual(['bank']);
      expect(JSON.stringify(props)).not.toContain('never-shown');
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

    test('the pages take the renderer of the application', () => {
      // The default renderer, above: Inertia pages reading useHenri()
      expect(read(auth, 'app/views/pages/accounts/new.jsx')).toContain(
        "from '@usehenri/inertia'"
      );

      const { app: other, dir: otherDir } = scaffold([
        '--no-git',
        '--renderer',
        'react',
      ]);

      try {
        expect(henri(['g', 'authentication'], { cwd: other }).status).toBe(0);
        expect(exists(other, 'app/views/pages/accounts/new.js')).toBe(true);
        expect(exists(other, 'app/views/pages/accounts/new.jsx')).toBe(false);
        expect(read(other, 'app/views/pages/accounts/new.js')).toContain(
          "from '@usehenri/react'"
        );
        expect(() =>
          parseFile(other, 'app/views/pages/accounts/new.js')
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

      test('has the seven resources actions, a before and a params block', () => {
        expect(Object.keys(controller).sort()).toEqual([
          'before',
          'create',
          'destroy',
          'edit',
          'index',
          'new',
          'params',
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

        // One call: the drizzle row updates itself
        expect(fake.calls.update).toEqual({ title: 'new' });
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
        'params',
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

  describe('the params block', () => {
    // The `henri new` shape: a model written by hand with the marks no
    // `name:type` pair can express, and the generator run over it
    const declared = `module.exports = {
  options: { timestamps: true },
  schema: {
    amount: { type: 'decimal', precision: 12, scale: 2 },
    customerId: { type: 'integer', references: { model: 'Post' } },
    note: { type: 'string', personal: { expose: false } },
    placedAt: { type: 'date' },
    quantity: { type: 'integer', required: true },
    shipped: { type: 'boolean' },
    state: { type: 'string', enum: ['open', 'sent'], default: 'open' },
  },
  store: 'default',
};
`;
    const attributes = [
      'amount:decimal',
      'customerId:integer',
      'note:string',
      'placedAt:date',
      'quantity:integer!',
      'shipped:boolean',
      'state:string',
    ];
    let controller;

    /**
     * The rules of one action, compiled the way `2.controllers.js` compiles
     * them at boot: a declaration henri cannot carry out throws here, which
     * is the point of asking the real compiler rather than reading strings
     *
     * @param {string} action The action name
     * @returns {object} The compiled rules, by field
     */
    const rulesFor = (action) =>
      declarations(
        controller,
        'orders',
        Object.keys(controller).filter(
          (key) => typeof controller[key] === 'function'
        )
      )[action];

    beforeAll(() => {
      fs.writeFileSync(path.join(app, 'app', 'models', 'Order.js'), declared);

      const result = henri(['g', 'scaffold', 'Order', ...attributes], {
        cwd: app,
      });

      if (result.status !== 0) {
        throw new Error(result.stdout + result.stderr);
      }

      controller = require(path.join(app, 'app/controllers/orders.js'));
    });

    test('declares the type of every attribute a request may set', () => {
      // One selector: what separates a create from an update is `required`,
      // which is not copied, so the two accept the same thing
      expect(Object.keys(controller.params)).toEqual(['create,update']);
      // The short form, and the model's own types: what a request holds is
      // what the columns are
      expect(controller.params['create,update']).toEqual({
        amount: 'decimal',
        note: 'string',
        placedAt: 'date',
        quantity: 'integer',
        shipped: 'boolean',
        state: { enum: ['open', 'sent'], type: 'string' },
      });
    });

    test('writes an enum value back exactly, whatever is in it', () => {
      // The values are written into JavaScript source, so escaping the
      // quote and not the backslash lets a value ending in one close the
      // string it was meant to stay inside -- and the file that comes out
      // is either broken or quietly says something else
      fs.writeFileSync(
        path.join(app, 'app', 'models', 'Label.js'),
        `module.exports = {
  options: { timestamps: true },
  schema: {
    state: {
      type: 'string',
      enum: ['plain', "it's open", 'ends-with-a-backslash\\\\', 'a\\'b'],
    },
  },
  store: 'default',
};
`
      );

      const written = henri(['g', 'scaffold', 'Label', 'state:string'], {
        cwd: app,
      });

      expect(written.status).toBe(0);

      // It parses at all, which is the first thing a broken escape costs
      const labels = require(path.join(app, 'app/controllers/labels.js'));

      expect(labels.params['create,update'].state.enum).toEqual([
        'plain',
        "it's open",
        'ends-with-a-backslash\\',
        "a'b",
      ]);
    });

    test('... which is what henri compiles at boot, for those two alone', () => {
      const compiled = declarations(
        controller,
        'orders',
        Object.keys(controller).filter(
          (key) => typeof controller[key] === 'function'
        )
      );

      expect(Object.keys(compiled).sort()).toEqual(['create', 'update']);
      expect(compiled.create.shipped).toEqual({ type: 'boolean' });
      // An index takes its page from req.pagination(), a show its id from
      // the path: a declaration there would say what neither needs said
      expect(compiled.index).toBeUndefined();
      expect(compiled.show).toBeUndefined();
    });

    test('a form body is coerced into what the columns hold', () => {
      const { errors, values } = inspect(rulesFor('create'), {
        body: {
          amount: '19.99',
          placedAt: '2026-01-02',
          quantity: '3',
          shipped: 'true',
        },
        is: () => false,
        method: 'POST',
        params: {},
        query: {},
      });

      expect(errors).toEqual({});
      expect(values.quantity).toBe(3);
      expect(values.shipped).toBe(true);
      expect(values.placedAt).toBeInstanceOf(Date);
      // An exact value stays the digits it arrived as (base/exact.js)
      expect(values.amount).toBe('19.99');
    });

    test('... and a value of the wrong shape never reaches the model', () => {
      const { errors } = inspect(rulesFor('update'), {
        body: { quantity: 'banana', shipped: 'yes please' },
        is: () => false,
        method: 'PATCH',
        params: {},
        query: {},
      });

      expect(errors).toEqual({
        quantity: 'must be a whole number',
        shipped: 'must be true or false',
      });
    });

    test('a column that never leaves is still typed: a write is not an answer', () => {
      const code = read(app, 'app/controllers/orders.js');

      expect(controller.params['create,update'].note).toBe('string');
      expect(code).toMatch(/const FIELDS = \[[\s\S]*'note'/u);
      expect(read(app, 'app/views/pages/orders/_form.jsx')).not.toContain(
        'note'
      );
    });

    test('a column naming another model is not typed, and says why', () => {
      const code = read(app, 'app/controllers/orders.js');

      // A foreign key is published as the target's externalId, so only the
      // application knows whether a request carries that or the column's
      // own value -- `henri openapi` leaves it untyped too
      expect(controller.params['create,update'].customerId).toBeUndefined();
      expect(code).toContain('customerId names another model.');
      expect(code).toContain('Permitted by FIELDS and not declared here:');
    });

    test('required is not copied, because the word means two things', () => {
      const code = read(app, 'app/controllers/orders.js');

      // `quantity` is required by the model and is optional here. The two
      // rules are not the same rule: a parameter is required when the key
      // arrived at all, while the model asks Rails' presence -- so the
      // empty string a form posts for an untouched input passes the first
      // and is refused by the second
      expect(controller.params['create,update'].quantity).toBe('integer');
      expect(coerce(rulesFor('create').quantity, '', true)).toEqual({});
      expect(code).toContain('here it means "the key was absent"');
    });

    test('... and the enum is, because nothing can send the list here', () => {
      const code = read(app, 'app/controllers/orders.js');

      // A page is handed `Order.enums` by the controller, but this block is
      // compiled at runlevel 2 and the models are built at 3: there is no
      // model to ask, so the values are a literal and the file says so
      expect(coerce(rulesFor('create').state, 'sent', true)).toEqual({
        value: 'sent',
      });
      expect(coerce(rulesFor('create').state, 'void', true)).toEqual({
        error: 'must be one of open, sent',
      });
      expect(code).toContain('The `enum` is a copy and the model is the');
    });

    test('nothing to type is no block at all', () => {
      const result = henri(['g', 'crud', 'Blank'], { cwd: app });

      expect(result.status).toBe(0);

      const blank = require(path.join(app, 'app/controllers/blanks.js'));

      expect(blank.params).toBeUndefined();
      expect(read(app, 'app/controllers/blanks.js')).not.toContain('params:');
    });
  });

  describe('scaffold --slug', () => {
    beforeAll(() => {
      const result = henri(
        [
          'g',
          'scaffold',
          'Article',
          'title:string!',
          'body:text',
          '--slug',
          'title',
        ],
        { cwd: app }
      );

      if (result.status !== 0) {
        throw new Error(result.stdout + result.stderr);
      }
    });

    test('declares the name on the model', () => {
      const model = read(app, 'app/models/Article.js');

      expect(model).toContain("slug: 'title'");
      expect(() => parseFile(app, 'app/models/Article.js')).not.toThrow();
    });

    test('writes a controller whose redirects carry the slug', () => {
      const controller = read(app, 'app/controllers/articles.js');

      expect(controller).toContain('/articles/${article.slug}');
      expect(controller).toContain('/articles/${req.article.slug}');
      expect(controller).not.toContain('article.externalId');
      expect(() => parseFile(app, 'app/controllers/articles.js')).not.toThrow();
    });

    test('writes pages that link with the slug', () => {
      const index = read(app, 'app/views/pages/articles/index.jsx');
      const show = read(app, 'app/views/pages/articles/show.jsx');

      expect(index).toContain("getRoute('show_articles_path', item.slug)");
      expect(index).toContain('key={item.slug}');
      expect(show).toContain('const id = item.slug;');
      expect(index).not.toContain('externalId');
      expect(() =>
        parseFile(app, 'app/views/pages/articles/index.jsx')
      ).not.toThrow();
    });

    test('reads the name back off the model for a later generator', () => {
      // No flag this time: the model file is what says the resource has a
      // name, so a controller written over a model that already has one is
      // never half wired
      fs.writeFileSync(
        path.join(app, 'app', 'models', 'Chapter.js'),
        "module.exports = { options: { slug: 'title', timestamps: true }, schema: { title: { type: 'string' } } };\n"
      );

      const result = henri(['g', 'crud', 'Chapter', 'title:string'], {
        cwd: app,
      });

      expect(result.status).toBe(0);
      // A crud controller answers JSON and builds no redirect, so what
      // says the name reached it is the lookup it documents
      expect(read(app, 'app/controllers/chapters.js')).toContain(
        'is the slug of the chapter'
      );
    });

    test('refuses a --slug naming an attribute the model has not got', () => {
      const result = henri(
        ['g', 'scaffold', 'Ghost', 'body:text', '--slug', 'title'],
        { cwd: app }
      );

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(
        'no title attribute'
      );
      expect(exists(app, 'app/models/Ghost.js')).toBe(false);
    });
  });

  describe('the marks the model file carries', () => {
    // What `henri new` does: a model written by hand, with an `enum` no
    // `name:type` pair can express, and the generator called right after
    // with the plain attributes
    const declared = `module.exports = {
  options: { timestamps: true },
  schema: {
    title: { type: 'string', required: true },
    status: { type: 'string', enum: ['draft', 'live'], default: 'draft' },
    note: { type: 'string' },
    ssn: { type: 'string', personal: { expose: false } },
    phone: { type: 'string', personal: true },
  },
  store: 'default',
};
`;
    const attributes = [
      'title:string!',
      'status:string',
      'note:string',
      'ssn:string',
      'phone:string',
    ];

    /**
     * The `<input>` or `<select>` a generated form writes for one field
     *
     * @param {string} form The form page
     * @param {string} tag input or select
     * @param {string} name The field
     * @returns {string} The element, attributes and all
     * @throws when the form has no such field (a `not.toContain` over
     *   nothing at all would pass without meaning anything)
     */
    const elementFor = (form, tag, name) => {
      const found = form.match(
        new RegExp(`<${tag}[^>]+name="${name}"[^>]*>`, 'u')
      );

      if (!found) {
        throw new Error(`the form has no <${tag} name="${name}">`);
      }

      return found[0];
    };

    beforeAll(() => {
      fs.writeFileSync(path.join(app, 'app', 'models', 'Ticket.js'), declared);

      const result = henri(['g', 'scaffold', 'Ticket', ...attributes], {
        cwd: app,
      });

      if (result.status !== 0) {
        throw new Error(result.stdout + result.stderr);
      }
    });

    test('an enum column is a select, of the list the controller sends', () => {
      const form = read(app, 'app/views/pages/tickets/_form.jsx');
      const controller = read(app, 'app/controllers/tickets.js');

      expect(elementFor(form, 'select', 'status')).toContain(
        "defaultValue={data.status ?? ''}"
      );
      expect(form).toContain('{(enums.status || []).map((value) => (');
      // The values are never copied into the page: a copy of the schema
      // stops being true the first time the model changes
      expect(form).not.toContain('draft');
      expect(controller).toContain(
        'new: async () => ({ enums: Ticket.enums })'
      );
      expect(controller).toContain(
        'data: { enums: Ticket.enums, ticket: req.ticket }'
      );
      // ... including the page rendered again after a failed write
      expect(controller).toContain(
        "invalid(res, error, '/tickets/new', { enums: Ticket.enums })"
      );
    });

    test('the new and edit pages hand the form what they were sent', () => {
      expect(read(app, 'app/views/pages/tickets/new.jsx')).toContain(
        'enums={data.enums}'
      );
      expect(read(app, 'app/views/pages/tickets/edit.jsx')).toContain(
        'enums={data.enums}'
      );
    });

    test('a required column gets a required input, and only it', () => {
      const form = read(app, 'app/views/pages/tickets/_form.jsx');

      expect(elementFor(form, 'input', 'title')).toContain('required');
      expect(elementFor(form, 'input', 'note')).not.toContain('required');
      expect(elementFor(form, 'select', 'status')).not.toContain('required');
    });

    test('a column that never leaves the server is on no page', () => {
      // A field marked `personal: { expose: false }` is stripped from every
      // answer henri builds, so a page showing it shows an empty column
      // forever -- and a form posts that empty string back over the value
      for (const page of ['_form', 'index', 'show']) {
        const file = `app/views/pages/tickets/${page}.jsx`;

        expect(read(app, file)).not.toContain('ssn');
        expect(() => parseFile(app, file)).not.toThrow();
      }

      // A personal column that does not say `expose: false` is a field like
      // any other: whether it is stripped is config.privacy.expose, which
      // is per environment, and a page is one file for all of them
      expect(read(app, 'app/views/pages/tickets/show.jsx')).toContain(
        'item.phone'
      );
    });

    test('... but a request may still set it: an answer is not a write', () => {
      const controller = read(app, 'app/controllers/tickets.js');

      expect(controller).toContain(
        "const FIELDS = ['title', 'status', 'note', 'ssn', 'phone']"
      );
      expect(controller).toContain(
        'henri drops a field marked personal: { expose: false } from every answer'
      );
      expect(controller).toContain('still permitted here: ssn');
      expect(() => parseFile(app, 'app/controllers/tickets.js')).not.toThrow();
    });

    test('the command line can write the enum itself, in one run', () => {
      const result = henri(
        [
          'g',
          'scaffold',
          'Release',
          'name:string!',
          'channel:string:enum=alpha,beta',
        ],
        { cwd: app }
      );

      expect(result.status).toBe(0);
      expect(read(app, 'app/models/Release.js')).toContain(
        "enum: ['alpha', 'beta']"
      );
      expect(read(app, 'app/views/pages/releases/_form.jsx')).toContain(
        '{(enums.channel || []).map((value) => ('
      );
      expect(read(app, 'app/controllers/releases.js')).toContain(
        'enums: Release.enums'
      );
    });

    test('the React renderer gets a Select and the same required inputs', () => {
      const { app: other, dir: otherDir } = scaffold([
        '--no-git',
        '--renderer',
        'react',
      ]);

      try {
        fs.writeFileSync(
          path.join(other, 'app', 'models', 'Ticket.js'),
          declared
        );
        expect(
          henri(['g', 'scaffold', 'Ticket', ...attributes], { cwd: other })
            .status
        ).toBe(0);

        const form = read(other, 'app/views/pages/tickets/_form.js');

        expect(form).toContain(
          "import { Button, Form, FormError, Input, Select } from '@usehenri/react/forms'"
        );
        expect(elementFor(form, 'Select', 'status')).toContain(
          'choices={enums.status || []}'
        );
        expect(elementFor(form, 'Input', 'title')).toContain('required');
        expect(elementFor(form, 'Input', 'note')).not.toContain('required');
        expect(form).not.toContain('ssn');
        expect(read(other, 'app/views/pages/tickets/new.js')).toContain(
          'enums={enums}'
        );
        expect(() =>
          parseFile(other, 'app/views/pages/tickets/_form.js')
        ).not.toThrow();
      } finally {
        cleanup(otherDir);
      }
    }, 120000);
  });

  test('keeps config/routes.js valid after every change', () => {
    expect(() => parseFile(app, 'config/routes.js')).not.toThrow();
    expect(fs.existsSync(path.join(app, 'config', 'routes.js'))).toBe(true);
  });
});
