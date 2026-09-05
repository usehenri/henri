const express = require('express');
const supertest = require('supertest');

const {
  answered,
  chain,
  hooksFor,
  implicit,
  normalize,
  pageFor,
  track,
} = require('../base/hooks');
const flash = require('../base/flash');

/**
 * A named no-op hook
 *
 * @param {string} name the name (pushed into `req.trace`)
 * @returns {function} the hook
 */
const trace = (name) => (req) => {
  req.trace = [...(req.trace || []), name];
};

describe('controller hooks', () => {
  describe('normalize', () => {
    const one = () => {};
    const two = () => {};

    test('a bare function runs on every action', () => {
      expect(normalize(one)).toEqual([
        { except: null, only: null, run: [one] },
      ]);
      expect(hooksFor(one, 'index')).toEqual([one]);
      expect(hooksFor(one, 'destroy')).toEqual([one]);
    });

    test('an object selects by action, `all` and comma lists included', () => {
      const before = { all: one, 'edit,update': [two], show: two };

      expect(hooksFor(before, 'index')).toEqual([one]);
      expect(hooksFor(before, 'edit')).toEqual([one, two]);
      expect(hooksFor(before, 'update')).toEqual([one, two]);
      expect(hooksFor(before, 'show')).toEqual([one, two]);
    });

    test('`*` is an alias of `all`', () => {
      expect(hooksFor({ '*': one }, 'whatever')).toEqual([one]);
    });

    test('an array takes rails only/except selectors', () => {
      const before = [
        one,
        { only: ['show', 'edit'], run: two },
        { except: 'index', use: one },
      ];

      expect(hooksFor(before, 'index')).toEqual([one]);
      expect(hooksFor(before, 'show')).toEqual([one, two, one]);
      expect(hooksFor(before, 'create')).toEqual([one, one]);
    });

    test('hooks can be named after another export of the controller', () => {
      const controller = { loadTask: one, show: two };

      expect(hooksFor({ show: 'loadTask' }, 'show', controller)).toEqual([one]);
      expect(hooksFor(['loadTask'], 'index', controller)).toEqual([one]);
      expect(hooksFor({ show: 'nope' }, 'show', controller)).toEqual([]);
    });

    test('anything else is ignored', () => {
      expect(normalize(null)).toEqual([]);
      expect(normalize(42)).toEqual([]);
      expect(normalize({ show: 'nope' })).toEqual([]);
      expect(normalize([{ only: ['show'] }])).toEqual([]);
      expect(hooksFor(undefined, 'index')).toEqual([]);
    });
  });

  describe('running them', () => {
    /**
     * An app running `before` on one route
     *
     * @param {*} before the before export
     * @param {function} action the action
     * @returns {object} a supertest agent
     */
    const app = (before, action) => {
      const server = express();

      server.get(
        '/',
        (req, res, next) => {
          track(res);
          next();
        },
        ...chain(hooksFor(before, 'index')),
        action
      );
      server.use((error, req, res, next) =>
        res.status(500).send(error.message)
      );

      return supertest(server);
    };

    test('runs them in order before the action', async () => {
      const res = await app([trace('a'), trace('b')], (req, res) =>
        res.json({ trace: req.trace })
      ).get('/');

      expect(res.body.trace).toEqual(['a', 'b']);
    });

    test('a hook that answers ends the request', async () => {
      const action = vi.fn((req, res) => res.json({ reached: true }));
      const res = await app(
        [async (req, res) => res.status(401).json({ nope: true }), trace('b')],
        action
      ).get('/');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ nope: true });
      expect(action).not.toHaveBeenCalled();
    });

    test('a (req, res, next) hook drives next itself', async () => {
      const res = await app(
        [
          (req, res, next) => {
            req.trace = ['next-style'];
            next();
          },
        ],
        (req, res) => res.json({ trace: req.trace })
      ).get('/');

      expect(res.body.trace).toEqual(['next-style']);
    });

    test('a hook that throws goes to the error handler', async () => {
      const res = await app(
        [
          async () => {
            throw new Error('boom');
          },
        ],
        (req, res) => res.json({})
      ).get('/');

      expect(res.status).toBe(500);
      expect(res.text).toBe('boom');
    });

    test('a (req, res, next) hook that rejects goes to the error handler', async () => {
      const res = await app(
        [
          async (req, res, next) => {
            next(new Error('async boom'));
          },
        ],
        (req, res) => res.json({})
      ).get('/');

      expect(res.status).toBe(500);
      expect(res.text).toBe('async boom');
    });
  });

  describe('answered', () => {
    test('tracks the answering methods, once', () => {
      const res = { json: vi.fn(() => 'sent') };
      const original = res.json;

      track(res);
      expect(answered(res)).toBe(false);
      expect(res.json({})).toBe('sent');
      expect(answered(res)).toBe(true);

      const patched = res.json;

      track(res);
      expect(res.json).toBe(patched);
      expect(original).toHaveBeenCalledTimes(1);
    });

    test('headersSent alone is enough', () => {
      expect(answered({ headersSent: true })).toBe(true);
      expect(answered({})).toBe(false);
    });
  });

  describe('implicit render', () => {
    /**
     * An app whose only route is the wrapped action
     *
     * @param {function} action the action
     * @returns {object} a supertest agent
     */
    const app = (action) => {
      const server = express();
      const rendered = [];

      server.get('/', (req, res, next) => {
        track(res);
        res.render = (route, opts) => {
          rendered.push([route, opts]);

          return res.json({ opts, route });
        };
        next();
      });
      server.get('/', implicit(action, 'tasks', 'show'));
      server.use((error, req, res, next) =>
        res.status(500).send(error.message)
      );

      return { rendered, request: supertest(server) };
    };

    test('names the page after the controller and the action', () => {
      expect(pageFor('tasks', 'show')).toBe('/tasks/show');
      expect(pageFor('tasks', 'index')).toBe('/tasks');
      expect(pageFor('admin/users', 'edit')).toBe('/admin/users/edit');
    });

    test('renders what the action returned', async () => {
      const { request } = app(async () => ({ task: { id: '1' } }));
      const res = await request.get('/');

      expect(res.body).toEqual({
        opts: { data: { task: { id: '1' } } },
        route: '/tasks/show',
      });
    });

    test('renders with no data when the action returns nothing', async () => {
      const { request } = app(async () => {});

      expect((await request.get('/')).body.opts).toEqual({ data: {} });
    });

    test('leaves an action that answered alone', async () => {
      const { rendered, request } = app(async (req, res) => {
        res.status(201).json({ mine: true });

        return { ignored: true };
      });
      const res = await request.get('/');

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ mine: true });
      expect(rendered).toEqual([]);
    });

    test('leaves an action that renders without awaiting alone', async () => {
      const { rendered, request } = app(async (req, res) => {
        res.render('/tasks/mine', { data: {} });
      });

      await request.get('/');

      expect(rendered).toEqual([['/tasks/mine', { data: {} }]]);
    });

    test('returning false opts out of the implicit render', async () => {
      const { rendered, request } = app(async (req, res) => {
        res.send('by hand');

        return false;
      });

      expect((await request.get('/')).text).toBe('by hand');
      expect(rendered).toEqual([]);
    });

    test('an action calling next() is not rendered', async () => {
      const { rendered, request } = app((req, res, next) =>
        next(new Error('nope'))
      );
      const res = await request.get('/');

      expect(res.status).toBe(500);
      expect(res.text).toBe('nope');
      expect(rendered).toEqual([]);
    });

    test('a rejected action goes to the error handler', async () => {
      const { request } = app(async () => {
        throw new Error('exploded');
      });
      const res = await request.get('/');

      expect(res.status).toBe(500);
      expect(res.text).toBe('exploded');
    });
  });
});

describe('flash messages', () => {
  /**
   * A request-like object with a session
   *
   * @param {object} [session] the session
   * @returns {object} the request
   */
  const fake = (session = {}) => {
    const req = { session };

    flash()(req, {}, () => {});

    return req;
  };

  test('queues, then reads and clears', () => {
    const req = fake();

    expect(req.flash('notice', 'Saved')).toEqual(['Saved']);
    expect(req.flash('notice', 'Again')).toEqual(['Saved', 'Again']);
    expect(req.session.flash).toEqual({ notice: ['Saved', 'Again'] });

    expect(req.flash('notice')).toEqual(['Saved', 'Again']);
    expect(req.flash('notice')).toEqual([]);
    expect(req.session.flash).toBeUndefined();
  });

  test('reads and clears everything at once', () => {
    const req = fake();

    req.flash('notice', 'Saved');
    req.flash('alert', ['One', 'Two']);

    expect(req.flash()).toEqual({ alert: ['One', 'Two'], notice: ['Saved'] });
    expect(req.flash()).toEqual({});
  });

  test('clearing one type keeps the others', () => {
    const req = fake();

    req.flash('notice', 'Saved');
    req.flash('alert', 'Careful');

    expect(req.flash('notice')).toEqual(['Saved']);
    expect(req.session.flash).toEqual({ alert: ['Careful'] });
  });

  test('is a no-op without a session', () => {
    const req = {};

    flash()(req, {}, () => {});

    expect(req.session).toBeUndefined();
    expect(req.flash('notice', 'Nowhere')).toEqual([]);
    expect(req.flash('notice')).toEqual([]);
    expect(req.flash()).toEqual({});
    expect(flash.pending(req)).toEqual({});
  });

  test('consume reads once and keeps what is queued afterwards', () => {
    const req = fake();

    req.flash('notice', 'Saved');

    const first = flash.consume(req);

    expect(first).toEqual({ notice: ['Saved'] });
    req.flash('notice', 'Later');
    expect(flash.consume(req)).toBe(first);
    expect(req.session.flash).toEqual({ notice: ['Later'] });
  });

  test('expose makes an enumerable property that consumes when read', () => {
    const req = fake();
    const view = flash.expose(req, { user: null });

    req.flash('notice', 'Saved');
    expect(Object.keys(view).sort()).toEqual(['flash', 'user']);
    expect(req.session.flash).toEqual({ notice: ['Saved'] });

    expect(Object.assign({}, view)).toEqual({
      flash: { notice: ['Saved'] },
      user: null,
    });
    expect(req.session.flash).toBeUndefined();
  });
});
