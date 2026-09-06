const supertest = require('supertest');

const { DEFAULTS, covers, settings } = require('../src/config');
const { bytes, format } = require('../src/bytes');
const { PNG, application, fakeHenri } = require('./helpers');

const MB = 1024 * 1024;

describe('sizes', () => {
  test.each([
    ['10mb', 10 * MB],
    ['512kb', 512 * 1024],
    ['1gb', 1024 * MB],
    ['900', 900],
    ['1.5mb', Math.floor(1.5 * MB)],
    [' 2 MB ', 2 * MB],
    [4096, 4096],
  ])('%s is %d bytes', (given, expected) => {
    expect(bytes(given)).toBe(expected);
  });

  test('false is not a badly written number', () => {
    expect(bytes(false)).toBe(false);
    expect(bytes('nonsense', 42)).toBe(42);
    expect(bytes(-1, 42)).toBe(42);
    expect(bytes(null)).toBeNull();
  });

  test('and they print the way the documentation writes them', () => {
    expect(format(10 * MB)).toBe('10mb');
    expect(format(512 * 1024)).toBe('512kb');
    expect(format(900)).toBe('900b');
    expect(format(false)).toBe('no limit');
  });
});

describe('the settings', () => {
  test('are the documented defaults when the key is absent', () => {
    const found = settings(fakeHenri('/tmp').config);

    expect(found).toEqual({
      allow: null,
      enabled: true,
      maxFieldNameSize: 100,
      maxFieldSize: MB,
      maxFields: 100,
      maxFileSize: 10 * MB,
      maxFilenameLength: 255,
      maxFiles: 10,
      maxTotalSize: 25 * MB,
      paths: null,
      root: DEFAULTS.root,
      sniff: true,
      storage: 'local',
    });
  });

  test('maxFieldSize follows config.bodyLimit, which bounds the other encodings', () => {
    const wide = settings(fakeHenri('/tmp', { bodyLimit: '4mb' }).config);

    expect(wide.maxFieldSize).toBe(4 * MB);

    const narrowed = settings(
      fakeHenri('/tmp', { bodyLimit: '4mb', uploads: { maxFieldSize: 512 } })
        .config
    );

    expect(narrowed.maxFieldSize).toBe(512);
  });

  test('"uploads": false accepts no file at all', () => {
    expect(settings(fakeHenri('/tmp', { uploads: false }).config)).toEqual({
      enabled: false,
    });
  });

  test('a bound removed on purpose stays removed', () => {
    const found = settings(
      fakeHenri('/tmp', {
        uploads: { maxFiles: false, maxTotalSize: false },
      }).config
    );

    expect(found.maxTotalSize).toBe(false);
    expect(found.maxFiles).toBe(false);
  });

  test('nonsense falls back to the default rather than to no limit', () => {
    const found = settings(
      fakeHenri('/tmp', {
        uploads: {
          allow: [],
          maxFiles: 'lots',
          maxTotalSize: 'as much as you like',
          paths: ['relative', 42],
          storage: 7,
        },
      }).config
    );

    expect(found.maxTotalSize).toBe(25 * MB);
    expect(found.maxFiles).toBe(10);
    expect(found.allow).toBeNull();
    expect(found.paths).toBeNull();
    expect(found.storage).toBe('local');
  });
});

describe('which requests are read', () => {
  test('only the methods that carry a body, and only the configured paths', () => {
    expect(covers({ method: 'GET', path: '/x' }, null)).toBe(false);
    expect(covers({ method: 'DELETE', path: '/x' }, null)).toBe(false);
    expect(covers({ method: 'POST', path: '/x' }, null)).toBe(true);
    expect(covers({ method: 'PUT', path: '/x' }, null)).toBe(true);
    expect(covers({ method: 'PATCH', path: '/x' }, null)).toBe(true);
    expect(covers({ method: 'POST', path: '/a' }, ['/a'])).toBe(true);
    expect(covers({ method: 'POST', path: '/a/b' }, ['/a'])).toBe(true);
    expect(covers({ method: 'POST', path: '/ab' }, ['/a'])).toBe(false);
    expect(covers({ method: 'POST', path: '/b' }, ['/a'])).toBe(false);
  });
});

describe('turning uploads off', () => {
  test('leaves req.files there and empty, and reads no body', async () => {
    const { app, uploads } = await application(false, {
      handler: (req, res) =>
        res.json({ files: req.files, has: typeof req.permitFiles }),
    });

    expect(uploads.enabled).toBe(false);
    expect(uploads.storage).toBeNull();

    const answer = await supertest(app)
      .post('/upload')
      .attach('scan', PNG, { filename: 'a.png' });

    expect(answer.body).toEqual({ files: {}, has: 'function' });
  });

  test('and says what to do when something asks for a file anyway', async () => {
    const { uploads } = await application(false);

    expect(() => uploads.ready()).toThrow(/uploads are off/u);
  });
});
