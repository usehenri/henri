const Privacy = require('../3.privacy');
const Retention = require('../4.retention');
const Tenancy = require('../0.tenancy');
const {
  MAX_TENANT,
  SOURCES,
  TenantError,
  headerFrom,
  markOf,
  normalizeTenant,
  subdomainOf,
  tenancyConfig,
  tenantOfUser,
  trusts,
} = require('../base/tenancy');

/**
 * Multi-tenancy, as far as it can be told without a database.
 *
 * The property the whole thing exists for -- tenant A cannot read or write
 * tenant B's rows -- is proved against real databases in
 * `packages/drizzle/__tests__/tenancy.spec.js` and
 * `packages/mongoose/__tests__/tenancy.spec.js`. What is here is the half
 * that has no rows in it: where the tenant of a request comes from, in what
 * order, what happens when the request and the signed-in user disagree, and
 * the three answers `conditionFor()` is allowed to give.
 */

/**
 * A configuration stand-in
 *
 * @param {object} [values={}] the keys
 * @returns {object} something with get/has
 */
const config = (values = {}) => ({
  get: (key) => values[key],
  has: (key) => typeof values[key] !== 'undefined',
});

/**
 * A tenancy module, initialized
 *
 * @param {object} [values={}] the configuration
 * @returns {Promise<object>} the module
 */
const build = async (values = {}) => {
  const said = [];
  const module = new Tenancy();

  module.henri = {
    config: config(values),
    pen: {
      info: (...args) => said.push(args),
      warn: (...args) => said.push(args),
    },
  };
  module.said = said;

  await module.init();

  return module;
};

/**
 * A request stand-in
 *
 * @param {object} [options={}] `headers`, `user`, `peer`
 * @returns {object} the request
 */
const request = ({ headers = {}, peer = '10.0.0.9', user = null } = {}) => ({
  get: (name) => headers[String(name).toLowerCase()],
  socket: { remoteAddress: peer },
  user,
});

describe('base/tenancy', () => {
  describe('what a tenant may be', () => {
    test('an identifier, and nothing else', () => {
      expect(normalizeTenant('acme')).toBe('acme');
      expect(normalizeTenant('acme-2.eu')).toBe('acme-2.eu');
      expect(normalizeTenant(null)).toBeNull();
      expect(normalizeTenant('')).toBeNull();
      expect(normalizeTenant(42)).toBe('42');
    });

    test('it is never truncated to fit', () => {
      expect(() => normalizeTenant('a'.repeat(MAX_TENANT + 1))).toThrow(
        /never truncated/u
      );
    });

    test('anything that would not survive a column is refused', () => {
      for (const bad of ['-acme', 'a b', "acme'--", 'acme\n', '../acme']) {
        expect(() => normalizeTenant(bad)).toThrow(/not an identifier/u);
      }
    });
  });

  describe('the subdomain', () => {
    test('one label in front of the domain, and only one', () => {
      expect(subdomainOf('acme.example.com', 'example.com')).toBe('acme');
      expect(subdomainOf('ACME.example.com:3000', 'example.com')).toBe('acme');
      expect(subdomainOf('example.com', 'example.com')).toBeNull();
      expect(subdomainOf('a.b.example.com', 'example.com')).toBeNull();
      expect(subdomainOf('acme.evil.com', 'example.com')).toBeNull();
      expect(subdomainOf('127.0.0.1', 'example.com')).toBeNull();
      expect(subdomainOf(undefined, 'example.com')).toBeNull();
    });
  });

  describe('the header', () => {
    test('a name with nobody allowed to set it fails the boot', () => {
      expect(() => headerFrom('x-tenant')).toThrow(
        /only believes a named one/u
      );
      expect(() => headerFrom({ from: [], name: 'x-tenant' })).toThrow();
    });

    test('a name with proxies is believed from those proxies only', () => {
      const header = headerFrom({ from: ['10.0.0.0/8'], name: 'X-Tenant' });

      expect(header.name).toBe('x-tenant');
      expect(trusts(request({ peer: '10.1.2.3' }), header)).toBe(true);
      expect(trusts(request({ peer: '203.0.113.4' }), header)).toBe(false);
      expect(trusts(request({ peer: null }), header)).toBe(false);
    });

    test('a range henri cannot read is a configuration failure', () => {
      expect(() => headerFrom({ from: ['nope'], name: 'x' })).toThrow(
        /tenancy\.from\.header\.from/u
      );
    });
  });

  describe('the configuration', () => {
    test('absent means off, and off means nothing', () => {
      const settings = tenancyConfig(config({}));

      expect(settings.enabled).toBe(false);
      expect(settings.column).toBe('tenantId');
    });

    test('false means off too', () => {
      expect(tenancyConfig(config({ tenancy: false })).enabled).toBe(false);
    });

    test('an object turns it on, with the defaults filled in', () => {
      const settings = tenancyConfig(config({ tenancy: {} }));

      expect(settings.enabled).toBe(true);
      expect(settings.from.user).toBe('tenantId');
      expect(settings.from.subdomain).toBeNull();
      expect(settings.require).toBe(false);
      expect(settings.status).toBe(404);
    });

    test('from.user false says the user record decides nothing', () => {
      const settings = tenancyConfig(
        config({ tenancy: { from: { subdomain: 'example.com', user: false } } })
      );

      expect(settings.from.user).toBeNull();
      expect(settings.from.subdomain).toBe('example.com');
    });

    test('anything but an object or false is refused', () => {
      expect(() => tenancyConfig(config({ tenancy: 'yes' }))).toThrow(
        /must be an object/u
      );
    });
  });

  describe('a model mark', () => {
    const settings = tenancyConfig(config({ tenancy: {} }));

    test('true is the column henri adds', () => {
      expect(
        markOf({ globalId: 'Invoice', options: { tenant: true } }, settings)
      ).toEqual({ column: 'tenantId', declared: false, length: MAX_TENANT });
    });

    test('a name is a column the model must declare', () => {
      expect(
        markOf(
          {
            globalId: 'Ticket',
            options: { tenant: 'accountId' },
            schema: { accountId: { type: 'string' } },
          },
          settings
        )
      ).toEqual({ column: 'accountId', declared: true, length: MAX_TENANT });
    });

    test('a name the schema has not fails the boot', () => {
      expect(() =>
        markOf(
          { globalId: 'Ticket', options: { tenant: 'accountId' }, schema: {} },
          settings
        )
      ).toThrow(/declares no accountId/u);
    });

    test('a mark henri cannot carry out fails the boot', () => {
      expect(() =>
        markOf({ globalId: 'Ticket', options: { tenant: 7 } }, settings)
      ).toThrow(/options\.tenant: 7/u);
    });

    test('saying nothing means shared, and so does tenancy being off', () => {
      expect(markOf({ globalId: 'Plan', options: {} }, settings)).toBeNull();
      expect(
        markOf(
          { globalId: 'Invoice', options: { tenant: true } },
          tenancyConfig(config({}))
        )
      ).toBeNull();
    });
  });

  describe("the user's own tenant", () => {
    test('is read off the column the configuration names', () => {
      expect(tenantOfUser({ tenantId: 'acme' }, 'tenantId')).toBe('acme');
      expect(tenantOfUser({ get: () => 'globex' }, 'tenantId')).toBe('globex');
      expect(tenantOfUser({}, 'tenantId')).toBeNull();
      expect(tenantOfUser(null, 'tenantId')).toBeNull();
      expect(tenantOfUser({ tenantId: 'acme' }, null)).toBeNull();
    });
  });
});

describe('henri.tenancy', () => {
  test('off costs nothing and says nothing', async () => {
    const module = await build({});

    expect(module.enabled).toBe(false);
    expect(module.said).toEqual([]);
    expect(module.conditionFor('Invoice')).toBeNull();
    expect(module.checkWrite('Invoice', {})).toBeNull();
    expect(module.mount({ app: { use: () => null } })).toBe(false);
  });

  test('on, the boot line says where the tenant comes from', async () => {
    const module = await build({
      tenancy: { from: { subdomain: 'example.com' } },
    });

    expect(module.enabled).toBe(true);
    expect(module.said[0][1]).toBe('on, from explicit, user, subdomain');
  });

  describe('the three answers of conditionFor', () => {
    let module;

    beforeEach(async () => {
      module = await build({ tenancy: {} });
      module.markFor({ globalId: 'Invoice', options: { tenant: true } });
      module.markFor({ globalId: 'Plan', options: {} });
    });

    test('nothing, for a shared model', () => {
      expect(module.conditionFor('Plan')).toBeNull();
      expect(module.conditionFor('Unknown')).toBeNull();
    });

    test('the condition, inside a tenant', () => {
      expect(module.run('acme', () => module.conditionFor('Invoice'))).toEqual({
        column: 'tenantId',
        tenant: 'acme',
      });
    });

    test('a refusal, outside one -- never an unscoped read', () => {
      expect(() =>
        module.conditionFor('Invoice', { operation: 'find' })
      ).toThrow(/Invoice\.find\(\) is a tenant's/u);
    });

    test('nothing again, inside unscoped()', () => {
      expect(module.unscoped(() => module.conditionFor('Invoice'))).toBeNull();
    });

    test('the context ends where it ends', () => {
      module.run('acme', () => module.current());

      expect(module.current()).toBeNull();
      expect(module.isUnscoped()).toBe(false);
    });

    test('run() refuses a value that cannot be a tenant', () => {
      expect(() => module.run('', () => null)).toThrow();
      expect(() => module.run('a b', () => null)).toThrow(/not an identifier/u);
    });

    test('run() takes the record that carries the column', () => {
      expect(module.run({ tenantId: 'acme' }, () => module.current())).toBe(
        'acme'
      );
    });

    test('require() answers or refuses', () => {
      expect(module.run('acme', () => module.require())).toBe('acme');
      expect(() => module.require('the sweep')).toThrow(/the sweep needs/u);
    });

    test('map() is what the models said', () => {
      expect(module.map()).toEqual({ Invoice: 'tenantId' });
    });
  });

  describe('a write that names a tenant', () => {
    let module;

    beforeEach(async () => {
      module = await build({ tenancy: {} });
      module.markFor({ globalId: 'Invoice', options: { tenant: true } });
    });

    test('is stamped when it names nothing', () => {
      expect(
        module.run('acme', () => module.checkWrite('Invoice', {}))
      ).toEqual({ column: 'tenantId', tenant: 'acme' });
    });

    test('is fine when it names this tenant', () => {
      expect(
        module.run('acme', () =>
          module.checkWrite('Invoice', { tenantId: 'acme' })
        )
      ).toEqual({ column: 'tenantId', tenant: 'acme' });
    });

    test('is refused when it names another', () => {
      expect(() =>
        module.run('acme', () =>
          module.checkWrite('Invoice', { tenantId: 'globex' })
        )
      ).toThrow(/refuses rather than obeying/u);
    });

    test('is refused outside a tenant', () => {
      expect(() =>
        module.checkWrite('Invoice', {}, { operation: 'create' })
      ).toThrow(/Invoice\.create\(\) writes to a tenant's table/u);
    });
  });

  describe('where the tenant of a request comes from', () => {
    test('the sources are asked in a fixed order', () => {
      expect(SOURCES).toEqual(['explicit', 'user', 'subdomain', 'header']);
    });

    test("the signed-in user's own record wins", async () => {
      const module = await build({
        tenancy: { from: { subdomain: 'example.com' } },
      });

      expect(
        module.resolve(
          request({
            headers: { host: 'acme.example.com' },
            user: { tenantId: 'acme' },
          })
        )
      ).toEqual({ source: 'user', tenant: 'acme' });
    });

    test('a subdomain decides it for an anonymous visitor', async () => {
      const module = await build({
        tenancy: { from: { subdomain: 'example.com' } },
      });

      expect(
        module.resolve(request({ headers: { host: 'acme.example.com' } }))
      ).toEqual({ source: 'subdomain', tenant: 'acme' });
    });

    test('a header is believed only from a listed proxy', async () => {
      const module = await build({
        tenancy: {
          from: {
            header: { from: ['10.0.0.0/8'], name: 'x-tenant' },
            user: false,
          },
        },
      });

      expect(
        module.resolve(
          request({ headers: { 'x-tenant': 'acme' }, peer: '10.1.2.3' })
        )
      ).toEqual({ source: 'header', tenant: 'acme' });

      expect(
        module.resolve(
          request({ headers: { 'x-tenant': 'acme' }, peer: '203.0.113.4' })
        )
      ).toEqual({ source: null, tenant: null });
    });

    test('a request naming another tenant than the user is refused', async () => {
      const module = await build({
        tenancy: { from: { subdomain: 'example.com' } },
      });
      const req = request({
        headers: { host: 'globex.example.com' },
        user: { tenantId: 'acme' },
      });

      expect(() => module.resolve(req)).toThrow(TenantError);

      const failure = (() => {
        try {
          module.resolve(req);
        } catch (error) {
          return error;
        }

        return null;
      })();

      expect(failure.code).toBe('HENRI_TENANT_MISMATCH');
      expect(failure.status).toBe(404);
      // A 404 that says which tenant it wanted is the boundary spelled out
      // in the body, so the message does not leave production
      expect(failure.expose).toBe(false);
    });

    test('refuses() is the same question, for the moment of a sign-in', async () => {
      const module = await build({
        tenancy: { from: { subdomain: 'example.com' } },
      });
      const req = request({ headers: { host: 'globex.example.com' } });

      expect(module.refuses(req, { tenantId: 'acme' })).toBeInstanceOf(
        TenantError
      );
      expect(module.refuses(req, { tenantId: 'globex' })).toBeNull();
      expect(module.refuses(req, null)).toBeNull();
    });
  });

  describe('the middleware', () => {
    /**
     * Runs the middleware over a request
     *
     * @param {object} module the tenancy module
     * @param {object} req the request
     * @returns {Promise<object>} `{ req, error, inside }`
     */
    const run = (module, req) =>
      new Promise((resolve) => {
        module.middleware()(req, {}, (error) =>
          resolve({ error, inside: module.current(), req })
        );
      });

    test('decides the tenant, says how, and opens the context', async () => {
      const module = await build({
        tenancy: { from: { subdomain: 'example.com' } },
      });
      const { error, inside, req } = await run(
        module,
        request({ headers: { host: 'acme.example.com' } })
      );

      expect(error).toBeUndefined();
      expect(req.tenant).toBe('acme');
      expect(req.tenantSource).toBe('subdomain');
      expect(inside).toBe('acme');
    });

    test('req.setTenant() is the explicit source, and it wins', async () => {
      const module = await build({ tenancy: {} });
      const req = request({});

      await run(module, req);
      req.setTenant('acme');

      expect(req.tenant).toBe('acme');
      expect(req.tenantSource).toBe('explicit');
      expect(module.resolve(req)).toEqual({
        source: 'explicit',
        tenant: 'acme',
      });
    });

    test('a request that resolved nothing is served, by default', async () => {
      const module = await build({ tenancy: {} });
      const { error, inside } = await run(module, request({}));

      expect(error).toBeUndefined();
      expect(inside).toBeNull();
    });

    test('tenancy.require refuses it instead', async () => {
      const module = await build({ tenancy: { require: true } });
      const { error } = await run(module, request({}));

      expect(error).toBeInstanceOf(TenantError);
      expect(error.code).toBe('HENRI_TENANT_UNRESOLVED');
    });

    test('a mismatch reaches the error handler', async () => {
      const module = await build({
        tenancy: { from: { subdomain: 'example.com' } },
      });
      const { error } = await run(
        module,
        request({
          headers: { host: 'globex.example.com' },
          user: { tenantId: 'acme' },
        })
      );

      expect(error.code).toBe('HENRI_TENANT_MISMATCH');
    });

    test('it is mounted once', async () => {
      const used = [];
      const module = await build({ tenancy: {} });
      const server = { app: { use: (fn) => used.push(fn) } };

      expect(module.mount(server)).toBe(true);
      expect(module.mount(server)).toBe(false);
      expect(used).toHaveLength(1);
    });
  });

  describe('the user model', () => {
    test('cannot be a tenant of itself', async () => {
      const module = await build({ tenancy: {}, user: { model: 'Account' } });

      expect(() =>
        module.markFor({ globalId: 'Account', options: { tenant: true } })
      ).toThrow(/is the user model/u);
    });
  });

  describe('the column of a model, by name', () => {
    test('answers what the mark said, and null for a shared model', async () => {
      const module = await build({ tenancy: {} });

      module.markFor({ globalId: 'Invoice', options: { tenant: true } });
      module.markFor({
        globalId: 'Ticket',
        options: { tenant: 'accountId' },
        schema: { accountId: { type: 'string' } },
      });
      module.markFor({ globalId: 'Plan', options: {} });

      expect(module.columnFor('Invoice')).toBe('tenantId');
      expect(module.columnFor('Ticket')).toBe('accountId');
      expect(module.columnFor('Plan')).toBeNull();
      // A model nobody asked about answers the same null a shared one does,
      // and it is safe for the same reason: it only ever adds a tenant to a
      // row, never skips a condition
      expect(module.columnFor('Nothing')).toBeNull();
    });

    test('answers null with tenancy off, whatever a model said', async () => {
      const module = await build({});

      expect(module.columnFor('Invoice')).toBeNull();
    });
  });

  describe("henri's own sweeps run across every tenant", () => {
    /**
     * A module of core's carrying a tenancy module
     *
     * @param {function} Module the class
     * @param {object} tenancy the tenancy module
     * @returns {object} the module
     */
    const sweeper = (Module, tenancy) => {
      const module = new Module();

      module.henri = { tenancy };

      return module;
    };

    test.each([
      ['privacy', Privacy],
      ['retention', Retention],
    ])(
      '%s walks the models inside unscoped(), so a command line works',
      async (name, Module) => {
        const tenancy = await build({ tenancy: {} });
        const module = sweeper(Module, tenancy);

        // Without this the first model call of a sweep raises
        // HENRI_TENANT_REQUIRED: there is no tenant at a cron line, and a
        // sweep narrowed to whatever happened to be in scope would delete
        // one customer's rows and write a receipt saying the rule ran
        expect(await module.everywhere(() => tenancy.isUnscoped())).toBe(true);
        expect(tenancy.isUnscoped()).toBe(false);
      }
    );

    test.each([
      ['privacy', Privacy],
      ['retention', Retention],
    ])('%s costs nothing when there is no tenancy', async (name, Module) => {
      const module = sweeper(Module, null);

      expect(await module.everywhere(() => 'ran')).toBe('ran');
    });
  });
});
