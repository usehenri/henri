const request = require('supertest');
require('../../config/index.js');
require('../index.js');

describe('server', () => {
  let serv;
  beforeAll(done => {
    serv = henri.start(null, done);
  });
  afterAll(done => serv.close(done));
  test('loads', async () => {
    expect(henri.getStatus('http')).toBeTruthy();
    await request(henri.app).get('/bb').expect(500);
  });
});
