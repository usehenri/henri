const util = require('util');
const path = require('path');
const { spawn } = require('child_process');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const {
  StdioServerTransport,
} = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z: zod } = require('zod');

const { App } = require('./app');
const { parseJson, runCli } = require('./cli');
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
  'worker',
  'test',
  'agents',
];
const TARGETS = [
  'scaffold',
  'crud',
  'model',
  'controller',
  'route',
  'view',
  'job',
  'mailer',
  'worker',
  'test',
];

const INSTRUCTIONS = `henri is a Rails-like MVC framework for Node.js. Read the henri://conventions resource (or AGENTS.md) before changing the application: it states the layout, the naming rules and the commands. Use the generate tool to add models, controllers, routes, views, jobs, workers and tests instead of writing files by hand, then run doctor, audit and test.`;

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
    typeof error === 'string' ? { code: 'FAILED', message: error } : error;

  return {
    content: [
      { text: JSON.stringify({ error: detail }, null, 2), type: 'text' },
    ],
    isError: true,
    structuredContent: { error: detail },
  };
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
          code: 'FAILED',
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
        'Checks the application against the henri conventions (naming, routes vs controllers vs pages, secrets, .env, AGENTS.md, dependencies) and reports the environment: node, package manager, henri packages, stores, whether a development server is running. Problems have a level (error fails, warning does not), a check name, a file and a hint.',
      inputSchema: {},
      title: 'Doctor',
    },
    async () => ok(await app.doctor())
  );

  // Generators: the only write path ------------------------------------------

  server.registerTool(
    'generate',
    {
      annotations: { destructiveHint: false, idempotentHint: false },
      description:
        'Runs a henri generator (the same as `henri generate`) and returns the files written, the files skipped and the routes added. scaffold/model/crud take attributes ("title:string!", "body:text"; types: string, text, number, integer, float, boolean, date, json, uuid; ! = required), controller and mailer take action names, agents takes nothing. Existing files are skipped unless force is true.',
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
      if (generator !== 'agents' && !name) {
        return failed({
          code: 'USAGE',
          hint: 'generate { generator: "scaffold", name: "Post", attributes: ["title:string!"] }',
          message: `${generator} needs a name`,
        });
      }

      if (generator !== 'controller' && name && !NAME.test(name)) {
        return failed({
          code: 'USAGE',
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
        return failed({ code: 'USAGE', message: invalid });
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
        return failed({ code: 'USAGE', message: invalid });
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
          code: 'NOT_INSTALLED',
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
          code: 'FAILED',
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

  await server.connect(transport);

  return new Promise((resolve) => {
    server.server.onclose = () => resolve();
  });
};

module.exports = { GENERATORS, TARGETS, createServer, serve };
