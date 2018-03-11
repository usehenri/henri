const init = require('../index');

let henri = null;

describe('henri', () => {
  beforeAll(async () => (henri = await init()));

  test('should be an object', () => {
    expect(henri).toBeDefined();
  });

  test('should have private properties', () => {
    expect(henri).toHaveProperty('_loaders');
    expect(henri).toHaveProperty('_unloaders');
    expect(henri).toHaveProperty('_models');
    expect(henri).toHaveProperty('_controllers');
    expect(henri).toHaveProperty('_middlewares');
    expect(henri).toHaveProperty('_paths');
    expect(henri).toHaveProperty('_routes');
    expect(henri).toHaveProperty('_user');
  });

  test('should have public properties', () => {
    expect(henri).toHaveProperty('settings');
    expect(henri).toHaveProperty('release');
    expect(henri).toHaveProperty('runlevel');
    expect(henri).toHaveProperty('prefix');
    expect(henri).toHaveProperty('status');

    expect(henri).toHaveProperty('env');
    expect(henri).toHaveProperty('isProduction');
    expect(henri).toHaveProperty('isDev');
    expect(henri).toHaveProperty('isTest');
    expect(henri).toHaveProperty('cwd');
  });

  test('should have settings', () => {
    expect(henri.settings).toHaveProperty('package');
    expect(henri.settings).toHaveProperty('arch');
    expect(henri.settings).toHaveProperty('platform');
  });

  test('should basic modules', () => {
    expect(henri).toHaveProperty('pen');
    expect(henri).toHaveProperty('modules');
    expect(henri).toHaveProperty('validator');
    expect(henri).toHaveProperty('utils');
  });

  test('should take default init prefix & runlevel', async () => {
    expect(henri.runlevel).toEqual(6);
    expect(henri.prefix).toEqual('.');
  });

  test('should have a working addMiddleware', () => {
    expect(henri._middlewares.length).toEqual(0);
    henri.addMiddleware(() => {});
    expect(henri._middlewares.length).toEqual(1);
  });

  test('should have get/set status', () => {
    henri.setStatus('test_ab', 'good');
    expect(henri.getStatus('test_ab')).toEqual('good');

    henri.setStatus('will_null');
    expect(henri.getStatus('will_null')).toBeUndefined();
  });

  test('should reload modules', async () => {
    const reloader = jest.fn();
    const errorReloader = () => {
      throw new Error('abc');
    };

    expect(henri.reload()).toBeTruthy();

    henri._loaders.push(reloader);
    expect(await henri.reload()).toBeTruthy();
    expect(reloader).toHaveBeenCalledTimes(1);

    henri._loaders.push(errorReloader);
    expect(await henri.reload()).toBeFalsy();
    expect(reloader).toHaveBeenCalledTimes(2);
  });

  test('should stop modules', async () => {
    const stopper = jest.fn();
    const errorStopper = () => {
      throw new Error('abc');
    };

    henri._unloaders.push(stopper);
    expect(await henri.stop()).toBeTruthy();
    expect(stopper).toHaveBeenCalledTimes(1);

    henri._unloaders.push(errorStopper);
    expect(await henri.stop()).toBeFalsy();
    expect(stopper).toHaveBeenCalledTimes(2);
  });

  test('should have gql? needs to move!', () => {
    expect(henri.gql('some stuff')).toEqual('some stuff');
  });
});
