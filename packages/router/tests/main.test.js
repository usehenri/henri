async function start(done) {
  await require('../../config/index.js');
  await require('../../server/index.js');
  await require('../../controller/index.js');
  await require('../index.js');

  done();
}

describe('router', () => {
  beforeAll(done => start(done));
  test('initializes', () => {
    expect(henri.router).toBeDefined();
    expect(henri._routes).toBeDefined();
  });
  test('fs routes', () => {
    const routes = henri._routes;
    expect(routes['get /fs']).toBe('main#fs (unknown controller)');
    expect(routes['get /unfs']).toBe('main#fs (unknown controller)');
  });
  test('config routes', () => {
    const routes = henri._routes;
    expect(routes['get /abc']).toBe('a#bc (ok)');
    expect(routes['get /def']).toBe('main#def (unknown controller)');
  });
  test('normalize verbs', () => {
    const routes = henri._routes;
    expect(routes['post /ghi']).toBeDefined();
    expect(routes['PosT /ghi']).toBeUndefined();
  });
  test('create data routes', () => {
    const routes = henri._routes;
    expect(routes['get /abc']).toBe('a#bc (ok)');
    expect(routes['get /_data/abc']).toBe('a#bc (ok)');
  });
  test('should reload', async () => {
    henri.log.warn = jest.fn();
    await henri.reload();
    expect(henri.log.warn).toHaveBeenCalled();
  });
});
