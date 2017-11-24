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
    console.dir(henri);
    expect(routes['get /fs'].active).toBeFalsy();
    expect(routes['get /unfs'].active).toBeFalsy();
  });
  test('config routes', () => {
    const routes = henri._routes;
    expect(routes['get /abc'].active).toBeTruthy();
    expect(routes['get /def'].active).toBeFalsy();
  });
  test('normalize verbs', () => {
    const routes = henri._routes;
    expect(routes['post /ghi']).toBeDefined();
    expect(routes['PosT /ghi']).toBeUndefined();
  });
  test('create data routes', () => {
    const routes = henri._routes;
    expect(routes['get /abc'].active).toBeTruthy();
    expect(routes['get /_data/abc'].active).toBeTruthy();
  });
  test('should reload', async () => {
    henri.log.warn = jest.fn();
    await henri.reload();
    expect(henri.log.warn).toHaveBeenCalled();
  });
});
