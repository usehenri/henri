/* global User */

async function start(done) {
  await require('../../config/index.js');
  await require('../../server/index.js');
  await require('../../user/index.js');
  await require('../index.js');
  await User.destroy({});
  done();
}

describe('models', () => {
  beforeAll(done => start(done));
  test('should reload', async () => {
    expect(User).toBeDefined();
    User.hello = () => 'say hello';
    expect(typeof User.hello).toBe('function');
    await henri.reload();
    expect(User.hello).toBeUndefined();
  });
  test('stops', async () => {
    henri.stop();
    expect(global.User).toBeUndefined();
  });
});
