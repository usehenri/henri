const fs = require('node:fs');
const path = require('node:path');

const LocalStorage = require('../src/storage/local');
const { createStorage } = require('../src/storage');
const { keyFor } = require('../src/names');
const { fakeHenri, workspace } = require('./helpers');

/**
 * A started local storage in a throwaway directory
 *
 * @returns {Promise<{cwd: string, storage: LocalStorage}>} the storage
 */
const started = async () => {
  const cwd = workspace();
  const storage = new LocalStorage(
    'local',
    { root: 'storage/uploads' },
    fakeHenri(cwd)
  );

  await storage.start();

  return { cwd, storage };
};

describe('the local disk', () => {
  test('creates its root private, and keeps it out of the repository', async () => {
    const { storage } = await started();
    const stats = fs.statSync(storage.root);

    expect(stats.mode & 0o777).toBe(0o700);
    expect(
      fs.readFileSync(path.join(storage.root, '.gitignore'), 'utf8')
    ).toContain('*');
  });

  test('a stored object is private and readable back', async () => {
    const { storage } = await started();
    const temp = await storage.temp();

    fs.writeFileSync(temp.path, 'hello');

    const key = await storage.put(temp.path, keyFor({ extension: 'txt' }));
    const full = path.join(storage.root, key);

    expect(fs.statSync(full).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(temp.path)).toBe(false);
    expect(await storage.stat(key)).toMatchObject({ size: 5 });

    const stream = await storage.get(key);
    const chunks = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(Buffer.concat(chunks).toString()).toBe('hello');
    expect(await storage.delete(key)).toBe(true);
    expect(await storage.delete(key)).toBe(false);
    expect(await storage.stat(key)).toBeNull();
  });

  test.each([
    '../../etc/passwd',
    '/etc/passwd',
    '2026/09/../../../../etc/passwd',
    'passwd',
    '2026/09/aaa.png',
    '',
  ])('refuses to write %s', async (key) => {
    const { storage } = await started();
    const temp = await storage.temp();

    fs.writeFileSync(temp.path, 'x');

    await expect(storage.put(temp.path, key)).rejects.toThrow(
      /unsafe|escapes/u
    );
    expect(fs.existsSync(path.resolve(storage.root, '..', 'passwd'))).toBe(
      false
    );
  });

  test('a key that escapes the root cannot be read either', async () => {
    const { storage } = await started();

    await expect(storage.get('../../etc/passwd')).rejects.toThrow(/unsafe/u);
    expect(await storage.stat('../../etc/passwd')).toBeNull();
    expect(await storage.delete('../../etc/passwd')).toBe(false);
  });

  test('has no public url: a file is reached through a controller', async () => {
    const { storage } = await started();

    expect(storage.url('2026/09/x.png')).toBeNull();
  });
});

describe('the storage seam', () => {
  test('local is what the configuration names by default', () => {
    const cwd = workspace();
    const storage = createStorage(fakeHenri(cwd), {
      root: 'storage/uploads',
      storage: 'local',
    });

    expect(storage).toBeInstanceOf(LocalStorage);
    expect(storage.root).toBe(path.join(cwd, 'storage/uploads'));
  });

  test('anything else is a module of the application', () => {
    const cwd = workspace();

    fs.writeFileSync(
      path.join(cwd, 'store.js'),
      `class Fake {
         async start() {}
         async stop() {}
         async temp() { return { path: '/tmp/x' }; }
         async put(source, key) { return key; }
         async get() { return null; }
         async stat() { return null; }
         async delete() { return true; }
         url() { return 'https://cdn.example.com'; }
       }
       module.exports = Fake;`
    );

    const storage = createStorage(fakeHenri(cwd), {
      root: 'storage/uploads',
      storage: './store.js',
    });

    expect(storage.url()).toBe('https://cdn.example.com');
  });

  test('a module that is not a storage says so', () => {
    const cwd = workspace();

    fs.writeFileSync(
      path.join(cwd, 'nope.js'),
      'module.exports = { hello: 1 };'
    );

    expect(() =>
      createStorage(fakeHenri(cwd), { root: 'x', storage: './nope.js' })
    ).toThrow(/does not implement HenriStorage/u);

    expect(() =>
      createStorage(fakeHenri(cwd), { root: 'x', storage: './missing.js' })
    ).toThrow(/unable to load the storage/u);
  });
});
