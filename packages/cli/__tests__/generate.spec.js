const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

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

  return {
    calls,
    model: {
      create: async (data) => {
        calls.create = data;
        if (!data.title) {
          throw validation();
        }

        return { id: '2', ...data };
      },
      find: async () => [{ id: '1', title: 'one' }],
      findById: async (id) => {
        if (id === 'bad') {
          throw cast();
        }

        return id === '1' ? { id: '1', title: 'one' } : null;
      },
      findByIdAndDelete: async (id) =>
        id === '1' ? { id: '1', title: 'one' } : null,
      findByIdAndUpdate: async (id, data, options) => {
        calls.update = { data, id, options };
        if (!data.title) {
          throw validation();
        }

        return id === '1' ? { id, ...data } : null;
      },
    },
  };
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
  });

  afterAll(() => {
    cleanup(dir);
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

  describe('worker and test', () => {
    test('writes a worker with start and stop', () => {
      const { status } = henri(['g', 'worker', 'cleanup'], { cwd: app });

      expect(status).toBe(0);

      const worker = require(path.join(app, 'app/workers/cleanup.js'));

      expect(worker.name).toBe('cleanup');
      expect(typeof worker.start).toBe('function');
      expect(typeof worker.stop).toBe('function');
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

  describe('scaffold', () => {
    const files = [
      'app/models/Post.js',
      'app/controllers/posts.js',
      'app/views/pages/posts/index.js',
      'app/views/pages/posts/new.js',
      'app/views/pages/posts/edit.js',
      'app/views/pages/posts/show.js',
      'app/views/pages/posts/_form.js',
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

      test('has the seven resources actions', () => {
        expect(Object.keys(controller).sort()).toEqual([
          'create',
          'destroy',
          'edit',
          'index',
          'new',
          'show',
          'update',
        ]);
      });

      test('index renders the list under the plural key', async () => {
        const res = fakeRes();

        await controller.index(fakeReq(), res);

        expect(res.calls).toEqual([
          [
            'render',
            '/posts',
            { data: { posts: [{ id: '1', title: 'one' }] } },
          ],
        ]);
      });

      test('create permits the attributes and answers 201', async () => {
        const res = fakeRes();

        await controller.create(
          fakeReq({ admin: true, body: 'b', title: 't' }),
          res
        );

        expect(fake.calls.create).toEqual({ body: 'b', title: 't' });
        expect(res.calls).toEqual([
          ['json', 201, { post: { body: 'b', id: '2', title: 't' } }],
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

      test('show renders the document or answers 404', async () => {
        const found = fakeRes();
        const missing = fakeRes();
        const malformed = fakeRes();

        await controller.show(fakeReq({}, { id: '1' }), found);
        await controller.show(fakeReq({}, { id: '9' }), missing);
        await controller.show(fakeReq({}, { id: 'bad' }), malformed);

        expect(found.calls).toEqual([
          [
            'render',
            '/posts/show',
            { data: { post: { id: '1', title: 'one' } } },
          ],
        ]);
        expect(missing.calls).toEqual([['notFound', 404, 'Post 9 not found']]);
        expect(malformed.calls).toEqual([
          ['notFound', 404, 'Post bad not found'],
        ]);
      });

      test('update runs the validators and answers the document', async () => {
        const res = fakeRes();

        await controller.update(
          fakeReq({ title: 'new', unknown: 1 }, { id: '1' }),
          res
        );

        expect(fake.calls.update).toEqual({
          data: { title: 'new' },
          id: '1',
          options: { new: true, runValidators: true },
        });
        expect(res.calls).toEqual([
          ['json', 200, { post: { id: '1', title: 'new' } }],
        ]);
      });

      test('destroy answers the removed document or 404', async () => {
        const found = fakeRes();
        const missing = fakeRes();

        await controller.destroy(fakeReq({}, { id: '1' }), found);
        await controller.destroy(fakeReq({}, { id: '9' }), missing);

        expect(found.calls).toEqual([
          ['json', 200, { post: { id: '1', title: 'one' } }],
        ]);
        expect(missing.calls).toEqual([['notFound', 404, 'Post 9 not found']]);
      });
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
        'create',
        'destroy',
        'index',
        'update',
      ]);
      expect(routesOf(app)['crud categories']).toBe('categories');
      expect(read(app, 'app/controllers/categories.js')).not.toContain(
        'res.render'
      );
    });
  });

  test('keeps config/routes.js valid after every change', () => {
    expect(() => parseFile(app, 'config/routes.js')).not.toThrow();
    expect(fs.existsSync(path.join(app, 'config', 'routes.js'))).toBe(true);
  });
});
