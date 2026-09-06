# Change Log

## 1.2.0

### Minor Changes

- [#387](https://github.com/usehenri/henri/pull/387) [`43d267f`](https://github.com/usehenri/henri/commit/43d267f0f9d192b2c01e89c3925b7daf5000041b) Thanks [@reel](https://github.com/reel)! - Drizzle is henri's SQL data layer: `henri new` defaults to it, and `@usehenri/postgresql` and `@usehenri/mysql` are it
  
  **This is a breaking change.** It rewrites what an existing store does rather than adding to it, and there is no compatibility switch. It is here rather than in a 2.0 because henri has no installed base to protect; if you have an application on `@usehenri/postgresql` or `@usehenri/mysql`, read the second half of this.
  
  **`henri new` scaffolds a drizzle store on sqlite.** `file:.henri/app.db`, `:memory:` under `NODE_ENV=test`, `@usehenri/drizzle` and `better-sqlite3` in the dependencies. This is Rails' default: nothing to start on the first run, a file the `.gitignore` already covers, migrations from the first day, and a database that is a real one on the last. The zero-config MongoDB store is `henri new --adapter disk`, one flag away and otherwise unchanged. `--adapter` now takes `drizzle` (the default), `postgresql`, `mysql`, `mssql`, `mongoose` and `disk`, and `--dialect sqlite|postgres|mysql` works on its own now that drizzle is the default adapter.
  
  The first run costs nothing extra: `better-sqlite3` 13 ships its compiled addon for darwin, linux, linuxmusl and win32 on arm64 and x64, so the scaffold lists it as `better-sqlite3: false` under `allowBuilds` — pnpm skips a `node-gyp rebuild` that needs a C++ toolchain and produces nothing that gets loaded. The Dockerfile of a sqlite application installs no toolchain either, and says instead that the database file lives inside the container unless a volume is mounted over it.
  
  **`@usehenri/postgresql` and `@usehenri/mysql` are `@usehenri/drizzle` with the dialect and the driver chosen.** The package names, the `--adapter postgresql` and `--adapter mysql` flags and the `"adapter": "postgresql"` store value are unchanged; the ORM behind them is not. The name means "henri's PostgreSQL adapter", and henri's PostgreSQL adapter is Drizzle. A store on one of them now has generated, versioned migrations (`henri db:generate`, `db:migrate`, `db:push`, `db:status`), needs no `dialect` key, and needs no driver in the application: `pg` and `mysql2` ship with the adapter package. `"adapter": "mariadb"` is `@usehenri/mysql` and follows.
  
  What that costs an application already on one of them: the global is the drizzle model, not a Sequelize `ModelStatic`. `findAll`, `findOne`, `findByPk`, `create`, `count`, `destroy`, `instance.update()` and `instance.destroy()` mean the same thing; `Model.scope()`, `findAndCountAll()`, `bulkCreate()`, `upsert()`, `increment()`, the association mixins and `instance.previous()` are gone and throw. Tables and columns are named the drizzle way (`tasks`, `created_at`, not `Tasks`, `createdAt`), so a database built by `sequelize.sync()` is not the one this adapter looks for. `website/src/content/docs/upgrading.md` has the list and the order to work through it.
  
  **The spellings that would have silently meant something else are refused.** This is the part that matters even if you never wrote a line of Sequelize. `Model.update(values, { where })` is Sequelize's argument order and the opposite of this adapter's: read as written it updates the rows matching the _values_ and sets a column called `where`, which answered "1 row updated" and changed nothing. It now raises the new `HENRI_MODEL_INVALID_QUERY`. So does a condition keyed by Sequelize's `Op` symbols (`Object.keys()` cannot see a symbol, so the condition narrowed nothing and the query answered every row), an empty operator object under a field, and `instance.get({ plain: true })`. An option the adapter does not read — `attributes`, `fields`, `raw`, `transaction`, `individualHooks`, `lock`, `plain` — raises the new `HENRI_MODEL_UNKNOWN_OPTION` instead of being dropped, because a dropped `fields` is a mass assignment somebody thought they had bounded. A model file's `options` takes `timestamps`, `paranoid`, `externalId`, `personal` and `retention`; one declaring `indexes`, `scopes`, `defaultScope`, `hooks`, `tableName`, `underscored` or `freezeTableName` fails the boot naming the key and what to write instead, rather than starting an application whose author believes it has an index it does not have.
  
  **`@usehenri/sequelize` is the SQL Server story, and only that.** Drizzle has no SQL Server dialect — drizzle-orm 0.45 ships pg, mysql, sqlite, singlestore and gel; drizzle-kit 0.31 generates for postgresql, mysql, sqlite, turso, singlestore and gel — so Sequelize is how henri reaches one, `@usehenri/mssql` is built on it, and neither is going anywhere. Everything an mssql store does differently from every other SQL store (no migrations, `sequelize.sync()` in development, nothing in production, `henri db:status` for the drift) follows from that one fact, and the documentation now says so rather than describing four equal SQL adapters.

- [#349](https://github.com/usehenri/henri/pull/349) [`0fe4c89`](https://github.com/usehenri/henri/commit/0fe4c898862feed6338e8da101d84b9ea2463ce9) Thanks [@reel](https://github.com/reel)! - `henri new` scaffolds an Inertia application. The default renderer is now `inertia`.
  
  A new application gets `"renderer": "inertia"` in `config/default.json`, `.jsx` pages under `app/views/pages` and a Vite build. `henri new --renderer react` still scaffolds the Next.js application, and that engine is supported: it is frozen on the pages router rather than removed, because the contract that hands a controller's data to a page (`withHenri` reading `req._henri` on the server) has no equivalent in the app router. Both renderers now get the same sample: `henri new` scaffolds the `Task` resource with the generators on either one, so the Inertia template no longer ships a hand-written sample page of its own.
  
  `henri generate scaffold` and `henri generate crud` follow the `renderer` of the application, read back from its configuration. An Inertia application gets `.jsx` pages using `useHenri()`, `<Form>` and `router`; a React one keeps getting `.js` pages using `withHenri` and `@usehenri/react/forms`. The renderer is also what a failed write answers a browser with: the Inertia controllers call `res.inertia.errors()` and render the form page again, the React ones answer the `422` their forms read, and API clients get the same `422` from both. `henri generate test` writes the Inertia page object assertions next to the HAL ones in an Inertia application.
  
  Nothing changes for an existing application: its `renderer` key is what the boot and the generators read, and there is no migration.

- [#320](https://github.com/usehenri/henri/pull/320) [`325d0aa`](https://github.com/usehenri/henri/commit/325d0aa0e16dc3c86bfb6bbfa26fdb344a382a76) Thanks [@reel](https://github.com/reel)! - `henri new` scaffolds a styled application: Tailwind CSS v4, out of the box, on both renderers.
  
  The nine-line Sass stylesheet is gone. `app/views/styles/index.css` is now the whole stylesheet of a new application: `@import 'tailwindcss' source(none)` with the `@source` globs of `pages/` and `components/`, a `color-scheme: light dark` root and a body rule. The React template compiles it with `@tailwindcss/postcss` through a new `app/views/postcss.config.mjs` (next.js reads its PostCSS configuration from `app/views`); the Inertia template merges the `@tailwindcss/vite` plugin into `app/views/vite.config.mjs`. Both work in development and in production, Inertia's server-side rendering included, and every `henri new --adapter` combination gets the same wiring.
  
  The sample pages are written with it. The welcome page, the Inertia tasks page and the five view templates behind `henri generate scaffold` (index, show, new, edit, `_form`) render a designed page instead of unstyled text, with a dark mode that follows the operating system through Tailwind's `dark:` variant. The class lists long enough to hide the markup sit in a `const` at the top of the page, so `useHenri()`, `withHenri` and the form handling stay in plain sight.
  
  The generated `AGENTS.md` has a `## Styling` section stating the convention (one stylesheet, utility classes in the pages, no `tailwind.config.js`, `dark:` on every colour), and the generated `README.md` says how to drop Tailwind: nothing in henri depends on it, the classes are plain strings in the pages.

- [#314](https://github.com/usehenri/henri/pull/314) [`b45f7c8`](https://github.com/usehenri/henri/commit/b45f7c8e6a02d8e84ec648ebd58803936934cae3) Thanks [@reel](https://github.com/reel)! - `henri new` and `henri init` take `--adapter disk|drizzle|mongoose|mysql|postgresql|mssql` (and `--dialect sqlite|postgres|mysql` with drizzle) to pick the store of the new application. `disk` stays the default, so nothing changes without the flag.
  
  The adapter drives the whole scaffold: the store block of `config/default.json`, a `config/test.json` on its own database, the dependencies and the driver (`better-sqlite3`, `pg` or `mysql2` for drizzle, allow-listed in `pnpm-workspace.yaml` when it needs a build), the README and AGENTS.md, and the sample `Task` resource. `henri generate scaffold|crud` now reads the adapter back from the configuration and writes a controller against the model API that store really has: Mongoose on `disk` and `mongoose`, Sequelize (`findAll`, `findByPk`, `row.update()`) on `mysql`, `postgresql` and `mssql`, the Rails-like Drizzle model (`query().offset().limit()`, `count`, `findByIdAndUpdate`) on `drizzle`. `henri doctor` knows the new combinations, including the driver a drizzle dialect needs.

### Patch Changes

- [#314](https://github.com/usehenri/henri/pull/314) [`b45f7c8`](https://github.com/usehenri/henri/commit/b45f7c8e6a02d8e84ec648ebd58803936934cae3) Thanks [@reel](https://github.com/reel)! - Fix `henri new` picking the wrong package manager, and two Inertia scaffold problems.
  
  `henri new` probed `pnpm --version` then `yarn --version` and took the first that answered. A version manager shim (mise, asdf) answers non-zero outside a project it manages, so a pnpm machine got a yarn application with no `pnpm-workspace.yaml`, and the first `pnpm install` failed with `ERR_PNPM_IGNORED_BUILDS`. The manager is now, in order: `--pm pnpm|yarn|npm` (new flag on `new` and `init`), the `packageManager` field, the lockfile, `npm_config_user_agent` (the manager that ran the command), then the probe. The choice and where it came from are printed, and `pnpm-workspace.yaml` is written whatever the manager is, since npm and yarn ignore it.
  
  A fresh Inertia application now ships `test/tasks.test.js`, so `henri test` is green from the first minute instead of exiting `1` on "No test files found", and its `eslint.config.js` declares the model globals of `app/models`, the Vitest globals and `vitest.config.js` like the React one does.
  
  `henri doctor` no longer reports an installed ESM-only dependency as missing (`@inertiajs/react declared in package.json but not installed`): `resolvePackageJson` falls back to reading `node_modules/<name>/package.json` from disk when the package's `exports` map has no `require` and no `./package.json` condition.

- [#326](https://github.com/usehenri/henri/pull/326) [`18715f9`](https://github.com/usehenri/henri/commit/18715f90ea8958dc57da1bb029b8209c36b84cc6) Thanks [@reel](https://github.com/reel)! - Three fixes found by building a full application on the framework (`showcase/`).
  
  `henri db:seed` boots the user module. It stopped at runlevel 3 (the models), and creating a user goes through `henri.user.encrypt()` to hash its password, so any `db/seeds.js` that wrote a user failed with `Cannot read properties of undefined (reading 'encrypt')` — which is every seed file of an application with authentication. Seeds now boot to runlevel 4; the migration commands still stop at 3, since they need no session.
  
  `henri generate agents` reads the store from the configuration. It always wrote an `AGENTS.md` describing the `disk` adapter and the Mongoose query API, whatever the application ran on, so a coding agent in a Drizzle or Sequelize application was handed the wrong model API in the first paragraph it read. The renderer was already read from the configuration; the adapter now is too (`adapterOf()`, next to `apiOf()`).
  
  The HAL guard leaves Inertia page objects alone. A route expanded from `resources` or `crud` reported (and, with `config.api.strict`, refused with a `500`) every JSON answer without `_links` — including the `{ component, props, url, version }` object the Inertia view engine answers a client-side visit with, which is a rendered page and not an API answer. Navigating between two pages of a `resources` route under `api.strict` answered `500`; without it, every visit logged a false warning. Answers carrying the `X-Inertia` header are no longer checked.
- Updated dependencies [[`1e23664`](https://github.com/usehenri/henri/commit/1e23664829bd1a356de28f404cfb21c9ae211388), [`5b627ad`](https://github.com/usehenri/henri/commit/5b627adfa37e9f16bc75af96cc8ff5308a91f688), [`1b316c6`](https://github.com/usehenri/henri/commit/1b316c6f3c5d5eb5752c70b534092d1052956cc6), [`b559fb7`](https://github.com/usehenri/henri/commit/b559fb72b391eeb21a3f6a0cda1515e01ecbfafc), [`1c0dfe8`](https://github.com/usehenri/henri/commit/1c0dfe84a98eff2122512256c4f42ec7ccde4212), [`43689b4`](https://github.com/usehenri/henri/commit/43689b47b2f15852a78fe686f60833be8e891b72), [`b278119`](https://github.com/usehenri/henri/commit/b2781190de436eb5838e866446c9a0c8210bb6ca), [`1616e34`](https://github.com/usehenri/henri/commit/1616e343a612be2bffffcfa5b23bfa8ad191bbe3), [`ab5a8e4`](https://github.com/usehenri/henri/commit/ab5a8e4a88c80cca070a2b8ad398c80babdaff11), [`345a102`](https://github.com/usehenri/henri/commit/345a10230f7a07ca1ef88676abcbbc07e84dd479), [`43d267f`](https://github.com/usehenri/henri/commit/43d267f0f9d192b2c01e89c3925b7daf5000041b), [`7071e76`](https://github.com/usehenri/henri/commit/7071e766f060ff28804549adcb22f73c18adff90), [`89dda62`](https://github.com/usehenri/henri/commit/89dda62da456a0a55600e79cfb65ce89f11258e2), [`62fac46`](https://github.com/usehenri/henri/commit/62fac46fd6cae5581979b73daf99700fd246e0ea), [`d9f3be4`](https://github.com/usehenri/henri/commit/d9f3be49c5929d929a220220bf6e72fdcb135595), [`c44f025`](https://github.com/usehenri/henri/commit/c44f025acec3d5bbbb57e2310d02184a1053a10d), [`67cfb20`](https://github.com/usehenri/henri/commit/67cfb200ea0e0b31bacf2af183db6467b0fa011d), [`e661f98`](https://github.com/usehenri/henri/commit/e661f98fe8f8acce15aa10ce2dc320c5a2cb006f), [`e1f68c5`](https://github.com/usehenri/henri/commit/e1f68c5add471c8129e7131dce93310cda907533), [`2c8a826`](https://github.com/usehenri/henri/commit/2c8a8265262dbf6ea5c3e73e8e7892a230d4d0f0), [`46d5dbc`](https://github.com/usehenri/henri/commit/46d5dbcc983c03e96ae5a87d7288c5d8a5adbc24), [`ba97ea9`](https://github.com/usehenri/henri/commit/ba97ea968f0b34cd67b7a3e803ecd34543b8aaaf), [`0fe4c89`](https://github.com/usehenri/henri/commit/0fe4c898862feed6338e8da101d84b9ea2463ce9), [`5ccd537`](https://github.com/usehenri/henri/commit/5ccd537b3621b54d11e7f24ccca39643ae7d5cf7), [`9895cbf`](https://github.com/usehenri/henri/commit/9895cbf4be85b476e341a5be915e3049e5a027de), [`5a150d5`](https://github.com/usehenri/henri/commit/5a150d576208571c32b9cd12827d035e31ed4313), [`a1c6769`](https://github.com/usehenri/henri/commit/a1c6769099e3dc28b22b5338a2a57b13bdf69f7a), [`dd2731d`](https://github.com/usehenri/henri/commit/dd2731d6a20fd96aa1be1aeb5e6ec0155001326b), [`b7038ce`](https://github.com/usehenri/henri/commit/b7038ceaa430f4a0b9eaf7e983fc2844421bf636), [`1ea0f85`](https://github.com/usehenri/henri/commit/1ea0f85066b86fba31f58937cc10abb6359e6a26), [`b45f7c8`](https://github.com/usehenri/henri/commit/b45f7c8e6a02d8e84ec648ebd58803936934cae3), [`e31a3f7`](https://github.com/usehenri/henri/commit/e31a3f73e7e8facf3cedf7460f115e57995f32c3), [`2689779`](https://github.com/usehenri/henri/commit/26897798b840fd28a4bc091c050a83457b36905d), [`72cd1d3`](https://github.com/usehenri/henri/commit/72cd1d35ffb99311bbca815c1f6ab41ee3682f64), [`a2e1ec2`](https://github.com/usehenri/henri/commit/a2e1ec29df52462f12ebaae9bfbc1ad4f427b27f), [`afead74`](https://github.com/usehenri/henri/commit/afead7489498ed42e1893a25123ea772cac2ca09), [`a4ecba5`](https://github.com/usehenri/henri/commit/a4ecba50c663f4d5c741adbb6cd9bc0eefe0e5cc), [`baec3fd`](https://github.com/usehenri/henri/commit/baec3fd22be92bf8ffbaeb251b0b6c2771f8347a), [`ada4794`](https://github.com/usehenri/henri/commit/ada4794204a72cf6e4bfe691a08933df92dd7ff4), [`fd59971`](https://github.com/usehenri/henri/commit/fd59971af2237b62a4fac78ec99c1e1dfbaab92b), [`6bc8a44`](https://github.com/usehenri/henri/commit/6bc8a4494136e8b634938d643894214f757dd796), [`4274567`](https://github.com/usehenri/henri/commit/4274567e20a980657f07df9ec7db25296c7d55f5), [`8a8e3b3`](https://github.com/usehenri/henri/commit/8a8e3b33d7967b81f66633aa25c3075318f01d60), [`18715f9`](https://github.com/usehenri/henri/commit/18715f90ea8958dc57da1bb029b8209c36b84cc6), [`325d0aa`](https://github.com/usehenri/henri/commit/325d0aa0e16dc3c86bfb6bbfa26fdb344a382a76), [`fda9366`](https://github.com/usehenri/henri/commit/fda9366e9ed2b072764a995c5aa60205ca7a4725), [`1a86acb`](https://github.com/usehenri/henri/commit/1a86acbf15e4a43e5fb81277bb22e101c06e77a4), [`c0c16e8`](https://github.com/usehenri/henri/commit/c0c16e873ba440aee9832160553cbb12ab81bd2c), [`41470bf`](https://github.com/usehenri/henri/commit/41470bf378d83ca3d35d00e8c31796fea5eb15e0), [`b45f7c8`](https://github.com/usehenri/henri/commit/b45f7c8e6a02d8e84ec648ebd58803936934cae3), [`8e44e7e`](https://github.com/usehenri/henri/commit/8e44e7e882dd8741b3ac632651b453389d76bf2c), [`de1c1e0`](https://github.com/usehenri/henri/commit/de1c1e02ed83d13dcfeb8e44012f309eb663f03e), [`4b4677d`](https://github.com/usehenri/henri/commit/4b4677d4a09d39fe50b1fa4af577600342578daf)]:
  - @usehenri/cli@1.2.0

## 1.1.0

### Minor Changes

- [#303](https://github.com/usehenri/henri/pull/303) [`f8ad32f`](https://github.com/usehenri/henri/commit/f8ad32fd996560337bda5f87332ecab4e5902ce9) Thanks [@reel](https://github.com/reel)! - henri is now agent-friendly: every new application gets an `AGENTS.md` stating
  the conventions (layout, naming, generators, the model format, controllers,
  routes, configuration, tests, commands and exit codes, a do-not list), a
  `CLAUDE.md` pointing to it and a `.mcp.json` starting the new MCP server.
  `henri generate agents` writes them into an existing application.
  
  `--json` everywhere: `henri help --json` (the catalogue of commands, flags and
  exit codes), `henri about --json`, `henri routes --json`, `henri generate` and
  `henri destroy --json` (the files written or removed and the routes changed),
  `henri doctor --json`, and every error printed as
  `{ "error": { command, message, hint, code, exitCode } }` on stderr. Exit codes
  are stable and documented in `henri help`: 0 ok, 1 failed, 2 usage error, 3 not
  a henri application, 4 a prompt was needed without a terminal.
  `henri clean` takes `--all`, `-y`/`--yes` or the folder names and fails fast
  with a hint when stdin is not a terminal.
  
  `henri doctor` checks the application against the conventions without
  starting it: model files singular and PascalCase, controllers lowercase and
  routed, every `resources` route backed by a controller, its actions and its
  pages, `.env` present and ignored by git, no `secret` in `config/*.json`,
  `AGENTS.md` and `vitest.config.js` present, dependencies declared and
  installed. It exits with 1 when a problem is found.
  
  `@usehenri/mcp` (`henri mcp`) is a stdio MCP server exposing the tools
  `routes`, `models`, `controllers`, `config` (secrets redacted), `generate`,
  `destroy`, `test`, `lint` and `doctor`, and the resources `henri://agents.md`,
  `henri://conventions`, `henri://routes` and `henri://help`. No shell, paths
  confined to the application, generators as the only write path.

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - CLI: `henri routes` prints the routes table from `config/routes.js` without starting the server, `henri --version` prints the version, `henri <command> --help` prints the help of every command without running it, and a failing command prints its error instead of the generic help.
  
  Generators: `generate scaffold|crud` write controllers on the Mongoose 9 API (`findById`, `findByIdAndUpdate` with `runValidators`, `findByIdAndDelete`), answer validation errors with a 422, missing documents with a 404, pick the attributes with `req.permit()` and answer HTML or JSON through `res.format`. Resources are plural and unscoped (`Post` gives `app/controllers/posts.js`, `resources posts`, `app/views/pages/posts/`). `generate model` validates the attribute types (`string|text|number|integer|float|boolean|date|json|uuid`, `!` for required). `generate controller` adds one route per action and `destroy controller` removes them. New `generate worker` and `generate test` (with the matching `destroy` targets). Existing files are skipped unless `--force` is given.
  
  `henri build` builds the React views through `@usehenri/react/engine` without booting the stores.
  
  `henri new`: `git init` (skipped inside a repository or with `--no-git`), a README, `config/default.json` without the secret (committed) and the secret in `.env` (`HENRI_SECRET`, ignored), a `Task` scaffold with a controller, pages and a `test/tasks.test.js` using `@usehenri/testing`. `init` names the project after the folder, `pnpm-workspace.yaml` is only written for pnpm and exit codes are positive.

- [#305](https://github.com/usehenri/henri/pull/305) [`a2cf383`](https://github.com/usehenri/henri/commit/a2cf383d6f3b4405b73816bc38175ad6f308dff4) Thanks [@reel](https://github.com/reel)! - New `@usehenri/drizzle` store adapter on Drizzle ORM: sqlite (better-sqlite3), postgres (pg) and mysql (mysql2) behind one Rails-like model API. An app selects it with `"stores": { "default": { "adapter": "drizzle", "dialect": "sqlite", "url": "file:.henri/app.db" } }` and installs the driver it needs.
  
  - Models compile the henri model format (`string|text|number|integer|float|boolean|date|json|uuid`, `required`, `default`, `enum`, `unique`, `index`, plus `select: false`, `min`, `max`, `minLength`, `maxLength`, `match`, `validate`, `lowercase`, `trim`, `references`) into Drizzle tables per dialect: plural snake_case tables, snake_case columns, `id` primary keys, `createdAt`/`updatedAt` with `options.timestamps`, pg enum types and mysql enums.
  - Model API: `create`, `find`, `findOne`, `findById`, `all`, `count`, `exists`, `pluck`, `update`, `destroy`, `findByIdAndUpdate`, `findByIdAndDelete`, `findOneAndUpdate`, `findOneAndDelete` and their Mongoose and Sequelize aliases; lazy chains `where().order().limit().offset().include().withHidden().first()/last()/count()`; instances with `save`, `update`, `destroy`, `reload`, `changed`, `toJSON`; `ValidationError` with `errors[field].message` (the shape the generated controllers read), unique violations included; `beforeValidate`, `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDestroy`, `afterDestroy` hooks; `belongsTo`, `hasMany`, `hasOne` in `associate(models)` with eager loading through `include()`; `adapter.transaction(fn)` with implicit joining.
  - User model: `email` unique, lowercased, trimmed and validated; `password` hashed on create and on every update that sets it, never selected by default; `roles` JSON, dropped from mass assignment unless `{ unsafe: true }`, `user.hasRole()`, `user.setRoles()`, `User.setRoles(id, roles)`.
  - Sessions: an express-session store on a `henri_sessions` table (get/set/destroy/touch/all/clear/length, expiry with the cookie, periodic sweep).
  - Migrations in `db/migrations` (drizzle-kit layout): `henri db:generate`, `henri db:migrate`, `henri db:push`, `henri db:status` (`henri db <command>` works too). Development boots push the schema unless the store sets `"sync": false`; production boots apply the migrations with `"migrate": true` and warn about pending ones otherwise.
  - Core accepts `"adapter": "drizzle"`.

### Patch Changes

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - The published packages declare their `files`: the tarballs no longer ship the
  test suites and every package carries the LICENSE, a README and its changelog.
  `@usehenri/websocket` is no longer published (it was never wired into core).
- Updated dependencies [[`f8ad32f`](https://github.com/usehenri/henri/commit/f8ad32fd996560337bda5f87332ecab4e5902ce9), [`f99341c`](https://github.com/usehenri/henri/commit/f99341cdf05b9306bfca0c8385aee1661fc77f4f), [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e), [`a2cf383`](https://github.com/usehenri/henri/commit/a2cf383d6f3b4405b73816bc38175ad6f308dff4), [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e), [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e), [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e)]:
  - @usehenri/cli@1.1.0

## 1.0.2

### Patch Changes

- Updated dependencies []:
  - @usehenri/cli@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [[`1f71bcb`](https://github.com/usehenri/henri/commit/1f71bcb8285e7853e7df15941dab02067cc9d219)]:
  - @usehenri/cli@1.0.1

## 1.0.0

### Major Changes

- [#283](https://github.com/usehenri/henri/pull/283) [`67f4b1a`](https://github.com/usehenri/henri/commit/67f4b1afe32f1820ed775b836062b3bb1b3da840) Thanks [@reel](https://github.com/reel)! - Revive henri on a current toolchain. This is a breaking release.
  
  - Node.js 22 or newer is required.
  - `@usehenri/core`: Express 5, Apollo Server 5 with `@graphql-tools` (`henri.graphql.run()` returns `{ data, errors }`, Apollo error classes are `GraphQLError` subclasses), bcryptjs instead of native bcrypt, passport 0.7 (`req.logout` takes a callback), `henri.server.stop()` closes the server. Model globals are also written to `.henri/globals.json`.
  - `@usehenri/mongoose` and `@usehenri/disk`: Mongoose 9, connect-mongo 6, mongodb-memory-server 11. The disk store is a local MongoDB with on-disk persistence outside test mode.
  - `@usehenri/sequelize`, `@usehenri/mysql`, `@usehenri/postgresql`, `@usehenri/mssql`: Sequelize 6 latest with mysql2 3, pg 8 and tedious 20. The user model overload uses valid Sequelize options (`allowNull`, a `TEXT` roles column with a JSON getter/setter, `hasRole`, re-hash on `beforeUpdate`) and `start()` waits for `sync()`.
  - `@usehenri/react`: Next.js 16 (Turbopack) and React 19. `withHenri` exposes `HenriContext` and `useHenri()` instead of legacy context; forms get `useForm()` and `react-quill-new`. `next` is a peer dependency: apps must depend on `next`, `react` and `react-dom`. The `inferno` and `preact` renderers are gone; `config/next.js` can extend the Next.js config and `config/webpack.js` switches the bundler to webpack.
  - `@usehenri/cli` and `henri`: Node 22 check, prettier 3, `@inquirer/prompts`; `henri new` scaffolds a React 19 app with `next.config.js`, `jsconfig.json`, an ESLint flat config and a `pnpm-workspace.yaml` allowing the build scripts pnpm 10+ blocks.
  - `@usehenri/testing` and `@usehenri/websocket` load again; `@usehenri/mailer` is no longer published (the mailer lives in core).

### Patch Changes

- Updated dependencies [[`67f4b1a`](https://github.com/usehenri/henri/commit/67f4b1afe32f1820ed775b836062b3bb1b3da840)]:
  - @usehenri/cli@1.0.0

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.37.2](https://github.com/usehenri/henri/compare/v0.37.1...v0.37.2) (2020-01-13)

**Note:** Version bump only for package henri





## [0.37.1](https://github.com/usehenri/henri/compare/v0.37.0...v0.37.1) (2019-12-24)

**Note:** Version bump only for package henri





# [0.37.0](https://github.com/usehenri/henri/compare/v0.36.5...v0.37.0) (2019-09-23)

**Note:** Version bump only for package henri





## [0.36.5](https://github.com/usehenri/henri/compare/v0.36.4...v0.36.5) (2019-09-23)

**Note:** Version bump only for package henri





## [0.36.4](https://github.com/usehenri/henri/compare/v0.36.3...v0.36.4) (2019-09-18)

**Note:** Version bump only for package henri





## [0.36.3](https://github.com/usehenri/henri/compare/v0.36.2...v0.36.3) (2019-09-18)

**Note:** Version bump only for package henri





## [0.36.2](https://github.com/usehenri/henri/compare/v0.36.1...v0.36.2) (2019-09-04)

**Note:** Version bump only for package henri





## [0.36.1](https://github.com/usehenri/henri/compare/v0.36.0...v0.36.1) (2019-09-04)

**Note:** Version bump only for package henri





# [0.36.0](https://github.com/usehenri/henri/compare/v0.35.2...v0.36.0) (2019-09-04)

**Note:** Version bump only for package henri





## [0.35.2](https://github.com/usehenri/henri/compare/v0.35.1...v0.35.2) (2019-07-04)

**Note:** Version bump only for package henri





## [0.35.1](https://github.com/usehenri/henri/compare/v0.35.0...v0.35.1) (2019-06-28)

**Note:** Version bump only for package henri





# [0.35.0](https://github.com/usehenri/henri/compare/v0.34.7...v0.35.0) (2019-06-19)

**Note:** Version bump only for package henri





## [0.34.7](https://github.com/usehenri/henri/compare/v0.34.6...v0.34.7) (2019-06-10)

**Note:** Version bump only for package henri





## [0.34.6](https://github.com/usehenri/henri/compare/v0.34.6-alpha.0...v0.34.6) (2019-05-28)


### Bug Fixes

* **cli:** checks for yarn and min version ([3892f6b](https://github.com/usehenri/henri/commit/3892f6b))





## [0.34.6-alpha.0](https://github.com/usehenri/henri/compare/v0.34.5...v0.34.6-alpha.0) (2019-04-22)

**Note:** Version bump only for package henri





## [0.34.5](https://github.com/usehenri/henri/compare/v0.34.4...v0.34.5) (2019-04-18)

**Note:** Version bump only for package henri





## [0.34.4](https://github.com/usehenri/henri/compare/v0.34.4-alpha.4...v0.34.4) (2019-04-12)


### Bug Fixes

* **cli:** adding a check to be sure that NodeJS version is >= 10 ([8d13fa0](https://github.com/usehenri/henri/commit/8d13fa0))





## [0.34.4-alpha.4](https://github.com/usehenri/henri/compare/v0.34.4-alpha.3...v0.34.4-alpha.4) (2019-03-28)

**Note:** Version bump only for package henri





## [0.34.4-alpha.3](https://github.com/usehenri/henri/compare/v0.34.4-alpha.2...v0.34.4-alpha.3) (2019-02-15)

**Note:** Version bump only for package henri





## [0.34.4-alpha.2](https://github.com/usehenri/henri/compare/v0.34.4-alpha.1...v0.34.4-alpha.2) (2019-02-15)

**Note:** Version bump only for package henri





## [0.34.4-alpha.1](https://github.com/usehenri/henri/compare/v0.34.4-alpha.0...v0.34.4-alpha.1) (2018-12-13)

**Note:** Version bump only for package henri





## [0.34.4-alpha.0](https://github.com/usehenri/henri/compare/v0.34.3...v0.34.4-alpha.0) (2018-12-03)

**Note:** Version bump only for package henri





## [0.34.3](https://github.com/usehenri/henri/compare/v0.34.2...v0.34.3) (2018-11-06)

**Note:** Version bump only for package henri





## [0.34.2](https://github.com/usehenri/henri/compare/v0.34.1...v0.34.2) (2018-10-31)

**Note:** Version bump only for package henri





## [0.34.1](https://github.com/usehenri/henri/compare/v0.34.0...v0.34.1) (2018-10-31)

**Note:** Version bump only for package henri





# [0.34.0](https://github.com/usehenri/henri/compare/v0.33.1...v0.34.0) (2018-10-30)

**Note:** Version bump only for package henri





## [0.33.1](https://github.com/usehenri/henri/compare/v0.33.0...v0.33.1) (2018-10-29)

**Note:** Version bump only for package henri





# [0.33.0](https://github.com/usehenri/henri/compare/v0.32.0...v0.33.0) (2018-10-26)


### Features

* **testing:** adding the package ([e2ec87b](https://github.com/usehenri/henri/commit/e2ec87b))





# [0.32.0](https://github.com/usehenri/henri/compare/v0.31.1...v0.32.0) (2018-10-23)

**Note:** Version bump only for package henri





# [0.31.0](https://github.com/usehenri/henri/compare/v0.30.3...v0.31.0) (2018-10-17)

**Note:** Version bump only for package henri





<a name="0.30.3"></a>
## [0.30.3](https://github.com/usehenri/henri/compare/v0.30.2...v0.30.3) (2018-09-28)

**Note:** Version bump only for package henri





<a name="0.30.2"></a>
## [0.30.2](https://github.com/usehenri/henri/compare/v0.30.1...v0.30.2) (2018-09-26)


### Bug Fixes

* **henri:** henri should be scoped and always referred internally as this.henri (avoids leaks in testing) ([b046cc4](https://github.com/usehenri/henri/commit/b046cc4))





<a name="0.30.0"></a>
# [0.30.0](https://github.com/usehenri/henri/compare/v0.29.3...v0.30.0) (2018-09-26)


### Features

* **henri:** henri should be used with Node 10+ ([de18480](https://github.com/usehenri/henri/commit/de18480))





<a name="0.29.3"></a>
## [0.29.3](https://github.com/usehenri/henri/compare/v0.29.2...v0.29.3) (2018-08-29)

**Note:** Version bump only for package henri





<a name="0.29.2"></a>
## [0.29.2](https://github.com/usehenri/henri/compare/v0.29.1...v0.29.2) (2018-08-23)

**Note:** Version bump only for package henri





<a name="0.29.0"></a>
# [0.29.0](https://github.com/usehenri/henri/compare/v0.28.0...v0.29.0) (2018-08-23)

**Note:** Version bump only for package henri





<a name="0.28.0"></a>
# [0.28.0](https://github.com/usehenri/henri/compare/v0.27.0...v0.28.0) (2018-07-13)




**Note:** Version bump only for package henri

<a name="0.27.0"></a>
# [0.27.0](https://github.com/usehenri/henri/compare/v0.26.1...v0.27.0) (2018-07-12)




**Note:** Version bump only for package henri

<a name="0.26.1"></a>
## [0.26.1](https://github.com/usehenri/henri/compare/v0.26.0...v0.26.1) (2018-06-22)




**Note:** Version bump only for package henri

<a name="0.26.0"></a>
# [0.26.0](https://github.com/usehenri/henri/compare/v0.25.0...v0.26.0) (2018-06-21)




**Note:** Version bump only for package henri

<a name="0.25.0"></a>
# [0.25.0](https://github.com/usehenri/henri/compare/v0.24.0...v0.25.0) (2018-05-22)




**Note:** Version bump only for package henri

<a name="0.24.0"></a>
# [0.24.0](https://github.com/usehenri/henri/compare/v0.23.0...v0.24.0) (2018-05-11)




**Note:** Version bump only for package henri

<a name="0.23.0"></a>
# [0.23.0](https://github.com/usehenri/henri/compare/v0.22.0...v0.23.0) (2018-04-23)




**Note:** Version bump only for package henri

<a name="0.22.0"></a>
# [0.22.0](https://github.com/usehenri/henri/compare/v0.21.3...v0.22.0) (2018-04-17)




**Note:** Version bump only for package henri

<a name="0.21.2"></a>
## [0.21.2](https://github.com/usehenri/henri/compare/v0.21.1...v0.21.2) (2018-04-10)




**Note:** Version bump only for package henri

<a name="0.21.1"></a>
## [0.21.1](https://github.com/usehenri/henri/compare/v0.21.0...v0.21.1) (2018-04-10)




**Note:** Version bump only for package henri

<a name="0.21.0"></a>
# [0.21.0](https://github.com/usehenri/henri/compare/v0.20.2...v0.21.0) (2018-04-10)




**Note:** Version bump only for package henri

<a name="0.20.2"></a>
## [0.20.2](https://github.com/usehenri/henri/compare/v0.20.1...v0.20.2) (2018-01-27)




**Note:** Version bump only for package henri

<a name="0.20.1"></a>
## [0.20.1](https://github.com/usehenri/henri/compare/v0.20.0...v0.20.1) (2017-12-07)




**Note:** Version bump only for package henri

<a name="0.20.0"></a>
# [0.20.0](https://github.com/usehenri/henri/compare/v0.19.0...v0.20.0) (2017-12-07)




**Note:** Version bump only for package henri

<a name="0.19.0"></a>
# [0.19.0](https://github.com/usehenri/henri/compare/v0.18.0...v0.19.0) (2017-11-25)




**Note:** Version bump only for package henri

<a name="0.18.0"></a>
# [0.18.0](https://github.com/usehenri/henri/compare/v0.17.0...v0.18.0) (2017-11-17)


### Features

* **henri:** adding ts definitions ([913916d](https://github.com/usehenri/henri/commit/913916d))




<a name="0.17.0"></a>
# [0.17.0](https://github.com/usehenri/henri/compare/v0.16.1...v0.17.0) (2017-11-09)


### Features

* **cli:** adding outdated notifier ([6c7beb1](https://github.com/usehenri/henri/commit/6c7beb1))
* **henri:** add a better error description for missing cli ([b1038ff](https://github.com/usehenri/henri/commit/b1038ff))




<a name="0.16.1"></a>
## [0.16.1](https://github.com/usehenri/henri/compare/v0.16.0...v0.16.1) (2017-10-06)




**Note:** Version bump only for package henri

<a name="0.16.0"></a>
# [0.16.0](https://github.com/usehenri/henri/compare/v0.15.5...v0.16.0) (2017-10-06)




**Note:** Version bump only for package henri

<a name="0.15.5"></a>
## 0.15.5 (2017-07-17)



<a name="0.15.2"></a>
## 0.15.2 (2017-07-05)


### Features

* **henri:** switch back to yarn and upgrade packages ([15e1664](https://github.com/usehenri/henri/commit/15e1664))
* **view:** adding support for preact and interno... ([324c9db](https://github.com/usehenri/henri/commit/324c9db))



<a name="0.15.0"></a>
# 0.15.0 (2017-07-05)



<a name="0.14.0"></a>
# 0.14.0 (2017-07-05)



<a name="0.13.1"></a>
## 0.13.1 (2017-07-05)



<a name="0.13.0"></a>
# 0.13.0 (2017-07-05)



<a name="0.12.0"></a>
# 0.12.0 (2017-07-05)



<a name="0.11.0"></a>
# 0.11.0 (2017-07-05)



<a name="0.10.0"></a>
# 0.10.0 (2017-07-05)



<a name="0.9.3"></a>
## 0.9.3 (2017-07-05)



<a name="0.9.0-alpha.7"></a>
# 0.9.0-alpha.7 (2017-07-05)
