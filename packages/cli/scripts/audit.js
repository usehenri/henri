const fs = require('fs-extra');
const path = require('path');

const { CliError } = require('./errors');
const { expandEntry, singularize } = require('./routing');
const { detectPackageManager, isProject, readRoutes } = require('./utils');

/**
 * Security audit: what the application's own files say about the things a
 * web application is judged on, without booting it and without guessing.
 *
 * The standard this is built on is the **Application Security Verification
 * Standard 4.0.3**, because it is the one written to be verified: numbered
 * requirements, at levels, that an answer can be measured against. The OWASP
 * **Top 10 (2021)** rides along as a second label, because it is what a
 * report is read against outside a security team -- but it is an awareness
 * document, ten categories chosen for teaching, and an audit shaped by it
 * would inherit that shape.
 *
 * Every check answers a question that is true or false from the repository:
 * a key written in `config/*.json`, a file the version control system has in
 * its index, a line in a controller, an entry of `config/routes.js`. Nothing
 * here says "remember to use https" or "consider a security review": advice
 * that is not a finding makes the real findings easier to skip.
 *
 * Three consequences of that rule, and they are what keeps the output short:
 *
 * - henri's own defaults are never reported. helmet, the CSRF token, the
 *   rate limiters, the parameter filters, the request timeout and the
 *   password hashing are on unless an application turns them off, so the
 *   audit reports the turning off, not the default. The split between what
 *   the framework guarantees and what stays the application's is in
 *   `website/src/content/docs/guides/security.md`, which is the more useful
 *   half of this feature.
 * - what only a deployment knows is not reported. Whether a proxy sits in
 *   front, whether TLS terminates before the process, which environment
 *   variables the container sets: none of that is in the repository.
 * - what the framework has no answer for is not reported either, however
 *   true it would be. A check whose hint is "there is nothing you can do"
 *   is a bug report, and it belongs in the issue tracker.
 *
 * `CHECKS` is the catalogue, and `henri audit --checks` prints it: what an
 * application has covered, not only what it failed.
 */

/** The OWASP Top 10 (2021) categories this audit maps findings to */
const OWASP = {
  A01: 'A01:2021 Broken Access Control',
  A02: 'A02:2021 Cryptographic Failures',
  A03: 'A03:2021 Injection',
  A05: 'A05:2021 Security Misconfiguration',
  A06: 'A06:2021 Vulnerable and Outdated Components',
  A07: 'A07:2021 Identification and Authentication Failures',
  A09: 'A09:2021 Security Logging and Monitoring Failures',
};

/** The standards the categories come from, printed with the report */
const STANDARDS = { asvs: '4.0.3', owasp: 'Top 10:2021' };

/**
 * The catalogue: every check this audit can make, whether or not it fires.
 *
 * It is the answer to "what have I covered", which a list of failures never
 * gives, and it is the one place the mapping lives -- `level` is henri's
 * reading of which ASVS 4.0.3 level the requirement sits at, and the
 * standard is the authority, not this table. A check with no `asvs` is one
 * henri thinks is worth knowing and the standard has no requirement for; it
 * carries no level either.
 *
 * `findings()` stamps every finding with the `level` of its check, and a
 * test asserts that no check can be emitted without an entry here.
 */
const CHECKS = [
  {
    asvs: 'V14.5.3',
    check: 'cors.permissive',
    level: 1,
    owasp: 'A05',
    what: 'cors accepts any origin, or reflects the caller and allows credentials',
  },
  {
    asvs: 'V2.10.4',
    check: 'credentials.key-committed',
    level: 2,
    owasp: 'A02',
    what: 'a config/credentials/*.key reached a commit',
  },
  {
    asvs: 'V4.2.2',
    check: 'csrf.disabled',
    level: 1,
    owasp: 'A01',
    what: '"csrf": false in a configuration file',
  },
  {
    asvs: 'V4.2.2',
    check: 'csrf.origin-disabled',
    level: 1,
    owasp: 'A01',
    what: '"csrf": { "origin": false }: the token is checked, where the request came from is not',
  },
  {
    asvs: 'V8.1.1',
    check: 'data.raw-record',
    level: 2,
    owasp: 'A01',
    what: 'a controller answers with a record as the ORM returned it, internal id and every column included',
  },
  {
    asvs: 'V14.2.1',
    check: 'deps.advisories',
    level: 1,
    owasp: 'A06',
    what: 'a production dependency has a high or critical advisory',
  },
  {
    asvs: 'V14.2.1',
    check: 'deps.audit-unavailable',
    level: 1,
    owasp: 'A06',
    what: 'the advisories could not be checked (no lockfile, or no network)',
  },
  {
    asvs: 'V14.2.1',
    check: 'deps.lockfile-untracked',
    level: 1,
    owasp: 'A06',
    what: 'the lockfile is not committed, so nothing pins what an install resolves',
  },
  {
    asvs: 'V2.10.4',
    check: 'env.committed',
    level: 2,
    owasp: 'A02',
    what: '.env reached a commit',
  },
  {
    asvs: 'V13.4.2',
    check: 'graphql.exposed',
    level: 2,
    owasp: 'A01',
    what: 'a model exports a graphql schema and the endpoint asks for no session, so anyone who can reach the application can query it',
  },
  {
    asvs: 'V13.4.1',
    check: 'graphql.limits-disabled',
    level: 2,
    owasp: 'A05',
    what: 'a graphql bound is false, so one request may cost whatever it asks for',
  },
  {
    asvs: 'V14.4.1',
    check: 'helmet.disabled',
    level: 1,
    owasp: 'A05',
    what: '"helmet": false in a configuration file: no security header is sent',
  },
  {
    asvs: 'V14.4',
    check: 'helmet.weakened',
    level: 1,
    owasp: 'A05',
    what: 'one helmet option is false, so the header it owns is not sent',
  },
  {
    asvs: 'V5.3.4',
    check: 'injection.raw-query',
    level: 1,
    owasp: 'A03',
    what: 'a raw query built by interpolating a template literal',
  },
  {
    asvs: 'V2.2.1',
    check: 'lockout.disabled',
    level: 1,
    owasp: 'A07',
    what: '"lockout": false: nothing bounds how many guesses one account may receive',
  },
  {
    asvs: 'V7.1.1',
    check: 'log.filters-disabled',
    level: 1,
    owasp: 'A09',
    what: '"filterParameters": false: passwords and tokens are logged in clear',
  },
  {
    asvs: 'V7.1.1',
    check: 'log.filters-narrowed',
    level: 1,
    owasp: 'A09',
    what: 'filterParameters replaces the defaults and drops one of them',
  },
  {
    asvs: 'V5.1.2',
    check: 'params.mass-assignment',
    level: 1,
    owasp: 'A01',
    what: 'a model write takes req.body or req.query whole instead of req.permit()',
  },
  {
    asvs: 'V4.1.3',
    check: 'params.unsafe',
    level: 1,
    owasp: 'A01',
    what: '{ unsafe: true } turns off the guard that keeps roles out of a write',
  },
  {
    asvs: 'V2.4.1',
    check: 'password.binding-disabled',
    level: 1,
    owasp: 'A02',
    what: '"binding": false: a hash copied onto another row still signs that row in',
  },
  {
    asvs: 'V4.2.1',
    check: 'policies.unenforced',
    level: 1,
    owasp: 'A01',
    what: 'a policy in app/policies is never asked: no route declares it and no controller calls req.can or req.authorize',
  },
  {
    asvs: 'V2.2.1',
    check: 'rate-limit.auth-disabled',
    level: 1,
    owasp: 'A07',
    what: '"auth": false: the login route keeps only the global limit',
  },
  {
    asvs: 'V2.2.1',
    check: 'rate-limit.disabled',
    level: 1,
    owasp: 'A07',
    what: '"rateLimit": false: nothing bounds how fast a client may call',
  },
  {
    asvs: null,
    check: 'request-timeout.disabled',
    level: null,
    owasp: 'A05',
    what: '"requestTimeout": false: a stuck handler holds its worker',
  },
  {
    asvs: 'V4.1.1',
    check: 'routes.unguarded',
    level: 1,
    owasp: 'A01',
    what: 'an action of a resource carries no role where its siblings do',
  },
  {
    asvs: 'V2.10.4',
    check: 'secret.in-config',
    level: 2,
    owasp: 'A02',
    what: 'the session secret is written in a configuration file',
  },
  {
    asvs: 'V2.10.4',
    check: 'secret.store-password',
    level: 2,
    owasp: 'A02',
    what: 'a store carries the credentials of a remote database',
  },
  {
    asvs: null,
    check: 'secret.weak',
    level: null,
    owasp: 'A02',
    what: 'HENRI_SECRET is short, or reads like a placeholder',
  },
  {
    asvs: 'V3.3.2',
    check: 'session.long-lifetime',
    level: 1,
    owasp: 'A07',
    what: 'sessions outlive the 30 days ASVS asks a re-authentication within',
  },
  {
    asvs: 'V8.1.1',
    check: 'session.public-fields',
    level: 2,
    owasp: 'A02',
    what: 'user.public names a field that looks like a credential',
  },
  {
    asvs: null,
    check: 'trust-proxy.permissive',
    level: null,
    owasp: 'A05',
    what: '"trustProxy": true: a client can forge the address it is limited by',
  },
  {
    asvs: 'V12.1.1',
    check: 'uploads.limits-disabled',
    level: 1,
    owasp: 'A05',
    what: 'an upload bound is false, so one request may write whatever it sends',
  },
  {
    asvs: 'V12.4.1',
    check: 'uploads.root-served',
    level: 1,
    owasp: 'A05',
    what: 'uploads are stored inside a directory the application serves',
  },
  {
    asvs: 'V12.2.1',
    check: 'uploads.type-check-disabled',
    level: 2,
    owasp: 'A05',
    what: '"sniff": false: the type of an uploaded file is whatever the client says it is',
  },
  {
    asvs: 'V5.3.3',
    check: 'views.unescaped',
    level: 1,
    owasp: 'A03',
    what: 'a view writes a value into the page without escaping it',
  },
];

/** The catalogue by check name */
const CATALOGUE = new Map(CHECKS.map((entry) => [entry.check, entry]));

/** Severities, weakest first: the index is the ordering */
const SEVERITIES = ['low', 'medium', 'high'];

/** What `--fail-on` accepts */
const THRESHOLDS = [...SEVERITIES, 'none'];

/** The `config.graphql` bounds `base/graphql-guard.js` enforces */
const GRAPHQL_BOUNDS = ['maxAliases', 'maxComplexity', 'maxDepth', 'maxTokens'];

/** The `config.uploads` bounds a multipart body is refused by */
const UPLOAD_BOUNDS = ['maxFields', 'maxFileSize', 'maxFiles', 'maxTotalSize'];

/**
 * The directory an application serves: `express.static` mounts
 * `app/views/public`, and the Inertia dev server has `app/views` for a root
 */
const SERVED_ROOT = 'app/views';

/** 30 days in milliseconds: henri's default session lifetime */
const THIRTY_DAYS = 2592000000;

/** The shortest `HENRI_SECRET` this audit accepts (128 bits, hex encoded) */
const MIN_SECRET_LENGTH = 32;

/** How long the package manager's advisory database lookup may take */
const AUDIT_TIMEOUT = 120000;

/** `config.filterParameters` when the key is absent (base/redact.js) */
const DEFAULT_FILTER = ['password', 'token', 'secret', 'authorization'];

/**
 * Hosts a committed database password is not a leak for: the credentials of
 * a local container are in `compose.yaml` anyway
 */
const LOCAL_HOSTS = ['0.0.0.0', '127.0.0.1', '::1', '[::1]', 'localhost'];

/** Secrets that are not secrets, whatever their length */
const PLACEHOLDERS = [
  'changeme',
  'change-me',
  'development',
  'password',
  'replace-me',
  'secret',
  'test',
  'xxxxxxxx',
];

/**
 * The helmet options an application may switch off one at a time, with the
 * header each one stops sending. Both helmet 8 names and the older aliases
 * are listed, because `config.helmet` is passed to helmet verbatim.
 */
const HELMET_DIRECTIVES = [
  {
    asvs: 'V14.4.3',
    header: 'Content-Security-Policy',
    key: 'contentSecurityPolicy',
  },
  { asvs: 'V14.4.5', header: 'Strict-Transport-Security', key: 'hsts' },
  {
    asvs: 'V14.4.5',
    header: 'Strict-Transport-Security',
    key: 'strictTransportSecurity',
  },
  { asvs: 'V14.4.7', header: 'X-Frame-Options', key: 'frameguard' },
  { asvs: 'V14.4.7', header: 'X-Frame-Options', key: 'xFrameOptions' },
  { asvs: 'V14.4.4', header: 'X-Content-Type-Options', key: 'noSniff' },
  {
    asvs: 'V14.4.4',
    header: 'X-Content-Type-Options',
    key: 'xContentTypeOptions',
  },
  { asvs: 'V14.4', header: 'Referrer-Policy', key: 'referrerPolicy' },
];

/**
 * A model write that takes a whole request bag instead of `req.permit()`.
 * `req.body` is only a finding when it is the argument itself: the sample
 * controllers read `req.body.title`, one field at a time, and that is fine.
 */
const REQUEST_BAG = String.raw`req\.(?:body|query)(?![\w.[])`;

/** The model writes mass assignment reaches */
const WRITES =
  'create|update|updateOne|updateMany|findOneAndUpdate|insert|bulkCreate|set';

/** Fields `config.user.public` should never name */
const CREDENTIAL_FIELD = /(?:pass|secret|token|salt|hash|credential)/iu;

/** Directories no scan ever walks into */
const SKIP = new Set([
  '.cache',
  '.git',
  '.henri',
  '.next',
  'coverage',
  'dist',
  'node_modules',
]);

/**
 * Is this a plain object? (a JSON object, not an array and not null)
 *
 * @param {*} value Anything
 * @returns {boolean} Plain object or not
 */
const isObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * The severity one step down, for a finding in `config/test.json`: the test
 * configuration never answers a request from the internet
 *
 * @param {string} severity A severity
 * @returns {string} The severity below it, or `low`
 */
const lower = (severity) =>
  SEVERITIES[Math.max(0, SEVERITIES.indexOf(severity) - 1)];

/**
 * Replace every comment of a source with spaces, keeping every offset and
 * every newline, so a match still knows which line it is on
 *
 * @param {string} source The source
 * @returns {string} The same source without its comments
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, (comment) =>
    comment.replace(/[^\n]/gu, ' ')
  );

/**
 * The line number of an offset in a source (1 based)
 *
 * @param {string} source The source
 * @param {number} index The offset
 * @returns {number} The line number
 */
const lineAt = (source, index) => source.slice(0, index).split('\n').length;

/**
 * Every file of a directory tree with one of the given extensions, as posix
 * paths relative to the application
 *
 * @param {string} dir The application directory
 * @param {string} relative The folder to walk, relative to it
 * @param {Array<string>} extensions Extensions to keep (`.js`)
 * @returns {Array<string>} The files (`app/controllers/tasks.js`)
 */
const sources = (dir, relative, extensions) => {
  const root = path.join(dir, relative);

  if (!fs.existsSync(root)) {
    return [];
  }

  const found = [];
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), `${prefix}${entry.name}/`);
      } else if (extensions.includes(path.extname(entry.name))) {
        found.push(`${prefix}${entry.name}`);
      }
    }
  };

  walk(root, `${relative.replace(/\\/gu, '/')}/`);

  return found.sort();
};

/**
 * The files git has in its index, for a set of pathspecs. A file that
 * reached a commit is committed whatever `.gitignore` says now.
 *
 * @param {string} dir The application directory
 * @param {Array<string>} patterns Pathspecs (`config/credentials/*.key`)
 * @returns {Array<string>} The tracked files (none outside a repository)
 */
const tracked = (dir, patterns) => {
  try {
    const { execFileSync } = require('child_process');
    const listed = execFileSync(
      'git',
      ['ls-files', '--cached', '--', ...patterns],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );

    return listed.split(/\r?\n/u).filter((line) => line.trim() !== '');
  } catch {
    // No git binary, or not a repository: nothing is committed yet
    return [];
  }
};

/**
 * The host a store connects to, from its `url` or its `host`
 *
 * @param {object} store One entry of `config.stores`
 * @returns {?string} The host, or null when the store names none
 */
const hostOf = (store) => {
  if (typeof store.url === 'string') {
    const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/?#:,]+)/iu.exec(
      store.url
    );

    return match ? match[1] : null;
  }

  return typeof store.host === 'string' ? store.host : null;
};

/**
 * Does a connection string carry a password?
 *
 * @param {*} url A store url
 * @returns {boolean} Yes or no
 */
const hasUrlPassword = (url) =>
  typeof url === 'string' &&
  /^[a-z][a-z0-9+.-]*:\/\/[^@/]+:[^@/]+@/iu.test(url);

/**
 * Is a host a local one? (a store with no host at all is local too: the
 * disk adapter writes in the application folder)
 *
 * @param {?string} host A host name
 * @returns {boolean} Local or not
 */
const isLocal = (host) =>
  host === null || LOCAL_HOSTS.includes(String(host).toLowerCase());

/**
 * Does a source define a key, as a property or as a method? (`before:`,
 * `graphql: {`, `async before(...)`)
 *
 * @param {string} source The source
 * @param {string} key The key name
 * @returns {boolean} Defined or not
 */
const defines = (source, key) =>
  new RegExp(`(^|[\\s,{])(async\\s+)?${key}\\s*[:(]`, 'mu').test(source);

/**
 * Read a JSON file, or null when it cannot be parsed (`henri doctor` owns
 * the syntax check; the audit says nothing about a file it cannot read)
 *
 * @param {string} file An absolute path
 * @returns {?object} The parsed content
 */
const readJson = (file) => {
  try {
    return fs.readJsonSync(file);
  } catch {
    return null;
  }
};

/**
 * The findings of one configuration file
 *
 * @param {object} config The parsed configuration
 * @param {object} context `{ file, hasUser }`
 * @returns {Array<object>} The findings, without their file
 */
const configFindings = (config, { hasUser }) => {
  const found = [];
  const add = (severity, check, owasp, message, hint, asvs = null) =>
    found.push({ asvs, check, hint, message, owasp, severity });

  if (typeof config.secret !== 'undefined') {
    add(
      'high',
      'secret.in-config',
      OWASP.A02,
      'the session secret is written in a configuration file, which is committed',
      'Move it to HENRI_SECRET in .env, or to the encrypted credentials (henri credentials:edit), and rotate it: the one in git is burnt',
      'V2.10.4'
    );
  }

  for (const [name, store] of Object.entries(config.stores || {})) {
    if (!isObject(store) || isLocal(hostOf(store))) {
      continue;
    }

    if (typeof store.password === 'string' && store.password !== '') {
      add(
        'high',
        'secret.store-password',
        OWASP.A02,
        `stores.${name} carries the database password of a remote host`,
        `Remove it and let DATABASE_URL, HENRI_CONFIG__stores__${name}__password or the credentials provide it, then rotate the password`,
        'V2.10.4'
      );
    } else if (hasUrlPassword(store.url)) {
      add(
        'high',
        'secret.store-password',
        OWASP.A02,
        `stores.${name}.url carries the credentials of a remote database`,
        `Remove them and let DATABASE_URL or HENRI_CONFIG__stores__${name}__url provide the connection string, then rotate the password`,
        'V2.10.4'
      );
    }
  }

  if (config.csrf === false) {
    add(
      'high',
      'csrf.disabled',
      OWASP.A01,
      'cross-site request forgery protection is turned off, so any site can post to this one with the visitor session',
      'Remove "csrf": false. A JSON client that sends Authorization: Bearer, or no session cookie at all, is already exempt',
      'V4.2.2'
    );
  } else if (isObject(config.csrf) && config.csrf.origin === false) {
    add(
      'medium',
      'csrf.origin-disabled',
      OWASP.A01,
      'the origin check is off, so the double-submit token stands alone: anything that can write a cookie on the parent domain can plant one it knows and post with it',
      'Remove "origin": false and name the origin that needs to post here instead: { "csrf": { "trustedOrigins": ["https://checkout.example.com"] } }',
      'V4.2.2'
    );
  }

  if (config.cors === true) {
    add(
      'medium',
      'cors.permissive',
      OWASP.A05,
      '"cors": true answers every origin with Access-Control-Allow-Origin: *',
      'Name the origins: { "cors": { "origin": ["https://app.example.com"] } }',
      'V14.5.3'
    );
  } else if (isObject(config.cors)) {
    const { credentials, origin } = config.cors;
    const permissive = (value) =>
      value === true || value === '*' || value === 'null';
    const open = Array.isArray(origin)
      ? origin.some(permissive)
      : permissive(origin);

    if (open) {
      add(
        credentials === true ? 'high' : 'medium',
        'cors.permissive',
        OWASP.A05,
        credentials === true
          ? 'cors reflects any origin and allows credentials, so any site can read answers made with the visitor session'
          : 'cors accepts any origin',
        'Name the origins: { "cors": { "origin": ["https://app.example.com"] } }',
        'V14.5.3'
      );
    }
  }

  if (config.helmet === false) {
    add(
      'high',
      'helmet.disabled',
      OWASP.A05,
      'helmet is off, so no Content-Security-Policy, X-Content-Type-Options, X-Frame-Options, Referrer-Policy or Strict-Transport-Security is sent',
      'Remove "helmet": false and override the single option you needed instead: { "helmet": { "crossOriginOpenerPolicy": false } }',
      'V14.4.1'
    );
  } else if (isObject(config.helmet)) {
    for (const { asvs, header, key } of HELMET_DIRECTIVES) {
      if (config.helmet[key] === false) {
        add(
          'medium',
          'helmet.weakened',
          OWASP.A05,
          `helmet.${key} is false, so ${header} is not sent`,
          `Give ${key} the options you need instead of turning it off`,
          asvs
        );
      }
    }
  }

  if (config.rateLimit === false) {
    add(
      'medium',
      'rate-limit.disabled',
      OWASP.A07,
      'rate limiting is off: nothing bounds how fast a client may call the application, the login route included',
      'Remove "rateLimit": false and raise the limit instead: { "rateLimit": { "max": 2000 } }',
      'V2.2.1'
    );
  } else if (isObject(config.rateLimit) && config.rateLimit.auth === false) {
    add(
      hasUser ? 'high' : 'medium',
      'rate-limit.auth-disabled',
      OWASP.A07,
      'the authentication limiter is off: the login route is only covered by the global limit, 600 requests a minute by default',
      'Remove "auth": false and raise its limit instead: { "rateLimit": { "auth": { "max": 30 } } }',
      'V2.2.1'
    );
  }

  if (isObject(config.graphql)) {
    const unbounded = GRAPHQL_BOUNDS.filter(
      (key) => config.graphql[key] === false
    );

    if (unbounded.length > 0) {
      add(
        'medium',
        'graphql.limits-disabled',
        OWASP.A05,
        `graphql.${unbounded.join(', graphql.')} ${unbounded.length === 1 ? 'is' : 'are'} false, so one query may alias, nest or select as much as it asks for`,
        `Raise the bound instead of removing it: { "graphql": { "${unbounded[0]}": 50 } }`,
        'V13.4.1'
      );
    }
  }

  if (config.trustProxy === true) {
    add(
      'low',
      'trust-proxy.permissive',
      OWASP.A05,
      '"trustProxy": true trusts X-Forwarded-For from any hop, so a client can choose its own address and its own rate limit bucket',
      'Set it to the number of proxies in front of henri ("trustProxy": 1), to their addresses, or to false when nothing is in front',
      null
    );
  }

  if (config.filterParameters === false) {
    add(
      'medium',
      'log.filters-disabled',
      OWASP.A09,
      'parameter filtering is off, so passwords, tokens and Authorization headers are written to the logs in clear',
      'Remove "filterParameters": false, or give it the names to mask',
      'V7.1.1'
    );
  } else if (Array.isArray(config.filterParameters)) {
    const kept = config.filterParameters.map((entry) =>
      String(entry).toLowerCase()
    );
    const missing = DEFAULT_FILTER.filter(
      (name) => !kept.some((entry) => name.includes(entry))
    );

    if (missing.length > 0) {
      add(
        'low',
        'log.filters-narrowed',
        OWASP.A09,
        `filterParameters replaces the defaults rather than extending them: ${missing.join(', ')} are no longer masked in the logs`,
        `List them again: "filterParameters": ${JSON.stringify([...new Set([...DEFAULT_FILTER, ...kept])])}`,
        'V7.1.1'
      );
    }
  }

  if (config.requestTimeout === false) {
    add(
      'low',
      'request-timeout.disabled',
      OWASP.A05,
      'requests never time out: a slow or stuck handler holds its worker until the client goes away',
      'Remove "requestTimeout": false, or raise it: { "requestTimeout": 120000 }',
      null
    );
  }

  if (isObject(config.uploads)) {
    const unbounded = UPLOAD_BOUNDS.filter(
      (key) => config.uploads[key] === false
    );

    if (unbounded.length > 0) {
      add(
        'medium',
        'uploads.limits-disabled',
        OWASP.A05,
        `uploads.${unbounded.join(', uploads.')} ${unbounded.length === 1 ? 'is' : 'are'} false, so one request may write as much as it sends`,
        `Raise the bound instead of removing it: { "uploads": { "${unbounded[0]}": "50mb" } }`,
        'V12.1.1'
      );
    }

    if (config.uploads.sniff === false) {
      add(
        'medium',
        'uploads.type-check-disabled',
        OWASP.A05,
        'the type of an uploaded file is taken from the Content-Type the client sent, so a script named avatar.png is stored as an image',
        'Remove "sniff": false and name the types you accept instead: { "uploads": { "allow": ["image/png", "image/jpeg"] } }',
        'V12.2.1'
      );
    }

    const root = String(config.uploads.root || '')
      .replace(/\\/gu, '/')
      .replace(/^\.\//u, '')
      .replace(/\/+$/u, '');

    if (root === SERVED_ROOT || root.startsWith(`${SERVED_ROOT}/`)) {
      add(
        'high',
        'uploads.root-served',
        OWASP.A05,
        `uploads are stored in ${root}, under the directory the view engine and express.static serve: an uploaded page is then reachable on this application's own origin`,
        'Store them outside it: { "uploads": { "root": "storage/uploads" } }, and hand a file back with henri.uploads.send()',
        'V12.4.1'
      );
    }
  }

  if (isObject(config.user)) {
    if (
      typeof config.user.sessionMaxAge === 'number' &&
      config.user.sessionMaxAge > THIRTY_DAYS
    ) {
      add(
        'low',
        'session.long-lifetime',
        OWASP.A07,
        `sessions last ${Math.round(config.user.sessionMaxAge / 86400000)} days`,
        'ASVS asks for a re-authentication at least every 30 days: "sessionMaxAge": 2592000000',
        'V3.3.2'
      );
    }

    if (config.user.lockout === false) {
      add(
        hasUser ? 'medium' : 'low',
        'lockout.disabled',
        OWASP.A07,
        'the per-account lockout is off: the address limiter still bounds one caller, so a guessing attempt spread over many addresses is unbounded',
        'Remove "lockout": false and widen the window instead: { "user": { "lockout": { "max": 25 } } }',
        'V2.2.1'
      );
    }

    const binding = (config.user.password || {}).binding;

    if (binding === false || (binding && binding.enabled === false)) {
      add(
        hasUser ? 'medium' : 'low',
        'password.binding-disabled',
        OWASP.A02,
        'password hashes are not bound to their row: someone who can write the database can copy a hash whose password they know onto another account and sign in as it',
        'Remove "binding": false; if a mass password update forced it, give each account its own password instead',
        'V2.4.1'
      );
    }

    const leaking = (config.user.public || []).filter(
      (field) =>
        String(field) !== 'password' && CREDENTIAL_FIELD.test(String(field))
    );

    if (leaking.length > 0) {
      add(
        'medium',
        'session.public-fields',
        OWASP.A02,
        `user.public sends ${leaking.join(', ')} to every view and every JSON answer`,
        'Keep credentials out of publicUser(): read them from the record in the controller that needs them',
        'V8.1.1'
      );
    }
  }

  return found;
};

/**
 * The findings of every `config/*.json` of the application
 *
 * @param {string} dir The application directory
 * @param {boolean} hasUser Does the application have a user model?
 * @returns {Array<object>} The findings
 */
const configurations = (dir, hasUser) => {
  const folder = path.join(dir, 'config');

  if (!fs.existsSync(folder)) {
    return [];
  }

  const found = [];

  for (const name of fs.readdirSync(folder).sort()) {
    if (!name.endsWith('.json')) {
      continue;
    }

    const config = readJson(path.join(folder, name));
    const file = `config/${name}`;

    if (!isObject(config)) {
      continue;
    }

    for (const finding of configFindings(config, { hasUser })) {
      found.push({
        ...finding,
        file,
        severity:
          name === 'test.json' ? lower(finding.severity) : finding.severity,
      });
    }
  }

  return found;
};

/**
 * What the repository itself says about the secrets: a key or a `.env` git
 * has in its index, and a `HENRI_SECRET` that is not one
 *
 * @param {string} dir The application directory
 * @returns {Array<object>} The findings
 */
const secrets = (dir) => {
  const found = [];
  const lockfile = Object.values(LOCKFILES).find((name) =>
    fs.existsSync(path.join(dir, name))
  );

  // Only once the repository holds something: before the first commit
  // nothing is tracked, and an application that has not been committed yet
  // is not an application that excluded its lockfile
  if (
    lockfile &&
    tracked(dir, ['package.json']).length > 0 &&
    tracked(dir, [lockfile]).length === 0
  ) {
    found.push({
      asvs: 'V14.2.1',
      check: 'deps.lockfile-untracked',
      file: lockfile,
      hint: 'Commit it: it is what makes an install resolve the versions this application was tested with, and what lets CI install with --frozen-lockfile',
      message: `${lockfile} is on disk but not committed, so nothing pins what the next install resolves`,
      owasp: OWASP.A06,
      severity: 'low',
    });
  }

  for (const file of tracked(dir, ['.env', 'config/credentials/*.key'])) {
    found.push({
      asvs: 'V2.10.4',
      check: file.endsWith('.key')
        ? 'credentials.key-committed'
        : 'env.committed',
      file,
      hint: `Remove it from the repository (git rm --cached ${file}), rotate everything it held and write the values again`,
      message: `${file} is committed: everyone who can read the repository has the secrets it holds`,
      owasp: OWASP.A02,
      severity: 'high',
    });
  }

  const env = path.join(dir, '.env');

  if (!fs.existsSync(env)) {
    return found;
  }

  const match = /^\s*(?:export\s+)?HENRI_SECRET\s*=\s*(.*?)\s*$/mu.exec(
    fs.readFileSync(env, 'utf8')
  );
  const secret = match ? match[1].replace(/^(['"])(.*)\1$/u, '$2') : '';
  const looksLikeAPlaceholder = PLACEHOLDERS.some((word) =>
    secret.toLowerCase().includes(word)
  );

  if (
    secret !== '' &&
    (looksLikeAPlaceholder || secret.length < MIN_SECRET_LENGTH)
  ) {
    found.push({
      asvs: null,
      check: 'secret.weak',
      file: '.env',
      hint: "HENRI_SECRET=$(node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"), which is what henri new writes",
      message: looksLikeAPlaceholder
        ? 'HENRI_SECRET reads like a placeholder: it signs every session cookie and every JWT'
        : `HENRI_SECRET is ${secret.length} characters: it signs every session cookie and every JWT`,
      owasp: OWASP.A02,
      severity: 'medium',
    });
  }

  return found;
};

/**
 * What the controllers, models, helpers and jobs say: mass assignment, the
 * roles escape hatch, and a raw query built by interpolation.
 *
 * Only `app/` is read. `db/seeds.js` and the scripts next to it are run by
 * hand with the arguments their author typed, so a query they build from a
 * database name is not a request reaching a database.
 *
 * @param {string} dir The application directory
 * @returns {Array<object>} The findings
 */
const code = (dir) => {
  const found = [];
  const patterns = [
    {
      asvs: 'V5.1.2',
      check: 'params.mass-assignment',
      hint: 'Name the fields: Model.create(req.permit("title", "body"))',
      message:
        'a model write takes the whole request bag, so any field a visitor sends reaches the record',
      owasp: OWASP.A01,
      regexp: new RegExp(`\\.(?:${WRITES})\\s*\\([^()]*${REQUEST_BAG}`, 'gu'),
      severity: 'medium',
    },
    {
      asvs: 'V5.1.2',
      check: 'params.mass-assignment',
      hint: 'Name the fields: new Model(req.permit("title", "body"))',
      message:
        'a model is built from the whole request bag, so any field a visitor sends reaches the record',
      owasp: OWASP.A01,
      regexp: new RegExp(
        `new\\s+[A-Z][A-Za-z0-9_]*\\s*\\(\\s*${REQUEST_BAG}`,
        'gu'
      ),
      severity: 'medium',
    },
    {
      asvs: 'V5.1.2',
      check: 'params.mass-assignment',
      hint: 'Name the fields: Object.assign(record, req.permit("title", "body"))',
      message:
        'a record is merged with the whole request bag, so any field a visitor sends reaches it',
      owasp: OWASP.A01,
      regexp: new RegExp(
        `Object\\.assign\\s*\\(\\s*[^,()]+,\\s*${REQUEST_BAG}`,
        'gu'
      ),
      severity: 'medium',
    },
    {
      asvs: 'V4.1.3',
      check: 'params.unsafe',
      hint: 'Set the roles explicitly instead: user.setRoles(["admin"])',
      message:
        '{ unsafe: true } turns off the guard that keeps `roles` out of a write',
      owasp: OWASP.A01,
      regexp: /\bunsafe\s*:\s*true\b/gu,
      severity: 'low',
    },
    {
      asvs: 'V5.3.4',
      check: 'injection.raw-query',
      hint: 'Pass the values apart: store.query("select * from tasks where id = ?", { replacements: [id] })',
      message:
        'a raw query is built by interpolating a template literal, which is how injection gets in',
      owasp: OWASP.A03,
      regexp: /\.query\s*\(\s*`[^`]*\$\{/gu,
      severity: 'medium',
    },
    {
      asvs: 'V8.1.1',
      check: 'data.raw-record',
      hint: 'res.resource(record) and res.collection(records) strip the internal id and answer HAL; res.render() strips it too',
      message:
        'a record leaves as the ORM returned it: the internal id and every column, including the ones nobody asked for',
      owasp: OWASP.A01,
      regexp: /res\.json\s*\(\s*await\s+[A-Z][A-Za-z0-9_]*\s*\./gu,
      severity: 'low',
    },
  ];
  const files = sources(dir, 'app', ['.js']).filter(
    (file) => !file.startsWith('app/views/')
  );

  for (const file of files) {
    const source = stripComments(fs.readFileSync(path.join(dir, file), 'utf8'));

    for (const pattern of patterns) {
      const { regexp, ...finding } = pattern;

      regexp.lastIndex = 0;

      const match = regexp.exec(source);

      if (match) {
        found.push({ ...finding, file, line: lineAt(source, match.index) });
      }
    }
  }

  return found;
};

/**
 * Unescaped output in the views: `dangerouslySetInnerHTML` in a page, a
 * triple stache in a template. Mail views are left alone: the layout henri
 * generates puts the body in with `{{{body}}}` and mail is not a browser.
 *
 * @param {string} dir The application directory
 * @returns {Array<object>} The findings
 */
const views = (dir) => {
  const found = [];
  const files = sources(dir, 'app/views', ['.js', '.jsx', '.hbs']).filter(
    (file) => !file.startsWith('app/views/mailers/')
  );

  for (const file of files) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    const needle = file.endsWith('.hbs')
      ? source.indexOf('{{{')
      : source.indexOf('dangerouslySetInnerHTML');

    if (needle < 0) {
      continue;
    }

    found.push({
      asvs: 'V5.3.3',
      check: 'views.unescaped',
      file,
      hint: 'Render the value as text, or sanitize the html before it reaches the view',
      line: lineAt(source, needle),
      message: file.endsWith('.hbs')
        ? 'a triple stache writes its value into the page without escaping it'
        : 'dangerouslySetInnerHTML writes its value into the page without escaping it',
      owasp: OWASP.A03,
      severity: 'low',
    });
  }

  return found;
};

/**
 * The entries of a routes file, with the namespaces flattened into the
 * context each child was declared in. A namespace is a folder, not a route:
 * its options are not inherited, so its children are the entries.
 *
 * @param {object} raw The content of config/routes.js
 * @param {object} [context={}] `{ namespace, prefix }` while recursing
 * @returns {Array<object>} `{ context, key, value }`, one per entry
 */
const routeEntries = (raw, context = {}) => {
  const out = [];

  for (const [key, value] of Object.entries(raw || {})) {
    if (value === null || typeof value === 'undefined') {
      continue;
    }

    const parts = String(key).trim().split(/\s+/u);

    if (parts[0].toLowerCase() === 'namespace' && isObject(value)) {
      const name = parts
        .slice(1)
        .join(' ')
        .replace(/^\/|\/$/gu, '');

      out.push(
        ...routeEntries(value, {
          namespace: context.namespace ? `${context.namespace}/${name}` : name,
          prefix: `${context.prefix || ''}/${name}`.replace(/\/{2,}/gu, '/'),
        })
      );
      continue;
    }

    out.push({ context, key, value });
  }

  return out;
};

/**
 * Actions of a resource that carry no role while their siblings do.
 *
 * The comparison is inside one `resources` or `crud` entry, and inside one
 * controller of it: those are the siblings. Two entries that happen to share
 * a controller are two decisions -- `get /signup` next to a guarded
 * `get /account` is an application, not a hole.
 *
 * A resource whose actions disagree is still either a hole or a decision;
 * the audit cannot tell, so it stays quiet about a controller that exports
 * `before` hooks, which is where an ownership check lives when it is not in
 * `config/routes.js`.
 *
 * @param {string} dir The application directory
 * @returns {Array<object>} The findings
 */
const guards = (dir) => {
  const found = [];
  let raw;

  try {
    raw = readRoutes(dir);
  } catch {
    // `henri doctor` reports a routes file that will not load
    return found;
  }

  for (const { context, key, value } of routeEntries(raw)) {
    const kind = String(key).trim().split(/\s+/u)[0].toLowerCase();

    if (!['crud', 'resources'].includes(kind)) {
      continue;
    }

    const byController = new Map();

    for (const route of expandEntry(key, value, context)) {
      const [controller] = route.controller.split('#');
      const roles = [].concat(route.roles || []).filter(Boolean);
      const entry = byController.get(controller) || { guarded: [], open: [] };

      entry[roles.length > 0 ? 'guarded' : 'open'].push(route);
      byController.set(controller, entry);
    }

    for (const [controller, { guarded, open }] of byController) {
      const file = `app/controllers/${controller}.js`;
      const full = path.join(dir, file);

      if (guarded.length === 0 || open.length === 0 || !fs.existsSync(full)) {
        continue;
      }

      if (defines(fs.readFileSync(full, 'utf8'), 'before')) {
        continue;
      }

      const listed = open
        .map((route) => `${route.verb.toUpperCase()} ${route.route}`)
        .join(', ');

      found.push({
        asvs: 'V4.1.1',
        check: 'routes.unguarded',
        file: 'config/routes.js',
        hint: `Give them a role too, or check the caller in a "before" hook of ${file}`,
        message: `"${key}" guards ${guarded.length} of the ${controller} routes with "roles" and leaves ${open.length} open: ${listed}`,
        owasp: OWASP.A01,
        severity: 'medium',
      });
    }
  }

  return found;
};

/**
 * A policy nothing asks.
 *
 * `app/policies/<name>.js` is the file that answers "may this person read
 * *this* record", and it answers nothing on its own: a route has to declare
 * `policy`, or a controller has to call `req.can()` / `req.authorize()`.
 * Writing the rules and forgetting the gate is the one mistake that looks
 * exactly like having solved the problem, so it is worth a finding.
 *
 * Nothing is reported for an application that ships no policy: this reads
 * what the application said, and an application that said nothing is not
 * being judged against a default.
 *
 * @param {string} dir The application directory
 * @returns {Array<object>} The findings
 */
const policies = (dir) => {
  const files = sources(dir, 'app/policies', ['.js']).map((file) =>
    file
      .replace(/^app\/policies\//u, '')
      .replace(/\.js$/u, '')
      .toLowerCase()
  );

  if (files.length === 0) {
    return [];
  }

  const asked = new Set();
  const remember = (word) => {
    const bare = String(word).toLowerCase();
    const parts = bare.split('/');

    asked.add(bare);
    parts[parts.length - 1] = singularize(parts[parts.length - 1]);
    asked.add(parts.join('/'));
  };
  let raw;

  try {
    raw = readRoutes(dir);
  } catch {
    // `henri doctor` reports a routes file that will not load
    raw = {};
  }

  for (const { context, key, value } of routeEntries(raw)) {
    for (const route of expandEntry(key, value, context)) {
      if (route.policy) {
        const [controller] = route.controller.split('#');

        remember(route.policy === true ? controller : route.policy);
      }
    }
  }

  // A controller asking by hand counts: `policy` on the route is one way of
  // asking, not the only one. The controller of a policy is the one named
  // after it, which is the same rule henri resolves a policy by
  for (const file of sources(dir, 'app/controllers', ['.js'])) {
    const source = stripComments(fs.readFileSync(path.join(dir, file), 'utf8'));

    if (/\breq\.(can|authorize|scope)\s*\(/u.test(source)) {
      remember(file.replace(/^app\/controllers\//u, '').replace(/\.js$/u, ''));
    }
  }

  return files
    .filter((name) => !asked.has(name))
    .map((name) => ({
      asvs: 'V4.2.1',
      check: 'policies.unenforced',
      file: `app/policies/${name}.js`,
      hint: `Add "policy": true to the ${name} routes of config/routes.js, or call req.authorize(action, record) in the controller`,
      message: `the ${name} policy is never asked: no route declares it and no controller calls req.can() or req.authorize()`,
      owasp: OWASP.A01,
      severity: 'medium',
    }));
};

/**
 * Who may query the GraphQL endpoint? It is mounted, and only mounted, when
 * a model exports a `graphql` key, and it then answers anyone unless
 * `config.graphql` asks for a session, a role or the loopback interface.
 *
 * What one query may cost is not part of this: `base/graphql-guard.js`
 * bounds aliases, depth, complexity and tokens for every application, and
 * `graphql.limits-disabled` is what reports the removal of a bound. This is
 * the other question, the one henri cannot answer for you -- a schema that
 * reaches a record only its owner may read is an access control decision,
 * and it lives in the resolvers.
 *
 * @param {string} dir The application directory
 * @param {object} config The configuration of the default environment
 * @returns {Array<object>} The findings
 */
const graphql = (dir, config) => {
  const models = sources(dir, 'app/models', ['.js']).filter((file) =>
    defines(fs.readFileSync(path.join(dir, file), 'utf8'), 'graphql')
  );

  if (models.length === 0) {
    return [];
  }

  const settings = isObject(config.graphql) ? config.graphql : {};
  const guarded =
    settings.authenticated === true ||
    settings.loopbackOnly === true ||
    (Array.isArray(settings.roles) && settings.roles.length > 0);

  if (guarded) {
    return [];
  }

  const endpoint =
    typeof config.graphql === 'string'
      ? config.graphql
      : settings.endpoint || '/_henri/gql';

  return [
    {
      asvs: 'V13.4.2',
      check: 'graphql.exposed',
      file: models[0],
      hint: `Ask for a session: { "graphql": { "authenticated": true } }, name the roles that may query, or keep it to the loopback interface. Then put the records only their owner may read behind a check in their resolver`,
      message: `${models.length} model${models.length === 1 ? '' : 's'} export a graphql schema and ${endpoint} asks for no session, so anyone who can reach the application can query it`,
      owasp: OWASP.A01,
      severity: 'low',
    },
  ];
};

/** How each package manager asks its registry about the production tree */
const AUDIT_COMMANDS = {
  npm: ['audit', '--omit=dev', '--audit-level=high', '--json'],
  pnpm: ['audit', '--prod', '--audit-level', 'high', '--json'],
  yarn: [
    'npm',
    'audit',
    '--environment',
    'production',
    '--severity',
    'high',
    '--json',
  ],
};

/** The lockfile each package manager leaves behind */
const LOCKFILES = {
  npm: 'package-lock.json',
  pnpm: 'pnpm-lock.yaml',
  yarn: 'yarn.lock',
};

/**
 * The advisories of an audit answer, whichever shape it came in: npm's v1
 * report (`advisories`, what pnpm prints) or its v2 one (`vulnerabilities`)
 *
 * @param {string} stdout What the package manager printed
 * @returns {?Array<object>} `{ module, severity, title, url }`, or null when
 *   the answer is not a report at all
 */
const advisoriesOf = (stdout) => {
  const start = stdout.indexOf('{');

  if (start < 0) {
    return null;
  }

  let report;

  try {
    report = JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }

  if (!isObject(report) || report.error) {
    return null;
  }

  const wanted = ['critical', 'high'];
  const found = [];

  for (const entry of Object.values(report.advisories || {})) {
    if (isObject(entry) && wanted.includes(entry.severity)) {
      found.push({
        module: entry.module_name,
        severity: entry.severity,
        title: entry.title,
        url: entry.url || null,
      });
    }
  }

  for (const entry of Object.values(report.vulnerabilities || {})) {
    if (!isObject(entry) || !wanted.includes(entry.severity)) {
      continue;
    }

    const source = [].concat(entry.via || []).find(isObject) || {};

    found.push({
      module: entry.name,
      severity: entry.severity,
      title: source.title || 'a known advisory',
      url: source.url || null,
    });
  }

  return found;
};

/**
 * Ask the package manager whether the production dependencies have known
 * advisories. High and critical only, and production only: a moderate
 * advisory in a build tool is what teaches a team to ignore the gate.
 *
 * @param {string} dir The application directory
 * @returns {Array<object>} The findings
 */
const dependencies = (dir) => {
  const pm = detectPackageManager(dir);
  const unavailable = (why, hint) => [
    {
      asvs: 'V14.2.1',
      check: 'deps.audit-unavailable',
      file: null,
      hint,
      message: `the dependency advisories were not checked: ${why}`,
      owasp: OWASP.A06,
      severity: 'low',
    },
  ];

  if (!fs.existsSync(path.join(dir, LOCKFILES[pm]))) {
    return unavailable(
      `there is no ${LOCKFILES[pm]} to resolve the tree from`,
      `${pm} install`
    );
  }

  const spawn = require('cross-spawn');
  const command = `${pm} ${AUDIT_COMMANDS[pm].join(' ')}`;
  const result = spawn.sync(pm, AUDIT_COMMANDS[pm], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: AUDIT_TIMEOUT,
  });

  if (result.error || result.status === null) {
    return unavailable(
      `"${command}" did not answer (${result.error ? result.error.message : 'timed out'})`,
      'Run it by hand once the machine is online'
    );
  }

  if (result.status === 0) {
    return [];
  }

  const advisories = advisoriesOf(result.stdout || '');

  if (advisories === null) {
    return unavailable(`"${command}" answered with an error`, command);
  }

  return advisories.map((advisory) => ({
    asvs: 'V14.2.1',
    check: 'deps.advisories',
    file: LOCKFILES[pm],
    hint: `${pm === 'npm' ? 'npm audit fix' : `${pm} update ${advisory.module}`}, or override the resolved version`,
    message: `${advisory.module} has a ${advisory.severity} advisory: ${advisory.title}${advisory.url ? ` (${advisory.url})` : ''}`,
    owasp: OWASP.A06,
    severity: 'high',
  }));
};

/**
 * Does the application have a user model? The session, the login route and
 * the CSRF token only exist when it does.
 *
 * @param {string} dir The application directory
 * @param {object} config The configuration of the default environment
 * @returns {boolean} Yes or no
 */
const hasUserModel = (dir, config) => {
  const configured = isObject(config.user) ? config.user.model : config.user;
  const name = String(configured || 'user').toLowerCase();
  const folder = path.join(dir, 'app', 'models');

  if (!fs.existsSync(folder)) {
    return false;
  }

  return fs
    .readdirSync(folder)
    .some((file) => file.toLowerCase() === `${name}.js`);
};

/**
 * Findings worst first, then by check name and file, so two runs of the
 * same tree print the same report. Each one is stamped with the ASVS level
 * of its check, which lives in the catalogue and nowhere else.
 *
 * @param {Array<object>} entries The findings
 * @returns {Array<object>} The same findings, ordered and levelled
 */
const sorted = (entries) =>
  [...entries]
    .map((entry) => ({
      level: (CATALOGUE.get(entry.check) || { level: null }).level,
      line: null,
      ...entry,
    }))
    .sort((left, right) => {
      const weight =
        SEVERITIES.indexOf(right.severity) - SEVERITIES.indexOf(left.severity);

      return (
        weight ||
        left.check.localeCompare(right.check) ||
        String(left.file).localeCompare(String(right.file))
      );
    });

/**
 * Every static finding: the configuration files, the secrets, the code, the
 * views, the route guards and the GraphQL surface. Nothing here starts a
 * process or reaches the network, so `henri doctor` can call it too.
 *
 * @param {string} [dir=process.cwd()] The application directory
 * @returns {Array<object>} The findings, worst first
 */
const findings = (dir = process.cwd()) => {
  const config = readJson(path.join(dir, 'config', 'default.json')) || {};
  const hasUser = hasUserModel(dir, config);

  return sorted([
    ...configurations(dir, hasUser),
    ...secrets(dir),
    ...code(dir),
    ...views(dir),
    ...guards(dir),
    ...policies(dir),
    ...graphql(dir, config),
  ]);
};

/**
 * Audit an application
 *
 * @param {string} [dir=process.cwd()] The application directory
 * @param {object} [options] Options
 * @param {boolean} [options.deps=true] Ask the package manager for advisories
 * @param {string} [options.failOn='medium'] The severity that fails the run
 * @returns {{ok: boolean, findings: Array<object>, summary: object}} The report
 * @throws {CliError} NOT_A_PROJECT when dir is not a henri application
 */
const audit = (
  dir = process.cwd(),
  { deps = true, failOn = 'medium' } = {}
) => {
  if (!isProject(dir)) {
    throw new CliError('NOT_A_PROJECT', `${dir} is not an henri project`, {
      hint: 'Run henri audit from the root of your application',
    });
  }

  const found = sorted([...findings(dir), ...(deps ? dependencies(dir) : [])]);
  const count = (severity) =>
    found.filter((entry) => entry.severity === severity).length;
  const threshold = SEVERITIES.indexOf(failOn);

  return {
    findings: found,
    ok:
      threshold < 0 ||
      !found.some((entry) => SEVERITIES.indexOf(entry.severity) >= threshold),
    summary: {
      // What was looked for, next to what was found: a list of failures
      // never says what an application has covered
      checks: CHECKS.length,
      failOn,
      findings: found.length,
      high: count('high'),
      low: count('low'),
      medium: count('medium'),
      standards: STANDARDS,
    },
  };
};

/**
 * Print the report as text
 *
 * @param {object} report The report from audit()
 * @returns {void}
 */
const print = ({ findings: found, summary }) => {
  const { checks, failOn, high, low, medium } = summary;
  const standards = `ASVS ${STANDARDS.asvs}, OWASP ${STANDARDS.owasp}`;

  console.log('');

  if (found.length === 0) {
    console.log(`  henri audit: nothing found in ${checks} checks`);
    console.log(`  ${standards}. henri audit --checks lists them.`);
    console.log('');
    console.log('  https://usehenri.io/guides/security/');
    console.log('');

    return;
  }

  console.log(
    `  henri audit: ${found.length} finding${found.length === 1 ? '' : 's'} in ${checks} checks (${high} high, ${medium} medium, ${low} low; failing on ${failOn})`
  );
  console.log('');

  for (const entry of found) {
    const where = entry.line ? `${entry.file}:${entry.line}` : entry.file || '';

    console.log(
      `  ${entry.severity.padEnd(7)} ${entry.check.padEnd(26)} ${where}`
    );
    console.log(
      `          ${entry.owasp}${entry.asvs ? ` / ASVS ${entry.asvs}${entry.level ? ` (L${entry.level})` : ''}` : ''}`
    );
    console.log(`          ${entry.message}`);

    if (entry.hint) {
      console.log(`          -> ${entry.hint}`);
    }
    console.log('');
  }

  console.log('  https://usehenri.io/guides/security/');
  console.log('');
};

/**
 * Print the catalogue as text: what this audit can determine, whether or
 * not it fired. The other half of the answer is what henri handles for
 * every application, which is the table on the documentation page.
 *
 * @returns {void}
 */
const printChecks = () => {
  console.log('');
  console.log(
    `  henri audit: ${CHECKS.length} checks against ASVS ${STANDARDS.asvs} and OWASP ${STANDARDS.owasp}`
  );
  console.log('');

  for (const entry of CHECKS) {
    console.log(
      `  ${(entry.level ? `L${entry.level}` : '--').padEnd(3)} ${entry.check.padEnd(26)} ${(entry.asvs || '').padEnd(9)} ${OWASP[entry.owasp]}`
    );
    console.log(`      ${entry.what}`);
  }

  console.log('');
  console.log('  What henri does for every application, and what stays yours:');
  console.log('  https://usehenri.io/guides/security/');
  console.log('');
};

/**
 * Audit the application in the current directory
 *
 * @param {object} [args] CLI arguments (--json, --checks, --no-deps, --fail-on)
 * @returns {Promise<void>} Resolves when printed
 * @throws {CliError} USAGE on a wrong --fail-on, CHECKS_FAILED (exit 1) when a
 *   finding reaches the threshold
 */
const main = async (args = {}) => {
  const failOn = String(args['fail-on'] || 'medium').toLowerCase();

  if (!THRESHOLDS.includes(failOn)) {
    throw new CliError('USAGE', `Unknown severity "${args['fail-on']}"`, {
      hint: `--fail-on takes one of: ${THRESHOLDS.join(', ')}`,
    });
  }

  if (args.checks === true) {
    if (args.json) {
      console.log(
        JSON.stringify(
          {
            checks: CHECKS.map((entry) => ({
              ...entry,
              owasp: OWASP[entry.owasp],
            })),
            standards: STANDARDS,
          },
          null,
          2
        )
      );
    } else {
      printChecks();
    }

    return;
  }

  const report = audit(process.cwd(), { deps: args.deps !== false, failOn });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    print(report);
  }

  if (!report.ok) {
    const blocking = report.findings.filter(
      (entry) =>
        SEVERITIES.indexOf(entry.severity) >= SEVERITIES.indexOf(failOn)
    ).length;

    throw new CliError(
      'CHECKS_FAILED',
      `${blocking} finding${blocking === 1 ? '' : 's'} at ${failOn} or above`,
      { hint: 'Fix them, or lower the bar with --fail-on=high' }
    );
  }
};

module.exports = main;
module.exports.CHECKS = CHECKS;
module.exports.OWASP = OWASP;
module.exports.SEVERITIES = SEVERITIES;
module.exports.STANDARDS = STANDARDS;
module.exports.advisoriesOf = advisoriesOf;
module.exports.audit = audit;
module.exports.dependencies = dependencies;
module.exports.findings = findings;
module.exports.stripComments = stripComments;
