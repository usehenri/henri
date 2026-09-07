/* global Memo */
const supertest = require('supertest');
const Henri = require('../henri');
const { EventEmitter } = require('node:events');
const {
  DEFAULTS,
  cell,
  filenameOf,
  headerOf,
  interrupted,
  line,
  numeric,
  push,
  settings,
  textOf,
} = require('../base/csv');

const password = 'difference-engine';
const ownerEmail = 'ada@usehenri.io';
const adminEmail = 'charles@usehenri.io';

describe('escaping a cell (base/csv.js)', () => {
  test('a plain value is written as it is', () => {
    expect(cell('ship it')).toBe('ship it');
    expect(cell(42)).toBe('42');
    expect(cell(true)).toBe('true');
    expect(cell(null)).toBe('');
    expect(cell(undefined)).toBe('');
  });

  test('the delimiter, a quote and a newline ask for quotes', () => {
    expect(cell('a,b')).toBe('"a,b"');
    expect(cell('say "hi"')).toBe('"say ""hi"""');
    expect(cell('one\ntwo')).toBe('"one\ntwo"');
    expect(cell('one\r\ntwo')).toBe('"one\r\ntwo"');
    expect(cell('a\tb')).toBe('"a\tb"');
  });

  test('a leading or trailing space is kept, and said so', () => {
    expect(cell(' padded')).toBe('" padded"');
    expect(cell('padded ')).toBe('"padded "');
  });

  test('a date is ISO 8601 and a json column is its json', () => {
    expect(textOf(new Date('2026-01-02T03:04:05.000Z'))).toBe(
      '2026-01-02T03:04:05.000Z'
    );
    expect(textOf(new Date('nope'))).toBe('');
    expect(cell({ a: 1 })).toBe('"{""a"":1}"');
    expect(cell(['a', 'b'])).toBe('"[""a"",""b""]"');
  });

  test('a formula is written as text, quoted and prefixed', () => {
    expect(cell('=SUM(A1)')).toBe(`"'=SUM(A1)"`);
    expect(cell('@import')).toBe(`"'@import"`);
    expect(cell('+cmd')).toBe(`"'+cmd"`);
    expect(cell("=cmd|'/c calc'!A1")).toBe(`"'=cmd|'/c calc'!A1"`);
  });

  test('... and a number is not a formula, whatever it starts with', () => {
    // The whole false positive the rule exists not to have: a negative
    // number stored in a text column
    expect(cell('-1.5')).toBe('-1.5');
    expect(cell('-42')).toBe('-42');
    expect(cell('+33')).toBe('+33');
    // Not a plain number, so it is text
    expect(cell('-1.5.2')).toBe(`"'-1.5.2"`);
    expect(cell('+33 6 12 34 56 78')).toBe(`"'+33 6 12 34 56 78"`);
  });

  test('a value henri wrote itself is never a formula', () => {
    // Only a string is considered: a number, a date or a boolean is text
    // henri produced
    expect(cell(-1.5)).toBe('-1.5');
    expect(numeric('-1.5')).toBe(true);
    expect(numeric('1.2.3')).toBe(false);
    expect(numeric('')).toBe(false);
    expect(numeric('-')).toBe(false);
    expect(numeric('12a')).toBe(false);
  });

  test('the guard can be turned off, and then the bytes are the bytes', () => {
    expect(cell('=SUM(A1)', false)).toBe('=SUM(A1)');
  });

  test('a row is the columns of the header, in order', () => {
    expect(line({ a: 1, b: 2 }, ['b', 'a', 'c'], true)).toBe('2,1,\r\n');
  });
});

describe('the filename of an export', () => {
  test('is walked rather than matched, and always ends in .csv', () => {
    expect(filenameOf('memos', 'export')).toBe('memos.csv');
    expect(filenameOf('memos.csv', 'export')).toBe('memos.csv');
    expect(filenameOf(undefined, 'memo')).toBe('memo.csv');
    expect(filenameOf('', 'memo')).toBe('memo.csv');
  });

  test('nothing of it can reach the header it is written into', () => {
    expect(filenameOf('a"b', 'export')).toBe('a-b.csv');
    expect(filenameOf('a\r\nX-Evil: 1', 'export')).toBe('a--X-Evil--1.csv');
    expect(filenameOf('../../etc/passwd', 'export')).toBe('etc-passwd.csv');
  });
});

describe('the settings', () => {
  test('are the defaults when the application says nothing', () => {
    expect(settings({ config: { has: () => false } })).toEqual(DEFAULTS);
    expect(settings(null)).toEqual(DEFAULTS);
  });

  test('and what it did say, when it said something usable', () => {
    const config = {
      get: () => ({ csv: { batch: 10, formulas: false, maxRows: -3 } }),
      has: () => true,
    };

    expect(settings({ config })).toEqual({
      batch: 10,
      formulas: false,
      maxRows: DEFAULTS.maxRows,
    });
  });
});

describe('writing, and stopping', () => {
  /**
   * A response that can be made to say it is full
   *
   * @param {boolean} full does `write()` ask the caller to wait?
   * @returns {object} the fake response
   */
  const fake = (full) => {
    const socket = new EventEmitter();

    socket.written = [];
    socket.destroyed = false;
    socket.writableEnded = false;
    socket.write = (chunk) => {
      socket.written.push(chunk);

      return !full;
    };
    socket.destroy = () => {
      socket.destroyed = true;
    };

    return socket;
  };

  test('a write that fits is not waited on', async () => {
    const res = fake(false);

    await push(res, 'a,b\r\n');

    expect(res.written).toEqual(['a,b\r\n']);
  });

  test('a write that does not fit waits for the socket', async () => {
    const res = fake(true);
    const waiting = push(res, 'a,b\r\n');
    let settled = false;

    waiting.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    res.emit('drain');
    await waiting;

    expect(settled).toBe(true);
  });

  test('... and gives up when the client goes away', async () => {
    const res = fake(true);
    const waiting = push(res, 'a,b\r\n');

    res.emit('close');

    await expect(waiting).rejects.toThrow('closed the connection');
  });

  test('a response that already ended is never written to again', async () => {
    const res = fake(false);

    res.writableEnded = true;

    await expect(push(res, 'x')).rejects.toThrow('closed the connection');
    expect(res.written).toEqual([]);
  });

  test('a failure with bytes on the wire destroys the connection', () => {
    const res = fake(false);
    const warned = [];
    const henri = {
      pen: { error: (...args) => warned.push(args) },
      reporter: { report: (...args) => warned.push(['reported', ...args]) },
    };

    interrupted(henri, {}, res, new Error('the store went away'), 12);

    // Not `end()`: the terminating chunk is never written, so a client
    // reads a transport error rather than a complete file
    expect(res.destroyed).toBe(true);
    expect(warned[0][1]).toContain('12 rows');
    expect(warned.some(([first]) => first === 'reported')).toBe(true);
  });

  test('a client that left is not reported as a failure of the application', () => {
    const res = fake(false);
    const reported = [];
    const error = new Error('gone');
    const henri = {
      pen: { error: () => undefined },
      reporter: { report: () => reported.push(true) },
    };

    error.code = 'HENRI_CSV_INTERRUPTED';
    interrupted(henri, {}, res, error, 3);

    expect(reported).toEqual([]);
    expect(res.destroyed).toBe(true);
  });
});

describe('res.csv (demo app, disk store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  let henri;
  let app;
  let owner;
  let admin;

  /**
   * Runs a request with `config.api.csv` saying something else. The settings
   * are read per request, so the stub is the whole of it
   *
   * @param {object} csv what `config.api.csv` should say
   * @param {function} run the request
   * @returns {Promise<*>} whatever it answered
   */
  const withSettings = async (csv, run) => {
    const read = henri.config.get.bind(henri.config);
    const knows = henri.config.has.bind(henri.config);

    henri.config.get = (key) =>
      key === 'api' ? { ...(knows('api') ? read('api') : {}), csv } : read(key);
    henri.config.has = (key) => key === 'api' || knows(key);

    try {
      return await run();
    } finally {
      henri.config.get = read;
      henri.config.has = knows;
    }
  };

  /**
   * Registers and signs a user in
   *
   * @param {string} email the address
   * @param {?Array<string>} [roles=null] roles to grant first
   * @returns {Promise<object>} a supertest agent
   */
  const signUp = async (email, roles = null) => {
    const agent = supertest.agent(app);

    await agent.post('/register').send({
      email,
      gender: 'unspecified',
      name: email.split('@')[0],
      password,
    });

    if (roles) {
      const record = await henri.user.findByEmail(email);

      await record.setRoles(roles);
    }

    await agent.post('/login').send({ email, password });

    return agent;
  };

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
    app = henri.server.app;
    owner = await signUp(ownerEmail);
    admin = await signUp(adminEmail, ['admin']);

    const record = await henri.user.findByEmail(ownerEmail);
    const ownerId = String(record.id || record._id);

    await Memo.create({
      body: 'the first one',
      ownerId,
      title: 'Ship, it',
    });
    await Memo.create({
      body: 'a formula somebody typed',
      ownerId,
      title: '=SUM(A1)',
    });
    // Somebody else's, which the scope of app/policies/memo.js excludes
    await Memo.create({
      body: 'not yours',
      ownerId: 'someone-else',
      title: 'x',
    });
  }, 60000);

  afterAll(async () => {
    await henri.stop();
    delete global.henri;
    process.env.SKIP_WORKERS = skipWorkers;
  });

  test('answers a chunked file with no length and a filename', async () => {
    const answer = await owner.get('/memos/report').expect(200);

    expect(answer.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(answer.headers['content-disposition']).toBe(
      'attachment; filename="memos.csv"'
    );
    expect(answer.headers['content-length']).toBeUndefined();
    expect(answer.headers['transfer-encoding']).toBe('chunked');
    expect(answer.headers['cache-control']).toContain('no-store');
  });

  test('the header is the model, not the rows', async () => {
    const answer = await owner.get('/memos/report').expect(200);
    const [header] = answer.text.split('\r\n');

    expect(header.split(',')).toEqual([
      'archivedAt',
      'body',
      'ownerId',
      'title',
      'externalId',
      'createdAt',
      'updatedAt',
    ]);
  });

  test('the rows are what the policy says the list is', async () => {
    const answer = await owner.get('/memos/report').expect(200);
    const rows = answer.text.trim().split('\r\n').slice(1);

    // Three memos exist and one of them is somebody else's: `res.csv()`
    // asked the policy for the scope, the way `req.filters()` does
    expect(rows.length).toBe(2);
    expect(answer.text).not.toContain('not yours');
  });

  test('the exit gate ran: no primary key, and a published foreign key', async () => {
    const answer = await owner.get('/memos/report').expect(200);
    const record = await henri.user.findByEmail(ownerEmail);
    const rows = answer.text.trim().split('\r\n').slice(1);

    for (const row of rows) {
      // `ownerId` is the owner's externalId, never the document id it holds
      expect(row).toContain(record.externalId);
      expect(row).not.toContain(String(record._id));
    }

    expect(answer.text).not.toContain('_id');
  });

  test('a formula somebody typed is written as text', async () => {
    const answer = await owner.get('/memos/report').expect(200);

    expect(answer.text).toContain(`"'=SUM(A1)"`);
    // ... and a title holding the delimiter is quoted rather than split
    expect(answer.text).toContain('"Ship, it"');
  });

  test('a column that never leaves the server is not in the file', async () => {
    // The user export is the dangerous one: a user row is where every
    // `personal: { expose: false }` column of this application lives
    const answer = await admin.get('/admin/people.csv').expect(200);
    const [header] = answer.text.split('\r\n');

    for (const name of ['gender', 'phone', 'nationalId', 'password']) {
      expect(header.split(',')).not.toContain(name);
    }

    // ... and neither are their values, at any depth
    expect(answer.text).not.toContain('unspecified');
    expect(answer.text).not.toContain('henri:v1:');
    expect(answer.text).toContain(ownerEmail);
  });

  test('an export carries no primary key either', async () => {
    const answer = await admin.get('/admin/people.csv').expect(200);
    const record = await henri.user.findByEmail(ownerEmail);
    const [header] = answer.text.split('\r\n');

    expect(header.split(',')).toContain('externalId');
    expect(header.split(',')).not.toContain('id');
    expect(answer.text).toContain(record.externalId);
    expect(answer.text).not.toContain(String(record._id));
  });

  test("`include` is the way back, and it is the caller's word", () => {
    const User = henri.model.stores.default.getModels().User;

    expect(headerOf(henri, User)).not.toContain('gender');
    expect(headerOf(henri, User, { include: ['gender'] })).toContain('gender');
  });

  test('a column the file cannot carry is refused before a byte', () => {
    const User = henri.model.stores.default.getModels().User;

    expect(() => headerOf(henri, User, { columns: ['gender'] })).toThrow(
      'is not a column this export can carry'
    );
    expect(() => headerOf(henri, User, { columns: ['nope'] })).toThrow(
      'is not a column this export can carry'
    );
    expect(headerOf(henri, User, { columns: ['email'], include: [] })).toEqual([
      'email',
    ]);
  });

  test('an export past the bound is a 413 before any byte', async () => {
    const answer = await withSettings({ maxRows: 1 }, () =>
      owner.get('/memos/report').set('Accept', 'application/json').expect(413)
    );

    expect(answer.body.code).toBe('HENRI_CSV_TOO_MANY');
    expect(answer.body.message).toContain('at most 1');
    expect(answer.headers['content-type']).toContain('json');
    // The refusal is an answer rather than a file that stops in the middle
    expect(answer.headers['content-disposition']).toBeUndefined();
  });

  test('a cursor walks the whole table however small a page is', async () => {
    const answer = await withSettings({ batch: 1 }, () =>
      owner.get('/memos/report').expect(200)
    );

    expect(answer.text.trim().split('\r\n').length).toBe(3);
  });

  test('a failure before a byte is out is an ordinary 500', async () => {
    // The headers go out with the first chunk rather than the first row, so
    // an export smaller than a chunk still has a status when it fails
    const strip = henri.privacy.strip.bind(henri.privacy);

    henri.privacy.strip = () => {
      throw new Error('the gate fell over');
    };

    try {
      const answer = await owner
        .get('/memos/report')
        .set('Accept', 'application/json')
        .expect(500);

      expect(answer.headers['content-disposition']).toBeUndefined();
      expect(answer.body.statusCode).toBe(500);
    } finally {
      henri.privacy.strip = strip;
    }
  });

  test('the formula guard can be turned off for a machine', async () => {
    const answer = await withSettings({ formulas: false }, () =>
      owner.get('/memos/report').expect(200)
    );

    expect(answer.text).toContain('=SUM(A1)');
    expect(answer.text).not.toContain(`"'=SUM(A1)"`);
  });
});
