const fs = require('fs');
const path = require('path');

const {
  CHECKS,
  OWASP,
  advisoriesOf,
  audit,
  findings,
  stripComments,
} = require('../scripts/audit');
const { cleanup, henri, scaffold } = require('./helpers');

/**
 * The findings of an application, keyed by check name
 *
 * @param {string} app The application directory
 * @returns {{ok: boolean, names: Array<string>, findings: Array<object>}} The result
 */
const run = (app) => {
  const report = audit(app, { deps: false });

  return {
    findings: report.findings,
    names: report.findings.map((finding) => finding.check),
    ok: report.ok,
  };
};

/**
 * Write a file of the application, run the audit, put the file back
 *
 * @param {string} app The application directory
 * @param {string} file A path relative to the application
 * @param {string} content What to write
 * @returns {object} What run() returned
 */
const withFile = (app, file, content) => {
  const location = path.join(app, file);
  const existed = fs.existsSync(location);
  const original = existed ? fs.readFileSync(location, 'utf8') : null;

  fs.writeFileSync(location, content);

  try {
    return run(app);
  } finally {
    if (existed) {
      fs.writeFileSync(location, original);
    } else {
      fs.unlinkSync(location);
    }
  }
};

/**
 * The same, with a configuration file merged over config/default.json
 *
 * @param {string} app The application directory
 * @param {string} file A path relative to the application
 * @param {object} config What to write, over the default configuration
 * @returns {object} What run() returned
 */
const withConfig = (app, file, config) => {
  const base = JSON.parse(
    fs.readFileSync(path.join(app, 'config/default.json'), 'utf8')
  );

  return withFile(app, file, JSON.stringify({ ...base, ...config }));
};

describe('audit helpers', () => {
  test('blanks the comments and keeps every offset', () => {
    const source = 'const a = 1; // req.body\n/* req.body */ const b = 2;\n';
    const blanked = stripComments(source);

    expect(blanked).not.toContain('req.body');
    expect(blanked).toHaveLength(source.length);
    expect(blanked.split('\n')).toHaveLength(source.split('\n').length);
  });

  test('reads both shapes of an audit report', () => {
    const v1 = JSON.stringify({
      advisories: {
        1: {
          module_name: 'left-pad',
          severity: 'high',
          title: 'pads too far',
          url: 'https://example.test/1',
        },
        2: { module_name: 'meh', severity: 'low', title: 'nothing' },
      },
    });
    const v2 = JSON.stringify({
      vulnerabilities: {
        'left-pad': {
          name: 'left-pad',
          severity: 'critical',
          via: [{ title: 'pads too far', url: 'https://example.test/1' }],
        },
        meh: { name: 'meh', severity: 'moderate', via: ['left-pad'] },
      },
    });

    expect(advisoriesOf(v1)).toEqual([
      {
        module: 'left-pad',
        severity: 'high',
        title: 'pads too far',
        url: 'https://example.test/1',
      },
    ]);
    expect(advisoriesOf(v2)).toEqual([
      {
        module: 'left-pad',
        severity: 'critical',
        title: 'pads too far',
        url: 'https://example.test/1',
      },
    ]);
    expect(advisoriesOf('ENOTFOUND registry.example.test')).toBeNull();
    expect(
      advisoriesOf(JSON.stringify({ error: { code: 'ENOTFOUND' } }))
    ).toBeNull();
  });

  test('the catalogue is sorted, complete and maps to a category', () => {
    const names = CHECKS.map((entry) => entry.check);

    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);

    for (const entry of CHECKS) {
      expect(OWASP[entry.owasp]).toMatch(/^A\d\d:2021 /u);
      expect(entry.what).toBeTruthy();
      // A requirement and a level travel together, or neither does
      expect(entry.asvs === null).toBe(entry.level === null);
    }

    const levelled = CHECKS.filter((entry) => entry.asvs !== null);

    expect(levelled.map((entry) => entry.asvs)).toSatisfy((all) =>
      all.every((asvs) => /^V\d+(?:\.\d+){1,2}$/u.test(asvs))
    );
    expect(levelled.map((entry) => entry.level)).toSatisfy((all) =>
      all.every((level) => [1, 2, 3].includes(level))
    );
  });
});

describe('henri audit', () => {
  let dir;
  let app;

  beforeAll(() => {
    ({ app, dir } = scaffold(['--no-git']));
  });

  afterAll(() => {
    cleanup(dir);
  });

  test('finds nothing in a fresh application', () => {
    expect(findings(app)).toEqual([]);

    const { status, stdout } = henri(['audit', '--no-deps'], { cwd: app });

    expect(status).toBe(0);
    expect(stdout).toContain('nothing found');
    expect(stdout).toContain('OWASP Top 10:2021');

    const json = henri(['audit', '--no-deps', '--json'], { cwd: app });

    expect(JSON.parse(json.stdout)).toEqual({
      findings: [],
      ok: true,
      summary: {
        checks: CHECKS.length,
        failOn: 'medium',
        findings: 0,
        high: 0,
        low: 0,
        medium: 0,
        standards: { asvs: '4.0.3', owasp: 'Top 10:2021' },
      },
    });
  });

  test('prints what it can determine, not only what failed', () => {
    const { status, stdout } = henri(['audit', '--checks'], { cwd: app });

    expect(status).toBe(0);
    expect(stdout).toContain(`${CHECKS.length} checks`);
    expect(stdout).toContain('csrf.disabled');
    expect(stdout).toContain('V4.2.2');
    expect(stdout).toContain('usehenri.io/guides/security');

    const json = henri(['audit', '--checks', '--json'], { cwd: app });
    const catalogue = JSON.parse(json.stdout);

    expect(catalogue.standards).toEqual({
      asvs: '4.0.3',
      owasp: 'Top 10:2021',
    });
    expect(catalogue.checks).toContainEqual({
      asvs: 'V5.1.2',
      check: 'params.mass-assignment',
      level: 1,
      owasp: 'A01:2021 Broken Access Control',
      what: expect.stringContaining('req.permit()'),
    });
  });

  test('reports the protections a configuration turns off', () => {
    const {
      findings: found,
      names,
      ok,
    } = withConfig(app, 'config/production.json', {
      cors: { credentials: true, origin: true },
      csrf: false,
      filterParameters: ['apiKey'],
      helmet: { contentSecurityPolicy: false, hsts: false },
      rateLimit: false,
      requestTimeout: false,
      secret: 'hunter2',
      trustProxy: true,
    });

    expect(ok).toBe(false);
    expect(names).toEqual(
      expect.arrayContaining([
        'cors.permissive',
        'csrf.disabled',
        'helmet.weakened',
        'log.filters-narrowed',
        'rate-limit.disabled',
        'request-timeout.disabled',
        'secret.in-config',
        'trust-proxy.permissive',
      ])
    );
    expect(found).toContainEqual(
      expect.objectContaining({
        asvs: 'V4.2.2',
        check: 'csrf.disabled',
        file: 'config/production.json',
        owasp: 'A01:2021 Broken Access Control',
        severity: 'high',
      })
    );
    expect(found).toContainEqual(
      expect.objectContaining({
        asvs: 'V14.4.3',
        check: 'helmet.weakened',
        message: expect.stringContaining('Content-Security-Policy'),
        severity: 'medium',
      })
    );
    // `helmet: false` is the whole set at once
    expect(
      withConfig(app, 'config/production.json', { helmet: false }).findings
    ).toContainEqual(
      expect.objectContaining({ check: 'helmet.disabled', severity: 'high' })
    );
  });

  test('reports the bounds a configuration removes', () => {
    const { findings: found, names } = withConfig(
      app,
      'config/production.json',
      {
        csrf: { origin: false },
        graphql: { maxAliases: false, maxDepth: false },
        user: { lockout: false, model: 'User' },
      }
    );

    expect(names).toEqual(
      expect.arrayContaining([
        'csrf.origin-disabled',
        'graphql.limits-disabled',
        'lockout.disabled',
      ])
    );
    expect(found).toContainEqual(
      expect.objectContaining({
        asvs: 'V4.2.2',
        check: 'csrf.origin-disabled',
        file: 'config/production.json',
        severity: 'medium',
      })
    );
    expect(found).toContainEqual(
      expect.objectContaining({
        asvs: 'V13.4.1',
        check: 'graphql.limits-disabled',
        message: expect.stringContaining(
          'graphql.maxAliases, graphql.maxDepth'
        ),
        severity: 'medium',
      })
    );

    // Turning CSRF off entirely is one finding, not two
    expect(
      withConfig(app, 'config/production.json', { csrf: false }).names
    ).not.toContain('csrf.origin-disabled');

    // A bound that is raised rather than removed is not a finding
    expect(
      withConfig(app, 'config/production.json', {
        csrf: { trustedOrigins: ['https://checkout.example.com'] },
        graphql: { maxAliases: 50 },
        user: { lockout: { max: 25 } },
      }).names
    ).not.toEqual(
      expect.arrayContaining([
        'csrf.origin-disabled',
        'graphql.limits-disabled',
        'lockout.disabled',
      ])
    );
  });

  test('reports password hashes that are not bound to their row', () => {
    // An application that turned the binding off is telling anyone who can
    // write its database that a hash copied onto another row still works
    const off = withConfig(app, 'config/production.json', {
      user: { model: 'User', password: { binding: false } },
    });

    expect(off.names).toContain('password.binding-disabled');
    expect(off.findings).toContainEqual(
      expect.objectContaining({
        asvs: 'V2.4.1',
        check: 'password.binding-disabled',
        file: 'config/production.json',
        // `low` without a user model in the application, `medium` with one,
        // the way the lockout finding is weighed
        severity: 'low',
      })
    );

    // The object form says the same thing
    expect(
      withConfig(app, 'config/production.json', {
        user: { model: 'User', password: { binding: { enabled: false } } },
      }).names
    ).toContain('password.binding-disabled');

    // Ending the migration is tightening, not loosening: not a finding
    expect(
      withConfig(app, 'config/production.json', {
        user: {
          model: 'User',
          password: { binding: { allowUnbound: false } },
        },
      }).names
    ).not.toContain('password.binding-disabled');

    // And saying nothing at all is the default, which is on
    expect(
      withConfig(app, 'config/production.json', {
        user: { model: 'User', password: { minLength: 16 } },
      }).names
    ).not.toContain('password.binding-disabled');
  });

  test('reports a finding of config/test.json one severity lower', () => {
    const { findings: found, ok } = withConfig(app, 'config/test.json', {
      csrf: false,
    });

    expect(ok).toBe(false);
    expect(found).toContainEqual(
      expect.objectContaining({
        check: 'csrf.disabled',
        file: 'config/test.json',
        severity: 'medium',
      })
    );
  });

  test('reports the credentials of a remote database, not of a local one', () => {
    const remote = {
      stores: {
        default: {
          adapter: 'postgresql',
          url: 'postgres://app:s3cret@db.example.com:5432/app',
        },
      },
    };
    const local = {
      stores: {
        default: {
          adapter: 'postgresql',
          url: 'postgres://app:s3cret@127.0.0.1:5432/app',
        },
      },
    };

    expect(withConfig(app, 'config/production.json', remote).names).toContain(
      'secret.store-password'
    );
    expect(
      withConfig(app, 'config/production.json', local).names
    ).not.toContain('secret.store-password');
  });

  test('reports a HENRI_SECRET that is not a secret', () => {
    expect(withFile(app, '.env', 'HENRI_SECRET=change-me\n').findings).toEqual([
      expect.objectContaining({
        check: 'secret.weak',
        file: '.env',
        severity: 'medium',
      }),
    ]);
    expect(withFile(app, '.env', 'HENRI_SECRET=abcd\n').names).toEqual([
      'secret.weak',
    ]);
    // Never the value itself
    expect(
      JSON.stringify(withFile(app, '.env', 'HENRI_SECRET=change-me\n').findings)
    ).not.toContain('change-me');
  });

  test('reports a model write that takes the whole request body', () => {
    const { findings: found, names } = withFile(
      app,
      'app/controllers/greed.js',
      `module.exports = {
  create: async (req, res) => res.json(await Task.create(req.body)),
  // Task.create(req.body) in a comment is not a write
  fine: async (req, res) =>
    res.json(await Task.create({ title: req.body.title })),
};
`
    );

    // The same line is two statements: the body reaches the record, and the
    // record leaves as the ORM returned it
    expect(names.sort()).toEqual(['data.raw-record', 'params.mass-assignment']);
    expect(found).toContainEqual(
      expect.objectContaining({
        asvs: 'V5.1.2',
        check: 'params.mass-assignment',
        file: 'app/controllers/greed.js',
        level: 1,
        line: 2,
        owasp: 'A01:2021 Broken Access Control',
        severity: 'medium',
      })
    );
  });

  test('reports a record answered as the ORM returned it', () => {
    const { findings: found } = withFile(
      app,
      'app/controllers/leaky.js',
      `module.exports = {
  index: async (req, res) => res.json(await Task.find()),
  fine: async (req, res) => res.resource(await Task.findOne()),
  ok: async (req, res) => res.json({ ok: true }),
};
`
    );

    expect(found).toEqual([
      expect.objectContaining({
        asvs: 'V8.1.1',
        check: 'data.raw-record',
        level: 2,
        line: 2,
        severity: 'low',
      }),
    ]);
  });

  test('reports a raw query built by interpolation and the roles escape hatch', () => {
    const { names } = withFile(
      app,
      'app/controllers/raw.js',
      `module.exports = {
  index: async (req, res) => {
    const rows = await henri.stores.default.query(
      \`select * from tasks where id = \${req.params.id}\`
    );

    return res.json(rows);
  },
  promote: async (req, res) =>
    res.json(await User.update({ id: 1 }, { roles: ['admin'] }, { unsafe: true })),
};
`
    );

    expect(names.sort()).toEqual([
      'data.raw-record',
      'injection.raw-query',
      'params.unsafe',
    ]);
  });

  test('reports a resource action left open where its siblings are guarded', () => {
    const routes = path.join(app, 'config/routes.js');
    const original = fs.readFileSync(routes, 'utf8');
    const controller = path.join(app, 'app/controllers/notes.js');
    const action = 'async (req, res) => res.json({})';

    fs.writeFileSync(
      routes,
      `${original.replace(
        'module.exports = {',
        `module.exports = {
  'resources notes': {
    collection: { 'get archive': { action: 'archive', roles: ['admin'] } },
    only: ['index', 'destroy'],
  },
  // Two entries of the same controller are two decisions, not a hole
  'get /notes/about': { controller: 'notes#about', roles: ['admin'] },`
      )}`
    );
    fs.writeFileSync(
      controller,
      `module.exports = {
  about: ${action},
  archive: ${action},
  destroy: ${action},
  index: ${action},
};
`
    );

    const open = run(app);

    // A `before` hook is where an ownership check lives when it is not here
    fs.writeFileSync(
      controller,
      `module.exports = {
  before: { all: (req, res, next) => next() },
  about: ${action},
  archive: ${action},
  destroy: ${action},
  index: ${action},
};
`
    );

    const hooked = run(app);

    fs.unlinkSync(controller);
    fs.writeFileSync(routes, original);

    expect(
      open.findings.filter((entry) => entry.check === 'routes.unguarded')
    ).toEqual([
      expect.objectContaining({
        asvs: 'V4.1.1',
        file: 'config/routes.js',
        message: expect.stringContaining('DELETE /notes/:id'),
        owasp: 'A01:2021 Broken Access Control',
        severity: 'medium',
      }),
    ]);
    expect(hooked.names).not.toContain('routes.unguarded');
  });

  test('reports a policy nothing asks, and stays quiet once something does', () => {
    const policy = path.join(app, 'app/policies/note.js');
    const controller = path.join(app, 'app/controllers/notes.js');
    const routes = path.join(app, 'config/routes.js');
    const original = fs.readFileSync(routes, 'utf8');

    fs.mkdirSync(path.dirname(policy), { recursive: true });
    fs.writeFileSync(
      policy,
      `module.exports = {
  show: (user, note) => String(note.userId) === String(user.id),
};
`
    );
    fs.writeFileSync(
      controller,
      `module.exports = { show: async (req, res) => res.json(req.note) };\n`
    );

    const forgotten = run(app);

    // Asking in the controller is asking
    fs.writeFileSync(
      controller,
      `module.exports = {
  show: async (req, res) => res.json(await req.authorize('show', req.note)),
};
`
    );

    const byHand = run(app);

    // ...and so is saying so on the route
    fs.writeFileSync(
      controller,
      `module.exports = { show: async (req, res) => res.json(req.note) };\n`
    );
    fs.writeFileSync(
      routes,
      original.replace(
        'module.exports = {',
        `module.exports = {
  'resources notes': { only: ['show'], policy: true },`
      )
    );

    const declared = run(app);

    fs.unlinkSync(policy);
    fs.unlinkSync(controller);
    fs.writeFileSync(routes, original);

    expect(
      forgotten.findings.filter(
        (entry) => entry.check === 'policies.unenforced'
      )
    ).toEqual([
      expect.objectContaining({
        asvs: 'V4.2.1',
        file: 'app/policies/note.js',
        message: expect.stringContaining('never asked'),
        owasp: 'A01:2021 Broken Access Control',
        severity: 'medium',
      }),
    ]);
    expect(byHand.names).not.toContain('policies.unenforced');
    expect(declared.names).not.toContain('policies.unenforced');
  });

  test('says nothing about policies when the application ships none', () => {
    expect(run(app).names).not.toContain('policies.unenforced');
  });

  test('reports unescaped output in a page, but not in a mail layout', () => {
    expect(
      withFile(
        app,
        'app/views/pages/raw.js',
        'export default () => <div dangerouslySetInnerHTML={{ __html: html }} />;\n'
      ).findings
    ).toEqual([
      expect.objectContaining({
        asvs: 'V5.3.3',
        check: 'views.unescaped',
        file: 'app/views/pages/raw.js',
        severity: 'low',
      }),
    ]);

    fs.mkdirSync(path.join(app, 'app/views/mailers/layouts'), {
      recursive: true,
    });

    expect(
      withFile(app, 'app/views/mailers/layouts/mailer.hbs', '{{{body}}}\n')
        .findings
    ).toEqual([]);

    fs.rmSync(path.join(app, 'app/views/mailers'), {
      force: true,
      recursive: true,
    });
  });

  test('reports a GraphQL endpoint that asks for no session', () => {
    const model = path.join(app, 'app/models/Task.js');
    const source = fs.readFileSync(model, 'utf8');

    fs.writeFileSync(
      model,
      source.replace(
        'module.exports = {',
        'module.exports = {\n  graphql: { resolvers: {}, types: `type Query { tasks: [String] }` },'
      )
    );

    try {
      const { findings: found, ok } = run(app);

      expect(ok).toBe(true);
      expect(found).toContainEqual(
        expect.objectContaining({
          asvs: 'V13.4.2',
          check: 'graphql.exposed',
          message: expect.stringContaining('/_henri/gql'),
          severity: 'low',
        })
      );

      // Asking for a session, a role or the loopback interface answers it
      for (const graphql of [
        { authenticated: true },
        { roles: ['admin'] },
        { loopbackOnly: true },
      ]) {
        expect(
          withConfig(app, 'config/default.json', { graphql }).names
        ).not.toContain('graphql.exposed');
      }
    } finally {
      fs.writeFileSync(model, source);
    }
  });

  test('--fail-on decides the exit code, and --json prints the error', () => {
    const file = path.join(app, 'config/production.json');

    fs.writeFileSync(file, JSON.stringify({ csrf: false }));

    const failed = henri(['audit', '--no-deps'], { cwd: app });
    const relaxed = henri(['audit', '--no-deps', '--fail-on=none'], {
      cwd: app,
    });
    const json = henri(['audit', '--no-deps', '--json'], { cwd: app });

    fs.unlinkSync(file);

    expect(failed.status).toBe(1);
    expect(failed.stdout).toContain('csrf.disabled');
    expect(failed.stdout).toContain('A01:2021 Broken Access Control');
    expect(failed.stderr).toContain('1 finding at medium or above');
    expect(relaxed.status).toBe(0);
    expect(JSON.parse(json.stderr).error).toMatchObject({
      code: 'HENRI_CLI_CHECKS_FAILED',
      command: 'audit',
      exitCode: 1,
    });
  });

  test('refuses an unknown --fail-on, and running outside a project', () => {
    const wrong = henri(['audit', '--fail-on=urgent', '--json'], { cwd: app });
    const outside = henri(['audit', '--json'], { cwd: dir });

    expect(wrong.status).toBe(2);
    expect(JSON.parse(wrong.stderr).error.code).toBe('HENRI_CLI_USAGE');
    expect(outside.status).toBe(3);
    expect(JSON.parse(outside.stderr).error.code).toBe(
      'HENRI_CLI_NOT_A_PROJECT'
    );
  });

  test('says so when the advisories cannot be checked', () => {
    // The scaffold was created with --skip-install: there is no lockfile
    const { status, stdout } = henri(['audit', '--json'], { cwd: app });

    expect(status).toBe(0);
    expect(JSON.parse(stdout).findings).toEqual([
      expect.objectContaining({
        asvs: 'V14.2.1',
        check: 'deps.audit-unavailable',
        owasp: 'A06:2021 Vulnerable and Outdated Components',
        severity: 'low',
      }),
    ]);
  });

  test('henri doctor points at it without repeating it', () => {
    const file = path.join(app, 'config/production.json');

    fs.writeFileSync(file, JSON.stringify({ csrf: false }));

    const { status, stdout } = henri(['doctor'], { cwd: app });

    fs.unlinkSync(file);

    expect(status).toBe(0);
    expect(stdout).toContain('security.findings');
    expect(stdout).toContain('1 security finding (worst: high)');
    expect(stdout).toContain('henri audit');
    expect(stdout).not.toContain('csrf.disabled');
  });
});
