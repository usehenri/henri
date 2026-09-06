/* global Artwork, User */
const supertest = require('supertest');
const Henri = require('../henri');
const runtime = require('../base/runtime');
// The SQL adapter comes from the workspace: core does not depend on it, the
// suite only needs a sqlite-backed store to run a real read against
const Sql = require('../../../sequelize');
const { LIMITS, condition, readOnly, recorder, rowsOf, scrub } = runtime;

/** The header every runtime request must carry */
const HEADERS = { 'X-Henri-Runtime': '1' };

describe('runtime rules (no application)', () => {
  describe('readOnly: what may reach a store', () => {
    test('accepts the reads', () => {
      for (const sql of [
        'select * from users',
        'SELECT id, email FROM users WHERE email = ?',
        "SELECT * FROM notes WHERE title = 'a; drop table notes'",
        'WITH recent AS (SELECT * FROM notes) SELECT * FROM recent',
        'EXPLAIN SELECT * FROM notes',
        'SHOW TABLES',
        'DESCRIBE users',
        'select * from users -- and nothing else\n',
      ]) {
        expect({ ok: readOnly(sql).ok, sql }).toEqual({ ok: true, sql });
      }
    });

    test('refuses every write, and says which word refused it', () => {
      const refusals = {
        'DELETE FROM users': 'DELETE',
        'DROP TABLE users': 'DROP',
        'INSERT INTO users (email) VALUES (?)': 'INSERT',
        'TRUNCATE users': 'TRUNCATE',
        'UPDATE users SET roles = ?': 'UPDATE',
        'alter table users add column evil text': 'ALTER',
        'create table evil (id int)': 'CREATE',
        'grant all on users to public': 'GRANT',
      };

      for (const [sql, word] of Object.entries(refusals)) {
        const verdict = readOnly(sql);

        expect({ ok: verdict.ok, sql }).toEqual({ ok: false, sql });
        expect(['NOT_A_READ', 'WRITES']).toContain(verdict.code);
        expect(verdict.reason).toContain(word);
      }
    });

    test('refuses a write hidden behind a read', () => {
      for (const sql of [
        'SELECT 1; DELETE FROM users',
        'SELECT 1 -- \n; DROP TABLE users',
        'WITH gone AS (DELETE FROM users RETURNING *) SELECT * FROM gone',
        'SELECT * INTO backup FROM users',
        'SELECT * FROM users FOR UPDATE',
      ]) {
        expect({ ok: readOnly(sql).ok, sql }).toEqual({ ok: false, sql });
      }
    });

    test('refuses what is not a read at all', () => {
      expect(readOnly('').code).toBe('EMPTY');
      expect(readOnly('   ').code).toBe('EMPTY');
      expect(readOnly(';;').code).toBe('EMPTY');
      expect(readOnly('-- nothing at all').code).toBe('EMPTY');
      expect(readOnly(42).code).toBe('EMPTY');
      expect(readOnly('VACUUM').code).toBe('NOT_A_READ');
      expect(readOnly('PRAGMA journal_mode = WAL').code).toBe('NOT_A_READ');
      expect(readOnly(`SELECT ${'x'.repeat(LIMITS.sql)}`).code).toBe(
        'TOO_LONG'
      );
      expect(readOnly("SELECT * FROM users WHERE a = 'unclosed").code).toBe(
        'UNTERMINATED'
      );
      expect(readOnly('SELECT pg_sleep(30)').reason).toContain('PG_SLEEP');
    });
  });

  describe('condition: what may reach a model', () => {
    test('accepts a flat object of equalities', () => {
      expect(condition({ done: true, title: 'a', year: 1912 }).ok).toBe(true);
      expect(condition().value).toEqual({});
    });

    test('refuses operators and anything nested', () => {
      expect(condition({ $where: '1 == 1' }).ok).toBe(false);
      expect(condition({ year: { $ne: 1 } }).ok).toBe(false);
      expect(condition({ 'user.roles': 'admin' }).ok).toBe(false);
      expect(condition([1, 2]).ok).toBe(false);
      expect(condition('title')).toMatchObject({ ok: false });
    });
  });

  test('reads the rows whichever shape the adapter answered with', () => {
    // Sequelize hands back [rows, metadata], every Drizzle dialect the rows
    expect(rowsOf([[{ id: 1 }], { rowCount: 1 }])).toEqual([{ id: 1 }]);
    expect(rowsOf([[], {}])).toEqual([]);
    expect(rowsOf([{ id: 1 }, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }]);
    expect(rowsOf([])).toEqual([]);
    expect(rowsOf({ changes: 0 })).toEqual([{ changes: 0 }]);
    expect(rowsOf(null)).toEqual([]);
  });

  test('scrub masks the password whatever the configuration says', () => {
    expect(
      scrub({ email: 'a@b.c', password: 'hash' }, { filters: [] })
    ).toEqual({
      email: 'a@b.c',
      password: '[FILTERED]',
    });
    expect(scrub({ apiToken: 'x', name: 'n' }, { filters: ['token'] })).toEqual(
      {
        apiToken: '[FILTERED]',
        name: 'n',
      }
    );
  });

  test('scrub masks a personal field name exactly, not as a substring', () => {
    expect(
      scrub(
        { filename: 'notes.txt', name: 'Ada', password: 'x' },
        { filters: [], keys: new Set(['name']) }
      )
    ).toEqual({
      filename: 'notes.txt',
      name: '[FILTERED]',
      password: '[FILTERED]',
    });
  });

  test('records nothing in production', () => {
    expect(recorder({ isProduction: true })).toBeNull();
    expect(recorder(null)).toBeNull();
  });
});

describe('runtime endpoints (demo app, disk store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  let henri;
  let request;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
    request = supertest(henri.server.app);

    // A route that fails: the error, its stack and the request that caused
    // it are what an agent asks for first
    henri.router.handler.get('/_test/boom', (req, res, next) =>
      next(new Error('the kettle is empty'))
    );
  }, 60000);

  afterAll(async () => {
    await henri.stop();
    delete global.henri;
    if (typeof skipWorkers === 'undefined') {
      delete process.env.SKIP_WORKERS;
    } else {
      process.env.SKIP_WORKERS = skipWorkers;
    }
  }, 60000);

  describe('the guard', () => {
    test('refuses a request without the header', async () => {
      const res = await request.get('/_henri/runtime');

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('HEADER');
      expect(res.body.error.message).toContain('x-henri-runtime');
    });

    test('refuses anything a browser sent', async () => {
      for (const [header, value] of [
        ['Origin', 'http://127.0.0.1:3000'],
        ['Sec-Fetch-Site', 'same-origin'],
      ]) {
        const res = await request
          .get('/_henri/runtime')
          .set(HEADERS)
          .set(header, value);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('BROWSER');
      }
    });

    test('refuses a query from a browser too', async () => {
      const res = await request
        .post('/_henri/runtime/query')
        .set(HEADERS)
        .set('Origin', 'http://evil.example')
        .send({ sql: 'SELECT 1' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('BROWSER');
    });
  });

  test('says what the application is', async () => {
    const res = await request.get('/_henri/runtime').set(HEADERS);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.app).toMatchObject({ env: 'test', pid: process.pid });
    expect(res.body.stores).toEqual({
      default: { adapter: 'disk', queryable: false },
    });
    expect(res.body.models.map((model) => model.name).sort()).toEqual([
      'Artwork',
      'Memo',
      'User',
    ]);
    expect(res.body.limits).toEqual(LIMITS);
    expect(res.body.filterParameters).toContain('password');
  });

  test('keeps the last error with the request that caused it', async () => {
    const failed = await request
      .get('/_test/boom?token=super-secret&keep=this')
      .set('X-Request-Id', 'boom-1');

    expect(failed.status).toBe(500);

    const res = await request.get('/_henri/runtime/errors').set(HEADERS);

    expect(res.status).toBe(200);

    const [error] = res.body.errors;

    expect(error.message).toBe('the kettle is empty');
    expect(error.status).toBe(500);
    expect(error.requestId).toBe('boom-1');
    expect(error.stack).toContain('Error: the kettle is empty');
    expect(error.request).toMatchObject({ method: 'GET' });
    expect(error.request.url).toBe(
      '/_test/boom?token=%5BFILTERED%5D&keep=this'
    );
    expect(JSON.stringify(res.body)).not.toContain('super-secret');
  });

  test('filters the errors by request id, and bounds them', async () => {
    await request.get('/_test/boom').set('X-Request-Id', 'boom-2');

    const one = await request
      .get('/_henri/runtime/errors?requestId=boom-2')
      .set(HEADERS);

    expect(one.body.count).toBe(1);
    expect(one.body.errors[0].requestId).toBe('boom-2');

    const bounded = await request
      .get('/_henri/runtime/errors?limit=1')
      .set(HEADERS);

    expect(bounded.body.limit).toBe(1);
    expect(bounded.body.errors).toHaveLength(1);
    expect(bounded.body.matched).toBeGreaterThan(1);
    expect(bounded.body.truncated).toBe(true);
  });

  test('answers the log lines, redacted, with their request id', async () => {
    henri.pen.error('teapot', 'brewing failed', {
      password: 'hunter2',
      user: 'ada',
    });
    henri.pen.info('teapot', 'https://example.com/x?token=leaky&page=2');

    const res = await request
      .get('/_henri/runtime/logs?contains=teapot')
      .set(HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.kept).toBe(LIMITS.logs);
    expect(res.body.seen).toBeGreaterThan(0);

    const levels = await request
      .get('/_henri/runtime/logs?level=error&contains=brewing')
      .set(HEADERS);

    expect(levels.body.lines).toHaveLength(1);
    expect(levels.body.lines[0]).toMatchObject({
      level: 'error',
      name: 'teapot',
    });
    expect(levels.body.lines[0].message).toContain('brewing failed =>');
    expect(levels.body.lines[0].message).toContain("password: '[FILTERED]'");
    expect(levels.body.lines[0].message).not.toContain('hunter2');

    const url = await request
      .get('/_henri/runtime/logs?contains=example.com')
      .set(HEADERS);

    expect(url.body.lines[0].message).toContain('token=%5BFILTERED%5D');
    expect(url.body.lines[0].message).not.toContain('leaky');
  });

  test('bounds a log line, and the number of lines', async () => {
    henri.pen.info('teapot', 'x'.repeat(LIMITS.message + 100));

    const res = await request
      .get('/_henri/runtime/logs?limit=2&contains=xxxx')
      .set(HEADERS);

    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].message).toMatch(/\[100 more characters\]$/);
    expect(res.body.limit).toBe(2);
  });

  test('never keeps more lines than it says it keeps', () => {
    const record = recorder(henri);
    const before = record.logs.length;

    for (let index = 0; index < LIMITS.logs + 10; index++) {
      henri.pen.silly('flood', `line ${index}`);
    }

    expect(before).toBeLessThanOrEqual(LIMITS.logs);
    expect(record.logs).toHaveLength(LIMITS.logs);
    expect(record.logs[record.logs.length - 1]).toMatchObject({
      message: `line ${LIMITS.logs + 9}`,
      name: 'flood',
    });
  });

  test('answers the routes the router registered', async () => {
    const res = await request.get('/_henri/runtime/routes').set(HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(10);

    const root = res.body.routes.find((route) => route.route === '/');

    expect(root).toMatchObject({
      action: 'home',
      active: true,
      controller: 'main',
      helper: 'home_main_path',
      verb: 'get',
    });

    const guarded = res.body.routes.find((route) => route.route === '/admin');

    expect(guarded.roles).toEqual(['admin']);
    expect(res.body.internal).toContain('GET /_henri/runtime');
    expect(res.body.internal).toContain('GET /_henri/health');
  });

  describe('reading a store', () => {
    test('refuses a write before it reaches the adapter', async () => {
      const res = await request
        .post('/_henri/runtime/query')
        .set(HEADERS)
        .send({ sql: 'DELETE FROM users' });

      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({
        code: 'REFUSED',
        refused: 'DELETE FROM users',
        rule: 'NOT_A_READ',
      });
      expect(res.body.error.message).toContain('DELETE');
    });

    test('says an adapter cannot be queried rather than trying', async () => {
      const res = await request
        .post('/_henri/runtime/query')
        .set(HEADERS)
        .send({ sql: 'SELECT 1' });

      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: 'NO_QUERY' });
      expect(res.body.error.message).toContain('disk');
    });

    test('says when a store does not exist', async () => {
      const res = await request
        .post('/_henri/runtime/query')
        .set(HEADERS)
        .send({ sql: 'SELECT 1', store: 'analytics' });

      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({
        code: 'UNKNOWN_STORE',
        known: ['default'],
      });
    });

    // A second store, so the read path runs against a real SQL database:
    // the demo application's own store is MongoDB and has no query()
    describe('against a sqlite store', () => {
      let sql;

      beforeAll(async () => {
        sql = new Sql(
          'sql',
          {
            adapter: 'sqlite',
            dialect: 'sqlite',
            logging: false,
            storage: ':memory:',
          },
          henri
        );
        sql.addModel(
          {
            globalId: 'Note',
            identity: 'note',
            options: { externalId: false, timestamps: false },
            schema: {
              password: { type: 'string' },
              title: { type: 'string' },
            },
          },
          'user'
        );
        await sql.start();

        const { Note } = sql.getModels();

        for (let index = 0; index < 12; index++) {
          await Note.create({ password: 'hunter2', title: `note ${index}` });
        }

        henri.model.stores.sql = sql;
      }, 30000);

      afterAll(async () => {
        delete henri.model.stores.sql;
        await sql.stop();
      });

      test('runs a read and redacts what comes back', async () => {
        const res = await request
          .post('/_henri/runtime/query')
          .set(HEADERS)
          .send({
            params: ['note 3'],
            sql: 'SELECT * FROM Notes WHERE title = ?',
            store: 'sql',
          });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          adapter: 'sqlite',
          count: 1,
          store: 'sql',
          truncated: false,
        });
        expect(res.body.rows[0].title).toBe('note 3');
        expect(res.body.rows[0].password).toBe('[FILTERED]');
        expect(res.text).not.toContain('hunter2');
      });

      test('never answers more rows than the caller asked for', async () => {
        const res = await request
          .post('/_henri/runtime/query')
          .set(HEADERS)
          .send({ limit: 4, sql: 'SELECT * FROM Notes', store: 'sql' });

        expect(res.body.count).toBe(4);
        expect(res.body.limit).toBe(4);
        expect(res.body.rows).toHaveLength(4);
        expect(res.body.truncated).toBe(true);
      });

      test('the writes never reach the database', async () => {
        const { Note } = sql.getModels();

        for (const statement of [
          'DELETE FROM Notes',
          'DROP TABLE Notes',
          'UPDATE Notes SET title = ?',
          "INSERT INTO Notes (title) VALUES ('x')",
          'SELECT * FROM Notes; DELETE FROM Notes',
        ]) {
          const res = await request
            .post('/_henri/runtime/query')
            .set(HEADERS)
            .send({ params: ['x'], sql: statement, store: 'sql' });

          expect({ sql: statement, status: res.status }).toEqual({
            sql: statement,
            status: 422,
          });
          expect(res.body.error.code).toBe('REFUSED');
        }

        expect(await Note.count()).toBe(12);
      });

      test('refuses a parameter that is not a value', async () => {
        const res = await request
          .post('/_henri/runtime/query')
          .set(HEADERS)
          .send({
            params: [{ evil: true }],
            sql: 'SELECT * FROM Notes WHERE title = ?',
            store: 'sql',
          });

        expect(res.status).toBe(422);
        expect(res.body.error.rule).toBe('PARAMS');
      });

      test('hands the database error back when the read is wrong', async () => {
        const res = await request
          .post('/_henri/runtime/query')
          .set(HEADERS)
          .send({ sql: 'SELECT * FROM Nope', store: 'sql' });

        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('FAILED');
        expect(res.body.error.message).toContain('Nope');
      });
    });
  });

  describe('reading a record through its model', () => {
    beforeAll(async () => {
      await Artwork.create({
        title: 'Nude Descending a Staircase',
        year: 1912,
      });
      await User.create({
        email: 'runtime@usehenri.io',
        name: 'ada',
        password: 'difference-engine',
      });
    });

    test('answers a page of a model', async () => {
      const res = await request
        .post('/_henri/runtime/records')
        .set(HEADERS)
        .send({ model: 'Artwork', perPage: 5 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ model: 'Artwork', page: 1, perPage: 5 });
      expect(res.body.records.length).toBeGreaterThan(0);
      expect(res.body.records[0].title).toBeTruthy();
    });

    test('answers one record, and never its password', async () => {
      const page = await request
        .post('/_henri/runtime/records')
        .set(HEADERS)
        .send({ model: 'User', where: { email: 'runtime@usehenri.io' } });

      expect(page.body.records).toHaveLength(1);
      expect(page.body.records[0].password).toBeUndefined();

      const one = await request
        .post('/_henri/runtime/records')
        .set(HEADERS)
        .send({ id: page.body.records[0].externalId, model: 'User' });

      // An email is personal: the runtime hands an agent the record with
      // it masked, like every other personal field (see base/privacy.js)
      expect(one.body.record.email).toBe('[FILTERED]');
      expect(one.body.record.name).toBeTruthy();
      expect(one.body.record.password).toBeUndefined();
      expect(JSON.stringify(one.body)).not.toContain('difference-engine');
    });

    test('never answers more records than it says it may', async () => {
      const res = await request
        .post('/_henri/runtime/records')
        .set(HEADERS)
        .send({ model: 'Artwork', perPage: 5000 });

      expect(res.body.perPage).toBe(LIMITS.perPage);
      expect(res.body.records.length).toBeLessThanOrEqual(LIMITS.perPage);
    });

    test('refuses an operator in a where', async () => {
      const res = await request
        .post('/_henri/runtime/records')
        .set(HEADERS)
        .send({ model: 'User', where: { $where: 'this.email.length > 0' } });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('REFUSED');
      expect(res.body.error.message).toContain('no operators');
    });

    test('says when a model does not exist', async () => {
      const res = await request
        .post('/_henri/runtime/records')
        .set(HEADERS)
        .send({ model: 'Teapot' });

      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: 'UNKNOWN_MODEL' });
      expect(res.body.error.known).toContain('Artwork');
    });
  });
});
