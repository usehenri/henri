---
title: Under the hood
description: The module system and boot sequence.
sidebar:
  order: 2
---

## Vision

Bundle the best tools in a structured environment to provide a stable and fast-paced development experience.

## Modules

henri is a set of modules booted in eight run levels. Modules on the same level start concurrently; the next level starts when they are all done.

| Level | Modules                                |
| ----- | -------------------------------------- |
| 0     | configuration, logger, module registry |
| 1     | GraphQL, mail                          |
| 2     | controllers, HTTP server (Express)     |
| 3     | models, views                          |
| 4     | users (sessions, passport, roles)      |
| 5     | routes, workers                        |
| 6     | last stage (your own modules)          |
| 7     | tests                                  |

Reloadable modules are torn down in reverse order and started again in order when a file changes, so a saved model reloads models, views, routes and workers but leaves the HTTP server alone.

## Writing a module

A module extends `BaseModule`, has a unique `name` and a `runlevel`, and implements `init()`. Reloadable modules add `reload()`; modules holding resources add `stop()`.

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

The instance is exposed as `henri.<name>`, which is why names must be unique: registering two modules with the same name, or one whose name collides with an existing property of `henri`, stops the boot with a [duplicate module error](/e/dup_mods/).

## Contributing

henri is a pnpm monorepo. Clone [usehenri/henri](https://github.com/usehenri/henri), run `pnpm install` at the root, `pnpm test` to run the suites and `pnpm lint` before sending a pull request. The disk adapter tests download a MongoDB binary on first run.
