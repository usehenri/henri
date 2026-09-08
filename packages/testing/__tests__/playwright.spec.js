// The half of the browser fixture this repository can prove: henri boots on
// a port the kernel assigns, and the url another process needs is written
// where Playwright reads it, before the global setup returns.
//
// The other half -- that `PLAYWRIGHT_TEST_BASE_URL` really is what
// `use.baseURL` falls back to, and that anything in `use` wins over it -- is
// Playwright's, measured against 1.63.0 and written down in
// `../playwright.mjs` and `guides/testing.md`. It is not re-measured here on
// purpose: Playwright is the application's dependency, and adding a browser
// to this repository's CI to assert a fixture default is a cost the
// deliverable does not carry.
const path = require('node:path');

const { teardown } = require('../index.js');

/** The demo application of this repository */
const APP = path.resolve(__dirname, '..', '..', 'demo');

describe('the playwright global setup (demo app, disk store)', () => {
  const previous = process.cwd();
  const before = {
    base: process.env.PLAYWRIGHT_TEST_BASE_URL,
    henri: process.env.HENRI_TEST_URL,
  };

  let playwright;

  beforeAll(async () => {
    process.chdir(APP);
    playwright = await import('../playwright.mjs');
  }, 60000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await teardown();
    process.chdir(previous);

    for (const [key, value] of [
      ['HENRI_TEST_URL', before.henri],
      ['PLAYWRIGHT_TEST_BASE_URL', before.base],
    ]) {
      if (typeof value === 'undefined') {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test('boot() publishes the address the listener was given', async () => {
    const { henri, url } = await playwright.boot();

    const address = henri.server.httpServer.address();

    expect(url).toBe(`http://127.0.0.1:${address.port}`);
    // Not the `localhost` line the terminal prints: the server binds
    // 127.0.0.1 and nothing else under NODE_ENV=test
    expect(henri.server.url).toBe(`http://localhost:${address.port}/`);
    expect(url).not.toContain('localhost');
    expect(address.port).toBeGreaterThan(0);
  }, 60000);

  test('the two variables another process reads are set', async () => {
    const { url } = await playwright.boot();

    expect(process.env.PLAYWRIGHT_TEST_BASE_URL).toBe(url);
    expect(process.env.HENRI_TEST_URL).toBe(url);
  });

  test('and the application answers there', async () => {
    const { url } = await playwright.boot();

    // Over the wire, from the address that was published: this is the leap
    // a browser makes, without the browser
    const response = await fetch(`${url}/livez`);

    expect(response.status).toBe(200);
  });

  test('a project pinning another baseURL is named, not obeyed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { url } = await playwright.boot({
      projects: [
        { name: 'chromium', use: {} },
        { name: 'staging', use: { baseURL: 'https://staging.example/' } },
      ],
    });

    expect(warn).toHaveBeenCalledTimes(1);

    const [message] = warn.mock.calls[0];

    expect(message).toContain('"staging" sets use.baseURL');
    expect(message).toContain('https://staging.example/');
    expect(message).toContain(url);
    // The variable is still ours: the warning says what will win, it does
    // not give up on setting it
    expect(process.env.PLAYWRIGHT_TEST_BASE_URL).toBe(url);
  });

  test('a top-level use.baseURL is the project with no name', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await playwright.boot({
      projects: [{ name: '', use: { baseURL: 'http://elsewhere.test:7' } }],
    });

    expect(warn.mock.calls[0][0]).toContain('the configuration sets');
  });

  test('one mistake is one line, however many projects inherit it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // What three browsers under one top-level `use` look like by the time a
    // global setup is handed the configuration
    await playwright.boot({
      projects: ['chromium', 'firefox', 'webkit'].map((name) => ({
        name,
        use: { baseURL: 'http://elsewhere.test:7' },
      })),
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(
      '"chromium", "firefox", "webkit" set use.baseURL'
    );
  });

  test('a baseURL that is the application is not a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { url } = await playwright.boot();

    await playwright.boot({
      projects: [
        { name: 'exact', use: { baseURL: url } },
        // A trailing slash is the same address
        { name: 'slashed', use: { baseURL: `${url}/` } },
        { name: 'silent', use: {} },
        { name: 'none' },
      ],
    });

    expect(warn).not.toHaveBeenCalled();
  });

  test('no configuration at all is fine', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(playwright.boot()).resolves.toHaveProperty('url');

    expect(warn).not.toHaveBeenCalled();
  });

  // Last: it stops the application every test above booted
  test('the global setup answers the teardown, and it stops henri', async () => {
    const stop = await playwright.default();

    expect(typeof stop).toBe('function');
    expect(await stop()).toBe(true);
    // Nothing left to stop
    expect(await stop()).toBe(false);
  }, 60000);
});
