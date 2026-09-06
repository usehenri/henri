---
title: Under the hood
description: The module system, the boot sequence, reloads and shutdown.
sidebar:
  order: 4
---

## Modules

henri is a set of modules booted in run levels. Modules on the same level start concurrently; the next level starts when they are all done. A module that throws fails the boot: `henri.init()` rejects with an `Error` whose `cause` is the module's error, and the CLI prints it.

| Level | Modules                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------ |
| 0     | `config`: `config/<env>.json`, `.env`                                                            |
| 1     | `mail`, `graphql`                                                                                |
| 2     | `controllers`, `mailers` (`app/mailers`), `server` (the Express app is built, not listening yet) |
| 3     | `model` (stores and model globals), `view` (the engine's `init()`)                               |
| 4     | `user` (sessions, passport, CSRF, `req.permit()`), `jobs` (the queue)                            |
| 5     | `router` (routes, the engine's `prepare()`, then the server listens), `workers`                  |
| 6     | your own modules                                                                                 |

The logger (`henri.pen`) and the registry (`henri.modules`) exist before level 0. Level 7 is reserved for the legacy `tests` module: henri boots up to level 6, and that module only prints a pointer to `henri test` when `HENRI_TESTING` is set.

## Reloads

In development the server watches `app/controllers`, `app/helpers`, `app/jobs`, `app/mailers`, `app/models`, `app/workers`, `app/views/partials`, `config` and `package.json`. Changes are debounced, every changed file is syntax checked first (an error is printed and nothing reloads), then `henri.reload()` runs: the application's own files are evicted from the require cache (nothing under `node_modules`) and the reloadable modules run their `reload()` in level order: `config`, `graphql`, `controllers`, `mailers`, `model`, `view`, `jobs`, `router`, `workers`. `server`, `mail` and `user` are not reloadable. Reloads are serialized: a change during a reload queues exactly one more run.

A model reload stops and restarts the stores; the session store follows the new adapter. The Handlebars engine drops its template cache (mail views are cached by modification time, so editing one is picked up without a reload); the React engine only announces that `config/next.js` or `config/webpack.js` changed (Next.js watches the pages itself); the Inertia engine lets Vite watch. `Ctrl+R` in the terminal triggers the same reload.

## Shutdown

`henri.stop()` stops the modules in reverse order, keeps going when one fails, and resolves with the array of errors (empty when everything stopped). `SIGINT` and `SIGTERM` call it with a 5 second timeout before the process is killed; a second signal exits at once. The exit code is `1` when a module failed to stop.

## Writing a module

A module extends `BaseModule`, has a unique `name` and a `runlevel`, and implements `init()` returning its name. Reloadable modules set `reloadable = true` and add `reload()`; modules holding resources add `stop()`; `consoleOnly = true` skips the module under `henri console`.

```js
const BaseModule = require('@usehenri/core/src/base/module');

class Metrics extends BaseModule {
  constructor() {
    super();
    this.name = 'metrics';
    this.runlevel = 6;
    this.reloadable = false;
  }

  async init() {
    this.henri.server.app.get('/_metrics', (req, res) =>
      res.json({ ok: true })
    );

    return this.name;
  }

  async stop() {
    return false;
  }
}

module.exports = Metrics;
```

Modules are registered with `henri.modules.add(new Metrics())` before `henri.init()` runs, which means booting core yourself instead of through the CLI:

```js
const Henri = require('@usehenri/core/src/henri');
const henri = new Henri();

henri.modules.add(new Metrics());
await henri.init();
```

The instance is exposed as `henri.<name>`, which is why names must be unique: registering two modules with the same name, or one whose name collides with an existing property of `henri`, stops the boot with a [duplicate module error](/e/dup_mods/).

## Contributing

henri is a pnpm monorepo. Clone [usehenri/henri](https://github.com/usehenri/henri), run `pnpm install` at the root, `pnpm test` to run the suites and `pnpm lint` before sending a pull request. The disk adapter tests download a MongoDB binary on first run. See `CONTRIBUTING.md` in the repository for the pull request checklist and how releases work.
