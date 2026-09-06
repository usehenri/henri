const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const Disk = require('../index.js');
const { CEILING, FLOOR, startingPort } = require('../port.js');

/**
 * Builds a minimal henri stand-in for the adapter
 *
 * @param {object} [flags={}] isTest, isProduction and cwd overrides
 * @returns {object} fake henri
 */
const fakeHenri = (flags = {}) => {
  const { cwd, ...rest } = flags;
  const calls = [];
  const pen = {};

  ['error', 'fatal', 'info', 'warn'].forEach((level) => {
    pen[level] = (...args) => calls.push([level, ...args]);
  });

  return {
    _user: null,
    calls,
    config: {
      get: () => undefined,
      has: () => false,
    },
    cwd: () => cwd || process.cwd(),
    isProduction: false,
    isTest: true,
    pen,
    user: {
      encrypt: async (password) => `hashed:${password}`,
    },
    ...rest,
  };
};

const artworkModel = {
  globalId: 'Artwork',
  identity: 'artwork',
  options: { timestamps: true },
  schema: { title: { type: 'string' }, year: { type: 'integer' } },
};

describe('disk database adapter', () => {
  describe('in memory (test mode)', () => {
    let store;
    let henri;
    let Artwork;

    beforeAll(async () => {
      henri = fakeHenri();
      store = new Disk('default', { adapter: 'disk' }, henri);
      Artwork = store.addModel(artworkModel, 'user');
      await store.start();
    }, 120000);

    afterAll(async () => {
      await store.stop();
    }, 60000);

    test('exposes the adapter name and a mongo uri', () => {
      expect(store.adapterName).toBe('disk');
      expect(store.mongoUri).toMatch(/^mongodb:\/\/.*\/henri/);
      expect(store.config.url).toBe(store.mongoUri);
      expect(store.mongoose.connection.name).toBe('henri');
      expect(henri.calls).toEqual([]);
    });

    test('registers models', () => {
      expect(store.getModels().Artwork).toBeDefined();
      expect(store.models.Artwork).toBe(Artwork);
    });

    test('creates and finds documents', async () => {
      await Artwork.create({ title: 'Le bonheur de vivre', year: 1905 });
      await Artwork.create({ title: 'Music', year: 1910 });

      const found = await Artwork.find({}).sort({ year: 1 }).lean();

      expect(found).toHaveLength(2);
      expect(found[0].title).toBe('Le bonheur de vivre');
      expect(found[1].year).toBe(1910);
      expect(found[0].createdAt).toBeInstanceOf(Date);
    });

    test('overloads the user model with email, password and roles', async () => {
      const User = store.addModel(
        {
          globalId: 'User',
          identity: 'user',
          schema: { name: { type: String } },
        },
        'user'
      );

      expect(henri._user).toBe(User);

      const user = await User.create({
        email: 'Testing@usehenri.io',
        name: 'Henri',
        password: 'delectorskaya',
      });

      expect(user.email).toBe('testing@usehenri.io');
      expect(user.password).toBe('hashed:delectorskaya');
      expect(user.roles.toObject()).toEqual([]);
      await expect(user.hasRole([])).resolves.toBe(true);
      await expect(user.hasRole('admin')).resolves.toBe(false);
      expect(
        (await store.findUserByEmail('testing@usehenri.io')).password
      ).toBe('hashed:delectorskaya');
      expect((await User.findById(user._id)).password).toBeUndefined();
    });

    test('pings the local server', async () => {
      await expect(store.ping()).resolves.toBe(true);
    });
  });

  describe('data path', () => {
    test('defaults to .henri/data in the app directory', () => {
      const store = new Disk(
        'default',
        { adapter: 'disk' },
        fakeHenri({ cwd: '/srv/app' })
      );

      expect(store.dataPath()).toBe(path.join('/srv/app', '.henri', 'data'));
    });

    test('honors a relative or absolute path', () => {
      const relative = new Disk(
        'default',
        { path: 'var/db' },
        fakeHenri({ cwd: '/srv/app' })
      );
      const absolute = new Disk(
        'default',
        { path: '/var/lib/henri' },
        fakeHenri({ cwd: '/srv/app' })
      );

      expect(relative.dataPath()).toBe(path.join('/srv/app', 'var', 'db'));
      expect(absolute.dataPath()).toBe('/var/lib/henri');
    });
  });

  describe('port', () => {
    test('each store of a process starts from a port of its own', () => {
      const ports = Array.from({ length: 8 }, () => startingPort());

      expect(new Set(ports).size).toBe(ports.length);
      for (const port of ports) {
        expect(port).toBeGreaterThanOrEqual(FLOOR);
        expect(port).toBeLessThan(CEILING);
      }
      // Below the ephemeral range of linux (32768) and macos (49152), so the
      // kernel never hands one of these to something else meanwhile
      expect(CEILING).toBeLessThanOrEqual(27017);
    });

    test('listens on the configured port', async () => {
      const henri = fakeHenri();
      const port = startingPort();
      const store = new Disk('default', { adapter: 'disk', port }, henri);

      await store.start();

      try {
        expect(store.mongoUri).toContain(`:${port}/`);
        await expect(store.ping()).resolves.toBe(true);
      } finally {
        await store.stop();
      }
    }, 120000);

    test('a configured port that is taken fails the boot, naming it', async () => {
      const port = startingPort();
      const squatter = net.createServer();

      await new Promise((resolve) =>
        squatter.listen(port, '127.0.0.1', resolve)
      );

      // The library prints the failure itself before throwing
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = new Disk('default', { port }, fakeHenri());

      try {
        // Never moved somewhere the application did not ask for
        await expect(store.start()).rejects.toThrow(`Port "${port}" already`);
        expect(store.mongoUri).toBe('');
      } finally {
        warn.mockRestore();
        await new Promise((resolve) => squatter.close(resolve));
      }
    }, 120000);
  });

  describe('persistence', () => {
    let dataPath;

    beforeAll(() => {
      dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-disk-'));
    });

    afterAll(() => {
      fs.rmSync(dataPath, { force: true, recursive: true });
    });

    test('keeps the data across stop() and start(), warns in production', async () => {
      const henri = fakeHenri({ isProduction: true, isTest: false });
      const store = new Disk(
        'default',
        { dbName: 'gallery', path: dataPath },
        henri
      );

      store.addModel(artworkModel, 'user');
      await store.start();

      expect(store.mongoose.connection.name).toBe('gallery');
      expect(fs.existsSync(path.join(dataPath, 'WiredTiger'))).toBe(true);
      expect(henri.calls).toEqual([
        [
          'warn',
          'disk',
          `persisting data in ${dataPath}; the disk adapter is not meant for production`,
        ],
      ]);

      await store.getModels().Artwork.create({ title: 'Jazz', year: 1947 });
      await store.stop();

      expect(store.mongod).toBeNull();

      await store.start();

      const { Artwork } = store.getModels();
      const found = await Artwork.find({}).lean();

      expect(found).toHaveLength(1);
      expect(found[0].title).toBe('Jazz');

      await store.stop();
    }, 180000);
  });
});
