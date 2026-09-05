const Disk = require('../index.js');

const pen = {
  error: vi.fn(),
  fatal: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

const henri = {
  _user: null,
  config: {
    get: () => undefined,
    has: () => false,
  },
  isTest: true,
  pen,
  user: {
    encrypt: async (password) => `hashed:${password}`,
  },
};

describe('disk database adapter', () => {
  let store;
  let Artwork;

  beforeAll(async () => {
    store = new Disk('default', { adapter: 'disk' }, henri);
    Artwork = store.addModel(
      {
        globalId: 'Artwork',
        identity: 'artwork',
        options: { timestamps: true },
        schema: { title: { type: String }, year: { type: Number } },
      },
      'user'
    );
    await store.start();
  }, 120000);

  afterAll(async () => {
    await store.stop();
  }, 60000);

  test('exposes the adapter name and a mongo uri', () => {
    expect(store.adapterName).toBe('disk');
    expect(store.mongoUri).toMatch(/^mongodb:\/\//);
    expect(store.config.url).toBe(store.mongoUri);
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
      email: 'testing@usehenri.io',
      name: 'Henri',
      password: 'delectorskaya',
    });

    expect(user.password).toBe('hashed:delectorskaya');
    expect(user.roles).toEqual([]);
    await expect(user.hasRole([])).resolves.toBe(true);
    await expect(user.hasRole('admin')).resolves.toBe(false);
  });
});
