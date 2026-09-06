// Runs with `henri test`: setup() boots henri under NODE_ENV=test and
// request() is a supertest agent bound to the running server.
//
// A request carrying `X-Inertia: true` gets the page object Inertia's client
// consumes, `{ component, props: { data, errors, csrf, user, paths }, url,
// version }`, instead of the HTML document a browser gets. The client is
// loaded with an asset version and sends it back on every visit: a GET whose
// `X-Inertia-Version` does not match answers `409` so the browser reloads,
// which is why the version is read once below.
const { request, setup } = require('@usehenri/testing');

let version = '';

/**
 * The Inertia page object of a path
 *
 * @param {string} path The path to request
 * @returns {object} The supertest request
 */
const page = (path) =>
  request()
    .get(path)
    .set('X-Inertia', 'true')
    .set('X-Inertia-Version', version);

describe('tasks', () => {
  beforeAll(async () => {
    await setup();

    const probe = await request().get('/tasks').set('X-Inertia', 'true');

    version = probe.headers['x-inertia-version'] || '';
  });

  test('GET /tasks renders the tasks page with its data', async () => {
    const response = await page('/tasks');

    expect(response.status).toBe(200);
    expect(response.body.component).toBe('tasks/index');
    expect(response.body.props.data.tasks).toEqual(expect.any(Array));
    expect(response.body.props.errors).toEqual({});
  });

  test('the page carries the public id of a task and not its internal one', async () => {
    await request()
      .post('/tasks')
      .set('X-Inertia', 'true')
      .send({ category: 'low', name: 'Has a public id' });

    const [task] = (await page('/tasks')).body.props.data.tasks;

    expect(task.externalId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(task.id).toBeUndefined();
    expect(task._id).toBeUndefined();
  });

  test('GET / answers a document to a browser', async () => {
    const response = await request().get('/');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
  });

  test('POST /tasks creates a task and redirects to the list', async () => {
    const before = (await page('/tasks')).body.props.data.tasks.length;
    const response = await request()
      .post('/tasks')
      .set('X-Inertia', 'true')
      .send({ category: 'high', name: 'Write a test' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/tasks');

    const tasks = (await page('/tasks')).body.props.data.tasks;

    expect(tasks).toHaveLength(before + 1);
    expect(tasks.map((task) => task.name)).toContain('Write a test');
  });

  test('POST /tasks without a name renders the page with an error', async () => {
    const response = await request()
      .post('/tasks')
      .set('X-Inertia', 'true')
      .send({ category: 'high' });

    expect(response.status).toBe(200);
    expect(response.body.component).toBe('tasks/index');
    expect(response.body.props.errors.name).toEqual(expect.any(String));
  });
});
