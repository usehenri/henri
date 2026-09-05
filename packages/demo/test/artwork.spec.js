const { henri, request, setup } = require('@usehenri/testing');

describe('demo app', () => {
  // A no-op: the setup file already booted henri
  beforeAll(() => setup());

  test('boots henri with the models as globals', () => {
    expect(henri).toBe(global.henri);
    expect(henri.env).toBe('test');
    expect(henri.server.httpServer.listening).toBe(true);
    expect(typeof Artwork.find).toBe('function');
    expect(typeof User.create).toBe('function');
  });

  test('serves the artwork page', async () => {
    const res = await request().get('/artwork');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  test('creates an artwork through the controller', async () => {
    const res = await request()
      .post('/artwork')
      .send({ title: 'Le bonheur de vivre', year: 1905 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ msg: 'success' });

    const stored = await Artwork.find({ title: 'Le bonheur de vivre' });

    expect(stored).toHaveLength(1);
    expect(stored[0].year).toBe(1905);
  });

  test('registers a user', async () => {
    const res = await request()
      .post('/register')
      .send({ email: 'testing@usehenri.io', password: 'delectorskaya' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(await User.countDocuments({ email: 'testing@usehenri.io' })).toBe(1);
  });
});
