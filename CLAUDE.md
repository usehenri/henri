# henri

henri is a Rails-like, server-side rendered JavaScript framework for Node.js:
models, controllers, routes and React views, with real ORMs and hot reload. This
is the monorepo for the `henri` CLI, `@usehenri/core` and its adapters, the view
engines, the testing helpers and the usehenri.io website. It is public and open
source (MIT). The documentation in `website/src/content/docs` describes what the
code does: keep both in sync when a behaviour changes.

## Setup and commands

Tool versions are pinned in `mise.toml` (Node 24, pnpm 11). Node 22 is the
minimum supported at runtime.

```bash
mise install                          # node + pnpm from mise.toml
pnpm install                          # whole workspace; builds @usehenri/react dist
pnpm test                             # vitest 5, all packages (rebuilds @usehenri/react first)
pnpm test packages/core               # one package (path filter); `pnpm test:cover` for coverage
pnpm test:sql                         # the SQL adapters and the job queue (sqlite; see below for a live server)
pnpm test:types                       # the hand-written .d.ts: packaging, then tsc over types/
pnpm lint                             # eslint 10 flat config, zero warnings in CI
pnpm format                           # prettier 3 (`pnpm format:check` in CI)
pnpm build                            # rollup build of @usehenri/react
pnpm --filter @usehenri/website dev   # docs site (Astro + Starlight); `build` and `preview` too
scripts/smoke.sh                      # scaffold an app from the packed workspace and boot it
pnpm db:up                            # postgres, mysql and mongo for local dev (compose.yaml)
pnpm test:sql:live                    # the SQL suites against the live postgres, then mysql
pnpm test:showcase                    # the showcase application's own suite (needs postgres)
pnpm db:down                          # stop them (`db:reset` also deletes the data)
pnpm changeset                        # record a version bump for changed packages
pnpm audit:deps                       # production dependencies, high and critical (the CI gate)
pnpm audit:zap <url>                  # OWASP ZAP baseline against a running app (needs Docker)
```

The first test run downloads a MongoDB binary (mongodb-memory-server) into
`~/.cache/mongodb-binaries`. Set `MONGOMS_DISABLE_POSTINSTALL=1` when
installing where that download is unwanted.

The SQL suites (`@usehenri/sequelize`, its dialect packages and
`@usehenri/drizzle`) run on sqlite by default, offline. Point
`HENRI_TEST_POSTGRES_URL` or `HENRI_TEST_MYSQL_URL` at a server and the same
suites run on it instead, each store in a `henri_test_*` database of its own
(created and dropped by `packages/*/__tests__/targets.js`);
`HENRI_TEST_SQL_DIALECT` picks one when both are set. The CI runs them that
way in the `Live PostgreSQL` and `Live MySQL` jobs, on service containers:

```bash
docker run -d --name henri-pg -e POSTGRES_USER=henri -e POSTGRES_PASSWORD=henri \
  -e POSTGRES_DB=henri_test -p 5432:5432 postgres:17
HENRI_TEST_POSTGRES_URL=postgres://henri:henri@127.0.0.1:5432/henri_test pnpm test:sql
```

Applications built with henri run their own tests with `henri test`, which
spawns the app's Vitest with `NODE_ENV=test`; `@usehenri/testing` boots the
app inside the test worker (`setup`, `teardown`, `request`, `agent`, `henri`,
plus `@usehenri/testing/setup-file` for `setupFiles`). `packages/demo` is such
an app and is what core's tests boot.

## Layout

| Path                                    | Package               | Role                                                                                                                                                                                                  |
| --------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/henri`                        | `henri`               | The CLI binary users install; delegates to `@usehenri/cli`.                                                                                                                                           |
| `packages/cli`                          | `@usehenri/cli`       | `new`, `init`, `server`, `console`, `routes`, `generate` (incl. `authentication`), `destroy`, `build`, `test`, `db`, `jobs`, `doctor`, `audit`, `mcp`, `clean`, `about`, `analyze`; the app templates |
| `packages/core`                         | `@usehenri/core`      | The framework: modules, server, router, models, views, users, mail                                                                                                                                    |
| `packages/mongoose`                     | `@usehenri/mongoose`  | MongoDB adapter (Mongoose 9)                                                                                                                                                                          |
| `packages/disk`                         | `@usehenri/disk`      | Zero-config local MongoDB (mongodb-memory-server) on top of mongoose                                                                                                                                  |
| `packages/sequelize`                    | `@usehenri/sequelize` | Shared SQL adapter (Sequelize 6)                                                                                                                                                                      |
| `packages/mysql`, `postgresql`, `mssql` | `@usehenri/*`         | Dialect packages on top of `@usehenri/sequelize`                                                                                                                                                      |
| `packages/drizzle`                      | `@usehenri/drizzle`   | SQL adapter on Drizzle ORM (sqlite, postgres, mysql) with drizzle-kit migrations (`henri db:*`), new in 1.1                                                                                           |
| `packages/react`                        | `@usehenri/react`     | Next.js 16 view engine (pages router), `withHenri`, `useHenri`, form components; supported and frozen                                                                                                 |
| `packages/inertia`                      | `@usehenri/inertia`   | Inertia.js view engine on Vite + React 19; the default renderer of `henri new`                                                                                                                        |
| `packages/jobs`                         | `@usehenri/jobs`      | Background jobs: a database backed queue with retries, a dead letter queue and recurring jobs (`henri jobs`), new in 1.1                                                                              |
| `packages/graphql`                      | `@usehenri/graphql`   | GraphQL: the models' types and resolvers merged and served by Apollo Server; left core in 1.2                                                                                                         |
| `packages/testing`                      | `@usehenri/testing`   | Boots an app for Vitest and binds supertest to it                                                                                                                                                     |
| `packages/mcp`                          | `@usehenri/mcp`       | `henri mcp`: stdio MCP server exposing routes, models, generators, tests and doctor to coding agents                                                                                                  |
| `packages/websocket`                    | private               | Not published, never wired into core                                                                                                                                                                  |
| `packages/demo`                         | private               | Demo app used by core's tests (`NODE_ENV=test` chdirs into it)                                                                                                                                        |
| `showcase`                              | private               | Lineup, the showcase application (Inertia + Drizzle on PostgreSQL); its own suite, `pnpm test:showcase`                                                                                               |
| `website`                               | private               | usehenri.io, deployed by Vercel from `website/`                                                                                                                                                       |

## How core works

- `Henri` (`packages/core/src/henri.js`) registers modules, each a class extending
  `base/module.js` with a unique `name` and `init()`. Packages extend it through
  `@usehenri/core/module` (`packages/core/module.js`), which is the supported
  path and the only one to keep working if the file moves. A module says where it goes
  by name (`needs` for what it cannot work without, `after`/`before` for ordering
  only) or by number (`runlevel`: 0 config, 1 mail and graphql, 2 controllers,
  mailers and the Express app, 3 models and the view engine, 4 users and jobs,
  5 router and workers, 6 app modules). Naming replaces the number; the number stays the
  module's slot, which the boot ceiling (`new Henri({ runlevel })`) and other
  modules' numeric pins are measured against. `base/graph.js` builds the graph and
  refuses to start on a missing dependency or a cycle, naming the modules; the
  loader (`0.modules.js`) then runs everything whose dependencies are done,
  concurrently. A failing `init()` fails the boot (`henri.init()` rejects with an
  Error whose `cause` is the module error) and the diagnostics name what failed,
  what was still running and what never started. `henri.analyze()` (and the
  `henri analyze` command) reports the order, the timings, what each module waited on
  and the critical path. Reloadable modules expose `reload()`, run in graph order
  after a backwards `release()` pass for the modules that implement it;
  `henri.stop()` walks the graph backwards, stops every module even when one
  fails and resolves with the errors. An application ships modules in
  `app/modules` (loaded like `app/models`), a package ships one by declaring
  `"henri": { "module": "./module.js" }` in its package.json, and
  `config/modules.js` adds anything else. `pen.fatal()` returns an Error to throw.
  Each module is exposed as `henri.<name>`, so names must be unique.
- The `henri` instance and every model are globals in user apps
  (`global.henri`, `global.Task`). Under `NODE_ENV=test` core does not set the
  global; `@usehenri/testing` does.
- Configuration is `config/<NODE_ENV>.json` (`dev.json` when unset) falling
  back to `default.json`, plus `.env` in the app. The environment is applied
  over the file that loaded (`0.config.js`): `HENRI_SECRET` sets `secret`,
  `HENRI_HOST` `host`, `DATABASE_URL` `stores.default.url`, and
  `HENRI_CONFIG__<key>` (`HENRI_CONFIG_JSON__<key>` for JSON) any other key,
  whose type comes from the file and, when the file has no value there, from
  the schema; every key the environment provided is
  printed at boot with the `filterParameters` masked. Keys: `port`, `host`, `cors`,
  `renderer`, `inertia`, `experimental`, `stores`, `secret`, `url`, `user`
  (string or `{ model, public, loginPath, afterLogin, sessionMaxAge, signup,
passwordReset, confirmation }`), `baseRole`,
  `trustProxy`, `csrf`, `graphql`, `mail`, `mailers`, `api`, `jobs`,
  `rateLimit`, `helmet`, `filterParameters`, `bodyLimit`, `requestTimeout`.
- The configuration is validated at boot, before any other module starts:
  `base/config-schema.js` declares every key henri owns (as data, in the order
  of the documentation page) and `base/config-validate.js` walks it. A wrong
  value is a `ConfigurationError` listing every problem at once with the key,
  what was expected, what arrived and where the value came from -- the file,
  the credentials file or the environment variable -- and it reaches the
  command line as `CONFIG_INVALID`. An unknown key is a warning, with the
  closest declared name when it is a near miss. `henri doctor` runs the same
  schema over every `config/*.json` without booting. The schema, the
  `Configuration` interface of `index.d.ts` and the table of
  `website/src/content/docs/configuration.md` are compared key by key by
  `src/__tests__/config-schema.spec.js`: a new key goes in all three.
- `henri audit` (`packages/cli/scripts/audit.js`) checks an application
  against the checkable ASVS 4.0.3 requirements from its files only: the
  `CHECKS` catalogue is the mapping (requirement, level, Top 10 category) and
  `henri audit --checks` prints it. It reports what an application says, never
  henri's defaults, and never something only a deployment knows. A new check
  needs an entry in `CHECKS`, a case in `packages/cli/__tests__/audit.spec.js`
  and a line in `website/src/content/docs/guides/security.md`, whose table of
  what henri does for every application is the other half of the feature.
  `scripts/smoke.sh` runs it with `--fail-on=low` on a scaffolded app: if
  `henri new` ever produces a finding, the scaffold is what is wrong.
  `.github/workflows/security.yml` owns the dependency advisories and the
  weekly ZAP baseline against the showcase (`.github/zap/rules.tsv`,
  `scripts/zap-baseline.sh`).
- The JSON API layer lives in `base/{api,hateoas,idempotency,rate-limit,
request-id,redact,headers,pagination,timeout,health}.js`: `res.resource()` and
  `res.collection()` answer HAL with `_links` from the route helpers filtered
  by roles, `res.negotiate({ html, json })` picks the page or the JSON,
  `Idempotency-Key` is honoured on every mutating route (`idempotent: false`
  opts out), express-rate-limit guards everything outside development plus
  the auth paths, `X-Request-Id` is threaded through `pen`, helmet sets the
  headers, `filterParameters` are masked in the logs, `GET /livez` says the
  process answers and `GET /readyz` (with `GET /_henri/health` as its alias)
  that it can serve -- the stores answered, the boot is done and no shutdown
  has started. `resources`/`crud` routes answering JSON without `_links`
  are reported (refused with `config.api.strict`).
- `SIGINT` and `SIGTERM` drain before they stop (`base/shutdown.js`,
  `2.server.js`): readiness turns 503, `config.shutdown.delay` passes, the
  listener closes and the idle keep-alives are hung up, the requests in
  flight finish within `config.shutdown.drain`, and only then does
  `henri.stop()` run. `config.shutdown.signals: false` leaves the signals to
  the application. `henri jobs` boots to runlevel 4, never starts the server
  and drains its own way (the runner stops claiming and finishes what it
  holds).
- Store adapters implement one contract (JSDoc `HenriAdapter` at the top of
  `packages/sequelize/index.js` and `packages/mongoose/index.js`):
  `new Adapter(name, config, henri)`, `addModel(model, userModelName)`,
  `getModels()`, `start()`, `stop()`, async `getSessionConnector(session)`,
  `findUserByEmail()`, `findUserById()`, `userId()`, `toPlain()`, `ping()`,
  `transaction()` and, on SQL, `query()`. Core loads them from the app cwd
  with `utils.resolveFrom('@usehenri/<adapter>')`. Model files use the henri
  schema format (`type: 'string'|'text'|'number'|'integer'|'float'|'boolean'|
'date'|'json'|'uuid'`, `required`, `default`, `enum`, `unique`, `index`),
  normalized by `schema.js` in each adapter (Sequelize throws on unknown keys,
  Mongoose passes them through). The user model gets `email` (unique,
  lowercased), `password` (hashed, not selected by default), `roles`
  (stripped from mass assignment; `setRoles()` or `{ unsafe: true }`) and the
  two dates the account flows write, `confirmedAt` and `passwordChangedAt`.
  Every model gets `createdAt`/`updatedAt` (`options.timestamps: false` opts
  out), `paginate({ page, perPage })` answering
  `{ records, page, perPage, total, pages }` and, with `options.paranoid`,
  soft deletes (`deletedAt`, `withDeleted()`, `restore()`, `{ force: true }`).
  `henri.model.errors(error)` (`base/model-errors.js`) normalizes the three
  ORMs' validation failures to `{ field: message }`, `null` for anything else.
  `henri db:seed` runs `db/seeds.js` on any adapter.
- The user module (`4.user.js`) mounts express-session (`henri.sid`),
  passport (`local` and `jwt` strategies), `POST /login`, `POST /logout`
  (`GET` answers 405), the double-submit CSRF middleware (`base/csrf.js`,
  cookie `henri.csrf`, header `X-CSRF-Token` or body `_csrf`) and
  `req.permit()` (`base/params.js`). Views and JSON only ever get
  `publicUser()` (`{ id, email, roles }` + `config.user.public`).
- The account flows (`base/accounts.js`, exposed as `henri.accounts`) are
  mounted by the same module when `config.user.signup`, `passwordReset` or
  `confirmation` ask for them: `POST /signup`, `POST /password/forgot`,
  `GET /password/reset/:token`, `POST /password/reset`, `GET /confirm/:token`,
  `POST /confirm` and `POST /account/email`. The links carry HMAC-signed
  tokens (`base/tokens.js`), never stored: the purpose, the expiry and a seed
  taken from the state the action changes (the password hash for a reset, the
  address and `confirmedAt` for a confirmation) are all inside one signature,
  which is what makes a link single use and expiring. A reset stamps
  `passwordChangedAt` and `deserializeUser` refuses the sessions opened before
  it. A reset request and a confirmation resend answer before they look
  anything up, so a known and an unknown address are indistinguishable in
  body, status and timing. The mails come from the built-in `auth` mailer
  (`core/src/mailers/`), whose views sit behind `app/views/mailers`, and go
  through `deliverLater()`. `henri generate authentication` writes the pages,
  the controller, the mailer, the routes and the tests into an application.
- The router (`5.router.js`) expands `config/routes.js` through
  `base/routes.js` (`root`, `resources`/`crud` with `only`/`except`/`omit`,
  `member`, `collection`, `namespace`, `nested`; `@usehenri/cli` requires the
  same module so `henri routes` and `henri doctor` read the same table), sets
  `req._henri` (`csrf`, `flash`, `localUrl`, `paths`, `query`, `user`) and
  `res.render()`, which builds the view options (`data` or a `graphql` query,
  `errors`, `flash`, role-filtered `paths`) and content-negotiates HTML (the
  engine) or JSON. `res.boom.*` (`base/boom.js`) answers
  `{ statusCode, error, message, data }`; 404 and 500 are negotiated in
  `base/http.js`.
- GraphQL lives in `@usehenri/graphql`. Core carries none of it: the package
  ships the module itself (`"henri": { "module": "./module.js" }`, the
  registration path of `0.modules.js`), so depending on the package is what
  puts `henri.graphql` in the boot at runlevel 1 (`run`, `endpoint`, `active`,
  the `GraphQLError` subclasses). The models' `graphql` keys are extracted at
  runlevel 3 and merged into one executable schema, served by Apollo Server at
  `config.graphql` (`/_henri/gql`); `3.model.js` declares `after: ['graphql']`,
  not `needs`, because an application without the package has no such module.
  The two places that reach for it go through `base/graphql.js`, which throws
  with the install line: a model declaring a `graphql` key fails the boot, and
  `res.render(view, { graphql })` fails the request. Everything else is
  guarded, so an application without either is silent, and `henri doctor`
  reports the missing dependency.
- Background jobs live in `@usehenri/jobs`, which core loads from the app the
  way it loads a store adapter (`4.jobs.js`, runlevel 4, so `henri jobs` boots
  to that level and binds no port) and exposes as `henri.jobs`
  (`perform`/`performIn`/`performAt`/`performNow`, `list`, `stats`, `dead.*`).
  A job is `app/jobs/<name>.js` exporting `perform(args, context)` plus
  `queue`, `priority`, `maxAttempts`, `timeout` and `backoff`. The queue owns
  `henri_jobs` and `henri_jobs_schedules` and reaches them through
  `adapter.query()` or the MongoDB collections, never through a model; every
  moment is a BIGINT of epoch milliseconds. Claiming is one statement per
  dialect (`FOR UPDATE SKIP LOCKED`, `UPDATE ... ORDER BY ... LIMIT`,
  `UPDLOCK, READPAST`, a subquery on sqlite, `findOneAndUpdate` on MongoDB)
  and the claimed rows are read back by the token it stamped, so two runners
  never perform one job. `henri jobs` runs a worker (`--queue`,
  `--concurrency`, `--once`), `henri jobs:install|status|list|dead|show|
perform|retry|discard` drive it. The module also registers
  `henri.mailers.onDeliverLater()`, so `deliverLater()` enqueues the rendered
  message as the built-in `henri/mail` job.
- Controllers may export `before` (`base/hooks.js`): hooks the router runs
  between the role guard and the action, keyed by action (`all`,
  `'show,edit'`) or as `[fn, { run, only, except }]`; a hook that answers ends
  the request, and `before` is the one export that is never an action. The
  same module wraps every action so that returning without answering renders
  `/<controller>/<action>` (`/<controller>` for `index`) with what it
  returned. `req.flash()` (`base/flash.js`) keeps one-shot messages in the
  express session and the views read them once through `flash`.
- Mailers (`2.mailers.js`) are `app/mailers/*.js` loaded like controllers:
  every exported function is an action returning the message it wants sent
  (`to`, `subject`, `data`, and anything else nodemailer takes), `defaults`
  applies to all of them and `previews` holds the sample data. They are
  reachable as `henri.mailers.<name>.<action>(...)`, which builds a `Message`
  (`base/mail-message.js`) answering `render()`, `deliver()` (through
  `henri.mail`) and `deliverLater()` (through the handler registered with
  `henri.mailers.onDeliverLater(fn)`, which receives the rendered nodemailer
  payload; without one henri sends out of band and `drain()` waits). Views
  live in `app/views/mailers` and are rendered by `base/mail-view.js` with
  henri's handlebars environment unless the view engine implements
  `renderMail({ view, layout, data, meta })`; `layouts/<name>.hbs` wraps them
  around `{{{body}}}`, and the plain text part is derived from the html
  (`base/mail-text.js`) unless a `<action>.text.hbs` sits next to the view.
  `base/mail-preview.js` is the `/_mailers` preview router, mounted by
  `5.router.js` in development behind `loopbackOnly()`. Configuration:
  `mailers: { from, layout, previews }`.
- View engines implement `init()`, `prepare()`, `fallback(router)`,
  `render(req, res, route, opts)` and optionally `reload()` and `close()`. The
  Handlebars engine lives in `core/src/engines/template.js`; `react` resolves
  `@usehenri/react/engine` and `inertia` `@usehenri/inertia/engine` from the app
  (`core/src/engines/*.js` are the loaders). The React engine passes `opts` to
  pages through `req._henri`; `withHenri` reads only that on the server.
  `build({ cwd, config })` on both engines builds without booting henri, which
  is what `henri build` calls.

## Conventions

- CommonJS everywhere except `packages/react/src` (ESM + JSX compiled by rollup
  to `dist/lib`), `packages/inertia/src` and `vite.mjs` (ESM consumed by Vite)
  and `website` (Astro). No TypeScript: the source is JavaScript and the type
  declarations are hand-written `.d.ts` files, one per package
  (`packages/core/index.d.ts`, `packages/react/{index,forms,engine}.d.ts`,
  `packages/inertia/{src/index.d.mts,vite.d.mts,engine/index.d.ts}`,
  `packages/testing/*.d.ts`), pointed at by `types` and shipped in `files`.
  `pnpm test:types` (`scripts/check-types.mjs`) checks that every declaration
  is published and runs `tsc --noEmit` over the fixtures in `types/`, whose
  `@ts-expect-error` lines make the wrong calls part of the test. Changing a
  signature means changing its `.d.ts` and, usually, `types/*.test-d.ts`.
  eslint ignores `.d.ts`; prettier formats them.
- pnpm links strictly: every module a package `require()`s must be in that
  package's `package.json`. Internal dependencies use `workspace:^`.
- Apps that use the React renderer must depend on `next`, `react` and `react-dom`
  themselves (Turbopack resolves `next` from the app directory); Inertia apps on
  `@inertiajs/react`, `react`, `react-dom`, `vite` and `@vitejs/plugin-react`.
- `henri new` defaults to the `inertia` renderer (`template/inertia`);
  `--renderer react` scaffolds the Next.js one (`template/default`).
  `scripts/utils.js` owns `RENDERERS` and `DEFAULT_RENDERER`, and `rendererOf()`
  reads the renderer of an application back from its configuration, which is
  what makes the generators renderer aware.
- Both scaffold templates ship Tailwind CSS v4: `app/views/styles/index.css` is
  the only stylesheet, compiled by `@tailwindcss/postcss` through
  `app/views/postcss.config.mjs` (react) or by the `@tailwindcss/vite` plugin
  merged into `app/views/vite.config.mjs` (inertia). The scaffold view
  templates (`packages/cli/scripts/generate/{inertia,react}-*.hbs`) write
  Tailwind classes with a `dark:` counterpart; there is no
  `tailwind.config.js`.
- ESLint rules worth knowing: `sort-keys`, `prefer-template`, `id-length`,
  `no-nested-ternary`, JSDoc on functions. Prettier: single quotes, es5 commas.
  `.hbs`, the demo views and `packages/cli/scripts/generate` are excluded from
  Prettier on purpose (its Handlebars parser mangles JSX inside templates).
- Tests live in `__tests__/*.spec.js` or `*.test.js` (vitest, `globals: true`:
  no imports for `describe`/`test`/`expect`/`vi`, and `require('vitest')` does
  not work in CommonJS); core's boot the demo app with the disk adapter.
  Snapshot tests exist for most core modules, regenerate them only when the diff
  is explained by your change.
- Commits follow Conventional Commits (`feat(core): ...`, `fix(react): ...`).
  Husky runs lint-staged (prettier + eslint --fix) and commitlint on commit.
- Any user-facing change to a public package needs a changeset
  (`pnpm changeset`) describing it for the changelog; the docs pages that
  describe the behaviour change in the same pull request. All public packages
  are versioned together (a `fixed` group in `.changeset/config.json`);
  private packages are never versioned.

## Releasing

`.github/workflows/release.yml` runs on pushes to `master`. With pending
changesets it opens or updates a "Version Packages" pull request; merging that
PR runs the publish job, which publishes to npm with provenance and creates
GitHub releases. Publishing uses npm trusted publishing (OIDC): every public
package trusts this repository's `release.yml` running in the `npm` GitHub
environment. There is no npm token to rotate. npm cannot create a package
through OIDC, so a new package is bootstrapped once by a maintainer
(`npm login`, then `node scripts/npm-bootstrap.mjs @usehenri/<name>` publishes
an empty 0.0.0), gets its trusted publisher registered on npmjs.com, and must
be added to the `fixed` group of `.changeset/config.json`. `scripts/prepublish.js` copies
the LICENSE and a README into every public package at publish time
(`packages/henri` gets the root README).

## Known gaps

- The Vue/Nuxt renderer (`core/src/engines/vue.js`) has not been exercised
  since 2020 and only loads with `experimental.vue: true`.
- The React (Next.js) engine is frozen on the pages router: it is supported and
  keeps getting fixes, but it does not follow Next.js into the app router,
  because `withHenri` reading `req._henri` on the server has no equivalent
  there. New applications get Inertia.
- The Inertia engine reached parity in 1.2 (server-side rendering in
  development and production, the full scaffold) but is younger than the React
  one; its options may still change.
- The SQL adapters run their suites against sqlite by default and against a
  live PostgreSQL or MySQL server with `HENRI_TEST_POSTGRES_URL` /
  `HENRI_TEST_MYSQL_URL` (see above); MSSQL is only covered offline (its
  generated DDL), and no adapter is exercised against MariaDB. The Sequelize
  adapters have no migrations (`sequelize.sync()`); Drizzle has them.
- drizzle-kit does not alter a mysql table on a push: `henri db:push` and the
  development boot create the tables that are missing and report the ones
  whose columns drifted (`Migrations#completeMySQLPlan`); a mysql schema
  change needs `henri db:generate` then `henri db:migrate`.
- `henri generate scaffold|crud` write the pages of the application's renderer
  (`.jsx` for inertia, `.js` for react) and controllers that follow the adapter
  of the default store (`scripts/adapters.js` maps it to the mongoose,
  sequelize or drizzle flavour), which `henri new --adapter <name>` configures.
  The `template` and `vue` renderers get no generated pages.
- The idempotency and rate-limit stores are in memory unless the app plugs a
  shared store (`config.api.idempotency.store`, `config.rateLimit.store`).
- `@usehenri/jobs` is new in 1.1. Its claim is covered against sqlite,
  PostgreSQL, MySQL and MongoDB (`packages/jobs/__tests__/claim.spec.js`,
  `mongo.spec.js`; `pnpm test:sql:live` runs the SQL ones on real servers with
  concurrent connection pools). MSSQL only has its generated DDL and claim
  statement covered offline, like the rest of that adapter.
- The scaffolded app pins ESLint 9 because `eslint-plugin-react` does not
  support ESLint 10 yet.
