/**
 * Source of the tests written by `henri generate test`.
 *
 * `plain` requests one path and expects a 200. `resource` is used when
 * config/routes.js has a `resources`/`crud` entry for the name: the routes
 * answer HAL (res.resource / res.collection), so the test checks the links.
 * The output goes through prettier.
 */

const plain = ({ lower }) => `
// Runs with \`henri test\`: setup() boots henri under NODE_ENV=test and
// request() is a supertest agent bound to the running server.
const { request, setup } = require('@usehenri/testing');

describe('${lower}', () => {
  beforeAll(() => setup());

  test('GET /${lower} answers', async () => {
    const response = await request()
      .get('/${lower}')
      .set('Accept', 'application/json');

    expect(response.status).toBe(200);
  });
});
`;

const resource = ({ lower, path }) => `
// Runs with \`henri test\`: setup() boots henri under NODE_ENV=test and
// request() is a supertest agent bound to the running server.
// The ${lower} routes come from config/routes.js (resources/crud) and answer
// HAL to JSON clients: every answer links to itself (_links.self) and to
// what the client may do next (see res.resource and res.collection).
const { request, setup } = require('@usehenri/testing');

describe('${lower}', () => {
  beforeAll(() => setup());

  test('GET ${path} answers a HAL collection', async () => {
    const response = await request()
      .get('${path}')
      .set('Accept', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body._links.self.href).toBe('${path}');
    expect(response.body._embedded.${lower}).toEqual(expect.any(Array));
    expect(response.body.total).toEqual(expect.any(Number));
  });

  test('GET ${path}/:id answers 404 for an unknown id', async () => {
    const response = await request()
      .get('${path}/unknown')
      .set('Accept', 'application/json');

    expect(response.status).toBe(404);
    expect(response.body.statusCode).toBe(404);
  });
});
`;

module.exports = { plain, resource };
