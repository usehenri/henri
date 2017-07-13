const request = require('supertest');
require('../../config/index.js');
const server = require('../index.js');

describe('server', () => {
  let serv;
  beforeAll(done => {
    henri.router = henri.express.Router();
    henri.router.get('/sirop', (req, res) => res.send('ok'));
    serv = henri.start(null, done);
  });
  afterAll(done => serv.close(done));
  test('loads', async () => {
    expect(henri.getStatus('http')).toBeTruthy();

    await request(henri._url).get('/sirop').expect(404);
  });
  test('handleErrors', () => {
    henri.log.error = jest.fn();
    henri.log.fatalError = jest.fn();
    server.handleError('simple error');
    expect(henri.log.fatalError).toHaveBeenCalledTimes(0);
    expect(henri.log.error).toHaveBeenCalledTimes(1);
    server.handleError({ code: 'EADDRINUSE', msg: 'oops' });
    expect(henri.log.fatalError).toHaveBeenCalledTimes(1);
    expect(henri.log.error).toHaveBeenCalledTimes(2);
  });
});
