---
title: Under the hood
description: The module system, the boot graph, reloads and shutdown.
sidebar:
  order: 4
---

## Modules

henri is a set of modules — its own, plus the ones an application keeps in `app/modules` and the ones its packages ship. Each one says where it goes, henri computes the order, and everything nothing separates starts at the same time. A module that throws fails the boot: `henri.init()` rejects with an `Error` whose `cause` is the module's error, and the CLI prints which module failed, what was still running and what never started.

A module says where it goes in one of two ways, and both are supported for good:

| Declaration | Means                                                                               |
| ----------- | ----------------------------------------------------------------------------------- |
| `needs`     | It cannot work without them: they must be registered, and they finish first.        |
| `after`     | Ordering only: those of them that are registered finish first.                      |
| `before`    | Ordering only: those of them that are registered start after it.                    |
| `runlevel`  | The slot: after every module of a lower level, before every module of a higher one. |

Naming replaces the number. A module that declares `needs`, `after` or `before` is ordered by what it named and nothing else; a module that names nothing is ordered by its level alone, exactly the way henri booted until 1.2. The number stays the module's slot in both cases, because that is what other people's numeric pins and the boot ceiling are measured against.

The levels of henri's own modules:

| Level | Modules                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------ |
| 0     | `config`: `config/<env>.json`, `.env`, the credentials                                           |
| 1     | `mail` (and `graphql`, from `@usehenri/graphql`, when the application has it)                    |
| 2     | `controllers`, `mailers` (`app/mailers`), `server` (the Express app is built, not listening yet) |
| 3     | `model` (stores and model globals), `view` (the engine's `init()`)                               |
| 4     | `user` (sessions, passport, CSRF, `req.permit()`), `jobs` (the queue, from `@usehenri/jobs`)     |
| 5     | `router` (routes, the engine's `prepare()`, then the server listens), `workers`                  |
| 6     | your own modules                                                                                 |

They are also what they declare, which is what actually orders them: `model` needs `config` and runs after `graphql`, `view` needs `config` and `server`, `user` needs `config`, `model` and `server`, `router` needs `config`, `controllers`, `server` and `user` and runs after `view` and `mailers`, `jobs` needs `config` and `model` and runs after `mailers`, `workers` needs `config` and `model` and runs after `user`. Nothing else separates them, so `mail`, `controllers` and `server` start together as soon as the configuration is read, and `mailers`, `model` and `view` follow as soon as each of them can. `graphql` and `jobs` are not henri's own: they arrive from `@usehenri/graphql` and `@usehenri/jobs` when the application depends on them, which is why `model` runs _after_ `graphql` rather than _needing_ it. `jobs` says what it needs the ordinary way, because when it is there at all, the models and the mailers are too.

The logger (`henri.pen`) and the registry (`henri.modules`) exist before level 0.

### Booting to a level

`new Henri({ runlevel })` stops the boot at a level: every module whose slot is above it is left out. `henri db:push` boots to 3 (the models), `henri db:seed` to 4 (it needs `henri.user.encrypt()`), `henri console` to 6 without the view engine. A module that `needs` something the ceiling left out fails the boot and says so, rather than failing later on a missing object.

## Writing a module

A module extends `BaseModule` (`require('@usehenri/core/module')`, the supported path to it), has a unique `name`, says where it goes, and implements `init()` returning its name. Reloadable modules set `reloadable = true` and add `reload()`; a module holding something adds `stop()`, and `release()` when it should let go before a reload rebuilds what is under it; `consoleOnly = true` skips the module under `henri console`.

Here is a real one. It adds a route of its own, so it has to run after the Express app exists and before the routes are mounted — which is exactly what it says:

```js
// app/modules/metrics.js
const BaseModule = require('@usehenri/core/module');

class Metrics extends BaseModule {
  constructor() {
    super();
    this.name = 'metrics';
    // The express app has to exist: henri.server.app is what I use
    this.needs = ['server'];
    // ...and my middleware has to be registered before the routes mount
    this.before = ['router'];
    // The slot I sit in, for a boot that stops early
    this.runlevel = 5;
    this.reloadable = true;
  }

  async init() {
    this.hits = 0;

    this.henri.addMiddleware('metrics', (router) => {
      router.use((req, res, next) => {
        this.hits++;

        return next();
      });
      router.get('/_metrics', (req, res) => res.json({ hits: this.hits }));
    });

    return this.name;
  }

  async reload() {
    this.hits = 0;

    return this.name;
  }

  async stop() {
    this.henri.pen.info('metrics', 'served', this.hits, 'requests');

    return this.name;
  }
}

module.exports = Metrics;
```

`needs` is the half a dependency can express, and `before` is the half it cannot: nothing in henri knows this module exists, so no amount of "I depend on the router" would get the middleware registered in time. Both directions read as the intent, which a number never did — `runlevel = 4` says "somewhere between the users and the routes" and hopes.

### Where it goes: an application's own module

`app/modules/*.js` is loaded into the boot, the way `app/models` and
`app/controllers` are: one module per file, no registration to write. Drop the
file above in `app/modules/metrics.js` and `henri server`, `henri console`,
`henri test` and `henri db:seed` all have it. A module that does not name
itself takes the name of its file, so the shortest one there is is:

```js
// app/modules/heartbeat.js
const BaseModule = require('@usehenri/core/module');

module.exports = class extends BaseModule {
  async init() {
    this.timer = setInterval(
      () => this.henri.pen.info('heartbeat', 'up'),
      60000
    );

    return this.name; // 'heartbeat', from the file name
  }

  async stop() {
    clearInterval(this.timer);

    return this.name;
  }
};
```

The file exports a module class, an instance, a function of the henri instance
returning one, or an array of any of those.

### Where it goes: a module that arrives from a package

A package ships a module by pointing at it from its own `package.json`.
Depending on the package is then all an application has to do:

```json
{
  "name": "henri-audit-log",
  "version": "1.0.0",
  "main": "index.js",
  "henri": { "module": "./module.js" }
}
```

```js
// node_modules/henri-audit-log/module.js
const BaseModule = require('@usehenri/core/module');

class AuditLog extends BaseModule {
  constructor() {
    super();
    this.name = 'audit';
    this.needs = ['model'];
    this.runlevel = 4;
  }

  async init() {
    this.henri.pen.info('audit', 'recording writes');

    return this.name;
  }
}

module.exports = AuditLog;
```

```bash
npm install henri-audit-log
```

henri reads the `dependencies` and `devDependencies` of the application, and
every package declaring `henri.module` is in the boot as `henri.audit`.
[`@usehenri/graphql`](/guides/graphql/) and [`@usehenri/jobs`](/guides/jobs/)
are henri's own packages doing exactly this: installing one is what puts
`henri.graphql` or `henri.jobs` in the boot. Nothing
else is written on either side, which is what lets somebody publish a module
and somebody else use it. The module file does not have to be in the package's
`exports` map — henri resolves it from the package's own directory — but the
package must let `require.resolve` reach its `package.json`, which is the
default.

### Where it goes: anything else

`config/modules.js` adds modules the two conventions above do not cover: one
that lives somewhere else in the application, or one loaded only under some
configuration.

```js
// config/modules.js
module.exports = [require('./../lib/reporting'), 'henri-audit-log'];
```

An entry is a module instance, a module class (constructed with the henri
instance), or the name of a package exporting either. The file may also export
a function of the henri instance returning that array:

```js
module.exports = (henri) =>
  henri.config.has('metrics') ? [require('./../lib/metrics')] : [];
```

The three sources are read once per boot, in that order — packages, then
`app/modules`, then `config/modules.js` — so adding or removing a module needs
a restart, not a reload. Modules can still be registered by hand, which is what
a program embedding henri does:

```js
const Henri = require('@usehenri/core/src/henri');
const henri = new Henri();

henri.modules.add(new Metrics());
await henri.init();
```

The instance is exposed as `henri.<name>`, which is why names must be unique:
registering two modules with the same name, or one whose name collides with an
existing property of `henri`, stops the boot with a
[duplicate module error](/e/dup_mods/).

### When it does not work

The graph is built before anything starts, so these fail at the boot, not halfway through it:

```text
modules => "metrics" needs "srever", which no module provides.
  Loaded modules: config (0), mail (1), controllers (2), mailers (2), server (2), model (3), view (3), user (4), router (5), workers (5), metrics (5)
  Did you mean: server?
```

```text
modules => "metrics" needs "router", which this boot leaves out: "router" sits at level 5 and the boot stops at level 3.
```

```text
modules => circular dependency: metrics -> billing -> metrics
  "billing" waits on "metrics" (needs)
  "metrics" waits on "billing" (before)
```

## Introspection

`henri.analyze()` answers what the boot did, and `henri analyze` prints it — the order, how long each module took, what each one waited on and why, the chain that decided the total, and the level chart a numeric pin lands in. `henri analyze <module>` answers the question an author actually has: where did mine end up, what ran before it, and what was waiting on me.

```bash
henri analyze metrics
```

```text
 metrics: level 5, pinned by name

   Started        8.9ms
   Took           42.6ms
   State          done
   Waited on      server (needs), config (runlevel 0)
   Held up by     server
   Waiting on it  router
```

`henri analyze --json` prints the whole thing, and so does `henri.analyze()` in the application: `{ ok, ceiling, duration, modules, criticalPath, chart, skipped, failed, reload }`. Each module carries `runlevel`, `pin` (`name` or `runlevel`), `state`, `startedAt`, `duration`, `waitsOn` (with the reason for each edge), `blocks` and `blockedBy`, the dependency that actually held it up.

## Reloads

In development the server watches `app/controllers`, `app/helpers`, `app/jobs`, `app/mailers`, `app/models`, `app/workers`, `app/views/partials`, `config` and `package.json`. Changes are debounced, every changed file is syntax checked first (an error is printed and nothing reloads), then `henri.reload()` runs in two passes over the same graph:

1. **Release**, the graph backwards. Every module implementing `release()` is asked to let go of what it holds, before anything rebuilds under it. It is called on every module that has one, reloadable or not: a module that never reloads can still hold a connection the model module is about to replace.
2. **Reload**, the graph forwards, like the boot. The application's own files are evicted from the require cache (nothing under `node_modules`), then every module with `reloadable = true` runs its `reload()` as soon as the reloadable modules it waits on are done: `config`, then `controllers`, `mailers`, `view` (and `graphql`, when the application has it), then `model`, then `jobs` (when the application has it), `workers` and `router`. `server`, `mail` and `user` are not reloadable.

A reload is not a shutdown followed by a boot: modules re-initialize in place and tear down what they own inside their own `reload()`. `release()` is the hook for what they do not own — something another module is about to replace. A module implementing neither sees no difference.

Reloads are serialized: a change during a reload queues exactly one more run, and every caller in the meantime gets that same run. A model reload stops and restarts the stores; the session store follows the new adapter. The Handlebars engine drops its template cache (mail views are cached by modification time, so editing one is picked up without a reload); the React engine only announces that `config/next.js` or `config/webpack.js` changed (Next.js watches the pages itself); the Inertia engine lets Vite watch. `Ctrl+R` in the terminal triggers the same reload. `henri.analyze().reload` reports the last one: what released, what reloaded, in what order and how long it took.

## Shutdown

`henri.stop()` stops the modules in the reverse of the graph — a module always stops before the ones it depends on — keeps going when one fails, and resolves with the array of errors (empty when everything stopped). The exit code is `1` when a module failed to stop.

`SIGINT` and `SIGTERM` do not call it first: they drain. `henri.server.draining` turns true, so `/readyz` answers `503` while the port is still open (`shutdown.delay`, `0` by default, keeps serving that long); the listener closes and the idle keep-alive sockets are hung up; the requests in flight finish, within `shutdown.drain` (10 seconds) before their sockets are destroyed; and only then does `henri.stop()` run, with the same 5 second timeout as before. A second signal exits at once, and `shutdown.signals: false` leaves the signals to the application — `henri.server.shutdown('SIGTERM')` is the handler it writes. See [Shutdown](/configuration/#shutdown).

## Contributing

henri is a pnpm monorepo. Clone [usehenri/henri](https://github.com/usehenri/henri), run `pnpm install` at the root, `pnpm test` to run the suites and `pnpm lint` before sending a pull request. The disk adapter tests download a MongoDB binary on first run. See `CONTRIBUTING.md` in the repository for the pull request checklist and how releases work.
