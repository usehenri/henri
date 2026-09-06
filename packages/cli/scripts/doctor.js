const fs = require('fs-extra');
const path = require('path');

const { APIS, PACKAGES, packagesFor } = require('./adapters');
const { CliError } = require('./errors');
const { validate } = require('@usehenri/core/src/base/config-validate');
const { controllerOf, expand, singularize } = require('./routing');
const {
  detectPackageManager,
  isProject,
  readConfig,
  readRoutes,
  resolvePackageJson,
  validInstall,
} = require('./utils');

/**
 * `henri doctor`: is this application coherent?
 *
 * **Where the line with `henri audit` is drawn.** The audit next door
 * answers what an application *chose*, against the ASVS: a protection
 * turned off, a secret committed, a record answered raw. Every finding
 * there is a decision someone made and could argue for, which is why it
 * carries a severity, a requirement and an OWASP category. `doctor` answers
 * what an application *cannot have meant*: a route naming a controller that
 * is not there, a model pointing at a store that does not exist, a job file
 * with no `perform`, a mailer with no view, an `AGENTS.md` describing a
 * renderer the configuration no longer names. Nothing is weighed here, so
 * there is no severity and no standard behind it: it is wrong, or it is
 * not. Where both could speak, the audit does -- the single
 * `security.findings` warning at the end points at it rather than repeating
 * it.
 *
 * **Nothing is booted.** Every check reads files, and the one thing that
 * would need a running application -- whether the schema in a database
 * matches the one the application would write -- is in `reach()`, behind
 * `--no-reach`, and says plainly when it could not tell.
 *
 * Every problem carries:
 *
 * - `check`, a stable name (`routes.action`, `models.store`) an agent or a
 *   script can branch on. It never changes meaning.
 * - `level`: `error` fails the command, `warning` does not.
 * - `file`, when there is one to open, and `hint`, which says what to
 *   *run*, not only what is wrong.
 * - `code`, the henri error code the boot would raise, when this check is
 *   predicting a failure the framework already has a name for
 *   (`packages/core/error-codes.json`). `null` otherwise -- a convention
 *   this command owns alone has no code, and inventing one would say the
 *   framework raises something it does not.
 *
 * A check that cannot be sure says nothing. A model whose `store` is
 * computed, a mailer that renders its own html, a `needs` naming a module
 * some third-party package may provide: all of them are left alone, because
 * a false alarm here costs more than a missing check. What makes this
 * command worth running is that its answer can be trusted.
 */

const MINIMUM_NODE = 22;

/** The adapters core can load (scripts/adapters.js is the catalogue) */
const ADAPTERS = Object.keys(APIS).sort();

/**
 * The check name a configuration problem is reported under. The schema is
 * one thing; `henri doctor` has stable check names, so an unknown adapter
 * keeps the one it has always had.
 *
 * @param {object} problem One problem of validate()
 * @returns {string} The check name
 */
const checkFor = (problem) => {
  if (problem.level === 'warning') {
    return 'config.unknown';
  }

  return /^stores\.[^.]+\.adapter$/u.test(problem.key)
    ? 'config.adapter'
    : 'config.invalid';
};

/**
 * Packages the renderers need in the app's package.json. What a store
 * needs (its adapter package, and the driver of a drizzle dialect) comes
 * from packagesFor().
 */
const NEEDS = {
  inertia: [
    '@usehenri/inertia',
    '@inertiajs/react',
    'react',
    'react-dom',
    'vite',
  ],
  react: ['@usehenri/react', 'next', 'react', 'react-dom'],
};

/** Page files a resources route needs, per renderer */
const PAGES = {
  inertia: ['index', 'new', 'show', 'edit'],
  react: ['index', 'new', 'show', 'edit'],
};

/** The extension `henri generate scaffold` writes, per renderer */
const PAGE_EXTENSION = { inertia: '.jsx', react: '.js' };

/** Either extension is accepted: a page is a page whatever it is named */
const PAGE_EXTENSIONS = ['.js', '.jsx'];

/**
 * The extensions each renderer actually resolves a page with. Next.js reads
 * both; Inertia globs `./pages/**\/*.jsx` in `app/views/main.jsx`, so a
 * `.js` page in an Inertia application is a page nothing ever finds.
 */
const RESOLVES = { inertia: ['.jsx'], react: ['.js', '.jsx'] };

/** The package each renderer's pages import from */
const RENDERER_PACKAGE = {
  inertia: '@usehenri/inertia',
  react: '@usehenri/react',
};

/**
 * The modules core registers itself (`henri.js`) and the properties a henri
 * instance already has (`base/henri.js`). A module is reached as
 * `henri.<name>`, and a name that is taken fails the boot before anything
 * starts (`HENRI_BOOT_DUPLICATE_MODULE`).
 */
const CORE_MODULES = [
  'cache',
  'config',
  'controllers',
  'encryption',
  'mail',
  'mailers',
  'model',
  'policies',
  'privacy',
  'retention',
  'router',
  'server',
  'trail',
  'user',
  'view',
  'workers',
];

/** The properties of a henri instance a module name would shadow */
const HENRI_PROPERTIES = [
  'addMiddleware',
  'analyze',
  'can',
  'changeDirectory',
  'checkApplication',
  'consoleOnly',
  'cwd',
  'env',
  'gql',
  'init',
  'isDev',
  'isProduction',
  'isTest',
  'modules',
  'pen',
  'prefix',
  'release',
  'reload',
  'reporter',
  'runlevel',
  'settings',
  'status',
  'stop',
  'utils',
  'validator',
];

/**
 * The henri packages that ship a module, and the name each one registers.
 * A package outside this table is a module doctor cannot name without
 * loading it, and it stops the `modules.needs` check rather than guessing.
 */
const PACKAGE_MODULES = {
  '@usehenri/graphql': 'graphql',
  '@usehenri/jobs': 'jobs',
  '@usehenri/uploads': 'uploads',
  '@usehenri/webhooks': 'webhooks',
};

/**
 * The jobs henri and its packages define themselves (`jobs.define()`), so a
 * recurring schedule naming one of them is not a schedule with no job
 */
const BUILTIN_JOBS = ['henri/mail', 'henri/retention', 'henri/webhook'];

/** What a mailer exports that is never an action (`2.mailers.js`) */
const MAILER_RESERVED = new Set([
  'defaults',
  'globalId',
  'identity',
  'previews',
]);

/** The extensions a mail view is looked for with (`base/mail-view.js`) */
const MAIL_EXTENSIONS = ['hbs', 'html', 'htm'];

/**
 * The blocks of the configuration that name one of `config.stores`, and the
 * code the module raises when the name is not there
 */
const STORE_KEYS = {
  jobs: 'HENRI_JOB_STORE_MISSING',
  trail: 'HENRI_TRAIL_UNSUPPORTED_STORE',
  webhooks: 'HENRI_WEBHOOK_STORE_MISSING',
};

/** Where the credentials of an environment and its key live */
const CREDENTIALS = path.join('config', 'credentials');

/** How long the shared store gets to answer before it is called unreachable */
const REACH_TIMEOUT = 3000;

/**
 * The package `config.shared` needs installed, when it names one.
 *
 * A bare adapter name is `@usehenri/<name>`, like a database store; a module
 * id or a path is the application's own business and nothing to report.
 *
 * @param {*} shared The `shared` block of the configuration
 * @returns {?string} The package name, or null
 */
const packageForShared = (shared) => {
  if (!shared || typeof shared !== 'object' || shared.enabled === false) {
    return null;
  }

  const adapter = typeof shared.adapter === 'string' ? shared.adapter : '';

  return /^[a-z][a-z0-9-]*$/.test(adapter) ? `@usehenri/${adapter}` : null;
};

/**
 * The backend constructor of a shared store adapter, resolved from the
 * application the way core resolves it (`base/shared.js`): a bare name is
 * `@usehenri/<name>` first and itself second, a dotted one is a path.
 *
 * @param {string} adapter The `config.shared.adapter` value
 * @param {string} dir The application directory
 * @returns {?Function} The constructor, or null when nothing resolves
 */
const loadShared = (adapter, dir) => {
  const ids = /^[a-z][a-z0-9-]*$/.test(adapter)
    ? [`@usehenri/${adapter}`, adapter]
    : [adapter.startsWith('.') ? path.resolve(dir, adapter) : adapter];

  for (const id of ids) {
    try {
      const loaded = require(
        require.resolve(id, { paths: [path.resolve(dir)] })
      );
      const backend = loaded && loaded.default ? loaded.default : loaded;

      if (typeof backend === 'function') {
        return backend;
      }
    } catch {
      continue;
    }
  }

  return null;
};

/**
 * The mail views henri ships with the mailers it mounts itself (the account
 * flows), read from the `@usehenri/core` of the application: an application
 * that writes `app/mailers/auth.js` gets those views for free, and reporting
 * them missing would be a false alarm.
 *
 * @param {string} dir The application directory
 * @returns {?string} The directory, or null when core is not installed
 */
const coreViews = (dir) => {
  try {
    const entry = require.resolve('@usehenri/core/src/base/mail-view', {
      paths: [path.resolve(dir)],
    });
    const views = path.resolve(path.dirname(entry), '..', 'mailers', 'views');

    return fs.existsSync(views) ? views : null;
  } catch {
    return null;
  }
};

/**
 * Is there a view for this mail, in any of the roots?
 *
 * The candidates are `base/mail-view.js`'s, in its order: the name with each
 * extension, then `<name>/index` with each.
 *
 * @param {Array<string>} roots The view directories, in order
 * @param {string} view The view name (`auth/reset`)
 * @returns {boolean} Found or not
 */
const mailView = (roots, view) => {
  const candidates = [
    ...MAIL_EXTENSIONS.map((ext) => `${view}.${ext}`),
    ...MAIL_EXTENSIONS.map((ext) => `${view}/index.${ext}`),
  ];

  return roots.some((root) =>
    candidates.some((candidate) => {
      try {
        return fs.statSync(path.join(root, candidate)).isFile();
      } catch {
        return false;
      }
    })
  );
};

/**
 * The modules the installed dependencies ship (`"henri": { "module": ... }`
 * in their package.json, the registration path of `0.modules.js`).
 *
 * `broken` is the one thing the boot has no code for: the field points at a
 * file that is not there, and `require()` fails with a bare
 * MODULE_NOT_FOUND. `unknown` says a package outside the table above ships
 * one, which is a name doctor would have to load the package to learn --
 * and the reason the `modules.needs` check then keeps quiet.
 *
 * @param {string} dir The application directory
 * @param {Array<string>} names The declared dependencies
 * @returns {{names: Set<string>, broken: Array<object>, unknown: boolean}} What they ship
 */
const packageModules = (dir, names) => {
  const found = { broken: [], names: new Set(), unknown: false };

  for (const name of names) {
    const manifest = resolvePackageJson(name, dir);
    const declared = manifest && manifest.henri;
    const entry =
      declared && typeof declared === 'object' && declared.module
        ? String(declared.module)
        : null;

    if (!entry) {
      continue;
    }

    let root;

    try {
      root = path.dirname(
        require.resolve(`${name}/package.json`, { paths: [path.resolve(dir)] })
      );
    } catch {
      // Its package.json is behind an `exports` map: the boot would fail
      // here too, and `deps.installed` is the one that says the useful thing
      continue;
    }

    if (!fs.existsSync(path.resolve(root, entry))) {
      found.broken.push({ module: entry, package: name });
      continue;
    }

    if (PACKAGE_MODULES[name]) {
      found.names.add(PACKAGE_MODULES[name]);
    } else {
      found.unknown = true;
    }
  }

  return found;
};

/**
 * What `AGENTS.md` claims the application is, from the sentence
 * `henri generate agents` writes: "renderer `inertia`, store `drizzle`"
 *
 * @param {string} source The AGENTS.md content
 * @returns {?{renderer: string, store: string}} The claim, or null
 */
const agentsClaim = (source) => {
  const match = /renderer `([\w-]+)`, store `([\w-]+)`/.exec(source);

  return match ? { renderer: match[1], store: match[2] } : null;
};

/**
 * The credentials keys of an application, as posix paths relative to it
 *
 * @param {string} dir The application directory
 * @returns {Array<string>} The key files (`config/credentials/dev.key`)
 */
const keyFiles = (dir) => {
  const folder = path.join(dir, CREDENTIALS);

  if (!fs.existsSync(folder)) {
    return [];
  }

  return fs
    .readdirSync(folder)
    .filter((name) => name.endsWith('.key'))
    .map((name) => `${CREDENTIALS}/${name}`.replace(/\\/g, '/'));
};

/**
 * Does a .gitignore cover the credentials keys? Anything that names every
 * key of the folder counts, whichever way it is written.
 *
 * @param {string} ignore The content of .gitignore
 * @returns {boolean} Covered or not
 */
const ignoresKeys = (ignore) =>
  ignore
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\//, ''))
    .some((line) =>
      ['*.key', '**/*.key', `${CREDENTIALS}/*.key`, `${CREDENTIALS}/`].includes(
        line
      )
    );

/**
 * The credentials keys git has in its index: a key that reached a commit is
 * a leaked key, whatever .gitignore says now
 *
 * @param {string} dir The application directory
 * @returns {Array<string>} The tracked key files (none without git)
 */
const trackedKeys = (dir) => {
  if (!fs.existsSync(path.join(dir, '.git'))) {
    return [];
  }

  try {
    const { execFileSync } = require('child_process');
    const listed = execFileSync(
      'git',
      ['ls-files', '--cached', '--', `${CREDENTIALS}/*.key`],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );

    return listed.split(/\r?\n/).filter((line) => line.trim() !== '');
  } catch {
    // No git binary, or not a repository: the .gitignore check stands alone
    return [];
  }
};

/**
 * Does a model name look plural? (ends with an s that is not part of
 * -ss, -us or -is: Tasks yes, Status, Address and Analysis no)
 *
 * @param {string} name A model name
 * @returns {boolean} Plural looking or not
 */
const looksPlural = (name) => /(?<![sui])s$/i.test(name);

/**
 * List the .js files of a directory, recursively, as posix paths relative
 * to it (without the extension)
 *
 * @param {string} dir The directory
 * @returns {Array<string>} The entries (`tasks`, `admin/users`)
 */
const listModules = (dir) => {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = [];

  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }

      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith('.js')) {
        entries.push(`${prefix}${entry.name.slice(0, -3)}`);
      }
    }
  };

  walk(dir, '');

  return entries.sort();
};

/**
 * The files of a directory tree with one of the given extensions, as posix
 * paths relative to it
 *
 * @param {string} dir The directory
 * @param {Array<string>} extensions The extensions to keep (`.jsx`)
 * @returns {Array<string>} The entries (`tasks/index.jsx`)
 */
const listSources = (dir, extensions) => {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = [];

  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }

      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), `${prefix}${entry.name}/`);
      } else if (extensions.includes(path.extname(entry.name))) {
        entries.push(`${prefix}${entry.name}`);
      }
    }
  };

  walk(dir, '');

  return entries.sort();
};

/**
 * Does a source import a package, by either spelling and at any sub-path?
 * (`from '@usehenri/react'`, `require('@usehenri/react/forms')`)
 *
 * @param {string} source The file source
 * @param {string} name The package name
 * @returns {boolean} Imported or not
 */
const imports = (source, name) =>
  new RegExp(
    `(?:from|require\\()\\s*\\(?\\s*['"]${name.replace(/[/@-]/g, '\\$&')}(?:/[^'"]*)?['"]`
  ).test(uncommented(source));

/**
 * Does a controller source define an action? (`show: async (req, res)`,
 * `async show(req, res)`, `show(req, res)`, `show: handler`)
 *
 * @param {string} source The controller source
 * @param {string} action The action name
 * @returns {boolean} Defined or not
 */
const definesAction = (source, action) =>
  new RegExp(`(^|[\\s,{])(async\\s+)?${action}\\s*[:(]`, 'm').test(source);

/**
 * Does a model source declare a `graphql` key?
 *
 * The types and resolvers of the models are merged and served by
 * `@usehenri/graphql`, which the application installs itself; a model that
 * declares them without it fails the boot.
 *
 * @param {string} source The model source
 * @returns {boolean} Declared or not
 */
const definesGraphql = (source) =>
  /(^|[\s,{])["']?graphql["']?\s*:/m.test(source);

/**
 * The end of the string literal that starts at `at` (the index just past
 * its closing quote), or the length of the source when it never closes
 *
 * @param {string} source The source
 * @param {number} at The index of the opening quote
 * @returns {number} The index just past the closing quote
 */
const endOfString = (source, at) => {
  const quote = source[at];
  let index = at + 1;

  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }

    if (source[index] === quote) {
      return index + 1;
    }
    index += 1;
  }

  return source.length;
};

/**
 * Comments blanked out, line numbers and offsets kept, so a scanner reads
 * code only.
 *
 * It has to know about strings to do that. A regular expression over
 * `//[^\n]*` blanks the rest of the line from the `//` inside
 * `url: 'https://example.com'`, which leaves an unterminated quote behind
 * and takes everything after it with it -- so a `store` key further down
 * the file simply stops existing, in that one application and no other.
 * That is the shape of failure this command cannot have.
 *
 * @param {string} source The file source
 * @returns {string} The source with every comment turned into spaces
 */
const uncommented = (source) => {
  const blank = (text) => text.replace(/[^\n]/g, ' ');
  const out = [];
  let at = 0;
  let kept = 0;

  while (at < source.length) {
    const char = source[at];

    if (char === '"' || char === "'" || char === '`') {
      at = endOfString(source, at);
      continue;
    }

    if (char !== '/' || (source[at + 1] !== '/' && source[at + 1] !== '*')) {
      at += 1;
      continue;
    }

    const line = source[at + 1] === '/';
    const end = line
      ? (source.indexOf('\n', at) + 1 || source.length + 1) - 1
      : (source.indexOf('*/', at + 2) + 2 || source.length + 2) - 0;
    const stop = Math.min(end, source.length);

    out.push(source.slice(kept, at), blank(source.slice(at, stop)));
    at = stop;
    kept = stop;
  }

  out.push(source.slice(kept));

  return out.join('');
};

/** A key of an object literal: `show:`, `'show':`, `show(`, `async show(` */
const KEY =
  /^\s*(?:async\s+)?(?:(['"])([^'"\n]*)\1|([A-Za-z_$][\w$]*))\s*(?=[:(])/;

/** A value written as a plain string literal, and nothing else */
const LITERAL = /^\s*(['"])([^'"\n]*)\1\s*(?=[,}])/;

/** A value shaped like a function: `(req) =>`, `async () =>`, `function` */
const CALLABLE = /^\s*(?:async\s+)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/;

/**
 * The top level keys of the `module.exports = { ... }` of a file, and what
 * each one holds.
 *
 * Model, job and mailer files are declarations, so reading them is reading
 * their top level: which store a model names, whether a job exports a
 * `perform`, which of a mailer's exports are actions. `require()`ing them
 * would be exact and would also run the application's code, load its
 * dependencies and touch whatever a file touches at import time -- which is
 * not what a command that promises to start nothing should do.
 *
 * The scan is deliberately narrow: a file that does not assign an object
 * literal to `module.exports` answers with nothing, and every check built on
 * it then stays quiet rather than guessing.
 *
 * @param {string} source The file source
 * @returns {Map<string, {kind: string, value: ?string}>} The keys, in order,
 *   with `kind` one of `string`, `function` or `other`
 */
const exportsOf = (source) => {
  const found = new Map();
  const clean = uncommented(source);
  const opening = /module\.exports\s*=\s*\{/.exec(clean);

  if (!opening) {
    return found;
  }

  let at = opening.index + opening[0].length;
  let depth = 1;
  let fresh = true;

  while (at < clean.length && depth > 0) {
    const char = clean[at];

    if (char === '"' || char === "'" || char === '`') {
      at = endOfString(clean, at);
      fresh = false;
      continue;
    }

    if (char === '{' || char === '[' || char === '(') {
      depth += 1;
      at += 1;
      fresh = false;
      continue;
    }

    if (char === '}' || char === ']' || char === ')') {
      depth -= 1;
      at += 1;
      continue;
    }

    if (char === ',' && depth === 1) {
      at += 1;
      fresh = true;
      continue;
    }

    if (/\s/.test(char)) {
      at += 1;
      continue;
    }

    const key = depth === 1 && fresh ? KEY.exec(clean.slice(at)) : null;

    if (!key) {
      fresh = false;
      at += 1;
      continue;
    }

    const name = typeof key[2] === 'string' ? key[2] : key[3];
    const after = at + key[0].length;

    if (clean[after] === '(') {
      // `async show(req, res) {}`: a method, and the loop reads its body
      found.set(name, { kind: 'function', value: null });
      at = after;
      fresh = false;
      continue;
    }

    const rest = clean.slice(after + 1);
    const literal = LITERAL.exec(rest);

    found.set(name, {
      kind: literal ? 'string' : (CALLABLE.test(rest) && 'function') || 'other',
      value: literal ? literal[2] : null,
    });
    at = after + 1;
    fresh = false;
  }

  return found;
};

/**
 * A `store` key at the left margin: the top level of a formatted file, where
 * a nested one sits at four spaces or more
 */
const TOP_LEVEL_STORE =
  /^ {0,2}["']?store["']?\s*:\s*(['"])([^'"\n]*)\1\s*[,}]?\s*$/mu;

/**
 * The store a model file names, when it names one as a literal.
 *
 * Two readings, and either one answering is enough. The scanner is the
 * precise one and knows a `store` column of the schema from the model's own
 * `store`; the second is a line at the left margin, which is where prettier
 * puts a top level key and nowhere else. A file neither can read answers
 * null, and the check then says nothing -- but a check that cannot fire is
 * worse than no check, so it takes two ways of missing rather than one.
 *
 * @param {string} source The model source
 * @returns {?string} The store name, or null when there is none to read
 */
const storeOf = (source) => {
  const store = exportsOf(source).get('store');

  if (store && store.kind === 'string') {
    return store.value;
  }

  // Only when the scanner found no `store` at all: one that found it nested
  // in the schema has already answered, and correctly
  if (store) {
    return null;
  }

  const line = TOP_LEVEL_STORE.exec(uncommented(source));

  return line ? line[2] : null;
};

/**
 * The actions of a mailer file: every top level export that is a function
 * and is not one of the keys that describe the mailer
 *
 * @param {string} source The mailer source
 * @returns {Array<string>} The action names
 */
const mailerActions = (source) =>
  [...exportsOf(source).entries()]
    .filter(
      ([name, held]) => held.kind === 'function' && !MAILER_RESERVED.has(name)
    )
    .map(([name]) => name);

/** A module's own name: `this.name = 'search'` or `name: 'search'` */
const MODULE_NAME =
  /(?:this\.name\s*=|(?:^|[\s,{])name\s*:)\s*['"]([\w./-]+)['"]/;

/** What a module says it needs: `this.needs = ['model']`, `needs: 'model'` */
const MODULE_NEEDS =
  /(?:this\.needs\s*=|(?:^|[\s,{])needs\s*:)\s*(\[[^\]]*\]|['"][\w-]+['"])/;

/**
 * What an `app/modules` file says about itself, read from its source.
 *
 * The name is the one it assigns, and the file's own name when it assigns
 * none -- which is what the loader does (`0.modules.js`, `register()`).
 *
 * @param {string} source The module source
 * @param {string} fallback The file name without its extension
 * @returns {{name: string, needs: Array<string>, named: boolean}} What it declares
 */
const moduleDeclaration = (source, fallback) => {
  const clean = uncommented(source);
  const named = MODULE_NAME.exec(clean);
  const needs = MODULE_NEEDS.exec(clean);

  return {
    name: named ? named[1] : fallback,
    named: Boolean(named),
    needs: needs
      ? [...needs[1].matchAll(/['"]([\w-]+)['"]/g)].map((match) => match[1])
      : [],
  };
};

/**
 * The policy file a name resolves to, the way `henri.policies` resolves one
 * (`3.policies.js`): lowercased, and the last segment singularized, so
 * `admin/proposals` finds `app/policies/admin/proposal.js` and never
 * borrows the policy of the `proposals` next door.
 *
 * @param {string} word A controller or policy name
 * @param {Set<string>} policies The policies that exist, as posix paths
 * @returns {?string} The policy that answers, or null
 */
const policyFor = (word, policies) => {
  const bare = String(word || '').toLowerCase();

  if (bare === '') {
    return null;
  }

  if (policies.has(bare)) {
    return bare;
  }

  const singular = policyPath(bare);

  return policies.has(singular) ? singular : null;
};

/**
 * The file `henri generate policy` writes for a controller or model name:
 * lowercased, and only the last segment singularized
 *
 * @param {string} word A controller, model or policy name
 * @returns {string} The policy path, without app/policies or .js
 */
function policyPath(word) {
  const parts = String(word || '')
    .toLowerCase()
    .split('/');

  parts[parts.length - 1] = singularize(parts[parts.length - 1]);

  return parts.join('/');
}

/**
 * Is a file ignored by a .gitignore? (whole-line match on the usual forms:
 * `.env`, `/.env`, `*.env`, `.env*`)
 *
 * @param {string} ignore The .gitignore content
 * @param {string} file The file name (ex: .env)
 * @returns {boolean} Ignored or not
 */
const ignores = (ignore, file) =>
  ignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some(
      (line) =>
        line === file ||
        line === `/${file}` ||
        line === `${file}/` ||
        line === `*${file}` ||
        line === `${file}*`
    );

/**
 * Run every check on an application directory
 *
 * @param {string} [dir=process.cwd()] The application directory
 * @returns {{ok: boolean, problems: Array<object>, summary: object}} The report
 * @throws {CliError} NOT_A_PROJECT when dir is not a henri application
 */
const check = (dir = process.cwd()) => {
  if (!isProject(dir)) {
    throw new CliError('NOT_A_PROJECT', `${dir} is not an henri project`, {
      hint: 'Run henri doctor from the root of your application',
    });
  }

  const problems = [];
  const problem = (
    level,
    name,
    message,
    { code = null, file = null, hint = null } = {}
  ) => problems.push({ check: name, code, file, hint, level, message });
  const exists = (relative) => fs.existsSync(path.join(dir, relative));
  const read = (relative) => fs.readFileSync(path.join(dir, relative), 'utf8');

  const pkg = fs.readJsonSync(path.join(dir, 'package.json'));
  const declared = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };
  const config = readConfig(dir, undefined);
  const renderer = String(config.renderer || 'react').toLowerCase();
  const models = listModules(path.join(dir, 'app', 'models'));
  const controllers = listModules(path.join(dir, 'app', 'controllers'));
  const jobs = listModules(path.join(dir, 'app', 'jobs'));
  const mailers = listModules(path.join(dir, 'app', 'mailers'));
  const policies = new Set(listModules(path.join(dir, 'app', 'policies')));
  const pm = detectPackageManager(dir);
  // Every environment's file, parsed. `config/<NODE_ENV>.json` replaces
  // `config/default.json` as a whole rather than merging into it, so each one
  // is a complete configuration and has to hold together on its own -- which
  // is what makes a store named in `production.json` alone worth checking
  // here rather than at the deploy.
  const configDir = path.join(dir, 'config');
  const configFiles = fs.existsSync(configDir)
    ? fs.readdirSync(configDir).filter((file) => file.endsWith('.json'))
    : [];
  const environments = new Map();
  const unreadable = new Map();

  for (const file of configFiles) {
    try {
      environments.set(
        `config/${file}`,
        fs.readJsonSync(path.join(configDir, file)) || {}
      );
    } catch (error) {
      unreadable.set(`config/${file}`, error.message);
    }
  }

  /** The environments that configure a store at all, as [file, stores] */
  const configured = [...environments]
    .map(([file, content]) => [file, Object.keys(content.stores || {})])
    .filter(([, named]) => named.length > 0);
  let rawRoutes = {};
  let routes = [];

  // --- node -----------------------------------------------------------------
  const major = parseInt(process.versions.node.split('.')[0], 10);

  if (major < MINIMUM_NODE) {
    problem('error', 'node.version', `Node.js ${process.version} is too old`, {
      hint: `henri needs Node.js ${MINIMUM_NODE} or newer`,
    });
  }

  // --- routes ---------------------------------------------------------------
  try {
    rawRoutes = readRoutes(dir);
    routes = expand(rawRoutes);
  } catch (error) {
    problem(
      'error',
      'routes.syntax',
      `config/routes.js cannot be loaded: ${error.message}`,
      {
        file: 'config/routes.js',
        hint: 'config/routes.js must be a CommonJS module exporting an object',
      }
    );
  }

  if (!exists('config/routes.js')) {
    problem('error', 'routes.missing', 'config/routes.js is missing', {
      file: 'config/routes.js',
      hint: "module.exports = { 'get /': 'main#home' }",
    });
  }

  // --- models ---------------------------------------------------------------
  for (const model of models) {
    const file = `app/models/${model}.js`;
    const base = path.posix.basename(model);

    if (model.includes('/')) {
      problem(
        'error',
        'models.location',
        `${file} is in a sub-folder: models live directly in app/models`,
        {
          file,
          hint: `Move it to app/models/${base}.js`,
        }
      );
      continue;
    }

    if (!/^[A-Z][A-Za-z0-9]*$/.test(base)) {
      const fixed = base.charAt(0).toUpperCase() + base.slice(1);

      problem(
        'error',
        'models.naming',
        `${file}: model files are PascalCase (the file name is the global)`,
        {
          file,
          hint: `Rename it to app/models/${fixed}.js and use the global ${fixed}`,
        }
      );
    } else if (looksPlural(base)) {
      const singular = base
        .replace(/ies$/, 'y')
        .replace(/(x|ch|sh|ss)es$/, '$1')
        .replace(/s$/, '');

      problem(
        'error',
        'models.naming',
        `${file}: model files are singular (${singular}.js, not ${base}.js)`,
        {
          file,
          hint: `Rename it to app/models/${singular}.js, the controller stays app/controllers/${base.toLowerCase()}.js`,
        }
      );
    }
  }

  // --- models -> stores -----------------------------------------------------
  // A model reaches its rows through one of `config.stores`, and the name it
  // gives has to be in the environment that boots. This is the failure that
  // happens at the worst moment: a store written in `config/dev.json` and
  // left out of `config/production.json` boots every machine but the one
  // that matters.
  //
  //
  // A model and no store anywhere is the same failure with nothing to name,
  // and it is reported rather than skipped: a check that goes quiet when its
  // inputs are not what it expected is a check nobody can rely on.
  if (models.length > 0 && configured.length === 0 && environments.size > 0) {
    problem(
      'error',
      'models.store',
      `app/models holds ${models.length} model${models.length === 1 ? '' : 's'} and no config/*.json configures a store`,
      {
        code: 'HENRI_MODEL_NO_STORE',
        file: 'config/default.json',
        hint: '{ "stores": { "default": { "adapter": "drizzle", "dialect": "sqlite", "url": "file:.henri/app.db" } } }',
      }
    );
  }

  for (const model of configured.length > 0 ? models : []) {
    const file = `app/models/${model}.js`;
    const store = storeOf(read(file));
    const without = configured
      .filter(
        ([, named]) => !named.includes(store === null ? 'default' : store)
      )
      .map(([name]) => name);

    if (without.length === 0) {
      continue;
    }

    problem(
      'error',
      'models.store',
      store === null
        ? `${file} names no store and ${without.join(', ')} has no "default" one`
        : `${file} uses the store "${store}", which ${without.join(', ')} does not hold`,
      {
        code:
          store === null ? 'HENRI_MODEL_NO_STORE' : 'HENRI_MODEL_UNKNOWN_STORE',
        file,
        hint: `An environment file replaces config/default.json whole, so every one of them needs the store: add "${store === null ? 'default' : store}" to ${without.join(', ')}, or point the model at one that is in all of them`,
      }
    );
  }

  // --- controllers ----------------------------------------------------------
  const routed = new Set(routes.map((route) => route.controller.split('#')[0]));

  for (const controller of controllers) {
    const file = `app/controllers/${controller}.js`;
    const base = path.posix.basename(controller);

    if (!/^[a-z][a-z0-9_-]*$/.test(base)) {
      problem(
        'error',
        'controllers.naming',
        `${file}: controller files are lowercase (tasks.js)`,
        {
          file,
          hint: `Rename it to app/controllers/${path.posix.dirname(controller) === '.' ? '' : `${path.posix.dirname(controller)}/`}${base.toLowerCase()}.js and update config/routes.js`,
        }
      );
    }

    if (routes.length > 0 && !routed.has(controller)) {
      problem(
        'warning',
        'controllers.unused',
        `${file} is not used by any route in config/routes.js`,
        {
          file,
          hint: `Add a route ('get /${base}': '${controller}#index') or remove it: henri destroy controller ${controller}`,
        }
      );
    }
  }

  // --- routes -> controllers, actions and pages -----------------------------
  const sources = {};
  const sourceOf = (controller) => {
    if (!(controller in sources)) {
      const file = path.join(dir, 'app', 'controllers', `${controller}.js`);

      sources[controller] = fs.existsSync(file)
        ? fs.readFileSync(file, 'utf8')
        : null;
    }

    return sources[controller];
  };
  const reported = new Set();

  for (const route of routes) {
    const [controller, action] = route.controller.split('#');
    const key = `${route.verb} ${route.route}`;
    const source = sourceOf(controller);

    if (source === null) {
      if (!reported.has(controller)) {
        reported.add(controller);
        problem(
          'error',
          'routes.controller',
          `"${key}" points to "${controller}" but app/controllers/${controller}.js does not exist`,
          {
            file: 'config/routes.js',
            hint: `henri generate controller ${controller} ${action}, or remove the route: henri destroy route "${key}"`,
          }
        );
      }
      continue;
    }

    if (
      source.includes('module.exports = {') &&
      !definesAction(source, action)
    ) {
      problem(
        'error',
        'routes.action',
        `app/controllers/${controller}.js does not define "${action}" (route "${key}")`,
        {
          file: `app/controllers/${controller}.js`,
          hint: `Add \`${action}: async (req, res) => {}\` to the controller or remove the route`,
        }
      );
    }
  }

  for (const [key, value] of Object.entries(rawRoutes)) {
    const [verb] = key.trim().split(/\s+/);
    const kind = verb.toLowerCase();

    if (
      !['resources', 'crud'].includes(kind) ||
      value === null ||
      typeof value === 'undefined'
    ) {
      continue;
    }

    const controller = controllerOf(value);

    if (controller && !looksPlural(path.posix.basename(controller))) {
      problem(
        'warning',
        'controllers.plural',
        `"${key}": ${kind} controllers are plural (app/controllers/${controller}s.js)`,
        {
          file: 'config/routes.js',
          hint: `henri generate scaffold <Name> writes the plural for you`,
        }
      );
    }

    if (kind !== 'resources' || !PAGES[renderer] || !controller) {
      continue;
    }

    const actions = new Set(
      routes
        .filter((route) => route.controller.startsWith(`${controller}#`))
        .map((route) => route.controller.split('#')[1])
    );

    for (const page of PAGES[renderer]) {
      if (!actions.has(page)) {
        continue;
      }

      // Whether a file is there at all. Whether it is one the renderer
      // resolves is `views.renderer`, which walks every page below rather
      // than only the ones a route names
      const found = PAGE_EXTENSIONS.some((ext) =>
        exists(`app/views/pages/${controller}/${page}${ext}`)
      );

      if (!found) {
        problem(
          'error',
          'views.pages',
          `"${key}" renders app/views/pages/${controller}/${page}${PAGE_EXTENSION[renderer] || '.js'} which does not exist`,
          {
            file: `app/views/pages/${controller}`,
            hint: `henri generate scaffold ${path.posix.basename(controller).replace(/s$/, '')} --force rewrites the pages`,
          }
        );
      }
    }
  }

  // --- views -> renderer ----------------------------------------------------
  // The other half of the same question: a page written for the engine the
  // configuration does not name. `withHenri` from `@usehenri/react` reads
  // `req._henri` on a next.js page and there is nothing to read it in an
  // Inertia app, and `useHenri` from `@usehenri/inertia` is not a thing a
  // next.js page can call -- so the import alone says which engine the page
  // was written for, and the renderer says which one will render it.
  //
  // The extension is the other half, and the quieter one: the Inertia engine
  // resolves a page through `import.meta.glob('./pages/**/*.jsx')` in
  // app/views/main.jsx, so a `.js` file under app/views/pages is a page
  // nothing ever finds -- no error, no log line, a 404 or a blank render.
  // Every file there is walked, not only the ones a `resources` route names,
  // because that is exactly where such a page hides.
  const theirs = RENDERER_PACKAGE[renderer === 'inertia' ? 'react' : 'inertia'];
  const ours = RENDERER_PACKAGE[renderer];
  const resolves = RESOLVES[renderer];

  for (const page of ours
    ? listSources(path.join(dir, 'app', 'views', 'pages'), PAGE_EXTENSIONS)
    : []) {
    const file = `app/views/pages/${page}`;
    const other = renderer === 'inertia' ? 'react' : 'inertia';

    if (resolves && !resolves.includes(path.extname(page))) {
      problem(
        'error',
        'views.renderer',
        `${file} is a page the ${renderer} engine does not resolve (it reads ${resolves.join(' and ')})`,
        {
          file,
          hint: `Rename it to ${page.replace(/\.[^.]+$/u, PAGE_EXTENSION[renderer])}. app/views/main.jsx globs pages/**/*${PAGE_EXTENSION[renderer]}, so this file is never loaded and never says so; a component that is not a page belongs in app/views/components`,
        }
      );
      continue;
    }

    if (!imports(read(file), theirs)) {
      continue;
    }

    problem(
      'error',
      'views.renderer',
      `${file} imports ${theirs} and the configured renderer is "${renderer}"`,
      {
        file,
        hint: `Rewrite it for ${ours}, or set "renderer": "${other}" in the configuration. henri generate scaffold <Name> --force writes the pages of the renderer this application names`,
      }
    );
  }

  // --- routes -> policies ---------------------------------------------------
  // `policy: true` registers the policy guard next to the role guard, and a
  // guard with no policy behind it refuses every request: `henri.policies`
  // fails closed, so a missing file is a route nobody can reach rather than
  // a route nobody guards. The router says so once, in a log line, at the
  // moment the first request is refused.
  const missingPolicies = new Set();

  for (const route of routes) {
    const wanted =
      route.policy === true ? route.controller.split('#')[0] : route.policy;

    if (typeof wanted !== 'string' || wanted === '') {
      continue;
    }

    if (policyFor(wanted, policies) === null && !missingPolicies.has(wanted)) {
      missingPolicies.add(wanted);
      problem(
        'error',
        'routes.policy',
        `a route asks for the "${wanted}" policy and app/policies/${policyPath(wanted)}.js does not exist`,
        {
          file: 'config/routes.js',
          hint: `henri generate policy ${singularize(path.posix.basename(wanted))}, or drop "policy" from the route: a policy that is not there refuses every request`,
        }
      );
    }
  }

  // --- configuration --------------------------------------------------------
  if (!configFiles.includes('default.json')) {
    problem('error', 'config.missing', 'config/default.json is missing', {
      file: 'config/default.json',
      hint: '{ "stores": { "default": { "adapter": "disk" } }, "renderer": "react" }',
    });
  }

  for (const [file, message] of unreadable) {
    problem('error', 'config.syntax', `${file} is not valid JSON: ${message}`, {
      file,
    });
  }

  for (const [file, content] of environments) {
    if (typeof content.secret !== 'undefined') {
      problem('error', 'config.secret', `${file} contains "secret"`, {
        file,
        hint: 'Move it to HENRI_SECRET in .env (ignored by git) and delete the key',
      });
    }

    // The schema of @usehenri/core, the one the boot runs: an application
    // never learns of a wrong key by booting when `henri doctor` can say it
    for (const entry of validate(content, { source: () => file }).problems) {
      problem(entry.level, checkFor(entry), `${file}: ${entry.message}`, {
        file,
        hint:
          entry.hint ||
          (checkFor(entry) === 'config.adapter'
            ? `Adapters: ${ADAPTERS.join(', ')}`
            : null),
      });
    }

    // The queue, the outbound webhooks and the access trail each own a
    // table in one of the application's stores and name it by hand. The
    // schema says the value is a string; only this file says whether the
    // string is one of the names next to it.
    const named = Object.keys(content.stores || {});

    for (const [key, failure] of Object.entries(STORE_KEYS)) {
      const block = content[key];
      const wanted = block && typeof block === 'object' ? block.store : null;

      if (typeof wanted !== 'string' || named.includes(wanted)) {
        continue;
      }

      problem(
        'error',
        'config.store',
        `${file}: "${key}.store" is "${wanted}", which is not one of its stores`,
        {
          code: failure,
          file,
          hint: `Name one of ${named.map((name) => `"${name}"`).join(', ') || 'the stores of this file'}, or leave "store" out to use the default one`,
        }
      );
    }
  }

  // --- schema ---------------------------------------------------------------
  // Whether an application has any way of changing the schema of a live
  // database. Drift itself needs a connection and belongs to `henri
  // db:status`; what the files know is which mechanism each store has, and
  // whether the migrations that are written will ever run.
  const migrationsDir = path.join(dir, 'db', 'migrations');
  const written =
    fs.existsSync(migrationsDir) &&
    fs.readdirSync(migrationsDir).some((entry) => entry.endsWith('.sql'));
  const production = readConfig(dir, 'production');

  for (const [name, store] of Object.entries(config.stores || {})) {
    const api = APIS[store && store.adapter];

    if (api === 'sequelize' && written) {
      problem(
        'error',
        'schema.migrations-ignored',
        `db/migrations holds migrations and store "${name}" (${store.adapter}) cannot apply them`,
        {
          file: 'db/migrations',
          hint: 'db/migrations is the drizzle adapter\'s. A Sequelize store creates the tables that are missing and never alters one: run "henri db:status" to see what drifted, or move the store to "adapter": "drizzle"',
        }
      );
    }

    if (api !== 'drizzle' || !written) {
      continue;
    }

    const deployed = (production.stores || {})[name] || {};

    if (deployed.migrate !== true) {
      problem(
        'warning',
        'schema.migrations-pending',
        `store "${name}" does not apply db/migrations on a production boot`,
        {
          // Only when there is one to open: this check reads the production
          // configuration whether or not the file exists, and pointing at a
          // path that is not there reads as "create it", which is the wrong
          // move (see the hint)
          file: exists('config/production.json')
            ? 'config/production.json'
            : null,
          hint: exists('config/production.json')
            ? `Run "henri db:migrate" as part of the deploy, or set "stores": { "${name}": { "migrate": true } } in config/production.json`
            : `Run "henri db:migrate" as part of the deploy. The other way is "migrate": true on the store in config/production.json -- and that file does not exist here: it would replace config/default.json whole rather than merge into it, so it has to carry the entire "stores" block, not the flag alone`,
        }
      );
    }
  }

  // --- secrets --------------------------------------------------------------
  const hasEnv = exists('.env');
  const hasIgnore = exists('.gitignore');

  if (!hasEnv) {
    problem('warning', 'env.missing', '.env is missing', {
      file: '.env',
      hint: 'Write HENRI_SECRET=<64 random hex characters> in .env; it signs the sessions once a User model exists',
    });
  } else if (!/^\s*(export\s+)?HENRI_SECRET\s*=\s*\S+/m.test(read('.env'))) {
    problem('warning', 'env.secret', '.env does not set HENRI_SECRET', {
      file: '.env',
      hint: 'HENRI_SECRET=<64 random hex characters>',
    });
  }

  if (!hasIgnore) {
    problem('warning', 'git.ignore', '.gitignore is missing', {
      file: '.gitignore',
      hint: 'Ignore at least .env, node_modules, .henri, .backup and .next',
    });
  } else {
    const ignore = read('.gitignore');

    if (hasEnv && !ignores(ignore, '.env')) {
      problem('error', 'env.ignored', '.env is not ignored by git', {
        file: '.gitignore',
        hint: 'Add a ".env" line to .gitignore (the secret must never be committed)',
      });
    }

    for (const folder of ['.henri', '.backup']) {
      if (!ignores(ignore, folder)) {
        problem('warning', 'git.ignore', `${folder} is not ignored by git`, {
          file: '.gitignore',
          hint: `Add a "${folder}/" line to .gitignore`,
        });
      }
    }
  }

  // --- credentials ----------------------------------------------------------
  for (const key of keyFiles(dir)) {
    if (!hasIgnore || !ignoresKeys(read('.gitignore'))) {
      problem('error', 'credentials.ignored', `${key} is not ignored by git`, {
        file: '.gitignore',
        hint: 'Add a "config/credentials/*.key" line: the key opens every secret of that environment',
      });
    }
  }

  for (const key of trackedKeys(dir)) {
    problem('error', 'credentials.committed', `${key} is committed`, {
      file: key,
      hint: `Remove it from the repository (git rm --cached ${key}), rotate the secrets it holds and write them again with henri credentials:edit`,
    });
  }

  // --- jobs -----------------------------------------------------------------
  // A file of app/jobs is a job, and the queue says so at boot: the module
  // loads every one of them before it starts, so a file that exports no
  // `perform` takes the whole application down rather than one job.
  const jobNames = new Set([...jobs, ...BUILTIN_JOBS]);

  for (const job of jobs) {
    const file = `app/jobs/${job}.js`;
    const perform = exportsOf(read(file)).get('perform');

    if (perform && perform.kind !== 'function') {
      continue;
    }

    if (!perform) {
      problem(
        'error',
        'jobs.perform',
        `${file} exports no perform(args, context) function`,
        {
          code: 'HENRI_JOB_INVALID_DEFINITION',
          file,
          hint: `module.exports = { queue: 'default', perform: async (args, context) => {} }, or remove the file: the queue loads every file of app/jobs at boot`,
        }
      );
    }
  }

  // A schedule naming a job that is not there is the quiet one: nothing
  // fails, the runner logs once and the work simply never happens.
  for (const [name, entry] of Object.entries(
    (config.jobs && config.jobs.recurring) || {}
  )) {
    const wanted =
      (entry && (entry.job || entry.name)) ||
      (typeof entry === 'object' ? name : null);

    if (typeof wanted !== 'string' || jobNames.has(wanted)) {
      continue;
    }

    problem(
      'error',
      'jobs.recurring',
      `the recurring schedule "${name}" runs the job "${wanted}", and app/jobs/${wanted}.js does not exist`,
      {
        code: 'HENRI_JOB_INVALID_SCHEDULE',
        file: 'config/default.json',
        hint: `henri generate job ${wanted}, or fix the name: a schedule naming a job that is not there is skipped with one log line and never runs`,
      }
    );
  }

  // --- mailers --------------------------------------------------------------
  // A mailer action renders app/views/mailers/<mailer>/<action>; the view is
  // read when the message is built, so a missing one fails the request that
  // sends the mail -- a signup, a password reset -- and nothing before it.
  const mailRoots = [path.join(dir, 'app', 'views', 'mailers')];
  const builtinViews = coreViews(dir);

  if (builtinViews) {
    mailRoots.push(builtinViews);
  }

  for (const mailer of mailers) {
    const file = `app/mailers/${mailer}.js`;
    const source = read(file);

    // An action that hands back its own html, or names its own view, is
    // outside what a file can tell: the whole mailer is left alone
    if (/(^|[\s,{])["']?(html|view)["']?\s*:/m.test(source)) {
      continue;
    }

    for (const action of mailerActions(source)) {
      const view = `${mailer}/${action}`;

      if (mailView(mailRoots, view)) {
        continue;
      }

      problem(
        'error',
        'mailers.view',
        `${file}: the "${action}" action has no view (app/views/mailers/${view}.hbs)`,
        {
          code: 'HENRI_MAIL_VIEW_MISSING',
          file,
          hint: `Write app/views/mailers/${view}.hbs. A <action>.text.hbs next to it replaces the plain text part, which is derived from the html otherwise`,
        }
      );
    }
  }

  // --- modules --------------------------------------------------------------
  // The boot builds a graph before anything starts: a name taken twice and a
  // `needs` nobody answers both stop it, with nothing running.
  const appModules = listModules(path.join(dir, 'app', 'modules')).filter(
    (name) => !name.includes('/')
  );
  const shipped = packageModules(dir, Object.keys(declared));

  for (const file of shipped.broken) {
    problem(
      'error',
      'modules.package',
      `${file.package} ships a module (${file.module}) and the file is not there`,
      {
        file: 'package.json',
        hint: `Reinstall it (${pm} install): the boot requires that file by name and fails with no henri code of its own when it is missing`,
      }
    );
  }

  const declaredModules = new Map();

  for (const name of appModules) {
    const file = `app/modules/${name}.js`;
    const {
      name: identity,
      named,
      needs,
    } = moduleDeclaration(read(file), name);
    const taken =
      CORE_MODULES.includes(identity) ||
      HENRI_PROPERTIES.includes(identity) ||
      shipped.names.has(identity) ||
      declaredModules.has(identity);

    if (taken) {
      problem(
        'error',
        'modules.name',
        `${file} registers the module "${identity}", and that name is taken`,
        {
          code: 'HENRI_BOOT_DUPLICATE_MODULE',
          file,
          hint: named
            ? `Rename it: a module is reached as henri.${identity}, so the name has to be free`
            : `A module with no name of its own takes the file name: rename the file, or set this.name in it`,
        }
      );
      continue;
    }

    declaredModules.set(identity, { file, needs });
  }

  // A `needs` is what a module cannot work without, and the graph refuses to
  // start on one nothing provides. Unknown packages may register a module of
  // their own, and then doctor cannot tell: it says nothing at all.
  const provided = new Set([
    ...CORE_MODULES,
    ...shipped.names,
    ...declaredModules.keys(),
  ]);

  for (const [identity, module] of shipped.unknown ? [] : declaredModules) {
    for (const wanted of module.needs) {
      if (provided.has(wanted)) {
        continue;
      }

      problem(
        'error',
        'modules.needs',
        `${module.file}: the "${identity}" module needs "${wanted}", which nothing provides`,
        {
          code: 'HENRI_BOOT_MISSING_DEPENDENCY',
          file: module.file,
          hint: `Install the package that registers it, or use "after" instead of "needs": henri orders on an "after" it cannot satisfy and refuses to start on a "needs" it cannot`,
        }
      );
    }
  }

  // --- agents, tests --------------------------------------------------------
  if (!exists('AGENTS.md')) {
    problem(
      'warning',
      'agents.missing',
      'AGENTS.md is missing (the conventions coding agents read)',
      {
        file: 'AGENTS.md',
        hint: 'henri generate agents',
      }
    );
  } else {
    // AGENTS.md is what a coding agent reads instead of guessing, and it
    // states two things the configuration can be compared with: which
    // renderer the pages are written for, and which store's model API the
    // controllers use. Both are what the generators follow, so a file that
    // still names the old one sends every generated file the wrong way.
    const claim = agentsClaim(read('AGENTS.md'));
    const adapter = String(
      (
        (config.stores || {}).default ||
        Object.values(config.stores || {})[0] ||
        {}
      ).adapter || ''
    ).toLowerCase();
    const wrong = claim
      ? [
          claim.renderer === renderer
            ? null
            : `the renderer is "${renderer}" and AGENTS.md says "${claim.renderer}"`,
          adapter === '' || claim.store === adapter
            ? null
            : `the default store is "${adapter}" and AGENTS.md says "${claim.store}"`,
        ].filter(Boolean)
      : [];

    if (wrong.length > 0) {
      problem(
        'warning',
        'agents.stale',
        `AGENTS.md is out of date: ${wrong.join(', ')}`,
        {
          file: 'AGENTS.md',
          hint: 'henri generate agents --force rewrites it from the configuration. Until it does, an agent reading it writes pages and controllers this application cannot run',
        }
      );
    }
  }

  if (!exists('vitest.config.js')) {
    problem(
      'warning',
      'tests.config',
      'vitest.config.js is missing: henri test cannot run',
      {
        file: 'vitest.config.js',
        hint: 'Copy vitest.config.js from a fresh henri app (setupFiles: @usehenri/testing/setup-file) and add vitest + @usehenri/testing to devDependencies',
      }
    );
  }

  // --- dependencies ---------------------------------------------------------
  const needed = new Set(['@usehenri/core']);

  for (const name of NEEDS[renderer] || []) {
    needed.add(name);
  }

  // Every environment's stores, not only the one this command reads: a
  // `config/production.json` naming an adapter nothing installed is a boot
  // that fails on the deploy and nowhere before it
  const adapterEnvironment = new Map();

  for (const [file, content] of environments) {
    for (const store of Object.values(content.stores || {})) {
      for (const name of packagesFor(store)) {
        needed.add(name);

        if (!adapterEnvironment.has(name)) {
          adapterEnvironment.set(name, file);
        }
      }
    }
  }

  // The GraphQL engine is a package of its own: a model that declares types
  // and resolvers, or a configured endpoint, needs it installed
  if (
    typeof config.graphql !== 'undefined' ||
    models.some((model) => definesGraphql(read(`app/models/${model}.js`)))
  ) {
    needed.add('@usehenri/graphql');
  }

  // So is the queue: a job in app/jobs, or a configured jobs block, needs it
  if (
    typeof config.jobs !== 'undefined' ||
    listModules(path.join(dir, 'app', 'jobs')).length > 0
  ) {
    needed.add('@usehenri/jobs');
  }

  // And so is the multipart parser: an `uploads` block says an application
  // means to accept a file, and without the package nothing reads one
  if (config.uploads !== false && typeof config.uploads !== 'undefined') {
    needed.add('@usehenri/uploads');
  }

  // And so are the outbound webhooks. They deliver through the queue, so a
  // `webhooks` block needs both packages: without the queue the endpoints
  // can be managed and nothing can be sent
  if (typeof config.webhooks !== 'undefined') {
    needed.add('@usehenri/webhooks');
    needed.add('@usehenri/jobs');
  }

  // And so is the shared store: `config.shared` names an adapter the way a
  // database store does, and `redis` means `@usehenri/redis`
  const sharedPackage = packageForShared(config.shared);

  if (sharedPackage) {
    needed.add(sharedPackage);
  }

  const undeclared = [...needed].filter((name) => !declared[name]);

  if (undeclared.length > 0) {
    // Name the file that asked, when one of them is an adapter only another
    // environment configures: "install @usehenri/postgresql" reads very
    // differently once it says which config/*.json wants it
    const asked = undeclared
      .map((name) => adapterEnvironment.get(name))
      .filter((file) => file && file !== 'config/default.json');

    problem(
      'error',
      'deps.declared',
      `package.json does not depend on ${undeclared.join(', ')}${asked.length > 0 ? ` (${[...new Set(asked)].join(', ')} asks for it)` : ''}`,
      {
        code: undeclared.every((name) => adapterEnvironment.has(name))
          ? 'HENRI_STORE_ADAPTER_NOT_INSTALLED'
          : null,
        file: 'package.json',
        hint: `${pm === 'npm' ? 'npm install --save' : `${pm} add`} ${undeclared.join(' ')}`,
      }
    );
  }

  if (!exists('node_modules')) {
    problem(
      'warning',
      'deps.installed',
      'node_modules is missing: the dependencies are not installed',
      {
        hint: `${pm} install`,
      }
    );
  } else {
    const missing = [...needed].filter(
      (name) => declared[name] && !resolvePackageJson(name, dir)
    );

    if (missing.length > 0) {
      problem(
        'warning',
        'deps.installed',
        `${missing.join(', ')} declared in package.json but not installed`,
        {
          hint: `${pm} install`,
        }
      );
    }

    // The henri packages are released together, one version for all of them
    // (the `fixed` group of .changeset/config.json), so two versions in one
    // node_modules is a half-finished upgrade: `henri` running one command
    // set against another core, or an adapter built against an older model.
    // What that produces at runtime is a TypeError deep in a package, which
    // is the least useful place to start reading.
    const versions = new Map();

    for (const name of Object.keys(declared).sort()) {
      if (name !== 'henri' && !name.startsWith('@usehenri/')) {
        continue;
      }

      const manifest = resolvePackageJson(name, dir);
      const version = manifest && manifest.version;

      if (typeof version === 'string' && version !== '') {
        versions.set(name, version);
      }
    }

    const spread = [...new Set(versions.values())];

    if (spread.length > 1) {
      problem(
        'warning',
        'deps.version',
        `the henri packages installed are not at one version: ${[...versions].map(([name, version]) => `${name} ${version}`).join(', ')}`,
        {
          file: 'package.json',
          hint: `They are published together, so they are meant to match. Line the ranges up in package.json and run ${pm} install`,
        }
      );
    }
  }

  // --- security -------------------------------------------------------------
  // The static half of `henri audit`: no network, no subprocess beyond the
  // one doctor already runs. Only the count is reported, because the
  // findings carry a severity and an OWASP category that this report has no
  // column for -- and because a warning nobody can act on is noise.
  const security = require('./audit').findings(dir);

  if (security.length > 0) {
    const worst = security[0].severity;

    problem(
      'warning',
      'security.findings',
      `${security.length} security finding${security.length === 1 ? '' : 's'} (worst: ${worst})`,
      {
        file: security[0].file,
        hint: 'henri audit lists them with their OWASP category and how to fix them',
      }
    );
  }

  const errors = problems.filter((entry) => entry.level === 'error').length;

  return {
    ok: errors === 0,
    problems,
    summary: {
      controllers: controllers.length,
      errors,
      models: models.length,
      renderer,
      routes: routes.length,
      warnings: problems.length - errors,
    },
  };
};

/**
 * Print the report as text
 *
 * @param {object} report The report from check()
 * @returns {void}
 */
const print = ({ problems, summary }) => {
  const { errors, warnings } = summary;
  const count = (number, word) => `${number} ${word}${number === 1 ? '' : 's'}`;

  console.log('');

  if (problems.length === 0) {
    console.log(
      `  henri doctor: no problems found (${count(summary.models, 'model')}, ${count(summary.controllers, 'controller')}, ${count(summary.routes, 'route')})`
    );
    console.log('');

    return;
  }

  console.log(
    `  henri doctor: ${count(problems.length, 'problem')} (${count(errors, 'error')}, ${count(warnings, 'warning')})`
  );
  console.log('');

  for (const entry of problems) {
    console.log(
      `  ${entry.level.padEnd(8)} ${entry.check.padEnd(20)} ${entry.file || ''}`
    );
    console.log(`           ${entry.message}`);

    if (entry.hint) {
      console.log(`           -> ${entry.hint}`);
    }

    // The code the boot would raise, when this is a failure henri has a
    // name for: the same string `henri <command>` and the MCP server print
    if (entry.code) {
      console.log(`           ${entry.code}`);
    }
    console.log('');
  }
};

/**
 * Add one problem to a report that has already been counted
 *
 * @param {object} report The report from check()
 * @param {object} entry The problem
 * @returns {object} The report
 */
const append = (report, entry) => {
  report.problems.push(Object.assign({ code: null, file: null }, entry));
  report.summary[entry.level === 'error' ? 'errors' : 'warnings'] =
    (report.summary[entry.level === 'error' ? 'errors' : 'warnings'] || 0) + 1;

  if (entry.level === 'error') {
    report.ok = false;
  }

  return report;
};

/**
 * Give up on a promise after a bound
 *
 * @param {Promise} promise What to wait for
 * @param {number} ms How long
 * @param {string} what What timed out, for the message
 * @returns {Promise} Resolves with the promise, or rejects on the bound
 */
const within = (promise, ms, what) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what} did not answer within ${ms}ms`)),
      ms
    );

    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

/**
 * A henri instance the size of what a store adapter reads from one.
 *
 * The adapters take `(name, config, henri)` and use it for four things:
 * where the application is, how to log, whether this is production, and the
 * configuration of the tables henri owns. None of that needs a boot, which
 * is what lets this command ask a store a question without starting one.
 *
 * @param {string} dir The application directory
 * @param {object} config The application configuration
 * @returns {object} Something shaped enough like henri
 */
const standalone = (dir, config) => {
  const at = (key) =>
    String(key)
      .split('.')
      .reduce(
        (value, part) =>
          value === null || typeof value !== 'object' ? undefined : value[part],
        config
      );

  return {
    config: { get: at, has: (key) => typeof at(key) !== 'undefined' },
    cwd: () => path.resolve(dir),
    isDev: false,
    isProduction: false,
    isTest: false,
    pen: {
      debug: () => null,
      error: () => null,
      fatal: (name, message) => new Error(String(message)),
      info: () => null,
      log: () => null,
      warn: () => null,
    },
  };
};

/**
 * The adapter class of a store, resolved from the application the way core
 * resolves it (`3.model.js`, `utils.resolveFrom`)
 *
 * @param {*} adapter The `adapter` of a store block
 * @param {string} dir The application directory
 * @returns {?Function} The constructor, or null when it is not installed
 */
const loadAdapter = (adapter, dir) => {
  const name = PACKAGES[String(adapter || '').toLowerCase()];

  if (!name) {
    return null;
  }

  try {
    const loaded = require(
      require.resolve(name, { paths: [path.resolve(dir)] })
    );
    const Adapter = loaded && loaded.default ? loaded.default : loaded;

    return typeof Adapter === 'function' ? Adapter : null;
  } catch {
    return null;
  }
};

/**
 * Are the migrations that are written applied in the database?
 *
 * This is the one question `henri doctor` asks a database, and the shape of
 * the answer is the point. Drift -- what a database and the models disagree
 * about, column by column -- is a live comparison against the models
 * (`adapter.drift()`), and it needs the models loaded and the application
 * booted: that is `henri db:status`, and this command does not do it. What
 * it can be sure of is the half that is a history rather than a comparison:
 * whether the store answers at all, and whether the migrations in
 * `db/migrations` have been applied to it.
 *
 * So there are three answers here and never a fourth. The store answered
 * and is up to date: nothing is said. It answered and is behind:
 * `schema.behind`, with the number and `henri db:migrate`. It did not
 * answer: `schema.unreachable`, which says that doctor could not tell --
 * because a store that is down and a store that is behind are different
 * problems with different fixes, and reporting one as the other is exactly
 * the false alarm that would make this command not worth running.
 *
 * Nothing is written: `HENRI_SKIP_SYNC` is set for the length of the call,
 * which is what stops a development boot's schema push from happening
 * inside a read-only command.
 *
 * @param {string} dir The application directory
 * @param {object} report The report from check()
 * @returns {Promise<object>} The report, with what it found appended
 */
const schema = async (dir, report) => {
  const config = readConfig(dir, undefined) || {};
  const folder = path.join(dir, 'db', 'migrations');
  const written =
    fs.existsSync(folder) &&
    fs.readdirSync(folder).some((entry) => entry.endsWith('.sql'));

  // Without a migration written, "behind" means nothing: a store with no
  // history to be behind of is a development schema, which the boot pushes
  if (!written) {
    return report;
  }

  const skip = process.env.HENRI_SKIP_SYNC;

  process.env.HENRI_SKIP_SYNC = 'true';

  try {
    for (const [name, store] of Object.entries(config.stores || {})) {
      await behind(dir, report, name, store);
    }
  } finally {
    if (typeof skip === 'undefined') {
      delete process.env.HENRI_SKIP_SYNC;
    } else {
      process.env.HENRI_SKIP_SYNC = skip;
    }
  }

  return report;
};

/**
 * Ask one store whether it is behind (see schema())
 *
 * @param {string} dir The application directory
 * @param {object} report The report from check()
 * @param {string} name The store name
 * @param {object} store The store block of the configuration
 * @returns {Promise<void>} Resolves when asked
 */
const behind = async (dir, report, name, store) => {
  const Adapter = loadAdapter(store && store.adapter, dir);

  // Not installed is `deps.declared` and `deps.installed`, which have
  // already said so in the vocabulary a person can act on. The same goes
  // for the driver: a store whose driver is missing has not answered
  // because nothing could ask, which is not the same as a store that is down
  const ready =
    Adapter !== null &&
    packagesFor(store).every((needed) => resolvePackageJson(needed, dir));

  if (!ready) {
    return;
  }

  let adapter;

  try {
    adapter = new Adapter(
      name,
      Object.assign({}, store, {
        pool: Object.assign(
          {
            connectTimeout: REACH_TIMEOUT,
            connectionTimeoutMillis: REACH_TIMEOUT,
          },
          store.pool || {}
        ),
      }),
      standalone(dir, readConfig(dir, undefined) || {})
    );
  } catch {
    // An unusable store block: `config.invalid` owns that answer
    return;
  }

  // A store that keeps no migration history is compared with the models
  // instead, which needs them loaded: `henri db:status` is that command
  if (!adapter.migrations) {
    return;
  }

  try {
    await within(adapter.start(), REACH_TIMEOUT, `store ${name}`);

    const { pending } = await within(
      adapter.migrations.status(),
      REACH_TIMEOUT,
      `store ${name}`
    );

    if (pending.length > 0) {
      append(report, {
        check: 'schema.behind',
        file: 'db/migrations',
        hint: `henri db:migrate applies them, and "stores": { "${name}": { "migrate": true } } in config/production.json applies them on a production boot. henri db:status lists them`,
        level: 'warning',
        message: `store "${name}" is behind db/migrations by ${pending.length} migration${pending.length === 1 ? '' : 's'} (${pending.join(', ')})`,
      });
    }
  } catch (error) {
    append(report, {
      check: 'schema.unreachable',
      file: 'config',
      hint: `Start it, or fix the store url. Until it answers, henri doctor cannot tell whether the schema it holds is the one the models describe: henri db:status compares them once it is up`,
      level: 'warning',
      message: `could not tell whether store "${name}" matches db/migrations: ${error.message}`,
    });
  } finally {
    if (adapter && typeof adapter.stop === 'function') {
      await within(
        Promise.resolve(adapter.stop()),
        REACH_TIMEOUT,
        `store ${name}`
      ).catch(() => false);
    }
  }
};

/**
 * Ask the shared store whether it is there.
 *
 * The rest of `henri doctor` reads files and starts nothing, and this is the
 * one exception, on purpose: an application that names `config.shared` has
 * said its counters live somewhere else, and whether that somewhere answers
 * is exactly the kind of thing this command is asked. It is one connection
 * with a three second bound, and `--no-reach` skips it.
 *
 * The application is not booted: the adapter is constructed from the block
 * alone, the way core would, and closed again.
 *
 * @param {string} dir The application directory
 * @param {object} report The report from check()
 * @returns {Promise<object>} The report, with what it found appended
 */
const shared = async (dir, report) => {
  const block = (readConfig(dir, undefined) || {}).shared;

  if (!block || typeof block !== 'object' || block.enabled === false) {
    return report;
  }

  const adapter = typeof block.adapter === 'string' ? block.adapter : '';

  if (adapter === '') {
    return report;
  }

  const Backend = loadShared(adapter, dir);

  // Not installed is `deps.declared`, which has already said so: reporting
  // it twice, in two vocabularies, helps nobody
  if (!Backend) {
    return report;
  }

  let backend = null;

  try {
    backend = new Backend(
      Object.assign({ connectTimeout: REACH_TIMEOUT }, block),
      null
    );
    await backend.start();
    await backend.ping();
  } catch (error) {
    append(report, {
      check: 'shared.unreachable',
      file: 'config',
      hint: 'Start it, or fix config.shared. Until it answers, the rate limit, the sign-in lockout and the idempotency keys follow config.shared.onError -- "closed" refuses every guarded request',
      level: 'warning',
      message: `the shared store (${adapter}) did not answer: ${error.message}`,
    });
  } finally {
    backend &&
      typeof backend.stop === 'function' &&
      (await Promise.resolve(backend.stop()).catch(() => false));
  }

  return report;
};

/**
 * The two questions `henri doctor` asks something outside its own files:
 * whether the shared store answers, and whether the database holds the
 * migrations that are written. Both are bounded, both are skipped by
 * `--no-reach`, and both say when they could not tell.
 *
 * @param {string} dir The application directory
 * @param {object} report The report from check()
 * @returns {Promise<object>} The report, with what they found appended
 */
const reach = async (dir, report) => {
  await shared(dir, report);
  await schema(dir, report);

  return report;
};

/**
 * Check the application in the current directory
 *
 * @param {object} [args] CLI arguments (--json prints the report as JSON)
 * @returns {Promise<void>} Resolves when printed
 * @throws {CliError} CHECKS_FAILED (exit 1) when a problem is found
 */
const main = async (args = {}) => {
  validInstall({ fatal: true });

  const report = check(process.cwd());

  if (args.reach !== false) {
    await reach(process.cwd(), report);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    print(report);
  }

  if (!report.ok) {
    throw new CliError(
      'CHECKS_FAILED',
      `${report.summary.errors} problem${report.summary.errors === 1 ? '' : 's'} found`,
      { hint: 'Fix them and run henri doctor again' }
    );
  }
};

module.exports = main;
module.exports.check = check;
module.exports.packageForShared = packageForShared;
module.exports.reach = reach;
module.exports.schema = schema;
module.exports.agentsClaim = agentsClaim;
module.exports.definesAction = definesAction;
module.exports.definesGraphql = definesGraphql;
module.exports.exportsOf = exportsOf;
module.exports.ignores = ignores;
module.exports.looksPlural = looksPlural;
module.exports.mailerActions = mailerActions;
module.exports.moduleDeclaration = moduleDeclaration;
module.exports.policyFor = policyFor;
module.exports.storeOf = storeOf;
module.exports.uncommented = uncommented;
