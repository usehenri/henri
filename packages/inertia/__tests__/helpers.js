const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * A henri look-alike with what the engine reads (no jest/vitest mocks so the
 * tests run on both)
 *
 * @param {object} [overrides={}] properties to override
 * @returns {object} the fake
 */
function fakeHenri(overrides = {}) {
  const logs = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-inertia-'));

  // The application "has" the scoped peers installed (checked on disk)
  installPackage(dir, '@inertiajs/react', '3.7.0');
  installPackage(dir, '@vitejs/plugin-react', '6.1.1');

  const henri = {
    _middlewares: [],
    addMiddleware(name, func) {
      henri._middlewares.push({ func, name });
    },
    checked: [],
    config: {
      get: (key) => henri.settings[key],
      has: (key) => Object.prototype.hasOwnProperty.call(henri.settings, key),
    },
    cwd: () => henri.dir,
    dir,
    isDev: true,
    isProduction: false,
    isTest: true,
    logs,
    pen: {
      error: (...args) => logs.push(['error', ...args]),
      fatal: (...args) => logs.push(['fatal', ...args]),
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
    },
    server: {
      express: {
        static: (dir) => {
          const handler = (req, res, next) => next();

          handler.dir = dir;

          return handler;
        },
      },
      httpServer: null,
    },
    settings: { renderer: 'inertia' },
    utils: {
      checkPackages: async (packages) => {
        henri.checked = packages;

        return true;
      },
      resolvePackageJson: () => ({ version: '0.0.0' }),
    },
  };

  return Object.assign(henri, overrides);
}

/**
 * A minimal request
 *
 * @param {string} url the url
 * @param {object} [options={}] method, headers and other properties
 * @returns {object} the request
 */
function fakeReq(url, { headers = {}, method = 'GET', ...rest } = {}) {
  return {
    headers: Object.assign({ host: 'localhost:3000' }, headers),
    method,
    originalUrl: url,
    protocol: 'http',
    query: {},
    url,
    ...rest,
  };
}

/**
 * A minimal response recording what was sent
 *
 * @returns {object} the response
 */
function fakeRes() {
  return {
    body: null,
    calls: [],
    cookie(name, value, options) {
      this.cookies[name] = { options, value };

      return this;
    },
    cookies: {},
    end() {
      this.calls.push(['end']);

      return this;
    },
    ended: false,
    getHeader(name) {
      return this.headers[name.toLowerCase()];
    },
    headers: {},
    json(payload) {
      this.body = payload;
      this.calls.push(['json']);

      return this;
    },
    locals: {},
    redirect(...args) {
      this.calls.push(['redirect', ...args]);

      return this;
    },
    send(payload) {
      this.body = payload;
      this.calls.push(['send']);

      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    statusCode: 200,
  };
}

/**
 * Write a fake package.json under <dir>/node_modules/<name>
 *
 * @param {string} dir the application directory
 * @param {string} name the package name
 * @param {string} version its version
 * @returns {string} the package.json path
 */
function installPackage(dir, name, version) {
  const target = path.join(dir, 'node_modules', ...name.split('/'));

  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(
    path.join(target, 'package.json'),
    JSON.stringify({ name, version })
  );

  return path.join(target, 'package.json');
}

/**
 * Remove a temporary directory
 *
 * @param {string} dir the directory
 * @returns {void}
 */
function cleanup(dir) {
  fs.rmSync(dir, { force: true, recursive: true });
}

module.exports = { cleanup, fakeHenri, fakeReq, fakeRes, installPackage };
