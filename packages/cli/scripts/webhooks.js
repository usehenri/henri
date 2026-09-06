const { CliError } = require('./errors');
const { usage } = require('./help');
const { validInstall } = require('./utils');

/**
 * `henri webhooks`: the endpoints an application delivers to.
 *
 * The endpoints are what this command drives. The **deliveries** are not:
 * they are jobs, so `henri jobs:list --queue webhooks`, `henri jobs:dead`,
 * `henri jobs:show <id>` and `henri jobs:retry <id>` are already the answer
 * to what succeeded, what is waiting, what is dead and why. A second
 * listing here would be a second, worse copy of the queue's, so
 * `webhooks:status` prints the endpoints and points at the queue for the
 * rest.
 */

/** The package that carries the endpoints */
const PACKAGE = '@usehenri/webhooks';

const COMMANDS = [
  'add',
  'disable',
  'enable',
  'install',
  'list',
  'remove',
  'rotate',
  'send',
  'show',
  'status',
  'update',
];

/**
 * Prefer the @usehenri/core the project depends on and fall back to the one
 * shipped with this CLI
 *
 * @returns {string} resolved path of the Henri class
 */
const resolveHenri = () => {
  try {
    return require.resolve('@usehenri/core/src/henri', {
      paths: [process.cwd()],
    });
  } catch {
    return require.resolve('@usehenri/core/src/henri');
  }
};

/**
 * Boots henri up to the webhooks module (runlevel 4)
 *
 * No express server, no router and no views: managing an endpoint is not
 * serving a request, and this command must never bind a port.
 *
 * @returns {Promise<object>} The henri instance
 */
const boot = async () => {
  process.env.SKIP_WORKERS = 'true';
  process.env.CONSOLE_ONLY = 'true';

  const Henri = require(resolveHenri());
  const henri = new Henri({ runlevel: 4 });

  await henri.init();

  return henri;
};

/**
 * The webhooks module of a booted instance
 *
 * @param {object} henri A booted instance
 * @returns {Promise<object>} `henri.webhooks`
 * @throws {CliError} FAILED when the application does not have the package
 */
const webhooksOf = async (henri) => {
  if (!henri.webhooks || !henri.webhooks.enabled) {
    await henri.stop();
    throw new CliError('FAILED', 'This application has no webhooks', {
      hint: `Install ${PACKAGE}, and ${'@usehenri/jobs'} with it: a delivery is a job`,
    });
  }

  return henri.webhooks;
};

/**
 * Runs something against the endpoints and stops henri afterwards
 *
 * @param {Function} fn `(webhooks, henri) => result`
 * @returns {Promise<*>} What fn answered
 */
const using = async (fn) => {
  const henri = await boot();

  try {
    return await fn(await webhooksOf(henri), henri);
  } finally {
    await henri.stop();
  }
};

/**
 * The endpoint id an argument names
 *
 * @param {object} args CLI arguments
 * @param {number} [position=1] Where it is in `args._`
 * @returns {string} The id
 * @throws {CliError} USAGE when there is none
 */
const idOf = (args, position = 1) => {
  const id = args._[position];

  if (!id) {
    throw new CliError('USAGE', 'Missing endpoint id', {
      hint: '`henri webhooks:list` shows the endpoints and their ids',
    });
  }

  return String(id);
};

/**
 * A list from a repeatable flag or a comma separated one
 *
 * @param {*} value What minimist parsed
 * @returns {Array<string>} The entries
 */
const list = (value) =>
  (Array.isArray(value) ? value : [value])
    .filter((entry) => typeof entry === 'string')
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * The headers `--header 'X-Name: value'` asked for
 *
 * @param {object} args CLI arguments
 * @returns {object} The headers
 * @throws {CliError} USAGE when one is not `Name: value`
 */
const headers = (args) => {
  const found = {};

  for (const entry of list(args.header)) {
    const at = entry.indexOf(':');

    if (at < 1) {
      throw new CliError('USAGE', `"${entry}" is not a header`, {
        hint: "--header 'X-Acme-Env: production'",
      });
    }

    found[entry.slice(0, at).trim()] = entry.slice(at + 1).trim();
  }

  return found;
};

/**
 * Creates the endpoints table
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 */
const install = async (args) =>
  using(async (webhooks) => {
    const statements = await webhooks.ready().store.install();

    return {
      command: 'install',
      ok: true,
      statements: statements.length,
      store: webhooks.ready().config.store,
      table: webhooks.ready().config.tables.endpoints,
    };
  });

/**
 * The endpoints
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 */
const listing = async (args) =>
  using(async (webhooks) => {
    const filter = { limit: Number(args.limit) || 200 };

    if (typeof args.owner === 'string') {
      filter.owner = args.owner;
    }

    if (args.disabled === true) {
      filter.disabled = true;
    }

    return {
      command: 'list',
      endpoints: await webhooks.endpoints(filter),
      ok: true,
    };
  });

/**
 * One endpoint
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 */
const show = async (args) =>
  using(async (webhooks) => {
    const id = idOf(args);
    const endpoint = await webhooks.endpoint(id);

    if (!endpoint) {
      throw new CliError('FAILED', `No webhook endpoint with id "${id}"`, {
        hint: '`henri webhooks:list` shows the endpoints',
      });
    }

    return {
      command: 'show',
      endpoint,
      ok: true,
      // Only when asked: the secret is what forges a delivery
      ...(args.reveal === true ? { secrets: await webhooks.secrets(id) } : {}),
    };
  });

/**
 * Registers an endpoint
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 */
const add = async (args) => {
  const url = args._[1];

  if (!url) {
    throw new CliError('USAGE', 'Missing url', {
      hint: "henri webhooks:add https://acme.example/hooks --events 'invoice.*'",
    });
  }

  const events = list(args.events);

  if (events.length === 0) {
    throw new CliError('USAGE', 'Missing --events', {
      hint: "--events 'invoice.paid,invoice.void', --events 'invoice.*' or --events '*'",
    });
  }

  return using(async (webhooks) => {
    const endpoint = await webhooks.register({
      description: args.description,
      events,
      headers: headers(args),
      owner: args.owner,
      url: String(url),
    });

    return { command: 'add', endpoint, ok: true, secret: endpoint.secret };
  });
};

/**
 * Changes an endpoint
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 */
const update = async (args) =>
  using(async (webhooks) => {
    const changes = {};

    if (typeof args.url === 'string') {
      changes.url = args.url;
    }

    if (typeof args.events !== 'undefined') {
      changes.events = list(args.events);
    }

    if (typeof args.description === 'string') {
      changes.description = args.description;
    }

    if (typeof args.header !== 'undefined') {
      changes.headers = headers(args);
    }

    return {
      command: 'update',
      endpoint: await webhooks.update(idOf(args), changes),
      ok: true,
    };
  });

/**
 * Gives an endpoint a new secret
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 */
const rotate = async (args) =>
  using(async (webhooks) => {
    const { duration } = require(
      require.resolve('@usehenri/jobs', { paths: [process.cwd()] })
    );
    const endpoint = await webhooks.rotate(idOf(args), {
      grace: duration(args.grace, 0),
    });

    return { command: 'rotate', endpoint, ok: true, secret: endpoint.secret };
  });

/**
 * Stops sending to an endpoint
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 */
const disable = async (args) =>
  using(async (webhooks) => ({
    command: 'disable',
    endpoint: await webhooks.disable(idOf(args), { reason: args.reason }),
    ok: true,
  }));

/**
 * Sends to an endpoint again
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 */
const enable = async (args) =>
  using(async (webhooks) => ({
    command: 'enable',
    endpoint: await webhooks.enable(idOf(args)),
    ok: true,
  }));

/**
 * Forgets an endpoint
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 */
const remove = async (args) =>
  using(async (webhooks) => {
    const id = idOf(args);

    return {
      command: 'remove',
      id,
      ok: true,
      removed: await webhooks.remove(id),
    };
  });

/**
 * Enqueues one delivery, to one endpoint
 *
 * The delivery goes through the queue like any other, so a runner has to be
 * running (or `henri jobs --once` has to be run) for it to leave.
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 */
const send = async (args) => {
  const id = idOf(args);
  const event = args._[2] || 'henri.test';
  let data = null;

  if (typeof args.data === 'string') {
    try {
      data = JSON.parse(args.data);
    } catch (error) {
      throw new CliError('USAGE', '--data is not JSON', {
        cause: error,
        hint: `--data '{"hello":"world"}'`,
      });
    }
  }

  return using(async (webhooks) => ({
    command: 'send',
    delivery: await webhooks.deliverTo(id, event, data),
    hint: 'A delivery is a job: run `henri jobs --once` or a worker for it to leave',
    ok: true,
  }));
};

/**
 * The endpoints, and what the queue holds for them
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 */
const status = async (args) =>
  using(async (webhooks) => ({
    command: 'status',
    ok: true,
    ...(await webhooks.stats()),
  }));

const RUNNERS = {
  add,
  disable,
  enable,
  install,
  list: listing,
  remove,
  rotate,
  send,
  show,
  status,
  update,
};

/**
 * One endpoint, in a line
 *
 * @param {object} endpoint The endpoint
 * @returns {string} The line
 */
const line = (endpoint) =>
  [
    endpoint.id,
    (endpoint.owner || '-').padEnd(12),
    (endpoint.disabled ? 'disabled' : 'enabled').padEnd(8),
    endpoint.events.join(',').padEnd(24),
    endpoint.url,
  ].join('  ');

/**
 * Prints what a command answered
 *
 * @param {object} result The result
 * @returns {void}
 */
const print = (result) => {
  switch (result.command) {
    case 'install':
      console.log(
        `The ${result.table} table is ready in the ${result.store} store (${result.statements} statement(s)).`
      );
      break;

    case 'list':
      if (result.endpoints.length === 0) {
        console.log('No webhook endpoint.');
        break;
      }

      console.log(`${result.endpoints.length} endpoint(s):\n`);
      result.endpoints.forEach((endpoint) => console.log(line(endpoint)));
      break;

    case 'show': {
      const { endpoint } = result;

      console.log(`id           ${endpoint.id}`);
      console.log(`url          ${endpoint.url}`);
      console.log(`events       ${endpoint.events.join(', ')}`);
      console.log(`owner        ${endpoint.owner || '-'}`);
      console.log(`description  ${endpoint.description || '-'}`);
      console.log(
        `state        ${endpoint.disabled ? `disabled (${endpoint.disabledReason || 'no reason given'})` : 'enabled'}`
      );
      console.log(`created      ${endpoint.createdAt}`);
      endpoint.secrets.forEach((secret) =>
        console.log(
          `secret       ${secret.scheme} ${secret.id} since ${secret.createdAt}${secret.expiresAt ? ` until ${secret.expiresAt}` : ''}`
        )
      );

      if (result.secrets) {
        result.secrets.forEach((secret) =>
          console.log(`             ${secret}`)
        );
      }

      break;
    }

    case 'add':
    case 'rotate':
      console.log(`Endpoint ${result.endpoint.id} -> ${result.endpoint.url}`);
      console.log(`\n  ${result.secret}\n`);
      console.log(
        'That is the signing secret. It is shown here and stored encrypted;'
      );
      console.log('hand it to the receiver now.');
      break;

    case 'update':
    case 'disable':
    case 'enable':
      console.log(
        `Endpoint ${result.endpoint.id} is ${result.endpoint.disabled ? 'disabled' : 'enabled'} -> ${result.endpoint.url}`
      );
      break;

    case 'remove':
      console.log(
        result.removed
          ? `Endpoint ${result.id} is gone.`
          : `No endpoint ${result.id}.`
      );
      break;

    case 'send':
      console.log(
        `Delivery ${result.delivery.id} queued as job ${result.delivery.job}.`
      );
      console.log(result.hint);
      break;

    case 'status':
      console.log(
        `${result.endpoints.total} endpoint(s): ${result.endpoints.enabled} enabled, ${result.endpoints.disabled} disabled`
      );

      if (result.deliveries) {
        const { dead, done, pending, running } = result.deliveries;

        console.log(
          `deliveries on the ${result.queue} queue: ${pending} pending, ${running} running, ${done} done, ${dead} dead`
        );
      }

      console.log(
        `\nWhat happened to a delivery is the queue's answer:\n  henri jobs:list --queue ${result.queue}\n  henri jobs:dead --queue ${result.queue}`
      );
      break;

    default:
      console.log(JSON.stringify(result, null, 2));
  }
};

/**
 * The `henri webhooks` command
 *
 * @param {object} args CLI arguments
 * @returns {Promise<void>} Resolves when the command is done
 * @throws {CliError} USAGE for an unknown subcommand
 */
const main = async (args) => {
  const [named] = args._;
  const command = named || 'list';

  if (!COMMANDS.includes(command)) {
    if (!args.json) {
      console.log(usage('webhooks'));
    }

    throw new CliError('USAGE', `Unknown webhooks command "${command}"`, {
      hint: `Available commands: ${COMMANDS.join(', ')}`,
    });
  }

  validInstall({ fatal: true });

  const log = console.log;

  if (args.json) {
    console.log = (...parts) => console.error(...parts);
  }

  let result;

  try {
    result = await RUNNERS[command](args);
  } finally {
    console.log = log;
  }

  if (args.json) {
    await new Promise((resolve) =>
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, resolve)
    );
  } else {
    print(result);
  }

  process.exit(0);
};

module.exports = main;
module.exports.COMMANDS = COMMANDS;
module.exports.PACKAGE = PACKAGE;
module.exports.boot = boot;
module.exports.print = print;
