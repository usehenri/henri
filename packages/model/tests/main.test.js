/* global User, Dog */

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
  test('initialize', () => {
    expect(henri._models).toBeDefined();
    expect(User).toBeDefined();
    expect(Dog).toBeDefined();
  });
  test('have properties', () => {
    expect(User.find).toBeDefined();
    expect(User.hello).toBeUndefined();
  });
  test('user overload', () => {
    expect(User._callbacks).toBeDefined();
    expect(typeof User._callbacks.beforeUpdate).toBe('function');
    expect(typeof User._callbacks.beforeCreate).toBe('function');
  });
  test('create', async () => {
    await expect(User.create({ name: 'henri', age: 84 })).rejects.toBeDefined();
    await expect(
      User.create({ name: 'henri', age: 84, email: 'hello@usehenri.io' })
    ).rejects.toBeDefined();
    await expect(
      User.create({
        name: 'henri',
        age: 84,
        email: 'hello@usehenri.io',
        password: 'delectorskaya',
      }).meta({ fetch: true })
    ).resolves.toBeDefined();
    const users = await User.find();
    expect(users[0].password).toBeDefined();
    expect(users[0].password).not.toBe('delectorskaya');
  });
  test('update', async () => {
    const user1 = await User.find({})
      .limit(1)
      .meta({ fetch: true });
    const userUpdate = Object.assign({}, user1[0]);
    userUpdate.password = 'someOtherPass';
    const user2 = await User.update({ id: userUpdate.id })
      .set(userUpdate)
      .meta({ fetch: true });
    expect(user1[0].password).not.toBe(user2[0].password);
    expect(user2[0].password).not.toBe('someOtherPass');
    await expect(
      henri.user.compare('someOtherPass', user2[0].password)
    ).resolves.toBeDefined();
  });
});
