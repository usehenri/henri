const util = require('util');
const path = require('path');
const { spawn } = require('child_process');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const {
  StdioServerTransport,
} = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z: zod } = require('zod');

const { App } = require('./app');
const { Runtime } = require('./runtime');
const { parseJson, runCli } = require('./cli');
const docs = require('./docs');
const { version } = require('../package.json');

/**
 * What the tools accept. Every name is validated before it reaches the
 * command line (which gets an argv array, never a shell), and every path
 * stays inside the application.
 */
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const CONTROLLER = /^[A-Za-z][A-Za-z0-9_]*(\/[A-Za-z][A-Za-z0-9_]*)*$/;
const ATTRIBUTE = /^[A-Za-z_][A-Za-z0-9_]*!?(:[A-Za-z]+!?)?$/;
const ACTION = /^[a-z][A-Za-z0-9_]*$/;
const ROUTE_KEY = /^([a-z-]+ )?\/[A-Za-z0-9_\-/:.]*$/i;
const TEST_FILE = /^(?!-)[A-Za-z0-9_.\-/]+$/;
const ENV = /^[a-z0-9_-]+$/i;

const GENERATORS = [
  'scaffold',
  'model',
  'controller',
  'crud',
  'job',
  'mailer',
  'policy',
  'worker',
  'test',
  'authentication',
  'agents',
];

/** The generators that take no name */
const NAMELESS = new Set(['agents', 'authentication']);
const TARGETS = [
  'scaffold',
  'crud',
  'model',
  'controller',
  'route',
  'view',
  'job',
  'mailer',
  'policy',
  'worker',
  'test',
];

const INSTRUCTIONS = `henri is a Rails-like MVC framework for Node.js. Read the henri://conventions resource (or AGENTS.md) before changing the application: it states the layout, the naming rules and the commands. Use the openapi tool to learn the HTTP surface in one call -- every path, its guards, its request body and the answers henri itself produces -- and trust what it marks unknown. Use the generate tool to add models, controllers, routes, views, jobs, workers and tests instead of writing files by hand, then run doctor, audit and test. The guide tool serves the documentation of the henri version installed here: read it instead of guessing from memory. errors, logs, query, records, runtime_routes and request answer against the running application rather than its files: start with errors when something failed, and use request to check a fix without a browser.`;

/** The levels pen writes with */
const LEVELS = ['error', 'warn', 'info', 'verbose', 'debug', 'silly'];

/** The verbs the request tool takes */
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** A value a query parameter or a `where` may hold */
const SCALAR = zod.union([
  zod.string(),
  zod.number(),
  zod.boolean(),
  zod.null(),
]);

/**
 * A tool result carrying JSON (as text for every client, structured for
 * the ones that read it)
 *
 * @param {object} data The result
 * @returns {object} The MCP tool result
 */
const ok = (data) => ({
  content: [{ text: JSON.stringify(data, null, 2), type: 'text' }],
  structuredContent: data,
});

/**
 * A failed tool call: the error as text and as data
 *
 * @param {object|string} error { code, message, hint } or a message
 * @returns {object} The MCP tool result
 */
const failed = (error) => {
  const detail =
    typeof error === 'string'
      ? { code: 'HENRI_CLI_FAILED', message: error }
      : error;

  return {
    content: [
      { text: JSON.stringify({ error: detail }, null, 2), type: 'text' },
    ],
    isError: true,
    structuredContent: { error: detail },
  };
};

/**
 * What a runtime tool answers: the result, or the refusal with the url that
 * refused it. The rules behind a refusal are the running application's, not
 * this server's (see src/runtime.js).
 *
 * @param {object} result what the Runtime answered
 * @returns {object} The MCP tool result
 */
const answered = (result) => {
  if (result && result.error) {
    return failed(
      Object.assign({}, result.error, {
        source: result.source || null,
        url: result.url || null,
      })
    );
  }

  return ok(result);
};

/**
 * The last lines of an output
 *
 * @param {string} text The output
 * @param {number} [lines=60] How many lines to keep
 * @returns {string} The tail
 */
const tail = (text, lines = 60) => {
  const all = text.replace(/\r/g, '').trimEnd().split('\n');

  return all.slice(-lines).join('\n');
};

/**
 * Check every value of a list against a pattern
 *
 * @param {Array<string>} values The values
 * @param {RegExp} pattern What they must match
 * @param {string} label What they are, for the message
 * @returns {string|null} The offending value, or null
 */
const reject = (values, pattern, label) => {
  const bad = values.find((value) => !pattern.test(value));

  return bad ? `${label} "${bad}" is not allowed (${pattern})` : null;
};

/**
 * Build the MCP server of an application
 *
 * @param {object} options Options
 * @param {string} [options.cwd=process.cwd()] The application directory
 * @returns {McpServer} The server (not connected yet)
 * @throws when cwd is not a henri application
 */
const createServer = ({ cwd = process.cwd() } = {}) => {
  const app = new App(cwd);

  if (!app.isProject()) {
    throw new Error(
      `${app.cwd} is not a henri application: start henri mcp from the root of the app (package.json with "henri" and app/views/pages)`
    );
  }

  const server = new McpServer(
    { name: 'henri', version },
    { instructions: INSTRUCTIONS }
  );
  const runtime = new Runtime(app);

  server.runtime = runtime;

  // Read-only tools --------------------------------------------------------

  server.registerTool(
    'routes',
    {
      annotations: { readOnlyHint: true },
      description:
        'The routes table expanded from config/routes.js (verb, route, controller#action, path helper name, roles), without starting the server.',
      inputSchema: {},
      title: 'Routes',
    },
    async () => {
      try {
        const routes = app.routes();

        return ok({ count: routes.length, routes });
      } catch (error) {
        return failed({
          code: 'HENRI_CLI_FAILED',
          hint: 'config/routes.js must be a CommonJS module exporting an object',
          message: error.message,
        });
      }
    }
  );

  server.registerTool(
    'models',
    {
      annotations: { readOnlyHint: true },
      description:
        'The models of app/models parsed from their files: name (the global), attributes (type, required, default, enum, unique, index, ...), options, store, associate.',
      inputSchema: {
        name: zod
          .string()
          .regex(NAME)
          .optional()
          .describe('Only this model (ex: Task)'),
      },
      title: 'Models',
    },
    async ({ name }) => {
      const models = app.models(name);

      return ok({ count: models.length, models });
    }
  );

  server.registerTool(
    'openapi',
    {
      annotations: { readOnlyHint: true },
      description:
        'The OpenAPI 3.1 description of what this application exposes, built from config/routes.js, app/models and the configuration without starting anything. It is the fastest way to learn the HTTP surface: every path and verb, the roles and the policy guarding each one, the request body derived from the model, the HAL resource and collection envelopes, the paging, the error envelope and the statuses henri answers itself, plus the endpoints henri mounts (POST /login, the account flows, the health probes). It is deliberately honest about its limits: an operation whose body a controller writes carries `x-henri.known: false` and declares no success status, so do not assume a shape it does not state. GraphQL is not in it (it has a schema of its own).',
      inputSchema: {},
      title: 'OpenAPI description',
    },
    async () => {
      try {
        return ok(app.openapi());
      } catch (error) {
        return failed({
          code: error.code || 'HENRI_CLI_FAILED',
          hint:
            error.hint ||
            'config/routes.js and the files of app/models must load; run doctor for the details',
          message: error.message,
        });
      }
    }
  );

  server.registerTool(
    'controllers',
    {
      annotations: { readOnlyHint: true },
      description:
        'The controllers of app/controllers with their exported actions and the routes pointing at them.',
      inputSchema: {
        name: zod
          .string()
          .regex(CONTROLLER)
          .optional()
          .describe('Only this controller (ex: tasks, admin/users)'),
      },
      title: 'Controllers',
    },
    async ({ name }) => {
      const controllers = app.controllers(name);

      return ok({ controllers, count: controllers.length });
    }
  );

  server.registerTool(
    'config',
    {
      annotations: { readOnlyHint: true },
      description:
        'The configuration henri loads for an environment (config/<env>.json, else config/default.json) with secrets and passwords redacted. Says whether HENRI_SECRET is set in .env.',
      inputSchema: {
        env: zod
          .string()
          .regex(ENV)
          .optional()
          .describe(
            'Environment (dev, production, test); NODE_ENV or dev by default'
          ),
      },
      title: 'Configuration',
    },
    async ({ env }) => ok(app.config(env))
  );

  server.registerTool(
    'audit',
    {
      annotations: { readOnlyHint: true },
      description:
        "Checks the application against the OWASP Top 10 (2021) and the checkable parts of the ASVS 4.0.3, from its files only: a protection turned off in config/*.json, a secret or a credentials key that reached a commit, a model write that takes the whole request body instead of req.permit(), a resource action left without a role where its siblings have one, a raw query built by interpolation, unescaped output in a view. Findings carry a severity (high, medium, low), the check name, the OWASP category, the ASVS requirement, the file and the line. It reports what the application says, never henri's own defaults, which are secure. Set deps to true to also ask the package manager about the known advisories of the production dependencies; that step reaches the network.",
      inputSchema: {
        deps: zod
          .boolean()
          .optional()
          .describe(
            'Also check the production dependencies against the advisory database (reaches the network; false by default)'
          ),
      },
      title: 'Security audit',
    },
    async ({ deps }) => ok(app.audit({ deps: deps === true }))
  );

  server.registerTool(
    'doctor',
    {
      annotations: { readOnlyHint: true },
      description:
        'Checks the application against the henri conventions (naming, routes vs controllers vs pages and policies, secrets, .env, AGENTS.md, dependencies) and what would fail a boot: a model naming a store that is not configured, an adapter another environment asks for, a job with no perform, a recurring schedule naming a job that is not there, a mailer action with no view, an app/modules file whose name is taken or whose needs nothing provides. It also reports the environment: node, package manager, henri packages, stores, whether a development server is running. Problems have a level (error fails, warning does not), a check name, a file, a hint and, when the check predicts a failure henri has a name for, the error code the boot would raise. Run it after every change.',
      inputSchema: {},
      title: 'Doctor',
    },
    async () => ok(await app.doctor())
  );

  // The running application ---------------------------------------------------

  server.registerTool(
    'errors',
    {
      annotations: { readOnlyHint: true },
      description:
        "The errors the running application answered with, newest first: the message, the stack, and the request that caused it (method, url, params, query, body, the controller#action it reached, the user's id and roles, the X-Request-Id). This is what to read first when something failed: it saves reproducing the failure. Filtered parameters are masked and the application keeps only its last errors. Needs a development server: this server attaches to the one already running, or starts one and says so.",
      inputSchema: {
        limit: zod
          .number()
          .int()
          .min(1)
          .max(25)
          .optional()
          .describe('How many errors (5 by default, newest first)'),
        requestId: zod
          .string()
          .max(200)
          .optional()
          .describe('Only the errors of one request (an X-Request-Id)'),
      },
      title: 'Last errors',
    },
    async ({ limit, requestId }) =>
      answered(
        await runtime.call('/errors', {
          query: Object.assign(
            {},
            limit ? { limit } : {},
            requestId ? { requestId } : {}
          ),
        })
      )
  );

  server.registerTool(
    'logs',
    {
      annotations: { readOnlyHint: true },
      description:
        'The lines the running application wrote (henri.pen), newest last, with the module that wrote them, the level and the id of the request they belong to. The parameter filtering of the application applies here exactly as it does in the terminal: a filtered key never comes back. Bounded, and the answer says how many lines matched and how many it kept.',
      inputSchema: {
        contains: zod
          .string()
          .max(200)
          .optional()
          .describe('Only the lines holding this text (case-insensitive)'),
        level: zod
          .array(zod.enum(LEVELS))
          .optional()
          .describe(
            'Only these levels (error, warn, info, verbose, debug, silly)'
          ),
        limit: zod
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('How many lines (100 by default)'),
        requestId: zod
          .string()
          .max(200)
          .optional()
          .describe('Only the lines of one request (an X-Request-Id)'),
      },
      title: 'Recent logs',
    },
    async ({ contains, level, limit, requestId }) =>
      answered(
        await runtime.call('/logs', {
          query: Object.assign(
            {},
            contains ? { contains } : {},
            level && level.length > 0 ? { level: level.join(',') } : {},
            limit ? { limit } : {},
            requestId ? { requestId } : {}
          ),
        })
      )
  );

  server.registerTool(
    'query',
    {
      annotations: { readOnlyHint: true },
      description:
        'One read against a store of the running application, through its adapter. The application refuses anything that is not a single SELECT, WITH ... SELECT, EXPLAIN, SHOW or DESCRIBE, and refuses it whether or not the store exists: a statement carrying INSERT, UPDATE, DELETE, DROP, SET, LOCK or a second statement comes back as REFUSED with the word that refused it, and never reaches the database. Values go in `params`, never in the text. The rows come back redacted (a `password` column is always masked) and capped; the answer says when it truncated. A MongoDB store has no query(): use the records tool instead.',
      inputSchema: {
        limit: zod
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('How many rows (100 at most, which is also the default)'),
        params: zod
          .array(SCALAR)
          .optional()
          .describe(
            'The values of the placeholders (? on sqlite and mysql, $1 on postgres)'
          ),
        sql: zod.string().max(4000).describe('The statement, a read only'),
        store: zod
          .string()
          .max(60)
          .optional()
          .describe('Which store (default when unset)'),
      },
      title: 'Read the database',
    },
    async ({ limit, params, sql, store }) =>
      answered(
        await runtime.call('/query', { body: { limit, params, sql, store } })
      )
  );

  server.registerTool(
    'records',
    {
      annotations: { readOnlyHint: true },
      description:
        'Rows of a model of the running application, read through the model itself rather than the driver, so what the adapter hides stays hidden: a password is not selected, a soft deleted row does not come back, and the filtered keys are masked. Either one record by id (the externalId or the internal id, whichever the application uses) or one page, optionally narrowed by a flat `where` of equalities. Operators are refused: `where` is `{ field: value }` and nothing else. At most 25 records per page.',
      inputSchema: {
        id: SCALAR.optional().describe(
          'One record by id (externalId or primary key)'
        ),
        model: zod
          .string()
          .regex(NAME)
          .describe('The model (its global name: Post, User)'),
        page: zod
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Which page (1 by default)'),
        perPage: zod
          .number()
          .int()
          .min(1)
          .max(25)
          .optional()
          .describe('How many records (25 at most, which is also the default)'),
        where: zod
          .record(zod.string(), SCALAR)
          .optional()
          .describe('Equalities the records must match ({ "done": true })'),
      },
      title: 'Read records',
    },
    async ({ id, model, page, perPage, where }) =>
      answered(
        await runtime.call('/records', {
          body: { id, model, page, perPage, where },
        })
      )
  );

  server.registerTool(
    'runtime_routes',
    {
      annotations: { readOnlyHint: true },
      description:
        'The routes the running router actually mounted, which is not always what config/routes.js reads: `active: false` marks a route whose controller or action does not exist (it answers 501), `hooks` counts the before hooks that run ahead of the action, and `internal` lists the endpoints henri mounts itself (health, the runtime endpoints, the development introspection, the mailer previews). Compare it with the routes tool when a route behaves unlike the file says it should.',
      inputSchema: {},
      title: 'Mounted routes',
    },
    async () => answered(await runtime.call('/routes'))
  );

  server.registerTool(
    'request',
    {
      annotations: { destructiveHint: true, readOnlyHint: false },
      description:
        'Make one request against the running application and return what it answered: the status, the headers, the body and the X-Request-Id, which the errors and logs tools take as a filter. This is how to check a fix without a browser. It goes through the whole stack, so a POST, PUT, PATCH or DELETE really writes, exactly as a browser would: name the method deliberately. GET by default; redirects are not followed, so a 302 and its Location come back as they are. The body is truncated past 20000 characters and the answer says so.',
      inputSchema: {
        body: zod
          .union([zod.string(), zod.record(zod.string(), zod.any())])
          .optional()
          .describe('The body: an object is sent as JSON, a string as it is'),
        headers: zod
          .record(zod.string(), zod.string())
          .optional()
          .describe(
            'Extra headers (Accept, Cookie, Authorization, X-CSRF-Token)'
          ),
        method: zod
          .enum(METHODS)
          .optional()
          .describe('The verb (GET by default)'),
        path: zod
          .string()
          .max(2000)
          .describe('The path, with its query string (/tasks?page=2)'),
      },
      title: 'Request the app',
    },
    async ({ body, headers = {}, method = 'GET', path: route }) => {
      if (!route.startsWith('/')) {
        return failed({
          code: 'HENRI_CLI_USAGE',
          message: `path "${route}" must start with /`,
        });
      }

      const forbidden = Object.keys(headers).find(
        (name) => name.toLowerCase() === 'x-henri-runtime'
      );

      if (forbidden) {
        return failed({
          code: 'HENRI_CLI_USAGE',
          hint: 'Use the errors, logs, query, records and runtime_routes tools instead',
          message:
            'x-henri-runtime is the header of the runtime endpoints: this tool makes ordinary requests',
        });
      }

      return answered(
        await runtime.request({ body, headers, method, path: route })
      );
    }
  );

  server.registerTool(
    'guide',
    {
      annotations: { readOnlyHint: true },
      description:
        'The documentation of the henri version installed in this application, shipped with this server: without a page, the index (every page with what it covers) and the versions of the henri packages actually installed here; with a page, its markdown. Read it instead of recalling henri from memory: the framework changed.',
      inputSchema: {
        page: zod
          .string()
          .max(120)
          .optional()
          .describe(
            'A slug from the index (guides/routes, configuration, reference/cli)'
          ),
      },
      title: 'henri guide',
    },
    async ({ page }) => {
      const installed = app.installed();

      if (!page) {
        const pages = docs.index();

        return pages.length > 0
          ? ok({ count: pages.length, pages, versions: installed })
          : failed({
              code: 'HENRI_AGENT_NO_DOCS',
              hint: 'Reinstall @usehenri/mcp',
              message: 'the documentation was not shipped with this server',
            });
      }

      const found = docs.page(page);

      return found
        ? ok(Object.assign({ versions: installed }, found))
        : failed({
            code: 'HENRI_AGENT_UNKNOWN_PAGE',
            hint: 'Call guide without a page to list them',
            message: `there is no documentation page named "${page}"`,
          });
    }
  );

  // Generators: the only write path ------------------------------------------

  server.registerTool(
    'generate',
    {
      annotations: { destructiveHint: false, idempotentHint: false },
      description:
        'Runs a henri generator (the same as `henri generate`) and returns the files written, the files skipped and the routes added. scaffold/model/crud take attributes ("title:string!", "body:text"; types: string, text, number, integer, float, boolean, date, json, uuid; ! = required), controller and mailer take action names, authentication and agents take nothing. `authentication` turns the account flows on in config/*.json and writes the pages, the controller, the mailer and the tests around the endpoints henri mounts. Existing files are skipped unless force is true.',
      inputSchema: {
        actions: zod
          .array(zod.string().regex(ACTION))
          .optional()
          .describe('controller, mailer: the actions (index, show, ...)'),
        attributes: zod
          .array(zod.string().regex(ATTRIBUTE))
          .optional()
          .describe('scaffold, model, crud: name:type! attributes'),
        force: zod
          .boolean()
          .optional()
          .describe('Overwrite existing files (default: false)'),
        generator: zod.enum(GENERATORS).describe('What to generate'),
        name: zod
          .string()
          .regex(CONTROLLER)
          .optional()
          .describe(
            'Model name (singular, PascalCase: Post) or controller/job/worker/test name'
          ),
      },
      title: 'Generate',
    },
    async ({
      actions = [],
      attributes = [],
      force = false,
      generator,
      name,
    }) => {
      if (!NAMELESS.has(generator) && !name) {
        return failed({
          code: 'HENRI_CLI_USAGE',
          hint: 'generate { generator: "scaffold", name: "Post", attributes: ["title:string!"] }',
          message: `${generator} needs a name`,
        });
      }

      if (generator !== 'controller' && name && !NAME.test(name)) {
        return failed({
          code: 'HENRI_CLI_USAGE',
          message: `name "${name}" is not allowed (${NAME})`,
        });
      }

      const extra =
        generator === 'controller' || generator === 'mailer'
          ? actions
          : attributes;
      const args = ['generate', generator, ...(name ? [name] : []), ...extra];

      if (force) {
        args.push('--force');
      }
      args.push('--json');

      const result = parseJson(await runCli(app.cwd, args));

      return result.ok ? ok(result.data) : failed(result.error);
    }
  );

  server.registerTool(
    'destroy',
    {
      annotations: { destructiveHint: true, idempotentHint: true },
      description:
        'Undoes a generator (the same as `henri destroy`): removes the files and the routes it created. Files are backed up in .backup/ unless the application is a git repository. Returns the files removed, the ones that were missing and the routes removed.',
      inputSchema: {
        name: zod
          .string()
          .describe(
            'Model name (Post), controller/job/worker/test/view name, or the route key ("get /about")'
          ),
        target: zod.enum(TARGETS).describe('What to remove'),
      },
      title: 'Destroy',
    },
    async ({ name, target }) => {
      const pattern = target === 'route' ? ROUTE_KEY : CONTROLLER;
      const invalid = reject([name], pattern, 'name');

      if (invalid) {
        return failed({ code: 'HENRI_CLI_USAGE', message: invalid });
      }

      const result = parseJson(
        await runCli(app.cwd, ['destroy', target, name, '--json'])
      );

      return result.ok ? ok(result.data) : failed(result.error);
    }
  );

  // Checks -------------------------------------------------------------------

  server.registerTool(
    'test',
    {
      annotations: { readOnlyHint: true },
      description:
        'Runs the tests with `henri test` (Vitest, henri booted under NODE_ENV=test) and returns whether they passed and the tail of the output. Optional: only some files, only the tests matching a name.',
      inputSchema: {
        files: zod
          .array(zod.string().regex(TEST_FILE))
          .optional()
          .describe('Test files, relative to the app (test/tasks.test.js)'),
        filter: zod
          .string()
          .max(200)
          .optional()
          .describe('Only run the tests whose name matches (vitest -t)'),
      },
      title: 'Test',
    },
    async ({ files = [], filter }) => {
      const invalid =
        reject(files, TEST_FILE, 'file') ||
        files
          .map((file) => {
            try {
              app.inside(file);

              return null;
            } catch (error) {
              return error.message;
            }
          })
          .find(Boolean);

      if (invalid) {
        return failed({ code: 'HENRI_CLI_USAGE', message: invalid });
      }

      const args = ['test', ...files];

      if (filter) {
        args.push('-t', filter);
      }

      const result = await runCli(app.cwd, args, { timeout: 600000 });
      const output = tail(`${result.stdout}\n${result.stderr}`);
      const data = {
        command: `henri ${args.join(' ')}`,
        exitCode: result.status,
        ok: result.status === 0,
        output,
        timedOut: result.timedOut,
      };

      return result.status === 0 ? ok(data) : { ...ok(data), isError: true };
    }
  );

  server.registerTool(
    'lint',
    {
      annotations: { readOnlyHint: true },
      description:
        "Runs the application's ESLint (`eslint .`, the configuration of the app) and returns the messages per file. Nothing is fixed.",
      inputSchema: {},
      title: 'Lint',
    },
    async () => {
      let eslint;

      try {
        const manifest = require.resolve('eslint/package.json', {
          paths: [app.cwd],
        });
        const { bin } = require(manifest);

        eslint = path.join(
          path.dirname(manifest),
          typeof bin === 'string' ? bin : bin.eslint
        );
      } catch (error) {
        return failed({
          code: 'HENRI_CLI_NOT_INSTALLED',
          hint: 'Install the dependencies of the application (eslint is a devDependency)',
          message: `eslint is not installed in ${app.cwd}: ${error.message}`,
        });
      }

      const result = await new Promise((resolve) => {
        const child = spawn(
          process.execPath,
          [eslint, '.', '--format', 'json', '--no-error-on-unmatched-pattern'],
          { cwd: app.cwd, stdio: ['ignore', 'pipe', 'pipe'] }
        );
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => (stdout += chunk));
        child.stderr.on('data', (chunk) => (stderr += chunk));
        child.on('error', (error) =>
          resolve({ status: null, stderr: error.message, stdout })
        );
        child.on('close', (status) => resolve({ status, stderr, stdout }));
      });

      let files;

      try {
        files = JSON.parse(result.stdout);
      } catch {
        return failed({
          code: 'HENRI_CLI_FAILED',
          message: `eslint did not answer JSON (exit ${result.status}): ${tail(result.stderr, 20)}`,
        });
      }

      const summary = {
        errorCount: 0,
        files: [],
        ok: result.status === 0,
        warningCount: 0,
      };

      for (const entry of files) {
        summary.errorCount += entry.errorCount;
        summary.warningCount += entry.warningCount;

        if (entry.messages.length > 0) {
          summary.files.push({
            file: path.relative(app.cwd, entry.filePath),
            messages: entry.messages.map((message) => ({
              column: message.column,
              line: message.line,
              message: message.message,
              ruleId: message.ruleId,
              severity: message.severity === 2 ? 'error' : 'warning',
            })),
          });
        }
      }

      return summary.ok ? ok(summary) : { ...ok(summary), isError: true };
    }
  );

  // Resources ----------------------------------------------------------------

  server.registerResource(
    'agents',
    'henri://agents.md',
    {
      description:
        'AGENTS.md of the application: the conventions coding agents follow',
      mimeType: 'text/markdown',
      title: 'AGENTS.md',
    },
    async (uri) => {
      const { text } = app.agents();

      return { contents: [{ mimeType: 'text/markdown', text, uri: uri.href }] };
    }
  );

  server.registerResource(
    'conventions',
    'henri://conventions',
    {
      description:
        'The henri conventions (the canonical AGENTS.md of this henri version, rendered for this application)',
      mimeType: 'text/markdown',
      title: 'henri conventions',
    },
    async (uri) => ({
      contents: [
        { mimeType: 'text/markdown', text: app.conventions(), uri: uri.href },
      ],
    })
  );

  server.registerResource(
    'routes',
    'henri://routes',
    {
      description: 'The routes table expanded from config/routes.js',
      mimeType: 'application/json',
      title: 'Routes',
    },
    async (uri) => ({
      contents: [
        {
          mimeType: 'application/json',
          text: JSON.stringify(app.routes(), null, 2),
          uri: uri.href,
        },
      ],
    })
  );

  server.registerResource(
    'runtime',
    'henri://runtime',
    {
      description:
        'The running application: where it runs, its stores and whether they can be queried, its models, its renderer, the parameters it masks in the logs and the caps every runtime answer is bounded by',
      mimeType: 'application/json',
      title: 'The running application',
    },
    async (uri) => ({
      contents: [
        {
          mimeType: 'application/json',
          text: JSON.stringify(await runtime.describe(), null, 2),
          uri: uri.href,
        },
      ],
    })
  );

  server.registerResource(
    'help',
    'henri://help',
    {
      description:
        'The henri command line catalogue: commands, flags, exit codes',
      mimeType: 'application/json',
      title: 'henri help',
    },
    async (uri) => ({
      contents: [
        {
          mimeType: 'application/json',
          text: JSON.stringify(app.cli.help.catalogue(), null, 2),
          uri: uri.href,
        },
      ],
    })
  );

  return server;
};

/**
 * Keep stdout for the protocol: anything the application's files print
 * with console.log while they are inspected goes to stderr instead
 *
 * @returns {void}
 */
const protectStdout = () => {
  const toStderr = (...args) =>
    process.stderr.write(`${util.format(...args)}\n`);

  /* eslint-disable no-console */
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
  console.dir = (value) => toStderr(util.inspect(value));
  /* eslint-enable no-console */
};

/**
 * Start the server on stdio and run until the client disconnects
 *
 * @param {object} [options] Options
 * @param {string} [options.cwd=process.cwd()] The application directory
 * @returns {Promise<void>} Resolves when the connection closes
 */
const serve = async ({ cwd = process.cwd() } = {}) => {
  protectStdout();

  const server = createServer({ cwd });
  const transport = new StdioServerTransport();
  const { runtime } = server;

  // An application this server started belongs to this server: it goes when
  // the client does, and when the process is killed under it
  const bury = () => {
    runtime.stop().catch(() => null);
  };

  process.once('exit', bury);
  process.once('SIGINT', bury);
  process.once('SIGTERM', bury);

  await server.connect(transport);

  return new Promise((resolve) => {
    server.server.onclose = () => resolve();
  }).finally(() => runtime.stop());
};

module.exports = { GENERATORS, TARGETS, createServer, serve };
