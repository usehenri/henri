/**
 * Source of the tests written by `henri generate test`.
 *
 * `plain` requests one path and expects a 200. `resource` is used when
 * config/routes.js has a `resources`/`crud` entry for the name: the routes
 * answer HAL (res.resource / res.collection), so the test checks the links,
 * and with the Inertia renderer it also checks the page object a browser
 * gets. The output goes through prettier.
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

const hal = ({ lower, path }) => `
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
  });`;

const resource = ({ lower, path }) => `
// Runs with \`henri test\`: setup() boots henri under NODE_ENV=test and
// request() is a supertest agent bound to the running server.
// The ${lower} routes come from config/routes.js (resources/crud) and answer
// HAL to JSON clients: every answer links to itself (_links.self) and to
// what the client may do next (see res.resource and res.collection).
const { request, setup } = require('@usehenri/testing');

describe('${lower}', () => {
  beforeAll(() => setup());
${hal({ lower, path })}
});
`;

const inertiaResource = ({ lower, path }) => `
// Runs with \`henri test\`: setup() boots henri under NODE_ENV=test and
// request() is a supertest agent bound to the running server.
//
// The ${lower} routes come from config/routes.js (resources/crud) and answer
// two things. A JSON client gets HAL: every answer links to itself
// (_links.self) and to what the client may do next (res.resource,
// res.collection). The Inertia client, which sends \`X-Inertia: true\`, gets the
// page object the browser renders: \`{ component, props: { data, errors, csrf,
// user, paths }, url, version }\`. That client is loaded with an asset version
// and sends it back on every visit, so a GET whose \`X-Inertia-Version\` does
// not match answers \`409\` and reloads: it is read once below.
const { request, setup } = require('@usehenri/testing');

let version = '';

/**
 * The Inertia page object of a path
 *
 * @param {string} target The path to request
 * @returns {object} The supertest request
 */
const page = (target) =>
  request()
    .get(target)
    .set('X-Inertia', 'true')
    .set('X-Inertia-Version', version);

describe('${lower}', () => {
  beforeAll(async () => {
    await setup();

    const probe = await request().get('${path}').set('X-Inertia', 'true');

    version = probe.headers['x-inertia-version'] || '';
  });

  test('GET ${path} renders the page with what the controller sent', async () => {
    const response = await page('${path}');

    expect(response.status).toBe(200);
    // app/views/pages/${lower}/index.jsx, rendered with res.render('${path}')
    expect(response.body.component).toBe('${lower}');
    expect(response.body.props.data.${lower}).toEqual(expect.any(Array));
    expect(response.body.props.errors).toEqual({});
  });
${hal({ lower, path })}
});
`;

module.exports = { inertiaResource, plain, resource };
