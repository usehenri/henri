// Shared setup for the suite.
//
// Every test file boots the application once (`@usehenri/testing/setup-file`)
// against the PostgreSQL of config/test.json, so the tables are shared: each
// file empties them and creates the records it needs.
const { agent, request } = require('@usehenri/testing');

/** The password every account created here uses */
const PASSWORD = 'showcase';

/**
 * The asset version of the Inertia client. A GET carrying `X-Inertia` and
 * another version answers 409 so the browser reloads, which is why every
 * file reads it once before asking for page objects.
 */
let version = '';

/**
 * Reads the asset version from the server (call it once per file)
 *
 * @returns {Promise<string>} The version
 */
const inertiaVersion = async () => {
  const probe = await request().get('/').set('X-Inertia', 'true');

  version = probe.headers['x-inertia-version'] || '';

  return version;
};

/**
 * The Inertia page object of a path: `{ component, props, url, version }`,
 * what the client consumes instead of the html document a browser gets
 *
 * @param {object} client A supertest agent or request
 * @param {string} path The path to ask for
 * @returns {object} The supertest request
 */
const page = (client, path) =>
  client.get(path).set('X-Inertia', 'true').set('X-Inertia-Version', version);

/**
 * Empties every table, children first (the foreign keys are ON DELETE
 * CASCADE, but the order makes the intent obvious)
 *
 * @returns {Promise<void>} Resolves when the database is empty
 */
const reset = async () => {
  await Review.destroy();
  // Proposal is paranoid: withDeleted() reaches the withdrawn rows too, and
  // `force` really deletes instead of stamping deletedAt again
  await Proposal.withDeleted().destroy({ force: true });
  await Track.destroy();
  await Event.destroy();
  await User.destroy();
};

/**
 * A signed-in supertest agent, and the CSRF token to send with it
 *
 * The agent keeps the cookies between requests. henri's CSRF middleware only
 * checks requests that carry a session cookie, and the token travels in the
 * `henri.csrf` cookie, which is what `token()` reads back.
 *
 * @param {object} user A User instance
 * @returns {Promise<object>} `{ browser, csrf }`
 */
const signIn = async (user) => {
  const browser = agent();
  const first = await browser.get('/login').set('Accept', 'text/html');
  const csrf = token(first);
  const answer = await browser
    .post('/login')
    .set('Accept', 'text/html')
    .type('form')
    .send({ _csrf: csrf, email: user.email, password: PASSWORD });

  if (answer.status !== 302) {
    throw new Error(`sign in failed with ${answer.status}`);
  }

  return { browser, csrf };
};

/**
 * The CSRF token of a response, from the `henri.csrf` cookie it set
 *
 * @param {object} response A supertest response
 * @returns {?string} The token, or null when the response set none
 */
const token = (response) => {
  const cookies = response.headers['set-cookie'] || [];
  const found = cookies.find((cookie) => cookie.startsWith('henri.csrf='));

  return found ? decodeURIComponent(found.split('=')[1].split(';')[0]) : null;
};

/**
 * Creates a user
 *
 * @param {object} [attributes={}] Overrides
 * @returns {Promise<object>} The user
 */
const createUser = async (attributes = {}) => {
  const user = await User.create({
    email: `speaker-${Math.random().toString(36).slice(2, 10)}@example.test`,
    name: 'A Speaker',
    password: PASSWORD,
    ...attributes,
  });

  if (attributes.roles) {
    await User.setRoles(user.id, attributes.roles);

    return User.findById(user.id);
  }

  return user;
};

/**
 * Creates an edition with one track
 *
 * @param {object} [attributes={}] Overrides of the edition
 * @returns {Promise<object>} `{ event, track }`
 */
const createEvent = async (attributes = {}) => {
  const event = await Event.create({
    city: 'Testville',
    name: 'Test Conf',
    slug: `test-${Math.random().toString(36).slice(2, 8)}`,
    state: 'open',
    year: 2026,
    ...attributes,
  });
  const track = await Track.create({
    eventId: event.id,
    name: 'Backend',
    slug: 'backend',
  });

  return { event, track };
};

/**
 * Creates a proposal
 *
 * @param {object} attributes The attributes (speakerId and eventId required)
 * @returns {Promise<object>} The proposal
 */
const createProposal = (attributes) =>
  Proposal.create({
    abstract:
      'An abstract that is comfortably longer than the sixty characters the model asks for.',
    title: 'A proposal with a long enough title',
    ...attributes,
  });

module.exports = {
  PASSWORD,
  agent,
  createEvent,
  createProposal,
  createUser,
  inertiaVersion,
  page,
  request,
  reset,
  signIn,
  token,
};
