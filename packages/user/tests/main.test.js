const request = require('supertest');
require('../../config/index.js');
delete henri.app;
henri._user = {};
require('../../server/index.js');
require('../index.js');

describe('user', () => {
  let requestWatch = null;
  const { user: { encrypt, compare } } = henri;
  const password = 'delectorskaya';
  beforeAll(done => {
    henri.router = henri.express.Router();
    henri.app.use((req, res, next) => {
      requestWatch = req;
      next();
    });
    henri.start(null, done);
  });
  test('initializes utilities', () => {
    expect(henri.user).toBeDefined();
    expect(henri.user.encrypt).toBeDefined();
    expect(henri.user.compare).toBeDefined();
  });
  test('middlewares are present', async () => {
    await request(henri._url)
      .get('')
      .expect(404);
    expect(henri._middlewares).toBeDefined();
    expect(henri._middlewares.length).toBe(2);
    expect(requestWatch._passport).toBeDefined();
    expect(requestWatch._passport.instance).toBeDefined();
  });
  test('encryption', async () => {
    let hash = await encrypt(password);
    expect(hash).not.toBe(password);
    await expect(encrypt()).rejects.toBeDefined();
    await expect(encrypt('lydia')).rejects.toBeDefined();
    await expect(encrypt(password)).resolves.toBeDefined();
  });
  test('compare', async () => {
    let hash = await encrypt(password);
    expect(hash).not.toBe(password);
    await expect(compare(password, hash)).resolves.toBe(true);
    await expect(compare('lydia', hash)).rejects.toBeDefined();
  });
  test('encryption warning', async () => {
    delete henri.passwordHashWarning;
    henri.log.warn = jest.fn();
    expect(henri.passwordHashWarning).toBeUndefined();
    await expect(encrypt(password, 15001)).resolves.toBeDefined();
    expect(henri.log.warn).toHaveBeenCalledTimes(1);
    expect(henri.passwordHashWarning).toBeDefined();
    await expect(encrypt(password, 15001)).resolves.toBeDefined();
    expect(henri.log.warn).toHaveBeenCalledTimes(1);
  });
});
