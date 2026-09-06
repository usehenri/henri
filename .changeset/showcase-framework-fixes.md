---
'@usehenri/cli': patch
'@usehenri/core': patch
'henri': patch
---

Three fixes found by building a full application on the framework (`showcase/`).

`henri db:seed` boots the user module. It stopped at runlevel 3 (the models), and creating a user goes through `henri.user.encrypt()` to hash its password, so any `db/seeds.js` that wrote a user failed with `Cannot read properties of undefined (reading 'encrypt')` — which is every seed file of an application with authentication. Seeds now boot to runlevel 4; the migration commands still stop at 3, since they need no session.

`henri generate agents` reads the store from the configuration. It always wrote an `AGENTS.md` describing the `disk` adapter and the Mongoose query API, whatever the application ran on, so a coding agent in a Drizzle or Sequelize application was handed the wrong model API in the first paragraph it read. The renderer was already read from the configuration; the adapter now is too (`adapterOf()`, next to `apiOf()`).

The HAL guard leaves Inertia page objects alone. A route expanded from `resources` or `crud` reported (and, with `config.api.strict`, refused with a `500`) every JSON answer without `_links` — including the `{ component, props, url, version }` object the Inertia view engine answers a client-side visit with, which is a rendered page and not an API answer. Navigating between two pages of a `resources` route under `api.strict` answered `500`; without it, every visit logged a false warning. Answers carrying the `X-Inertia` header are no longer checked.
