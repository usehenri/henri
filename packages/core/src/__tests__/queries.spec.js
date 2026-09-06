const Queries = require('../0.queries');
const {
  Detector,
  OPERATIONS,
  callsiteOf,
  checkDetect,
  keysOf,
  queriesConfig,
  rowsOf,
  shapeOf,
} = require('../base/queries');
const { context } = require('../base/request-id');

/**
 * A henri stand-in with the seam built on it
 *
 * @param {*} [queries] What `config.queries` says
 * @param {boolean} [production=false] Whether this is a production boot
 * @returns {object} The module, with `henri` on it
 */
const build = (queries, production = false) => {
  const lines = [];
  const henri = {
    config: {
      get: () => queries,
      has: () => typeof queries !== 'undefined',
    },
    cwd: () => process.cwd(),
    isDev: !production,
    isProduction: production,
    lines,
    pen: {
      error: (...args) => lines.push(['error', ...args]),
      info: (...args) => lines.push(['info', ...args]),
      warn: (...args) => lines.push(['warn', ...args]),
    },
  };
  const module = new Queries();

  module.henri = henri;
  module.init();

  return module;
};

/** One event, as an adapter would report it */
const record = (module, over = {}) =>
  module.record({
    adapter: 'drizzle',
    method: 'findByKey',
    model: 'Track',
    operation: 'select',
    rows: 1,
    started: performance.now(),
    ...over,
  });

/** Runs something inside a request, so the detector has a bucket */
const inRequest = (id, fn) => context.run({ id }, fn);

describe('the query seam', () => {
  describe('the configuration', () => {
    test('is on outside production and off inside it', () => {
      expect(queriesConfig(null, false).enabled).toBe(true);
      expect(queriesConfig(null, true).enabled).toBe(false);
    });

    test('false is off everywhere, and detects nothing', () => {
      const settings = queriesConfig(
        { get: () => false, has: () => true },
        false
      );

      expect(settings.enabled).toBe(false);
      expect(settings.detect).toBe(false);
      expect(settings.callsites).toBe(false);
    });

    test('enabled: true is the production opt-in', () => {
      const settings = queriesConfig(
        { get: () => ({ enabled: true }), has: () => true },
        true
      );

      expect(settings.enabled).toBe(true);
      expect(settings.detect).toBeTruthy();
    });

    test('detect: false keeps the events and reports nothing', () => {
      const settings = queriesConfig(
        { get: () => ({ detect: false }), has: () => true },
        false
      );

      expect(settings.enabled).toBe(true);
      expect(settings.detect).toBe(false);
      // No detector, no reason to pay for a stack per call
      expect(settings.callsites).toBe(false);
    });

    test('refuses a threshold below two, because one call is not a repeat', () => {
      expect(() => checkDetect({ ignore: [], threshold: 1 })).toThrow(
        /at least 2/u
      );
      expect(() => checkDetect({ ignore: [], threshold: 1 })).toThrow(
        expect.objectContaining({ code: 'HENRI_QUERIES_INVALID_DETECT' })
      );
    });

    test('refuses an ignore entry that is not a name it understands', () => {
      expect(() =>
        checkDetect({ ignore: ['Track.frobnicate'], threshold: 5 })
      ).toThrow(
        expect.objectContaining({ code: 'HENRI_QUERIES_INVALID_DETECT' })
      );
      expect(
        checkDetect({ ignore: ['Track', 'User.select', '*.raw'], threshold: 5 })
      ).toBeTruthy();
    });
  });

  describe('what an event carries', () => {
    test('names and numbers, and the request id it joins on', () => {
      const module = build();
      const event = inRequest('req-1', () =>
        record(module, { filter: { ownerId: 42, state: 'open' } })
      );

      expect(event).toMatchObject({
        adapter: 'drizzle',
        keys: ['ownerId', 'state'],
        method: 'findByKey',
        model: 'Track',
        operation: 'select',
        requestId: 'req-1',
        rows: 1,
        source: 'application',
      });
      expect(event.duration).toBeGreaterThanOrEqual(0);
      expect(event.shape).toMatch(/^[0-9a-f]{12}$/u);
    });

    test('and never a value, a statement or a parameter', () => {
      const module = build();
      const event = record(module, {
        filter: { email: 'ada@example.com', token: 'a-secret' },
      });
      const serialized = JSON.stringify(event);

      expect(event.keys).toEqual(['email', 'token']);
      expect(serialized).not.toContain('ada@example.com');
      expect(serialized).not.toContain('a-secret');
      expect(event).not.toHaveProperty('sql');
      expect(event).not.toHaveProperty('statement');
      expect(event).not.toHaveProperty('params');
      // The join is the request id, and there is only one identifier
      expect(event).not.toHaveProperty('traceId');
    });

    test('an operation is one of the vocabulary the adapters share', () => {
      expect(OPERATIONS).toContain('select');
      expect(OPERATIONS).toContain('raw');
      expect([...OPERATIONS].sort()).toEqual([...OPERATIONS]);
    });

    test('a shape is the same in the next process, so it can be grepped', () => {
      const parts = {
        adapter: 'drizzle',
        keys: ['id'],
        model: 'Track',
        operation: 'select',
      };

      expect(shapeOf(parts)).toBe(shapeOf({ ...parts }));
      expect(shapeOf(parts)).not.toBe(shapeOf({ ...parts, model: 'Other' }));
      expect(shapeOf(parts)).not.toBe(shapeOf({ ...parts, keys: ['slug'] }));
    });
  });

  describe('the filter, read for its names', () => {
    test('drops the operators and keeps the columns', () => {
      expect(keysOf({ age: { $gt: 30 }, name: 'ada' })).toEqual([
        'age',
        'name',
      ]);
    });

    test('walks the combinators the three query languages share', () => {
      expect(
        keysOf({ $and: [{ a: 1 }, { $or: [{ b: 2 }, { c: 3 }] }] })
      ).toEqual(['a', 'b', 'c']);
    });

    test('walks a symbol key, which is how Sequelize spells Op.and', () => {
      expect(keysOf({ [Symbol.for('and')]: [{ a: 1 }, { b: 2 }] })).toEqual([
        'a',
        'b',
      ]);
    });

    test('answers nothing for what it cannot read', () => {
      expect(keysOf(null)).toEqual([]);
      expect(keysOf('a string')).toEqual([]);
    });

    test('is bounded: a filter is a shape and not a document', () => {
      const wide = Object.fromEntries(
        Array.from({ length: 40 }, (one, index) => [`f${index}`, index])
      );

      expect(keysOf(wide).length).toBeLessThanOrEqual(12);
    });
  });

  describe('the row count', () => {
    test('reads the shapes the three adapters answer with', () => {
      expect(rowsOf([1, 2, 3])).toBe(3);
      expect(rowsOf(null)).toBe(0);
      expect(rowsOf(undefined)).toBe(0);
      expect(rowsOf({ records: [1, 2] })).toBe(2);
      expect(rowsOf({})).toBe(1);
      expect(rowsOf(7)).toBe(7);
      expect(rowsOf(false)).toBe(0);
    });

    test('and answers null rather than guessing', () => {
      expect(rowsOf(Symbol('x'))).toBeNull();
    });
  });

  describe('the call site', () => {
    test('is the application frame and not henri or node_modules', () => {
      const error = new Error('here');

      error.stack = [
        'Error: here',
        '    at Model.find (/app/node_modules/drizzle-orm/index.js:1:1)',
        '    at Queries.record (/repo/packages/core/src/0.queries.js:1:1)',
        '    at index (/repo/app/controllers/TracksController.js:34:12)',
      ].join('\n');

      expect(callsiteOf(error, '/repo')).toEqual({
        column: 12,
        file: 'app/controllers/TracksController.js',
        line: 34,
      });
    });

    test('answers nothing when every frame belongs to somebody else', () => {
      const error = new Error('here');

      error.stack = [
        'Error: here',
        '    at x (/app/node_modules/pg/index.js:1:1)',
      ].join('\n');

      expect(callsiteOf(error, '/repo')).toBeNull();
    });
  });

  describe('the detector', () => {
    test('counts the same shape and leaves the different ones alone', () => {
      const detector = new Detector({ threshold: 3 });

      inRequest('req', () => {
        for (let index = 0; index < 4; index += 1) {
          detector.count({
            duration: 1,
            keys: ['id'],
            method: 'findByKey',
            model: 'Track',
            operation: 'select',
            shape: 'aaa',
          });
        }

        detector.count({
          duration: 1,
          keys: [],
          method: 'find',
          model: 'Event',
          operation: 'select',
          shape: 'bbb',
        });

        const findings = detector.findings(context.getStore().queries);

        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ count: 4, model: 'Track' });
      });
    });

    test('counts nothing outside a request, because that is the predicate', () => {
      const detector = new Detector({ threshold: 2 });

      expect(
        detector.count({ duration: 1, operation: 'select', shape: 'aaa' })
      ).toBeNull();
    });

    test('one request is not pooled with another', () => {
      const detector = new Detector({ threshold: 2 });
      const once = () =>
        detector.count({
          duration: 1,
          keys: [],
          method: 'find',
          model: 'Track',
          operation: 'select',
          shape: 'aaa',
        });

      inRequest('one', once);
      inRequest('two', () => {
        once();

        expect(detector.findings(context.getStore().queries)).toEqual([]);
      });
    });

    test('ignores by model, by Model.operation and by *.operation', () => {
      const event = {
        duration: 1,
        model: 'Track',
        operation: 'select',
        shape: 'aaa',
      };

      expect(new Detector({ ignore: ['Track'] }).ignores(event)).toBe(true);
      expect(new Detector({ ignore: ['Track.select'] }).ignores(event)).toBe(
        true
      );
      expect(new Detector({ ignore: ['*.select'] }).ignores(event)).toBe(true);
      expect(new Detector({ ignore: ['Track.insert'] }).ignores(event)).toBe(
        false
      );
    });
  });

  describe('where a finding goes', () => {
    test('one warning per request, naming the call and what to do', () => {
      const module = build({ detect: { threshold: 3 } });

      inRequest('req', () => {
        for (let index = 0; index < 3; index += 1) {
          record(module);
        }

        module.complain({ method: 'GET' });
      });

      const warning = module.henri.lines.find((line) => line[0] === 'warn');

      expect(warning).toBeTruthy();
      expect(warning.join(' ')).toContain('Track.findByKey ran 3 times');
      expect(warning.join(' ')).toContain('load them together');
    });

    test('nothing is said when nothing repeated', () => {
      const module = build({ detect: { threshold: 3 } });

      inRequest('quiet', () => {
        record(module);

        expect(module.complain({ method: 'GET' })).toBe(0);
      });
    });

    test('the header carries counts and names, and never a value', () => {
      const module = build({ detect: { threshold: 2 } });

      inRequest('req', () => {
        record(module, { filter: { id: 'a-secret-id' } });
        record(module, { filter: { id: 'another-secret' } });

        const line = module.summarize();

        expect(line).toContain('n+1 Track.findByKey x2');
        expect(line).not.toContain('a-secret-id');
        expect(line).not.toContain('another-secret');
      });
    });

    test('raise throws the moment the threshold is crossed', () => {
      const module = build({ detect: { raise: true, threshold: 3 } });

      inRequest('req', () => {
        record(module);
        record(module);

        // The third is the one that crosses, so the stack names the call
        // that went one too far
        expect(() => record(module)).toThrow(
          expect.objectContaining({ code: 'HENRI_QUERIES_N_PLUS_ONE' })
        );
      });
    });

    test('the reporter is deliberately not one of them', () => {
      const module = build({ detect: { threshold: 2 } });
      const reported = [];

      module.henri.reporter = { report: (error) => reported.push(error) };

      inRequest('req', () => {
        record(module);
        record(module);
        module.complain({ method: 'GET' });
      });

      // An N+1 is a slow answer, not a failure: it does not belong in the
      // stream an application wired to page somebody
      expect(reported).toEqual([]);
    });
  });

  describe('the handler an application registers', () => {
    test('gets every event, and only a function is accepted', () => {
      const module = build();
      const seen = [];

      expect(module.onQuery((event) => seen.push(event))).toBe(true);
      record(module);
      expect(seen).toHaveLength(1);

      expect(module.onQuery(null)).toBe(true);
      record(module);
      expect(seen).toHaveLength(1);

      expect(module.onQuery('not a function')).toBe(false);
    });

    test('one that throws is removed rather than left to break queries', () => {
      const module = build();

      module.onQuery(() => {
        throw new Error('the handler is broken');
      });

      expect(() => record(module)).not.toThrow();
      expect(module._handler).toBeNull();
      expect(
        module.henri.lines.some(
          (line) => line[0] === 'error' && line.join(' ').includes('threw')
        )
      ).toBe(true);
    });
  });

  describe('the middleware', () => {
    /**
     * A response double carrying the two hooks the middleware uses
     *
     * @returns {object} the response
     */
    const fakeRes = () => {
      const listeners = [];

      return {
        finish: () => listeners.forEach((fn) => fn()),
        headers: {},
        headersSent: false,
        on: (event, fn) => event === 'finish' && listeners.push(fn),
        setHeader(name, value) {
          this.headers[name] = value;
        },
        writeHead() {
          return this;
        },
      };
    };

    test('writes the header before the answer goes out, in development', () => {
      const module = build({ detect: { threshold: 2 } });
      const middleware = module.middleware();
      const res = fakeRes();

      expect(middleware).toBeTypeOf('function');

      inRequest('req', () => {
        middleware({ method: 'GET' }, res, () => {});
        record(module);
        record(module);
        // Express writes the head when the answer starts going out; the
        // header has to be there by then, which is what the wrap is for
        res.writeHead(200);
      });

      expect(res.headers['X-Henri-Queries']).toContain(
        'n+1 Track.findByKey x2'
      );
    });

    test('and outside development it writes none at all', () => {
      const module = build({ detect: { threshold: 2 } }, true);

      // Production turns the whole seam off, so there is no middleware
      expect(module.enabled).toBe(false);
      expect(module.middleware()).toBeNull();

      // On in production by request, the header still is not: a count of an
      // application's internals is nobody else's business
      const counting = build({ detect: { threshold: 2 }, enabled: true }, true);
      const res = fakeRes();

      inRequest('req', () => {
        counting.middleware()({ method: 'GET' }, res, () => {});
        record(counting);
        record(counting);
        res.writeHead(200);
      });

      expect(res.headers['X-Henri-Queries']).toBeUndefined();
    });

    test('the end of the request is when the count is final', () => {
      const module = build({ detect: { threshold: 3 } });
      const res = fakeRes();

      inRequest('req', () => {
        module.middleware()({ method: 'GET' }, res, () => {});

        for (let index = 0; index < 7; index += 1) {
          record(module);
        }

        res.finish();
      });

      const warning = module.henri.lines.find((line) => line[0] === 'warn');

      // Seven, not the three that crossed the line
      expect(warning.join(' ')).toContain('ran 7 times');
      expect(module.stats().findings).toBe(1);
    });

    test('a request with no query allocates no bucket', () => {
      const module = build({ detect: { threshold: 2 } });
      const res = fakeRes();

      inRequest('quiet', () => {
        module.middleware()({ method: 'GET' }, res, () => {});
        res.writeHead(200);
        res.finish();
      });

      expect(res.headers['X-Henri-Queries']).toBeUndefined();
      expect(module.stats().findings).toBe(0);
    });
  });

  describe('off', () => {
    test('installs nothing and says nothing', () => {
      const module = build(false);

      expect(module.enabled).toBe(false);
      expect(module.detector).toBeNull();
      expect(module.middleware()).toBeNull();
      expect(module.henri.lines).toEqual([]);
    });

    test('a target handed to instrument() while off is untouched', () => {
      const module = build(false);
      const original = () => 'answer';
      const target = { find: original };

      module.instrument(
        target,
        { find: { operation: 'select' } },
        { adapter: 'drizzle', model: 'Track' }
      );

      // The wrapper is installed (an adapter that asked anyway gets one) but
      // it calls straight through, so a disabled seam costs one call
      expect(target.find()).toBe('answer');
    });

    test('stats say what happened', () => {
      const module = build();

      record(module);

      expect(module.stats()).toMatchObject({
        detecting: true,
        enabled: true,
        events: 1,
      });
    });
  });
});
