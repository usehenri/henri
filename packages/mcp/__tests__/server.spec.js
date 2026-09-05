const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StdioClientTransport,
} = require('@modelcontextprotocol/sdk/client/stdio.js');

const { describeField, redact, scanActions } = require('../src/app');
const { version } = require('../package.json');

const henriBin = path.resolve(__dirname, '../../henri/bin/henri.js');
const mcpBin = path.resolve(__dirname, '../bin/henri-mcp.js');

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
 * @returns {Promise<{client: Client, transport: StdioClientTransport}>} The client
 */
const connect = async (app) => {
  const transport = new StdioClientTransport({
    args: [mcpBin],
    command: process.execPath,
    cwd: app,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'henri-mcp-tests', version: '0.0.0' });

  await client.connect(transport);

  return { client, transport };
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
      'config',
      'controllers',
      'destroy',
      'doctor',
      'generate',
      'lint',
      'models',
      'routes',
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
    ]);
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

  test('doctor: the conventions check and the environment', async () => {
    const { isError, structuredContent } = await call(client, 'doctor');

    expect(isError).toBe(false);
    expect(structuredContent.ok).toBe(true);
    expect(structuredContent.summary).toMatchObject({
      controllers: 2,
      errors: 0,
      models: 1,
      renderer: 'react',
      routes: 9,
    });
    expect(structuredContent.environment.node).toBe(process.version);
    expect(structuredContent.environment.cli).toBe(version);
    expect(structuredContent.server.running).toBe(false);
    expect(structuredContent.stores).toEqual([
      expect.objectContaining({
        adapter: 'disk',
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
      'app/views/pages/posts/index.js',
      'app/views/pages/posts/_form.js',
      'app/views/pages/posts/new.js',
      'app/views/pages/posts/edit.js',
      'app/views/pages/posts/show.js',
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
      code: 'USAGE',
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
    expect(conventions.contents[0].text).toContain('renderer `react`');

    const routes = await client.readResource({ uri: 'henri://routes' });

    expect(JSON.parse(routes.contents[0].text)).toHaveLength(9);

    const help = await client.readResource({ uri: 'henri://help' });

    expect(
      JSON.parse(help.contents[0].text).commands.map((c) => c.name)
    ).toContain('doctor');
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
