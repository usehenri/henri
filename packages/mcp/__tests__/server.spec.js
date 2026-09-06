const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StdioClientTransport,
  getDefaultEnvironment,
} = require('@modelcontextprotocol/sdk/client/stdio.js');

const { describeField, redact, scanActions } = require('../src/app');
const { freePort, probe } = require('../src/runtime');
const { version } = require('../package.json');

const henriBin = path.resolve(__dirname, '../../henri/bin/henri.js');
const PORT = 47311;
const mcpBin = path.resolve(__dirname, '../bin/henri-mcp.js');
const demo = path.resolve(__dirname, '../../demo');

/**
 * Scaffold an application with `henri new` in a temporary directory
 *
 * @returns {{dir: string, app: string}} The paths
 */
const scaffold = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-mcp-'));
  const result = spawnSync(
    process.execPath,
    [henriBin, 'new', 'app', '--skip-install', '--no-git'],
    { cwd: dir, encoding: 'utf8', timeout: 60000 }
  );

  if (result.status !== 0) {
    throw new Error(`henri new failed: ${result.stdout}${result.stderr}`);
  }

  return { app: path.join(dir, 'app'), dir };
};

/**
 * Start the server for an application and connect a client to it
 *
 * @param {string} app The application directory
 * @param {object} [env={}] Environment variables on top of the default one
 *   (which carries no NODE_ENV, like the editor that starts `henri mcp`)
 * @returns {Promise<{client: Client, transport: StdioClientTransport}>} The client
 */
const connect = async (app, env = {}) => {
  const transport = new StdioClientTransport({
    args: [mcpBin],
    command: process.execPath,
    cwd: app,
    env: Object.assign(getDefaultEnvironment(), env),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'henri-mcp-tests', version: '0.0.0' });

  await client.connect(transport);

  return { client, transport };
};

/**
 * A copy of the demo application in a temporary directory, on a port of its
 * own: a real henri application with real models, whose store and mongod
 * are not the ones any other suite is using
 *
 * @returns {Promise<{dir: string, app: string, port: number}>} The fixture
 */
const fixture = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-mcp-app-'));
  const app = path.join(dir, 'app');
  const port = await freePort();

  // The application, not what it wrote while running: `.henri` holds the
  // store's data and `.tmp` the uploads, and another suite may be writing
  // into either of them right now
  fs.cpSync(demo, app, {
    filter: (source) =>
      !source.includes(`${path.sep}node_modules`) &&
      !source.includes(`${path.sep}.henri`) &&
      !source.includes(`${path.sep}.tmp`),
    recursive: true,
  });
  fs.symlinkSync(
    path.join(demo, 'node_modules'),
    path.join(app, 'node_modules')
  );

  const config = path.join(app, 'config');
  const defaults = JSON.parse(
    fs.readFileSync(path.join(config, 'default.json'), 'utf8')
  );

  // One configuration whatever NODE_ENV says, so the server and the mcp
  // server agree on the port without either being told. Only the files: the
  // directories next to them (config/locales) are part of the application
  for (const entry of fs.readdirSync(config, { withFileTypes: true })) {
    entry.isFile() && fs.rmSync(path.join(config, entry.name));
  }
  fs.writeFileSync(
    path.join(config, 'default.json'),
    JSON.stringify(Object.assign({}, defaults, { port }), null, 2)
  );

  return { app, dir, port };
};

/**
 * Start a development server for an application and wait until it answers
 *
 * @param {string} app The application directory
 * @param {number} port The port it was configured with
 * @returns {Promise<object>} The child process
 * @throws when it does not answer in time
 */
const boot = async (app, port) => {
  const env = Object.assign({}, process.env, { NO_COLOR: '1' });

  delete env.NODE_ENV;

  const child = spawn(
    process.execPath,
    [path.resolve(__dirname, '../src/run-cli.js'), 'server'],
    { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const cwd = fs.realpathSync(app);
  const until = Date.now() + 90000;

  child.stdout.resume();
  child.stderr.resume();

  while (Date.now() < until) {
    if (await probe(port, cwd)) {
      return child;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  child.kill('SIGKILL');
  throw new Error(`the demo application did not answer on ${port}`);
};

/**
 * Call a tool and return its structured result
 *
 * @param {Client} client The client
 * @param {string} name The tool
 * @param {object} [args={}] The arguments
 * @returns {Promise<object>} The result ({ isError, structuredContent, text })
 */
const call = async (client, name, args = {}) => {
  const result = await client.callTool({ arguments: args, name });

  return {
    isError: result.isError === true,
    structuredContent: result.structuredContent,
    text: result.content.map((entry) => entry.text).join('\n'),
  };
};

describe('inspection helpers', () => {
  test('describes schema fields in the model format', () => {
    expect(describeField('title', 'string')).toEqual({
      name: 'title',
      type: 'string',
    });
    expect(
      describeField('status', {
        default: 'low',
        enum: ['low', 'high'],
        type: 'string',
      })
    ).toEqual({
      default: 'low',
      enum: ['low', 'high'],
      name: 'status',
      type: 'string',
    });
    expect(describeField('when', { default: Date.now, type: Date })).toEqual({
      default: '[now]',
      name: 'when',
      type: '[Date]',
    });
    expect(describeField('tags', [{ type: 'string' }])).toEqual({
      name: 'tags',
      of: ['string'],
      type: 'array',
    });
    expect(describeField('address', { street: 'string' })).toEqual({
      fields: [{ name: 'street', type: 'string' }],
      name: 'address',
      type: 'object',
    });
  });

  test('redacts secrets, passwords, tokens and url credentials', () => {
    expect(
      redact({
        mail: { apiKey: 'k', password: 'p', token: 't' },
        port: 3000,
        secret: 'abc',
        stores: {
          default: {
            adapter: 'postgresql',
            password: 'hunter2',
            url: 'postgres://henri:hunter2@localhost/app',
            user: 'henri',
          },
        },
      })
    ).toEqual({
      mail: {
        apiKey: '[redacted]',
        password: '[redacted]',
        token: '[redacted]',
      },
      port: 3000,
      secret: '[redacted]',
      stores: {
        default: {
          adapter: 'postgresql',
          password: '[redacted]',
          url: 'postgres://henri:[redacted]@localhost/app',
          user: 'henri',
        },
      },
    });
  });

  test('finds the actions of a controller source', () => {
    expect(
      scanActions(`module.exports = {
  index: async (req, res) => {},
  show(req, res) {},
  async edit(req, res) {},
  update: function (req, res) {},
  FIELDS: ['a'],
};`)
    ).toEqual(['index', 'show', 'edit', 'update']);
  });
});

describe('henri mcp', () => {
  let dir;
  let app;
  let client;

  beforeAll(async () => {
    ({ app, dir } = scaffold());

    // A port nobody listens on, so "is a server running" is deterministic
    const file = path.join(app, 'config', 'default.json');

    fs.writeFileSync(
      file,
      JSON.stringify({
        ...JSON.parse(fs.readFileSync(file, 'utf8')),
        port: PORT,
      })
    );
    ({ client } = await connect(app));
  }, 60000);

  afterAll(async () => {
    if (client) {
      await client.close();
    }
    fs.rmSync(dir, { force: true, recursive: true });
  });

  test('identifies itself and lists the tools and resources', async () => {
    expect(client.getServerVersion()).toEqual({ name: 'henri', version });
    expect(client.getInstructions()).toContain('henri://conventions');

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'audit',
      'config',
      'controllers',
      'destroy',
      'doctor',
      'errors',
      'generate',
      'guide',
      'lint',
      'logs',
      'models',
      'openapi',
      'query',
      'records',
      'request',
      'routes',
      'runtime_routes',
      'test',
    ]);

    const generate = tools.find((tool) => tool.name === 'generate');

    expect(generate.inputSchema.properties.generator.enum).toContain(
      'scaffold'
    );
    expect(generate.inputSchema.required).toEqual(['generator']);

    const { resources } = await client.listResources();

    expect(resources.map((resource) => resource.uri).sort()).toEqual([
      'henri://agents.md',
      'henri://conventions',
      'henri://help',
      'henri://routes',
      'henri://runtime',
    ]);
  });

  test('openapi: a valid 3.1 description of what the application exposes', async () => {
    const { isError, structuredContent } = await call(client, 'openapi');
    const { Validator } = await import('@seriousme/openapi-schema-validator');

    expect(isError).toBe(false);
    expect(structuredContent.openapi).toBe('3.1.0');
    expect(await new Validator().validate(structuredContent)).toEqual({
      valid: true,
    });
    expect(structuredContent.paths['/tasks'].get['x-henri']).toMatchObject({
      answer: 'collection',
      controller: 'tasks',
      known: true,
      model: 'Task',
    });
    // The scaffold has no user model, so henri mounts no session endpoints
    expect(structuredContent.paths['/livez'].get).toBeDefined();
  });

  test('routes: the expanded table of config/routes.js', async () => {
    const { isError, structuredContent } = await call(client, 'routes');

    expect(isError).toBe(false);
    expect(structuredContent.count).toBe(9);
    expect(structuredContent.routes[0]).toEqual({
      controller: 'main#home',
      path: 'home_main_path',
      route: '/',
      verb: 'get',
    });
    expect(structuredContent.routes.map((route) => route.controller)).toContain(
      'tasks#show'
    );
  });

  test('models: the model files parsed', async () => {
    const { isError, structuredContent } = await call(client, 'models');

    expect(isError).toBe(false);
    expect(structuredContent.count).toBe(1);

    const [task] = structuredContent.models;

    expect(task).toMatchObject({
      associate: false,
      file: 'app/models/Task.js',
      identity: 'task',
      name: 'Task',
      options: { timestamps: true },
      store: 'default',
    });
    expect(task.attributes).toEqual([
      { name: 'name', required: true, type: 'string' },
      {
        default: 'low',
        enum: ['urgent', 'high', 'medium', 'low'],
        name: 'category',
        type: 'string',
      },
      { default: false, name: 'done', type: 'boolean' },
    ]);

    const filtered = await call(client, 'models', { name: 'nothing' });

    expect(filtered.structuredContent.count).toBe(0);
  });

  test('controllers: files, actions and routes', async () => {
    const { structuredContent } = await call(client, 'controllers');

    expect(structuredContent.count).toBe(2);
    expect(structuredContent.controllers.map((entry) => entry.name)).toEqual([
      'main',
      'tasks',
    ]);

    const tasks = structuredContent.controllers[1];

    expect(tasks.actions.sort()).toEqual([
      'create',
      'destroy',
      'edit',
      'index',
      'new',
      'show',
      'update',
    ]);
    expect(tasks.routes).toContainEqual({
      action: 'show',
      path: 'show_tasks_path',
      route: 'get /tasks/:id',
    });
  });

  test('config: the configuration with the secrets redacted', async () => {
    const file = path.join(app, 'config', 'default.json');
    const original = fs.readFileSync(file, 'utf8');

    fs.writeFileSync(
      file,
      JSON.stringify({
        ...JSON.parse(original),
        secret: 'do-not-leak',
        stores: {
          default: {
            adapter: 'postgresql',
            password: 'hunter2',
            url: 'postgres://henri:hunter2@localhost/app',
          },
        },
      })
    );

    try {
      const { isError, structuredContent, text } = await call(client, 'config');

      expect(isError).toBe(false);
      expect(structuredContent).toMatchObject({
        env: 'dev',
        file: 'config/default.json',
        secretInConfig: true,
        secretInEnv: true,
      });
      expect(structuredContent.config.secret).toBe('[redacted]');
      expect(structuredContent.config.stores.default).toEqual({
        adapter: 'postgresql',
        password: '[redacted]',
        url: 'postgres://henri:[redacted]@localhost/app',
      });
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain('do-not-leak');
    } finally {
      fs.writeFileSync(file, original);
    }
  });

  test('audit: the security findings, with their category', async () => {
    const { isError, structuredContent } = await call(client, 'audit');

    expect(isError).toBe(false);
    expect(structuredContent.ok).toBe(true);
    expect(structuredContent.findings).toEqual([]);
    expect(structuredContent.summary).toMatchObject({
      failOn: 'medium',
      findings: 0,
      high: 0,
      standards: { asvs: '4.0.3', owasp: 'Top 10:2021' },
    });
  });

  test('doctor: the conventions check and the environment', async () => {
    const { isError, structuredContent } = await call(client, 'doctor');

    expect(isError).toBe(false);
    expect(structuredContent.ok).toBe(true);
    expect(structuredContent.summary).toMatchObject({
      controllers: 2,
      errors: 0,
      models: 1,
      renderer: 'inertia',
      routes: 9,
    });
    expect(structuredContent.environment.node).toBe(process.version);
    expect(structuredContent.environment.cli).toBe(version);
    expect(structuredContent.server).toEqual({
      running: false,
      url: `http://127.0.0.1:${PORT}/`,
    });
    expect(structuredContent.stores).toEqual([
      expect.objectContaining({
        adapter: 'drizzle',
        name: 'default',
        reachable: expect.objectContaining({ status: 'skipped' }),
      }),
    ]);
  });

  test('generate then destroy a scaffold through the cli', async () => {
    const generated = await call(client, 'generate', {
      attributes: ['title:string!', 'body:text'],
      generator: 'scaffold',
      name: 'Post',
    });

    expect(generated.isError).toBe(false);
    expect(generated.structuredContent).toMatchObject({
      command: 'generate',
      generator: 'scaffold',
      name: 'Post',
      routes: { added: ['resources posts'] },
      skipped: [],
    });
    expect(generated.structuredContent.created).toEqual([
      'app/models/Post.js',
      'app/controllers/posts.js',
      'app/views/pages/posts/index.jsx',
      'app/views/pages/posts/_form.jsx',
      'app/views/pages/posts/new.jsx',
      'app/views/pages/posts/edit.jsx',
      'app/views/pages/posts/show.jsx',
    ]);
    expect(fs.existsSync(path.join(app, 'app/models/Post.js'))).toBe(true);

    const routes = await call(client, 'routes');

    expect(routes.structuredContent.count).toBe(17);

    const again = await call(client, 'generate', {
      attributes: ['title:string'],
      generator: 'model',
      name: 'Post',
    });

    expect(again.structuredContent.created).toEqual([]);
    expect(again.structuredContent.skipped).toEqual(['app/models/Post.js']);

    const destroyed = await call(client, 'destroy', {
      name: 'Post',
      target: 'scaffold',
    });

    expect(destroyed.isError).toBe(false);
    expect(destroyed.structuredContent).toMatchObject({
      command: 'destroy',
      name: 'Post',
      routes: { removed: ['resources posts'] },
      target: 'scaffold',
    });
    expect(destroyed.structuredContent.removed).toEqual([
      'app/models/Post.js',
      'app/controllers/posts.js',
      'app/views/pages/posts',
    ]);
    expect(destroyed.structuredContent.backup).toMatch(/^\.backup\//);
    expect(fs.existsSync(path.join(app, 'app/models/Post.js'))).toBe(false);
    expect((await call(client, 'routes')).structuredContent.count).toBe(9);
  });

  test('reports generator errors as tool errors', async () => {
    const result = await call(client, 'generate', {
      attributes: ['x:bogus'],
      generator: 'model',
      name: 'Bad',
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toMatchObject({
      code: 'HENRI_CLI_USAGE',
      command: 'generate',
      exitCode: 2,
    });
    expect(result.structuredContent.error.message).toContain('bogus');
    expect(fs.existsSync(path.join(app, 'app/models/Bad.js'))).toBe(false);
  });

  test('refuses names and paths that could leave the app or inject flags', async () => {
    for (const [name, args] of [
      ['generate', { generator: 'model', name: '../Evil' }],
      ['generate', { generator: 'model', name: '--force' }],
      ['generate', { generator: 'model', name: 'Post; rm -rf /' }],
      ['generate', { generator: 'scaffold' }],
      ['destroy', { name: '../../etc', target: 'view' }],
      ['destroy', { name: '--json', target: 'model' }],
      ['test', { files: ['../secrets.js'] }],
      ['test', { files: ['--reporter=evil'] }],
    ]) {
      const result = await call(client, name, args);

      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/not allowed|needs a name|outside|invalid/i);
    }
  });

  test('serves AGENTS.md, the conventions, the routes and the help as resources', async () => {
    const agents = await client.readResource({ uri: 'henri://agents.md' });

    expect(agents.contents[0].mimeType).toBe('text/markdown');
    expect(agents.contents[0].text).toContain('# app: conventions');

    const conventions = await client.readResource({
      uri: 'henri://conventions',
    });

    expect(conventions.contents[0].text).toContain('## Do not');
    expect(conventions.contents[0].text).toContain('renderer `inertia`');

    const routes = await client.readResource({ uri: 'henri://routes' });

    expect(JSON.parse(routes.contents[0].text)).toHaveLength(9);

    const help = await client.readResource({ uri: 'henri://help' });

    expect(
      JSON.parse(help.contents[0].text).commands.map((c) => c.name)
    ).toContain('doctor');
  });

  test('guide: the documentation of the version installed here', async () => {
    const { isError, structuredContent } = await call(client, 'guide');

    expect(isError).toBe(false);
    expect(structuredContent.count).toBeGreaterThan(10);
    expect(structuredContent.pages.map((entry) => entry.slug)).toContain(
      'guides/routes'
    );
    expect(structuredContent.versions.node).toBe(process.version);
    expect(structuredContent.versions.cli).toBe(version);

    const routes = await call(client, 'guide', { page: 'guides/routes' });

    expect(routes.structuredContent.title).toBe('Routes');
    expect(routes.structuredContent.text).toContain('config/routes.js');
    expect(routes.structuredContent.truncated).toBe(false);
  });

  test('guide: refuses a page that is not one', async () => {
    for (const page of ['../../../etc/passwd', 'nothing/here']) {
      const result = await call(client, 'guide', { page });

      expect(result.isError).toBe(true);
      expect(result.structuredContent.error.code).toBe(
        'HENRI_AGENT_UNKNOWN_PAGE'
      );
    }
  });

  test('the runtime tools say what is missing instead of booting', async () => {
    // The scaffolded app has no dependencies installed (--skip-install)
    for (const [tool, args] of [
      ['errors', {}],
      ['logs', {}],
      ['query', { sql: 'SELECT 1' }],
      ['records', { model: 'Task' }],
      ['runtime_routes', {}],
      ['request', { path: '/' }],
    ]) {
      const result = await call(client, tool, args);

      expect({ isError: result.isError, tool }).toEqual({
        isError: true,
        tool,
      });
      expect(result.structuredContent.error.code).toBe(
        'HENRI_AGENT_NOT_INSTALLED'
      );
      expect(result.structuredContent.error.hint).toMatch(/install/i);
    }
  }, 60000);

  test('refuses to start anything when told not to', async () => {
    const { client: quiet } = await connect(app, { HENRI_MCP_AUTOSTART: '0' });

    try {
      const { isError, structuredContent } = await call(quiet, 'errors');

      expect(isError).toBe(true);
      expect(structuredContent.error.code).toBe('HENRI_AGENT_NO_SERVER');
      expect(structuredContent.error.hint).toContain('henri server');
    } finally {
      await quiet.close();
    }
  }, 60000);

  test('refuses a production application, and says so', async () => {
    const { client: live } = await connect(app, { NODE_ENV: 'production' });

    try {
      const { isError, structuredContent } = await call(live, 'query', {
        sql: 'SELECT 1',
      });

      expect(isError).toBe(true);
      expect(structuredContent.error.code).toBe('HENRI_AGENT_PRODUCTION');
      expect(structuredContent.error.message).toContain('production');
    } finally {
      await live.close();
    }
  }, 60000);
});

describe('henri mcp against a running application', () => {
  let dir;
  let app;
  let client;
  let server;
  let port;

  beforeAll(async () => {
    ({ app, dir, port } = await fixture());
    server = await boot(app, port);
    ({ client } = await connect(app));
  }, 120000);

  afterAll(async () => {
    if (client) {
      await client.close();
    }
    if (server) {
      const ended = new Promise((resolve) => server.once('exit', resolve));

      server.kill('SIGKILL');
      await ended;
    }
    fs.rmSync(dir, { force: true, recursive: true });
  }, 30000);

  test('attaches to the server that is already running', async () => {
    const { isError, structuredContent } = await call(client, 'runtime_routes');

    expect(isError).toBe(false);
    expect(structuredContent.source).toBe('attached');
    expect(structuredContent.url).toBe(`http://127.0.0.1:${port}`);
    expect(structuredContent.app).toMatchObject({
      env: 'dev',
      stores: { default: { adapter: 'disk', queryable: false } },
    });
  });

  test('runtime_routes: what the router mounted, not what the file says', async () => {
    const { structuredContent } = await call(client, 'runtime_routes');
    const root = structuredContent.routes.find(
      (route) => route.route === '/' && route.verb === 'get'
    );

    expect(root).toMatchObject({
      action: 'home',
      active: true,
      controller: 'main',
      helper: 'home_main_path',
    });
    expect(structuredContent.inactive).toBe(0);
    expect(structuredContent.internal).toContain('GET /_henri/health');
    expect(structuredContent.internal).toContain('GET /_mailers');
  });

  test('request: makes one and hands back what it answered', async () => {
    const { isError, structuredContent } = await call(client, 'request', {
      path: '/version',
    });

    expect(isError).toBe(false);
    expect(structuredContent.status).toBe(200);
    expect(structuredContent.headers['x-request-id']).toBeTruthy();
    expect(structuredContent.requestId).toBe(
      structuredContent.headers['x-request-id']
    );
    expect(JSON.parse(structuredContent.body)).toHaveProperty('_links');
  });

  test('request then errors: the failure and the request that caused it', async () => {
    const answer = await call(client, 'request', {
      body: '{"broken"',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'mcp-broken-1',
      },
      method: 'POST',
      path: '/echo?token=super-secret',
    });

    expect(answer.structuredContent.status).toBe(400);

    const { structuredContent } = await call(client, 'errors', {
      requestId: 'mcp-broken-1',
    });

    expect(structuredContent.count).toBe(1);

    const [error] = structuredContent.errors;

    expect(error.status).toBe(400);
    expect(error.requestId).toBe('mcp-broken-1');
    expect(error.stack).toContain('at ');
    expect(error.request.method).toBe('POST');
    expect(error.request.url).toBe('/echo?token=%5BFILTERED%5D');
    expect(JSON.stringify(structuredContent)).not.toContain('super-secret');
  });

  test('logs: the lines the application wrote, filtered', async () => {
    const { structuredContent } = await call(client, 'logs', {
      contains: 'routes loaded',
      level: ['info'],
    });

    expect(structuredContent.lines.length).toBeGreaterThan(0);
    expect(structuredContent.lines[0].name).toBe('router');
    expect(structuredContent.kept).toBe(500);
  });

  test('records: a page of a model, and the refusals', async () => {
    const page = await call(client, 'records', { model: 'Artwork' });

    expect(page.isError).toBe(false);
    expect(page.structuredContent).toMatchObject({
      model: 'Artwork',
      page: 1,
      perPage: 25,
    });

    const unknown = await call(client, 'records', { model: 'Teapot' });

    expect(unknown.isError).toBe(true);
    expect(unknown.structuredContent.error.code).toBe('UNKNOWN_MODEL');

    const operator = await call(client, 'records', {
      model: 'User',
      where: { $where: '1 == 1' },
    });

    expect(operator.isError).toBe(true);
    expect(operator.text).toMatch(/no operators/);
  });

  test('query: the writes are refused by the application', async () => {
    for (const sql of [
      'DELETE FROM users',
      'DROP TABLE users',
      'UPDATE users SET roles = 1',
      'SELECT 1; DELETE FROM users',
    ]) {
      const refused = await call(client, 'query', { sql });

      expect({ isError: refused.isError, sql }).toEqual({
        isError: true,
        sql,
      });
      expect(refused.structuredContent.error.code).toBe('REFUSED');
      expect(refused.structuredContent.error.url).toBe(
        `http://127.0.0.1:${port}`
      );
    }
  });

  test('query: says a MongoDB store is not one to query', async () => {
    const { isError, structuredContent } = await call(client, 'query', {
      sql: 'SELECT 1',
    });

    expect(isError).toBe(true);
    expect(structuredContent.error.code).toBe('NO_QUERY');
    expect(structuredContent.error.message).toContain('disk');
  });

  test('request: refuses to forge the runtime header', async () => {
    const { isError, text } = await call(client, 'request', {
      headers: { 'X-Henri-Runtime': '1' },
      path: '/_henri/runtime',
    });

    expect(isError).toBe(true);
    expect(text).toContain('x-henri-runtime');
  });

  test('serves the running application as a resource', async () => {
    const resource = await client.readResource({ uri: 'henri://runtime' });
    const identity = JSON.parse(resource.contents[0].text);

    expect(identity.app.pid).toBe(server.pid);
    expect(identity.models.map((model) => model.name).sort()).toEqual([
      'Artwork',
      'Invoice',
      'Memo',
      'User',
    ]);
    expect(identity.filterParameters).toContain('password');
    expect(identity.limits.rows).toBe(100);
  });
});

describe('henri mcp outside of an application', () => {
  test('refuses to start', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-mcp-none-'));
    const result = spawnSync(process.execPath, [mcpBin], {
      cwd: dir,
      encoding: 'utf8',
      input: '',
      timeout: 20000,
    });

    fs.rmSync(dir, { force: true, recursive: true });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not a henri application');
  });
});
