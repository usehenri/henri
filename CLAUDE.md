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
pnpm test:types                       # the .d.ts: packaging, then tsc over types/ (the generated ones too)
pnpm lint                             # eslint 10 flat config, zero warnings in CI
pnpm format                           # prettier 3 (`pnpm format:check` in CI)
pnpm build                            # rollup build of @usehenri/react
pnpm --filter @usehenri/website dev   # docs site (Astro + Starlight); `build` and `preview` too
scripts/smoke.sh                      # scaffold an app from the packed workspace and boot it
pnpm db:up                            # postgres, mysql, mariadb, mongo, redis and sql server (compose.yaml)
pnpm test:sql:live                    # the SQL suites against the live postgres, then mysql, then mariadb
pnpm test:sql:mariadb                 # the same suites against a live MariaDB
pnpm test:sql:mssql                   # the sequelize, jobs and webhooks suites against SQL Server
pnpm test:s3                          # @usehenri/s3 against a live object store (MinIO, below)
pnpm test:showcase                    # the showcase application's own suite (needs postgres)
pnpm db:down                          # stop them (`db:reset` also deletes the data)
pnpm changeset                        # record a version bump for changed packages
pnpm audit:deps                       # production dependencies, high and critical (the CI gate)
pnpm audit:zap <url>                  # OWASP ZAP baseline against a running app (needs Docker)
```

The first test run downloads a MongoDB binary (mongodb-memory-server) into
`~/.cache/mongodb-binaries`. Set `MONGOMS_DISABLE_POSTINSTALL=1` when
installing where that download is unwanted.

The SQL suites (`@usehenri/drizzle`, its dialect packages and
`@usehenri/sequelize`) run on sqlite by default, offline. Point
`HENRI_TEST_POSTGRES_URL`, `HENRI_TEST_MYSQL_URL`, `HENRI_TEST_MARIADB_URL`
or `HENRI_TEST_MSSQL_URL`
at a server and the same
suites run on it instead, each store in a `henri_test_*` database of its own
(created and dropped by `packages/*/__tests__/targets.js`);
`HENRI_TEST_SQL_DIALECT` picks one when several are set. MariaDB is a
**server** and not a dialect there: `target.name` stays `mysql` (henri
compiles the same dialect and mysql2 is the driver either way) and
`target.server` says which of the two answered, which is what the two
measured booleans `target.eagerLoads` and `target.introspects` and the
column spellings of `dialect.spec.js` branch on. The CI runs postgres and
mysql that way in the `Live PostgreSQL` and `Live MySQL` jobs, on service
containers:

```bash
docker run -d --name henri-pg -e POSTGRES_USER=henri -e POSTGRES_PASSWORD=henri \
  -e POSTGRES_DB=henri_test -p 5432:5432 postgres:17
HENRI_TEST_POSTGRES_URL=postgres://henri:henri@127.0.0.1:5432/henri_test pnpm test:sql
```

**SQL Server is the third one, and it is not in the CI.** `@usehenri/mssql`
is the only way an application reaches Sequelize, so it is the dialect that
matters most here and the one nothing ever ran against; `compose.yaml` has
the server and `pnpm test:sql:mssql` points the `sequelize`, `mssql`, `jobs`
and `webhooks` projects at it. Whether it becomes a fourth service container
on every pull request is a cost decision and it belongs to whoever pays for
the minutes. What it would take: a `Live SQL Server` job shaped exactly like
`Live MySQL`, one `mcr.microsoft.com/mssql/server:2022-latest` service with
`ACCEPT_EULA` and `MSSQL_SA_PASSWORD` and a `sqlcmd` health command, and
`HENRI_TEST_MSSQL_URL` on `pnpm test:sql:mssql`. Developer edition is free
for that, so there is no licence in the way. What it would cost: the image
is about 1.5GB unpacked -- three or four times the postgres one -- so a
minute or so of pull, ten to twenty seconds of boot before it answers, and
roughly a minute of tests, on top of the checkout and the install every job
already pays; call it four runner-minutes a run, in parallel with the
others. There is no arm64 build, which does not matter on
`ubuntu-latest` and means Apple Silicon runs it under Docker Desktop's
amd64 emulation locally (it works, and starts in about twenty seconds).
Until then it runs locally, and a tranche that touches
`@usehenri/sequelize`, `@usehenri/jobs` or `@usehenri/webhooks` should run
it.

```bash
HENRI_MSSQL_PORT=51433 pnpm db:up            # or just `pnpm db:up` on 1433
HENRI_MSSQL_PORT=51433 pnpm test:sql:mssql
```

Applications built with henri run their own tests with `henri test`, which
spawns the app's Vitest with `NODE_ENV=test`; `@usehenri/testing` boots the
app inside the test worker (`setup`, `teardown`, `request`, `agent`, `henri`,
plus `@usehenri/testing/setup-file` for `setupFiles`). It also owns the
factories: `test/factories/<name>.js` exports `{ attributes, traits, model,
after }`, a value is a literal or a function of the build context
(`attrs`, `build`, `create`, `sequence`, `traits`, `uid`) resolved on demand,
and `create`/`build`/`createList`/`defineFactory` are the calls
(`packages/testing/factory.js`, `guides/testing.md`). An override always wins
and is never made, which is what keeps `create('proposal', { speakerId })`
from making a second user. `inbox()`/`clearInbox()`
(`packages/testing/mail.js`) is the mail an application was asked to send:
captured at **both** doors -- `henri.mail.send` and `henri.mailers.enqueue`,
each an own property of that instance's modules -- and kept on the henri
instance under a symbol, so the inbox is per-application and the setup file
empties it before every test. `enqueued()`/`clearJobs()`
(`packages/testing/jobs.js`) read `henri.jobs` back rather than intercepting
anything, and answer `HENRI_JOB_QUEUE_UNAVAILABLE` with the install line when
the application has no queue -- never an empty list, which would pass.
`@usehenri/testing/playwright` (`packages/testing/playwright.mjs`) is the
browser suite's boot: a Playwright `globalSetup` that starts the application
once for the run on a kernel-assigned port and exports
`PLAYWRIGHT_TEST_BASE_URL`, which is what `use.baseURL` falls back to in
every worker -- anything written in `use` wins over it, measured against
Playwright 1.63.0, and the setup names a project that pins another url rather
than letting the browser go somewhere else in silence. Playwright is the
application's dependency and this repository has none: nothing here imports
it, nothing re-measures it, and `henri doctor` reports a `playwright.config.*`
with no `@playwright/test` (`deps.playwright`). It touches no data -- one
server for the run is one database for the run -- so seeding is a global
setup of the application's own wrapping `boot(config)`. `packages/demo` is
such an app and is what core's tests boot; `showcase/test/factories` is the
worked example.

Every project runs its test files at the same time, core included: each of
its files boots the demo application on a port the kernel assigns and a
MongoDB of its own (`packages/disk/port.js`), and `vitest.setup.js` binds
every host-less `listen()` to `127.0.0.1` so the reservation is exact. What
those files still share is `packages/demo/.tmp`, so anything written there
has to be named per record or per process. An application's own suite keeps
`fileParallelism: false` unless each file gets a database of its own.

## Layout

| Path                           | Package               | Role                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/henri`               | `henri`               | The CLI binary users install; delegates to `@usehenri/cli`.                                                                                                                                                                                                                                                                  |
| `packages/cli`                 | `@usehenri/cli`       | `new`, `init`, `server`, `console`, `runner`, `routes`, `openapi`, `graphql`, `types`, `generate` (incl. `authentication`), `destroy`, `build`, `test`, `db`, `jobs`, `webhooks`, `privacy`, `encryption`, `calls`, `flags`, `maintenance`, `doctor`, `audit`, `docs`, `mcp`, `clean`, `about`, `analyze`; the app templates |
| `packages/core`                | `@usehenri/core`      | The framework: modules, server, router, models, views, users, policies, mail, i18n                                                                                                                                                                                                                                           |
| `packages/mongoose`            | `@usehenri/mongoose`  | MongoDB adapter (Mongoose 9)                                                                                                                                                                                                                                                                                                 |
| `packages/disk`                | `@usehenri/disk`      | Zero-config local MongoDB (mongodb-memory-server) on top of mongoose                                                                                                                                                                                                                                                         |
| `packages/drizzle`             | `@usehenri/drizzle`   | henri's SQL data layer: Drizzle ORM (sqlite, postgres, mysql) with drizzle-kit migrations (`henri db:*`). The default of `henri new`, on sqlite                                                                                                                                                                              |
| `packages/postgresql`, `mysql` | `@usehenri/*`         | `@usehenri/drizzle` with the dialect and the driver chosen; `mariadb` is served by `@usehenri/mysql`, with two limits the server imposes (see the gaps)                                                                                                                                                                      |
| `packages/sequelize`           | `@usehenri/sequelize` | Sequelize 6, only under `@usehenri/mssql`: Drizzle has no SQL Server dialect                                                                                                                                                                                                                                                 |
| `packages/mssql`               | `@usehenri/mssql`     | SQL Server, on `@usehenri/sequelize`. No migrations; `henri db:status` reports the drift                                                                                                                                                                                                                                     |
| `packages/react`               | `@usehenri/react`     | Next.js 16 view engine (pages router), `withHenri`, `useHenri`, form components; supported and frozen                                                                                                                                                                                                                        |
| `packages/inertia`             | `@usehenri/inertia`   | Inertia.js view engine on Vite + React 19; the default renderer of `henri new`                                                                                                                                                                                                                                               |
| `packages/jobs`                | `@usehenri/jobs`      | Background jobs: a database backed queue with retries, a dead letter queue and recurring jobs (`henri jobs`), new in 1.1; ships its own module, left core in 1.2                                                                                                                                                             |
| `packages/graphql`             | `@usehenri/graphql`   | GraphQL: the models' types and resolvers merged and served by Apollo Server; left core in 1.2                                                                                                                                                                                                                                |
| `packages/webhooks`            | `@usehenri/webhooks`  | Outbound webhooks: endpoints henri stores, Standard Webhooks signatures, an SSRF check at request time; delivers through the queue, new in 1.2                                                                                                                                                                               |
| `packages/uploads`             | `@usehenri/uploads`   | File uploads: bounded multipart parsing (busboy), files typed by their bytes and a storage seam; ships its own module, new in 1.2                                                                                                                                                                                            |
| `packages/s3`                  | `@usehenri/s3`        | Uploads on an object store: one backend over the S3 API (S3, R2, Spaces, MinIO), SigV4 and presigned urls, new in 1.2                                                                                                                                                                                                        |
| `packages/redis`               | `@usehenri/redis`     | The shared store of `config.shared`: the rate limit, the sign-in lockout and the idempotency keys counted in Redis instead of one process                                                                                                                                                                                    |
| `packages/testing`             | `@usehenri/testing`   | Boots an app for Vitest and binds supertest to it                                                                                                                                                                                                                                                                            |
| `packages/mcp`                 | `@usehenri/mcp`       | `henri mcp`: stdio MCP server exposing routes, models, generators, tests and doctor to coding agents                                                                                                                                                                                                                         |
| `packages/demo`                | private               | Demo app used by core's tests (`NODE_ENV=test` chdirs into it)                                                                                                                                                                                                                                                               |
| `showcase`                     | private               | Lineup, the showcase application (Inertia + Drizzle on PostgreSQL); its own suite, `pnpm test:showcase`                                                                                                                                                                                                                      |
| `website`                      | private               | usehenri.io, deployed by Vercel from `website/`, master only (`vercel.json`)                                                                                                                                                                                                                                                 |

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
  printed at boot with the `filterParameters` masked. Keys, in the order of
  the schema: `port`, `host`, `cors`, `renderer`, `inertia`, `assets`,
  `experimental`,
  `stores`, `migrations`, `secret`, `url`, `user` (string or `{ model, public, loginPath,
afterLogin, sessionMaxAge, signup, passwordReset, confirmation,
identities }`),
  `baseRole`, `externalIds`, `policies`, `trustProxy`, `csrf`, `graphql`,
  `mail`, `mailers`, `api`, `jobs`, `webhooks`, `rateLimit`, `shared`,
  `cache`, `flags`, `helmet`, `csp`, `filterParameters`, `logs`, `telemetry`,
  `encryption`, `privacy`, `retention`, `trail`, `calls`, `queries`,
  `versions`, `tenancy`, `i18n`, `bodyLimit`, `uploads`, `requestTimeout`,
  `streams`, `shutdown`, `maintenance`, `errors`.
- The configuration is validated at boot, before any other module starts:
  `base/config-schema.js` declares every key henri owns (as data, in the order
  of the documentation page) and `base/config-validate.js` walks it. A wrong
  value is a `ConfigurationError` listing every problem at once with the key,
  what was expected, what arrived and where the value came from -- the file,
  the credentials file or the environment variable -- and it reaches the
  command line as `HENRI_CONFIG_INVALID`. An unknown key is a warning, with the
  closest declared name when it is a near miss. `henri doctor` runs the same
  schema over every `config/*.json` without booting. The schema, the
  `Configuration` interface of `index.d.ts` and the table of
  `website/src/content/docs/configuration.md` are compared key by key by
  `src/__tests__/config-schema.spec.js`: a new key goes in all three.
- Every failure henri raises on its own behalf carries a code:
  `HENRI_<AREA>_<REASON>` (`HENRI_MODEL_UNKNOWN_TYPE`,
  `HENRI_BOOT_CIRCULAR_DEPENDENCY`), one namespace across core, the
  adapters, the jobs queue, the view engines, the command line and
  `henri mcp`. The catalogue is `packages/core/error-codes.json` -- data,
  one entry per code with what it means, what usually causes it and how to
  fix it -- and `base/errors.js` reads it (`stamp`, `fail`, `fallback`,
  `coded`, `exitOf`, `url`). A code is a string, so a package that cannot
  depend on core raises one with a three line `coded()` helper of its own.
  It reaches a person through `pen.fatal(name, summary, full, obj, code)`,
  through the JSON error body (`base/boom.js`, `base/http.js` gained a
  `code`), through `henri <command> --json` and its text output, and through
  the MCP server. `config.errors.url` is the seam for turning a code into a
  page: a template holding `{code}`, unset by default, and henri ships no
  address. `src/__tests__/error-codes.spec.js` compares the catalogue, the
  source and `website/src/content/docs/reference/errors.md`: a new code goes
  in the catalogue, gets raised somewhere, and the page is regenerated with
  `node scripts/error-codes-page.mjs`.
- `henri.pen` has two formats (`base/logs.js`, `config.logs.format`): the
  pretty lines a terminal reads, and one JSON object per line -- `time`,
  `level`, `module`, `requestId` (the one `base/request-id.js` threads),
  `msg`, `data` and `err` with its code and its `cause` chain -- for
  everywhere else. `auto`, the default, is json in production and pretty
  everywhere else; the environment decides it, not whether stdout is a tty.
  Every object argument is masked on the way in by the one redactor of
  `base/redact.js` (`filterParameters` as substrings, the `personal` field
  names exactly), because a structured logger serializes faithfully what the
  pretty format used to summarize; a message is not masked, in either
  format. No logging dependency: the format is one file. The API of `pen`
  did not change and the pretty output is what it was.
- `henri.reporter` (`base/reporting.js`) is where an application hears about
  the failures henri catches. `onError(fn)` -- the shape of
  `henri.mailers.onDeliverLater()`, one handler, `null` removes it --
  registers it, and the three places henri answers a failure instead of the
  application report through it once each: the boot (`henri.init()` rejects,
  awaited), a 5xx in `base/http.js` (never awaited) and an unhandled
  rejection. A 4xx is an answer rather than a failure; `pen.fatal()` does not
  report, because it hands back an Error and the caller is the one who knows
  what it ends; a dead job does not either, since the queue's own row is the
  durable record. The handler gets
  `{ at, code, error, meta, request, requestId, source }` where `request` is
  the method, the _route pattern_ and the status and nothing else -- no url,
  no query, no body, no params, no headers, no user -- and `meta` is masked
  like a log line. A handler that throws or hangs is logged and abandoned
  (two seconds), the same Error is reported once, and no handler at all costs
  a property read. Not a module: it is built with the instance, because the
  first failure worth reporting is a module that would not start. The guide
  is `guides/logs.md`.
- `henri.telemetry` (`0.telemetry.js`, `base/telemetry.js`) is
  OpenTelemetry, and only the instrumentation: `@opentelemetry/api` is an
  **optional peer dependency** resolved from the application, and henri
  ships no SDK, no exporter, no sampler and no collector address. An
  application without the package pays nothing and gets no boot line,
  because nothing is installed rather than tested per call -- the middleware
  is not mounted (`2.server.js`), `adapter.query()` is not wrapped
  (`3.model.js`), no instrument is created. A span carries the method, the
  route _pattern_, the status and `henri.request_id`, and it asks
  `requestOf()` -- the reporter's own function -- for them, so the two
  cannot drift; nothing from the client is in one, which is a deliberate
  departure from the HTTP semantic conventions and is said out loud.
  Attributes an application passes are masked like a log line. The
  boundaries are `config.telemetry.spans` (`boot`, `http`, `jobs`, `mail`,
  `stores`, `views`, `webhooks`), and henri's own call sites name theirs so
  it can be turned off; the boot span is **reconstructed from
  `henri.analyze()` after the fact**, so nothing runs during a boot for it.
  An incoming `traceparent` decides the trace and `X-Request-Id` decides the
  request id, neither derived from the other, and `inject()` writes one onto
  a webhook delivery. The metrics are the request duration histogram (whose
  count is the request count, so there is no counter), the queue depth, the
  claim latency and the cache counters, the last two observable so nothing
  is recorded on the hot path. henri owns no buffer and never awaits an
  export, so a dead exporter is a dropped span; an api that throws five
  times turns telemetry off for the process. It is the one module that is
  not reloadable, because an observable instrument is registered once by
  name. `@usehenri/jobs` and `@usehenri/webhooks` add their own boundary
  through it, and `henri doctor` reports `deps.declared` when
  `telemetry.enabled` is true and the package is in no `package.json`. The
  guide is `guides/telemetry.md`.
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
  by roles and then by the policy of the record,
  `res.negotiate({ html, json })` picks the page or the JSON,
  `Idempotency-Key` is honoured on every mutating route (`idempotent: false`
  opts out), express-rate-limit guards everything outside development plus
  the auth paths, `X-Request-Id` is threaded through `pen`, helmet sets the
  headers, `filterParameters` are masked in the logs, `GET /livez` says the
  process answers and `GET /readyz` (with `GET /_henri/health` as its alias)
  that it can serve -- the stores answered, the boot is done and no shutdown
  has started. `resources`/`crud` routes answering JSON without `_links`
  are reported (refused with `config.api.strict`).
- `henri openapi` (`packages/cli/scripts/openapi.js`, built by
  `base/openapi.js`) writes the OpenAPI 3.1 description of what an
  application exposes, from the expanded routes, the model files and the
  configuration, without booting. It describes what henri itself answers --
  the HAL resource and collection of a `resources`/`crud` route, the boom
  envelope of every failure henri owns, the paging, `Idempotency-Key`, the
  versioned media type, the roles and the policy of each route, and the
  endpoints the user module and the health probes mount -- and it refuses to
  describe what a controller writes: such an operation carries the statuses
  henri produces, `x-henri.known: false` and no success status at all. A
  response schema requires nothing (an action may present its records) and a
  request body is the model's writable columns, all optional, with no type on
  a foreign key. A booted application answers the same document at
  `GET /_openapi.json` (`5.router.js`, development and loopback only, like
  `/_routes`), and `henri mcp` exposes it as the `openapi` tool. It is
  validated against the specification by `src/__tests__/openapi.spec.js`,
  `packages/cli/__tests__/openapi.spec.js` and `showcase/test/openapi.test.js`,
  which also calls the application and compares the answers with what the
  document said. The guide is
  `website/src/content/docs/guides/openapi.md`.
- `henri types` (`packages/cli/scripts/types.js`, built by `base/types.js`)
  writes `.henri/types.d.ts`: an interface per model of an application and
  the union of every path helper `config/routes.js` expands to, from the
  model files and the routes file, without booting. It borrows `columnsOf()`
  and `settingsOf()` from `base/openapi.js` rather than reading a model a
  second way, so the two cannot disagree. A **record is closed** -- the
  columns of the file plus the ones the adapters add, so `article.titel` is
  an error -- and a **model is as closed as its adapter lets it be**.
  `ModelGuarantees` in `packages/core/index.d.ts` is the _measured_
  intersection of the three model APIs (`findById`, `findByKey`,
  `findByExternalId`, `findOne`, `create`, `paginate`) and does **not**
  hold `find()`, because a Sequelize model has none -- it was dropped in
  Sequelize 4, so `Model.find()` on an mssql store is a `TypeError`. On top
  of it sit three interfaces the renderer picks by the adapter of the
  model's store, the way it already picks the record base (`RECORDS` and
  `STATICS` in `base/types.js`). `MongooseModelStatics` and
  `SequelizeModelStatics` **keep the index signature**: the rest of that
  surface belongs to an ORM, at whatever version the application installed,
  and enumerating it would pin someone else's API to a henri release.
  `DrizzleModelStatics` is **closed** -- no index signature -- because that
  model class is henri's own (`@usehenri/drizzle/model.js`), released in
  lockstep with core, and its statics are the same 83 whatever the model
  declares (measured across `paranoid`, `slug`, `versioned`, `externalId`
  and the user model, which add nothing but `setRoles`). So on the adapter
  `henri new` scaffolds by default a typo in a static (`Task.fnid()`), a
  scope that does not exist (`Task.published()`) and a call from the wrong
  ORM (`Task.aggregate()`) are all compile errors, and `Task.find().sort()`
  is one too, because a drizzle `find()` is a plain promise and `where()`
  is the chain (`DrizzleRelation`). The price, said in the guide: `Task[key]`
  is an error there, and henri's own bookkeeping statics are declared
  `@internal` rather than left out. `packages/drizzle/__tests__/
statics.spec.js` builds a model and compares its statics with the
  declaration, so the list cannot drift; the names it closes are also the
  ones `base/enums.js` refuses a generated scope, so a collision fails the
  boot rather than reaching this file. A
  `decimal` and a `bigint` are `string` (`base/exact.js`), an `enum` is the
  union of its values, and a column marked `personal: { expose: false }` is
  on the record because the mark is about answers. `5.router.js` writes the
  same file on every development boot and every hot reload, the way
  `3.model.js` writes `.henri/globals.json`, and `henri build` writes it for
  CI; the scaffold's `jsconfig.json` names it in `include` and errors stay
  opt-in (`// @ts-check`, or `checkJs`). Nothing is invented: a model whose
  name is not a TypeScript identifier is skipped and named, and a routes
  file that will not expand leaves the helper registry empty, which puts
  `pathFor()` back to taking any string. `henri doctor` reports a stale, a
  foreign or an unwritable file, `henri mcp` exposes it as the `types` tool,
  and `types/generated.d.ts` -- the real output over
  `packages/cli/__tests__/fixtures/types-app`, kept byte identical by
  `packages/cli/__tests__/types.spec.js` -- is what `pnpm test:types`
  compiles, with `types/generated.test-d.ts` asserting through
  `@ts-expect-error` that a wrong column, a wrong enum value and a
  misspelled path helper are errors. The page is
  `website/src/content/docs/reference/types.md`.
- The three counters that only worked with one process -- the rate limit, the
  sign-in lockout (`base/lockout.js`) and the idempotency keys -- share one
  backend through `config.shared` (`base/shared.js`, `henri.shared`). The
  adapter is resolved from the application like a store adapter
  (`redis` -> `@usehenri/redis`), `2.server.js` builds it before
  `createApi()` hands its stores to all three, and `config.rateLimit.store`,
  `config.user.lockout.store` and `config.api.idempotency.store` still win
  key by key. `SharedStore` is where the failure policy lives:
  `shared.onError` is `closed` (a `SharedStoreError` carrying a 503 and a
  `Retry-After`, answered by `base/http.js`) or `open` (the request is served
  uncounted), and the idempotency keys are always closed. `/readyz` pings it,
  `henri doctor` reports it unreachable, and the boot line of the rate limit
  says where the counting happens.
- The cache is `henri.cache` (`3.cache.js`, `base/cache.js`), the fourth
  thing that wants that backend and the one that follows neither answer of
  `onError`: it takes the store through `SharedStore#unguarded` and a
  backend that is down is a miss, because a cache holds no truth. Without
  `config.shared` it is this process's memory, bounded twice
  (`cache.maxEntries` 1000, `cache.maxSize` 32mb, least recently used out
  first); `config.cache.store` still names a module of its own. `get`,
  `set`, `delete`, `clear`, `scope(name)` and `fetch(key, [options], fn)`,
  which keeps one promise per key while the function runs, so a hundred
  concurrent misses in one process run it once (across processes the bound
  is the number of processes, deliberately -- a lock needs a lease and a
  lease needs a guess). A value is JSON plus `Date`, encoded to a string
  (both backends keep the same thing, and no reader can mutate another's);
  a model instance, `undefined`, `NaN`, a `Map`, a `Buffer` or anything
  circular is refused (`HENRI_CACHE_VALUE_UNSUPPORTED`) rather than stored
  to come back wrong, and a value past `cache.maxEntrySize` (256kb) is not
  stored at all. Every entry has a TTL; henri invalidates nothing on its
  own. Values never reach a log line and a key matching `filterParameters`
  is masked there.
- Feature flags are `2.flags.js` (`henri.flags`) and `base/flags.js`, and
  they are **declared**: `config/flags.js` lists every flag an application
  has (`checkout: false`, or `{ default, description, expose, group }`), and
  a name nothing declares is `HENRI_FLAGS_UNKNOWN` at the call and a refusal
  on the command line rather than a `false` -- `req.permit()`'s position,
  argued in the guide, with the cost (removing a flag is two deploys) said
  out loud. `flipper` is what it learns from: the gates and the
  `enable`/`disable` vocabulary are kept, `percentage_of_time` is not (a
  feature that flickers inside one page load is a bug henri would have
  caused), and neither are the expression gates, the UI or the metrics. The
  gates are a union, first `true` wins: the switch, a named set of
  `externalId`s, a percentage, then `boolean === false` (the kill switch,
  which the group below cannot argue with), then the group, then the
  declared default -- and `disable(name)` is a **reset**, clearing the set
  and the percentage the way flipper's does. The percentage is
  `sha256(flag + actor)`, computed and never stored, so it is stable across
  processes and restarts and a rollout only ever adds people; the flag name
  is in the hash so two features at ten percent are not on for the same ten
  percent, and the `externalId` is hashed **whole** because a uuid v7 is
  time-ordered and any prefix of it would roll out by signup date (the
  suite checks every tenth of ten thousand sequential ids, not only the
  total). A primary key is never an actor
  (`HENRI_FLAGS_ACTOR_INVALID`). The state lives in `config.shared` when
  there is a backend, `.henri/flags.json` otherwise and this process's
  memory under `NODE_ENV=test`, and the boot line names which and says its
  limit. Every read comes from an in-memory snapshot re-read on a timer
  (`flags.refresh`, ten seconds, which is the whole staleness window) --
  not through `henri.cache`, because a cache's answer to a backend that is
  down is a miss and a miss here would revert every flag to its default
  mid-incident; **a store that cannot be read flips nothing**, the snapshot
  stands and it is reported at most once a minute. `henri.flags.enabled()`,
  `req.flag()` and, for the pages, the `flags` view option holding the
  flags declared `expose: true` and no others. `henri flags`, `flags:on`,
  `flags:off`, `flags:percentage` and `flags:reset` boot to **runlevel 2**
  and no further, so a kill switch can be flipped with the database
  unreachable; there is **no HTTP surface** in any environment. The guide
  is `guides/feature-flags.md`.
- `SIGINT` and `SIGTERM` drain before they stop (`base/shutdown.js`,
  `2.server.js`): readiness turns 503, `config.shutdown.delay` passes, the
  listener closes and the idle keep-alives are hung up, the requests in
  flight finish within `config.shutdown.drain`, and only then does
  `henri.stop()` run. `config.shutdown.signals: false` leaves the signals to
  the application. `henri jobs` boots to runlevel 4, never starts the server
  and drains its own way (the runner stops claiming and finishes what it
  holds).
- Maintenance mode is `base/maintenance.js` (`henri.maintenance`), built by
  `2.server.js` next to `henri.shared` and mounted **after the health
  endpoints and before everything else**, so a closed application opens no
  session, runs no CSRF check, counts no rate limit and touches no store to
  answer. It is deliberately not a deploy: `henri maintenance:on
[--message] [--retry-after]`, `:off` and `:status` write a record every
  running process re-reads on the way into a request, at most once per
  `config.maintenance.poll` (1s) and deduplicated, so a burst costs one
  read. The switch is `henri.shared` when `config.shared` names one -- every
  process on every machine, with a thirty day expiry because a key there
  needs one -- and `.henri/maintenance.json` otherwise, which reaches that
  machine only; `maintenance.switch` pins either and the boot line says
  which. A read that fails leaves the last state standing (the cache's
  reasoning: a Redis blip must not close an application, or open one) and is
  reported at most once every ten seconds. A visitor gets a 503 with a
  `Retry-After` and `Cache-Control: no-store`, negotiated like the 404 and
  the 500: `app/views/maintenance.html` if the application ships one (read
  as it is, `{{message}}`/`{{retryAfter}}`/`{{since}}` substituted and
  escaped -- the view engine is not involved), henri's own page otherwise,
  and the boom envelope with `HENRI_MAINTENANCE_ON` for an API client.
  **`/livez` and `/readyz` both keep answering 200**, readiness with
  `maintenance: true` in the body: every process is in maintenance at once,
  so a 503 there empties the pool and hands the visitor the proxy's error
  page instead of the operator's, breaks the bypass, and stalls the rollout
  that would end it -- the opposite of a drain, which is one process leaving
  while its peers stay. `maintenance.readyz: "unavailable"` reverses it. The
  bypass is one signed url (`base/tokens.js`, purpose `maintenance`, seeded
  with the window id, so `maintenance:off` invalidates it) which sets an
  `HttpOnly` cookie; `maintenance.bypass: "loopback"` adds the machine
  itself, which behind a proxy is everybody, and `henri audit` reports that
  in a production configuration (`maintenance.loopback-bypass`). The guide
  is `guides/maintenance.md`.
- `henri console --sandbox` (`packages/cli/scripts/console.js`) holds one
  transaction open per store for the life of the REPL and rolls it back on
  exit. It is offered **only where a model call joins the transaction of its
  async context on its own**, which is `Drizzle#sandbox()` (the adapter reads
  the open transaction out of its `AsyncLocalStorage`); mongoose, disk and
  mssql implement no `sandbox()` and the command refuses before it prints a
  prompt (`HENRI_STORE_SANDBOX_UNSUPPORTED`), because a flag that silently
  kept the writes is trusted at exactly the wrong moment. The REPL is started
  inside the context and its `eval` is wrapped as well, which is the
  guarantee. Every store is opened, not only the default, and a store that
  cannot open rolls back the ones that did.
- `henri runner` (`packages/cli/scripts/runner.js`) is the cron line: an
  expression, a file or stdin (`-`) run inside a booted application, with
  the globals an application has. It boots to runlevel 4 like `henri jobs`
  and **binds no port at any point**, a value it answers is printed
  (`henri runner '1 + 1'` prints `2`), anything thrown or rejected exits 1
  with the stack on stderr, and `henri.stop()` runs whatever happened.
- **Drizzle is henri's SQL data layer.** `henri new` scaffolds it on sqlite
  (`file:.henri/app.db`, `:memory:` under `NODE_ENV=test`), which is the
  default of `packages/cli/scripts/adapters.js`; `--adapter` also takes
  `postgresql`, `mysql`, `mssql`, `mongoose` and `disk`.
  `@usehenri/postgresql` and `@usehenri/mysql` are `@usehenri/drizzle` with
  the dialect and the driver chosen (the fourth `options` argument of its
  constructor: `adapterName`, `dialect`, `driverPaths`), so
  `"adapter": "postgresql"` is a drizzle store with migrations and the app
  declares no driver. `@usehenri/sequelize` is reachable only under
  `@usehenri/mssql`, and the reason is that Drizzle has no SQL Server
  dialect (drizzle-orm 0.45: pg, mysql, sqlite, singlestore, gel;
  drizzle-kit 0.31 generates for postgresql, mysql, sqlite, turso,
  singlestore, gel). Everything an mssql store does differently -- no
  migrations, `sequelize.sync()` in development, `henri db:status` for the
  drift -- follows from that.
- **The migration story is `db/migrations` plus `db/schema.sql`**
  (`packages/drizzle/{migrations,dump}.js`). `db:generate` writes
  forward-only drizzle-kit SQL, and `db:rollback` computes the inverse when
  it is asked for, from the two `meta/NNNN_snapshot.json` the folder already
  holds handed to drizzle-kit backwards -- so no `down` file is stored and
  none can go stale. It refuses a migration that dropped a table or a column
  (`HENRI_MIGRATION_IRREVERSIBLE`, no flag lifts it), one whose `.sql` no
  longer hashes to what the database recorded (`HENRI_MIGRATION_EDITED`),
  and, without `--force`, one whose inverse would drop rows that exist --
  counted first, so undoing a migration nothing was written into is quiet.
  Rolling back moves the database, never the folder. `db:schema:dump` reads
  the **database** back into `db/schema.sql` (not the chain, which would
  agree with itself by construction and never catch a hand-run `ALTER`),
  ordered so two runs are byte identical, headed with the migration it was
  taken at; `db:schema:load` creates it in an empty database and records the
  migrations through that one. The codes are the `migration` area of
  `error-codes.json`, and an adapter without either says so
  (`HENRI_CLI_MIGRATIONS_UNSUPPORTED`).
- **A generated migration is read back before it runs** (`safety.js`).
  drizzle-kit will write a statement that takes a production database down,
  so henri scans the `.sql` -- the SQL, not the model diff, because the SQL
  is what runs -- and reports a dropped or renamed column or table, a
  `NOT NULL` column with no default, a type change, an index build and a
  `DELETE`/`UPDATE` with no `WHERE`. Each check names the dialects it
  applies to and the list is **measured**
  (`packages/drizzle/__tests__/engines.spec.js` pins it against real
  servers): an index build is a **postgres problem alone** (`ShareLock` for
  the build; mysql 8 accepts `ALGORITHM=INPLACE, LOCK=NONE`, sqlite has no
  concurrent form), and a `NOT NULL` column with no default fails
  differently -- sqlite and postgres refuse the statement once a row
  exists, mysql accepts it and writes `''`/`0` into every row without a
  warning. `CONCURRENTLY` is named as the fix and is **not** told to go in
  the file, because drizzle applies every pending migration in one
  transaction and postgres refuses it there. `db:generate` warns and writes
  the file; a **production** `migrate()` refuses until the migration's token
  is in `config.migrations.approved` (`HENRI_MIGRATION_UNREVIEWED`, applying
  nothing at all, and the production boot with `"migrate": true` goes
  through the same call); `status()` carries the review so `henri db:status`
  and `henri doctor` (`schema.unreviewed`) answer before the deploy. The
  token is `<tag>:<digest of the findings>`, plain like retention's, so
  reformatting keeps it and another drop edited in replaces it; a flag was
  rejected because `--force` in a deploy script turns the check off for
  every future migration. `migrations.approve: false` is the blanket way out
  and `henri audit` reports it (`migrations.unreviewed`). The scanner
  **walks and does not match**: comments, string literals (whose content it
  throws away rather than skips), dollar quoting and each dialect's
  identifier quotes are lexed, so SQL that only mentions `DROP COLUMN`
  inside a string is not a finding. Two precision rules keep a false
  refusal from happening: a table created by the same migration has no rows,
  and sqlite's `__new_x`/copy/drop/rename rebuild is recognized by its shape
  and reported once as `table.recreate`.
- **The drizzle model refuses what it cannot honour** rather than dropping
  it, because the Sequelize spellings it does not share used to run and mean
  something else. `Model.update(values, { where })` (Sequelize's argument
  order), an option the adapter does not read (`attributes`, `fields`,
  `raw`, `transaction`, ...), a condition keyed by Sequelize's `Op` symbols
  or an empty operator object, and `instance.get({ plain: true })` all raise
  `HENRI_MODEL_INVALID_QUERY` or `HENRI_MODEL_UNKNOWN_OPTION`
  (`packages/drizzle/{model,relation}.js`, covered by
  `packages/drizzle/__tests__/refusals.spec.js`). A model file's `options`
  takes `timestamps`, `paranoid`, `externalId`, `personal` and `retention`;
  anything else (`indexes`, `scopes`, `hooks`, `tableName`, `underscored`)
  fails the boot naming the key (`Drizzle#checkModelOptions`).
- Store adapters implement one contract (JSDoc `HenriAdapter` at the top of
  `packages/drizzle/index.js`, `packages/sequelize/index.js` and
  `packages/mongoose/index.js`):
  `new Adapter(name, config, henri)`, `addModel(model, userModelName)`,
  `getModels()`, `start()`, `stop()`, async `getSessionConnector(session)`,
  `findUserByEmail()`, `findUserById()`, `userId()`, `toPlain()`,
  `references()`, async `externalIdsOf(model, keys)`, `ping()`,
  `transaction()`, on SQL `query()` and `drift()` (what the database
  and the models disagree about, which `henri db:status` prints and a
  production boot warns about), and the optional `describe()` -- what the
  database _holds_, read from the catalogue and never from the model files:
  the physical table of every model, its real columns (name, type,
  nullability, default, primary key, the values of an enum, and the model
  `attribute` a rename maps back to), its indexes, and the names of the
  tables no model claims. The two are never derived from one another and
  `describe()` writes nothing. It is what `GET /_henri/runtime/schema`
  (`base/runtime.js`, the surface `query` lives on, so development only,
  loopback only, `X-Henri-Runtime: 1`, no `Origin`; a column _name_ is
  never masked and a column _default_ is, by name and by shape), the
  `schema` tool of `henri mcp` and `henri db:schema` all ask for. MongoDB
  answers `read: 'models'`, `enforced: false` and a note: the collections
  and the indexes are the server's, the fields are henri's declaration
  applied by Mongoose, and no document is held to them.
  Core loads them from the app cwd
  with `utils.resolveFrom('@usehenri/<adapter>')`. Model files use the henri
  schema format (`type: 'string'|'text'|'number'|'integer'|'float'|'decimal'|
'bigint'|'boolean'|'date'|'json'|'uuid'`, `required`, `default`, `enum`,
  `predicates`, `unique`, `index`),
  normalized by `schema.js` in each adapter (Sequelize and Drizzle throw on
  unknown keys,
  Mongoose passes them through). **`decimal` and `bigint` are the two a
  JavaScript number cannot carry**, and `base/exact.js` is the argument (a
  copy per adapter, byte identical, kept so by `src/__tests__/exact.spec.js`,
  the way `external-id.js` is): a `decimal` has a `precision` (19, at
  most 38) and a `scale` (4), a `bigint` takes neither, and both cross into
  JavaScript as exact decimal **strings** on every adapter -- never a
  `number`, never a `BigInt`, because `JSON.stringify` throws on one and
  henri serializes records in a dozen places. henri ships no arithmetic. A
  value with more decimal places than the scale, more digits than the
  precision, a `bigint` past the signed 64-bit range or a `number` that is
  not a safe integer is refused rather than rounded, so `0.1 + 0.2` fails
  validation instead of landing in the column. The columns are
  `numeric(p, s)`/`bigint` on postgres, `decimal(p, s)`/`bigint` on mysql,
  `Decimal128`/BSON `BigInt` on MongoDB, `DECIMAL(p, s)`/`BIGINT` on mssql,
  and on sqlite a `text` of the digits, cast for a comparison only
  (`dialects.js`: `CAST(... AS INTEGER)`, exact; `CAST(... AS REAL)`, the
  one approximation). `graphql-schema.js` makes both `String`,
  `openapi.js` a string with a `pattern` and no numeric bound, and
  `params-schema.js` a rule type a JSON body must send as a string.
  The user model gets `email` (unique,
  lowercased), `password` (hashed, not selected by default), `roles`
  (stripped from mass assignment; `setRoles()` or `{ unsafe: true }`) and the
  two dates the account flows write, `confirmedAt` and `passwordChangedAt`.
  Every model gets `createdAt`/`updatedAt` (`options.timestamps: false` opts
  out), `paginate({ page, perPage })` answering
  `{ records, page, perPage, total, pages }` and, with `options.paranoid`,
  soft deletes (`deletedAt`, `withDeleted()`, `restore()`, `{ force: true }`).
  Identifiers are two, and one of them is public (`base/references.js`):
  `externalId` (a uuid v7) leaves the server, the primary key does not, and
  neither does a _declared_ foreign key -- `belongsTo()`, `references: {
model }` or Mongoose's `ref` -- which `res.render()`, `res.resource()`,
  `res.collection()` and `henri.model.publish()` replace with the
  `externalId` of the row it names, batched one statement per target model.
  henri reads no field name, so an undeclared column, a `refPath` and a
  plain object that carries no model are left alone and the guide says so.
  `Model.findById()` takes the public identifier and nothing else (a primary
  key answers the same `null` an unknown uuid answers, which is a 404 and
  not an oracle); `findByKey()` is the primary key lookup the framework's
  own session and token reads use, and `findByExternalId()` the explicit
  other half. `config.externalIds` (`lookup`, `references`) restores either
  behaviour and `henri audit` reports it.
  `henri.model.errors(error)` (`base/model-errors.js`) normalizes the three
  ORMs' validation failures to `{ field: message }`, `null` for anything else.
  `henri db:seed` runs `db/seeds.js` on any adapter.
- **A slug is a third identifier and it only ever names a url**
  (`base/slug.js`, a copy per adapter the way `validations.js` is).
  `options: { slug: 'title' }` adds a unique, indexed, `NOT NULL` `slug`
  column, henri fills it on the insert, and `hateoas.identify()` --
  through `references.nameOf()`, which asks the model table rather than
  the record, so an application's own `slug` column keeps the urls it had
  -- prints it in `_links`, the route helpers and the `Location` of a 201.
  Nowhere else: a foreign key is still the target's `externalId`, and so
  is every identifier the versions table, the trail, the flags actor and
  the receipts hold. `findById()` resolves a uuid against `externalId`
  and **anything else against the slug column** -- a `WHERE slug = ?`,
  never a fallthrough -- so a primary key answers the same `null` an
  unknown name answers; a model with a slug takes the whole non-uuid
  space with it, `externalIds.lookup: "any"` included, and a slug shaped
  like a uuid is refused so the two spaces never overlap. `findBySlug()`
  is the explicit half and `internalId()` follows the same rule. **No
  `SELECT` before the `INSERT`**, the position `validates` already takes
  on `unique`: the default appends a six character discriminator derived
  from the record's own `externalId` (`getting-started-k3f9pq`), and
  `suffix: false` gives the bare name and leaves the unique index to
  refuse the second one. `on: 'create'` (the default) never moves the
  url; `on: 'change'` follows the source, the old url 404s -- there is no
  history table -- and a mass update naming the source is
  `HENRI_MODEL_SLUG_MASS_WRITE`. Unicode is NFKD plus eleven Latin
  letters it does not decompose and nothing else, so a Japanese, Arabic
  or Cyrillic title folds to nothing and the discriminator is what makes
  its url work (`HENRI_MODEL_SLUG_EMPTY` with `suffix: false`); a slug
  the application writes itself always wins and may be in any script,
  carried percent-encoded. **No regular expression anywhere in the
  file** -- it walks the code points with the bound applied as it goes,
  because a title arrives through `req.permit()`.
  `henri generate scaffold --slug <field>` writes the declaration, the
  controller and the pages, and a later generator reads the mark back off
  the model file. The guide is `guides/models.md` (`#slugs`).
- **What must be true of a record is `validates`** (`base/validations.js`,
  a copy per adapter the way `exact.js` is, kept byte identical by
  `src/__tests__/validations.spec.js`): a block keyed by field, in the
  vocabulary `params-schema.js` already owns (`required`, `enum`, `min`,
  `max`, `minLength`, `maxLength`, `pattern`) plus `validate`, a function.
  No `type` -- the schema says it, and it is what decides which constraints
  apply; a rule henri cannot carry out fails the boot naming the model and
  the field (`HENRI_MODEL_VALIDATION_INVALID`). **The schema's own
  `required` and `enum` are the same rules**, which is what makes those two
  mean one thing: they used to mean three. Measured before this existed:
  Mongoose ran its validators on `save`/`create`/`insertMany` and on
  nothing else, so `updateMany` wrote a null over a required field;
  Sequelize's `bulkCreate` defaults to `validate: false`, so it wrote a
  value outside an `enum`; and on postgres and mysql the `enum` column is a
  native `ENUM` with no JavaScript check, so the server refused the value
  with a `SequelizeDatabaseError` -- which `model-errors.js` answers null
  for, so the same model file answered **500** there and 422 on sqlite. The
  rules run in `Model.prepare()` (drizzle), a `beforeValidate` plus
  `beforeBulkCreate` (sequelize, ahead of Sequelize's own validators so the
  sentence is henri's) and `pre('validate')` plus the query middleware
  (mongoose, where `required` and `enum` are stripped from the path
  definition for a field whose type henri knows, so henri owns the message
  -- a type Mongoose brought keeps Mongoose's meaning). Two refusals rather
  than a silence: a `validate` declaring a second parameter is asking for
  the record, the predicate `base/policies.js` uses, so a mass write naming
  that field is `HENRI_MODEL_VALIDATION_MASS_WRITE` (the versions
  precedent), measured against the fields the write names so a soft delete
  is not caught; and a write no hook reaches -- Mongoose's `bulkWrite`,
  Sequelize's `increment`/`decrement`, a `$inc` -- is
  `HENRI_MODEL_VALIDATION_UNCHECKED_WRITE`. **henri does not claim
  `unique`**: a check before an insert is a race, so the index stays what
  holds and `model-errors.js` turns the duplicate into
  `{ field: 'must be unique' }`. **A write the store refused puts back
  every attribute it set**: `record.update(attrs)` is `set()` then
  `save()`, so a refusal used to leave the refused value on the record and
  the next `update()` was measured against it -- refused for a field it
  never named on drizzle and mongoose, and silently _not_ refused on
  sequelize, which narrows the statement to the fields the call names. The
  rollback is per adapter (`packages/drizzle/model.js` `rollbackOf()`,
  which carries the whole argument, `restoring()` in
  `packages/sequelize/plugins.js`, `updating()` in
  `packages/mongoose/plugins.js` -- which also _adds_ `doc.update()`,
  removed by Mongoose 7, so the call the guide names exists on all three).
  It fires for what `henri.model.errors()` calls a refusal and nothing
  else, so an `afterUpdate` hook that throws leaves the record saying what
  the row now says; `set()` + `save()` stays two steps and keeps what was
  set, which is how a form keeps what a person typed. The guide is
  `guides/models.md`
  (`#validations`), which is also where the boundary with `params` is
  argued: `params` checks what arrives, `validates` what is written, and a
  job, a seed or a console has no request.
- **An `enum` column is spelled back as methods** (`base/enums.js`, applied
  by `3.model.js` right after `addModel`). One file in core rather than a
  copy per adapter, unlike `validates`: a method on a model is a property,
  and core already knows how to read a model on all three (`kindOf()` in
  `base/erasure.js`, `narrow()` in `base/filters.js`). Three of Rails' four:
  `post.isDraft()` on the record, `Post.live()` on the model -- **a
  condition, not records**, because henri has three query builders and wraps
  none of them, and a condition is the value all three read identically and
  the one that composes -- and `Post.enums.status`, the frozen list. It goes
  under `policy.scope(user)` and the client's filters with the same `and`
  `narrow()` spells, so a scope narrows a list and can never widen it. **The
  bang is dropped**: `post.update({ status: 'archived' })` is already one
  call, the wrong value in a _write_ is already refused by the `enum` rule,
  and only the wrong value in a _comparison_ was silently false forever --
  which is the whole argument for the predicate. `in_review`, `in-review`,
  `IN_REVIEW` and `InReview` all give `inReview` (`names()` in
  `packages/cli/scripts/utils.js` is a _resource_ name and lives where core
  cannot require it); a value that is not a name gets no method and stays in
  the list. A generated name that is already something else is a boot
  failure (`HENRI_MODEL_ENUM_NAME_TAKEN`) rather than a silent shadow, and
  the measurement is why: the record's namespace holds eight `is<Name>`
  methods across the three ORMs and exactly one is a plausible value
  (`new` -> `isNew`, how Mongoose and the drizzle model tell an insert from
  an update), while the model's is crowded (`find`, `create`, `count`,
  `name`, `length`). It is checked against `MODEL_API`/`RECORD_API` -- henri's
  own surface, held as data so the answer is the same on every adapter --
  and then `name in Model`, which is exact and covers the ORM's own. The
  field carries the way out next to the `enum`: `predicates: 'status'`
  prefixes both halves, `predicates: false` generates none. The guide is
  `guides/models.md` (`#enums-predicates-scopes-and-the-list`).
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
- Signing in with somebody else's identity provider is `base/identities.js`
  and `base/identity-store.js`, mounted by the same user module when
  `config.user.identities` names a provider. henri ships **no provider list
  and no provider secrets**: an application points each provider at its own
  `authorizationUrl`, `tokenUrl` and `userinfoUrl`, and the client secret
  belongs in the credentials (`henri audit` reports one in a `config/*.json`,
  the way it does an encryption key). No `id_token` is ever parsed -- the
  profile is what `userinfoUrl` answers to a request henri makes with the
  access token -- and henri is a client, never an OAuth _provider_.
  `henri_identities` is a table henri owns like the trail's, raw SQL or a
  MongoDB collection and never a model, because **a row is a credential** and
  a model would put `provider` and `subject` behind an application's own mass
  assignment; `(provider, subject)` and `(user_id, provider)` are both unique.
  A row carries what it is allowed to imply (`allows`: `signin` or `verify`,
  read from the row rather than the configuration) and how it came to be
  (`origin`: `signup`, `session`, `verified`). The routes are inside the
  machinery rather than beside it: `POST <path>/:provider` behind the CSRF
  token and the origin check (`GET` is 405), `GET <path>/:provider/callback`
  whose `state` is minted per attempt, kept in the session, single use and
  expiring, with PKCE S256, `req.session.regenerate()` before `req.logIn()`,
  the lockout of `POST /login` checked and cleared but never counted, and the
  auth rate limit over the whole prefix. **The merge rule refuses**: a
  callback whose verified address already belongs to an account answers
  `exists` and says to sign in and link, because auto-linking on
  `email_verified` lets a stranger add a credential to somebody else's
  account. Linking happens only from a session that already belongs to that
  user, which is the flow and not a setting; `identities.merge: "verified"`
  is the audited opt-out and needs the provider `trusted: true`. An
  unverified address decides nothing and is refused **before the user table
  is read**, so a known and an unknown address are one answer at one price.
  `henri generate authentication` writes the buttons and the connections
  page, the export lists the providers without the subject, and the erasure
  deletes the rows rather than masking them. The guide is
  `guides/users.md`.
- Record-level authorization lives in `3.policies.js` (`henri.policies`) and
  `base/policies.js`. `app/policies/<model>.js` is loaded the way `app/models`
  is, one file per model, every exported function the rule of the action of
  the same name, `(user, record, context) => boolean`. It fails closed
  everywhere: no policy, no rule for the action and a rule that threw all
  answer false, and only the boolean `true` allows -- there is no setting that
  turns any of that into a yes. **A rule that declares a record parameter is
  never asked without one**, the single predicate that lets the same file
  answer the route gate (no record yet), the `_links` of a HAL resource (a
  record in hand) and the `paths` of a page (no record). One way to ask:
  `henri.can(user, action, record)`, `req.can()` and `req.authorize()` (which
  resolves with the record and rejects with a `POLICY_DENIED` error carrying
  `config.policies.status`, 404 by default, or 401 and the login page for an
  anonymous visitor). **The message of a 404 refusal does not leave a
  production process** (`base/http.js`, `spoken()`, the call `notFound()`
  already made for the route 404): "Not allowed to show this memo" says in
  the body what the 404 was chosen to hide, so it is answered in development
  and in a test process and the reason phrase is the whole answer in
  production, while the `policies denied` log line carries it everywhere. The
  other half of the pair is `res.notFound(why)`, which follows the same rule
  and negotiates -- `res.boom.notFound()` says its message everywhere and
  answers JSON even to a browser, so the shape gave the two apart even when
  the words matched -- and it is what `henri generate scaffold` writes.
  `config.policies.status: 403` keeps its message: that application decided
  to tell them. The **anonymous** half is `config.policies.anonymous`,
  argued in `refusal()`: that 401 is uniform only when it is decided before
  anything is looked up, so on a route guarded only by a record-level rule
  an anonymous visitor could tell an id that exists from one that does not.
  `challenge` (the default) is what henri has always done; `uniform` hands
  an anonymous visitor exactly the error a signed-in stranger gets --
  `policies.status`, the same `expose`, and **no `redirect`**, since a 404
  page setting a `Location` would leak through the header -- and the cost,
  said in the hint and in the guide, is the login-page affordance for a
  bookmarked link. A `roles` on the route still answers at the gate, before
  the lookup, and needs no key; `henri audit` says nothing about either
  value, because the audit reports what an application weakened and this is
  a default henri chose plus a hardening it may opt into.
  `policy: true` on a route registers the guard next to
  the role guard rather than instead of it; what the gate cannot decide is
  enforced by `res.resource()` (unless the action already asked that question)
  and reported by `config.policies.verify`. `res.resource`/`res.collection`
  take a `subject` for controllers answering with a presentation of the
  record. `policy.scope(user)` is the query seam: henri hands the value back
  untouched, and a policy without one throws rather than meaning "everything".
  `henri generate policy <Model> [ownerColumn]` writes the file and its test,
  and `henri audit` reports a policy nothing asks (`policies.unenforced`).
- Multi-tenancy is `0.tenancy.js` (`henri.tenancy`) and `base/tenancy.js`,
  off unless `config.tenancy` says otherwise. Of the three ways to be
  multi-tenant henri picked **a column on every row**, and the header argues
  why: a schema per tenant is a `search_path` on postgres, a database name
  on mysql, a connection on MongoDB and a file on sqlite, all of which are
  _connection_ decisions a store makes once at boot -- so it would be a pool
  per tenant and a migration run per customer, and the guide says who should
  reach for it anyway. A model marks itself (`options: { tenant: true }`, or
  a column of its own by name) and from then on the condition is added to
  every query henri builds for it -- `Relation#whereSQL()` on drizzle next
  to the soft-delete scope, plus `updateById()` and `setWhere()`, which are
  the two write funnels that never build a Relation; query middleware on
  mongoose; hooks plus one connector hook for the `include` on sequelize,
  because `defaultScope` is dropped by the `.scope('withPassword')` of
  henri's own sign-in and by two `unscoped()` calls. **The default is the
  refusal**: a tenanted model touched with no tenant in scope raises
  `HENRI_TENANT_REQUIRED` rather than reading every tenant's rows, which is
  `HENRI_POLICY_SCOPE_REQUIRED`'s instinct one layer down, and it is what
  makes a job, a seed or a console session fail loudly instead of leaking.
  `henri.tenancy.unscoped(fn)` is the one way past and is an async context
  rather than a setting (`henri.encryption.tolerate()`'s shape); a write
  naming another tenant is `HENRI_TENANT_CROSS_WRITE`; what an ORM cannot
  narrow at all (a MongoDB `aggregate` or `bulkWrite`, a Sequelize
  `increment`) is `HENRI_TENANT_UNSCOPABLE`, and `adapter.query()` is raw
  SQL and is not covered, which the guide says out loud. The tenant of a
  request is decided in **one** place, right after passport, and is visible
  (`req.tenant`, `req.tenantSource`, the `req.localeSource` precedent) in a
  fixed order: `explicit` (`req.setTenant()`), the user's own column, the
  subdomain, then a header from a proxy `tenancy.from.header.from` lists --
  a header with no `from` fails the boot. Everything a client can name sits
  **below** the user's own record and may only agree with it: a mismatch is
  `HENRI_TENANT_MISMATCH` (404, message not spoken in production like a
  policy refusal), and `POST /login` asks again after passport so signing in
  on the wrong subdomain opens no session. The path prefix is deliberately
  not a source, `base/i18n.js`'s refusal for `base/i18n.js`'s reason. The
  user model **cannot** be marked. Around it: the idempotency keys are
  scoped by tenant, `henri.webhooks.emit()` defaults its `owner` to the
  tenant in scope, and `henri audit` gained `tenancy.header-from-any` and
  `tenancy.unmarked-model`. **`henri_jobs` and `henri_versions` carry a
  `tenant` column**: `henri.jobs.perform()` stamps the tenant in scope and
  the runner enters it around `perform()` (a null tenant enters none --
  null is not every tenant), and a version names the tenant of the
  **record** it is about, read off the record so a sweep running
  `unscoped()` still names the right one. `henri.versions` reads are
  narrowed and refused the way a tenanted model's are; `restore()` of a
  record that is gone _creates_ one, so across the boundary it is
  `HENRI_VERSION_CROSS_TENANT`. henri's own sweeps say `unscoped()` out
  loud (`Privacy#everywhere`, `Retention#everywhere`) -- an erasure is
  about a person and a retention rule is about a table, and both were
  raising `HENRI_TENANT_REQUIRED` from a command line before that.
  `Tenancy#columnFor(name)` is the accessor a caller that is not an adapter
  asks. The guide is `guides/multi-tenancy.md`.
- Personal data lives in `3.privacy.js` (`henri.privacy`), `base/privacy.js`
  and `base/erasure.js`. A model marks a field in the schema
  (`name: { personal: true, type: 'string' }`, or
  `{ personal: { expose, export, erase } }`) and says what its records are to
  a person in `options.personal` (`subject`, `onErase`, `export`); the three
  adapters accept the key and strip it, and core reads it back from the model
  files at boot. The mark drives four things: every personal field name is
  masked _exactly_ in the logs (`base/redact.js` next to the substring
  `filterParameters`), a field marked `expose: false` is dropped from every
  answer henri builds (`res.render`, `res.resource`, `res.collection`,
  `publicUser`) at every depth unless it is named in `include`,
  `henri privacy:export <who>` hands a person everything held about them, and
  `henri privacy:erase <who>` removes them. The person is the user model. The
  three questions and their answers are in the header of `base/erasure.js`: a
  soft-deleted row is erased (and a soft delete is never an erasure), the
  records that reference the person survive while the person is anonymized in
  place (`onErase`: `anonymize`, `delete`, `orphan`, `retain`), and every
  erasure writes a receipt to `config.privacy.receipts` holding an HMAC of the
  identity rather than the identity. `henri privacy` prints the map,
  `henri audit` reports an unmarked field about a person (`privacy.unmarked`),
  and the guide is `website/src/content/docs/guides/privacy.md`.
- Retention is `4.retention.js` (`henri.retention`) and `base/retention.js`.
  A model says how long it keeps its records in its options
  (`retention: { action, after, from, where, name }`, or a list of those);
  `after` is a period (`'90d'`, `'18mo'`, `'2y'`), `action` is one of the
  three verbs henri already has -- `delete`, `soft-delete` (only on a
  `paranoid` model) and `anonymize` (what `base/erasure.js` writes) -- and
  `from` is the date column the clock starts on, which is rarely
  `createdAt`. A record whose `from` is null never ages out and is counted
  as `waiting`. A rule henri cannot carry out fails the boot
  (`HENRI_RETENTION_INVALID_RULE`). `henri.retention.sweep()` needs nothing
  installed: `henri retention:sweep --yes` is the cron line, and with
  `@usehenri/jobs` `config.retention.schedule` registers the recurring
  `henri/retention` job through `henri.jobs.recur()`; the boot line names
  whichever it is, and says when it is neither. A rule writes nothing until
  its token (`Model:rule:<digest of its terms>`, a plain digest so it means
  the same in every environment) is in `config.retention.approved`, and
  `config.retention.batch` (1000) bounds one run. Every sweep leaves a
  receipt in `config.retention.receipts`, and the guide is
  `guides/retention.md`.
- The access trail is `4.trail.js` (`henri.trail`), `base/trail.js` and
  `base/trail-store.js`, off unless `config.trail` says otherwise. It owns
  a table (`henri_trail`) the way the queue owns its own -- raw SQL through
  the adapter or a MongoDB collection, never a model -- and only ever
  `INSERT`s and `SELECT`s into it. It records what core does itself to
  personal data (`privacy.export`, `privacy.erase` including refusals,
  `retention.sweep`) plus, with `config.trail.reads`, the answers henri
  serializes (`res.resource`, `res.collection`, `res.render`);
  `henri.trail.record()` is how an application adds its own, and the guide
  says plainly that a model call in a controller is outside the boundary.
  An entry holds field _names_, counts, public identifiers and digests: a
  `meta` naming a personal field, a `filterParameters` match, a long string
  or something shaped like an address is refused
  (`HENRI_TRAIL_VALUE_REFUSED`). Every entry carries `seq` (one more than
  the last, under a unique index, so two writers make one chain rather than
  two) and `hash = HMAC(secret, prev + canonical(entry))`, so an edited or
  removed row breaks the chain and `henri trail:verify` says where. Its own
  retention is `config.trail.keep`, pruned by the retention sweep as a
  prefix plus a `trail.pruned` checkpoint. `henri trail`,
  `henri trail:about <who>` and `henri trail:verify` read it back, and the
  guide is `guides/trail.md`.
- The call log is `4.calls.js` (`henri.calls`), `base/calls.js` and
  `base/call-store.js`, off unless `config.calls` says otherwise. It is the
  **deliberate opposite of the trail**: two records -- the call an
  application answered and every call it made -- joined by the request id,
  in one table (`henri_calls`, a `direction` column) that henri owns the way
  the trail owns its own, and it holds **values** where the trail refuses
  them. Four bounds keep it from being a denial of service and each is
  argued in the module header: off unless configured (`2.server.js` mounts
  the middleware right after `requestId()`, and only then, so a request the
  rate limit refused is in the log); the write never blocks the answer (a
  bounded buffer, a multi-row `INSERT` on a timer, a failed flush dropped
  rather than retried and never able to fail a request); the payload capped
  (`calls.maxBody`, and only a body the redactor can _walk_ is stored at
  all, which is why the response body comes from `res.json(value)` rather
  than off the socket); and what one client can cause bounded twice --
  `calls.sample`, a hash of the request id **seeded with `config.secret`**
  so the inbound call and its outbound calls agree and a chosen
  `X-Request-Id` cannot buy its way into the sample, plus
  `calls.maxPerSecond`, an absolute per-process ceiling, with
  `calls.always` keeping the failures sampling dropped (without their
  bodies). Everything stored goes through `redactor(henri)` and, on top of
  it, `authorization`/`cookie`/`set-cookie`/`x-csrf-token`/`x-api-key`/
  `webhook-signature` and every forwarding header are masked whatever
  `filterParameters` says, a url
  loses its userinfo and the person is their `externalId`. An inbound row
  also records where the request came from (`base/address.js`,
  `config.calls.address`), in three columns rather than one: `client_ip`,
  what henri believes; `peer_ip`, the socket; and `ip_source`, how it was
  decided. `X-Forwarded-For` is believed through `config.trustProxy`, which
  express already applies, and a header express will not read
  (`cf-connecting-ip`) only through `calls.address.header` **and**
  `calls.address.from`, the proxies allowed to set it -- a header without
  `from` fails the boot (`HENRI_CALLS_ADDRESS_UNVERIFIABLE`). A blanket
  `trustProxy: true` in front of a forwarded request records **no client
  address at all** and says `unverified`, because an address that is a
  guess is worse than an empty column; `henri audit` reports that
  (`calls.address-unverified`) and a `from` covering everything
  (`calls.address-from-any`). `calls.address.anonymize` truncates to a /24
  or a /48 keeping the prefix length in the value, and is off by default.
  An address is personal data, so it is in columns of its own rather than
  the header blob and a person's rows answer `henri privacy:export` and
  `henri privacy:erase` (`henri.calls.forPerson()`/`forget()`, best effort,
  joined on the `externalId`) -- the trail records no address on purpose,
  because it holds no values and is hash-chained, and `henri.reporter`
  still carries nothing from the client. `calls.keep`
  (30d) is pruned by the retention sweep, and where the dialect has ranges
  (`calls.partition`, PostgreSQL and MySQL) the sweep drops whole periods
  instead of rows -- with a catch-all partition so no row is ever refused,
  and a period the sweep dropped never coming back, because MySQL keeps its
  ranges in increasing order. `henri.calls.track()`/`outbound()` is the seam
  an application's own HTTP client goes through (henri wraps nobody's
  client); the mail transport and the webhook deliveries use it themselves,
  and `emit()` stamps the request id into the delivery job so an
  asynchronous delivery still joins. `henri calls <request-id>`,
  `henri calls:stats` and `henri calls:sweep` read it back, and the guide is
  `guides/calls.md`.
- The query seam is `0.queries.js` (`henri.queries`) and `base/queries.js`,
  on outside production. **Every adapter reports every model call** --
  `{ at, store, adapter, dialect, model, operation, method, keys, shape,
duration, rows, requestId, source, callsite }` -- and the N+1 detector is
  a listener on it. It sits at the **model call and not the statement**, and
  the header argues why: it is the only level at which henri can give advice
  (a driver instrumentation counts statements better), a statement count is
  not actionable (`paginate` is two, a MySQL insert is two), and -- the
  measurement that settled it -- `include()` on Drizzle is one correlated
  json subquery, so the Rails lazy-association N+1 **does not exist there**
  and a detector written to `bullet`'s model would report success. So: **the
  threshold counts model calls, never statements**, said out loud everywhere
  because a person reading "40 queries" assumes the other thing. The event
  carries **no SQL**, and the reason is `@usehenri/sequelize`: its query
  generator interpolates values into the text it runs (`WHERE "name" =
'ada'`), so a `sql` field would be safe on Drizzle and Mongoose and a copy
  of the row there; `keys` is column **names**, the trail's rule. The join
  is the request id and nothing else, off the same `AsyncLocalStorage`, and
  **telemetry does not consume this seam** -- statements stay the driver's
  own instrumentation to trace, `adapter.query()` keeps its span and gains
  an event, and no model call becomes a span (`base/telemetry.js` was
  amended to say where that line sits). Each adapter maps its own layer in
  a `queries.js`: Drizzle and Sequelize **wrap** their statics (both answer
  promises) plus `Relation.prototype` once per process for the lazy path,
  Mongoose uses **schema middleware** because `Model.find()` answers a lazy
  chainable `Query` and wrapping it would break `find().sort()` -- at the
  cost that an operation that fans out (`populate`) reports twice, which the
  header and the guide both say. `henri.queries.instrument()` is the one API
  they call, and it owns the nesting rule (the outermost call wins, so
  `findById` is one event and not the `first()` it is built out of).
  A finding goes to the log, to `X-Henri-Queries` in development, or to a
  thrown `HENRI_QUERIES_N_PLUS_ONE` with `detect.raise` (the test-suite
  gate); **not** to `henri.reporter`, because an N+1 is a slow answer and
  not a failure. Off means nothing installed: no hook, no middleware, no
  allocation. `henri audit` reports `queries.raise-in-production` and the
  guide is `guides/queries.md`.
- Model versioning is `4.versions.js` (`henri.versions`),
  `base/versions.js` and `base/version-store.js`, and it is **opt-in per
  model**: `options: { versioned: true }` (or `{ only, except, events }`)
  is the switch, `config.versions` only says where the table lives
  (`henri_versions`, owned the way the trail owns its own) and how long a
  row is kept. No model asking means no table, no hook registered on any
  model, no middleware and no boot line. It lives in core rather than in a
  package because `options` is core's vocabulary -- the adapters refuse a
  key they do not know by name -- and because `privacy:erase` and the
  retention sweep have to reach the table, which core must not be able to
  forget. One row per change: `at`, the model, the record's **`externalId`**
  (never the primary key), the event, `changes` as `{ field: [old, new] }`,
  the actor and the request id. **A soft delete is an `update`** -- the row
  is still there and the diff says all of it -- and only a `destroy` carries
  a `snapshot`, because a diff describes a change to something and after a
  real delete there is nothing left to fold from. The actor and the request
  id come off the `AsyncLocalStorage` of `base/request-id.js`, which the
  module's own middleware stamps `req.user` onto; outside a request the
  actor is null and the source is `system` unless
  `henri.versions.acting({ actor, source }, fn)` says otherwise. What is
  never stored, in order: a field the model left out, `password` (named as
  changed, values not kept, whatever `filterParameters` says), an
  `encrypted` field (stored as its envelope, re-wrapped with the field's
  own context), and a `filterParameters` match -- a change with no values
  is `null` rather than a masked string, because a mask is a value a
  restore would write. A `personal` field **is** stored, argued in the
  header: the erasure reaches it (`config.versions.onErase`: `follow`,
  `delete`, `retain`), the export hands it over and the sweep prunes it
  (`config.versions.keep`). `reify()` reads -- it folds backwards from the
  live record, or from a destroy's snapshot, and says when it is not exact
  -- and `restore()` writes, refusing an inexact reconstruction
  (`HENRI_VERSION_INCOMPLETE`) unless forced. A **mass write on a versioned
  model is refused** (`HENRI_VERSION_MASS_WRITE`): the hooks run once
  without instances, so recording nothing for a hundred rows would make the
  history lie; the refusal names the loop, `{ versions: false }` is the way
  through, and henri's own sweeps use it. Each adapter has a `versions.js`
  (the wiring) the way each has an `encryption.js`. **A row carries the
  `tenant` of the record it is about** when `config.tenancy` is on, read
  off the record's own column (`Versions#tenantOf`) and not off the scope,
  so a sweep running `unscoped()` names the right one and a shared model
  names none. `list`/`count`/`of` are narrowed to the tenant in scope and
  **refused** without one (`Versions#scope`, `HENRI_TENANT_REQUIRED`), a
  scoped read taking the null rows with it because that is what a shared
  model's history and every pre-upgrade row look like; `get()` answers
  `null` for another tenant's row (`findById()`'s non-oracle); and
  `restore()` of a record that is **gone** is a create, so it refuses
  across the boundary (`Versions#restorable`,
  `HENRI_VERSION_CROSS_TENANT`) while an update never needs to. The column
  arrives through an upgrade block this file did not have before (`ADDED`,
  `upgrade()`, tolerated by `SqlVersions#install`, probed by `tenanted()`),
  and a multi-tenant application whose table cannot hold it fails the boot
  (`HENRI_VERSION_TENANT_UNINSTALLED`). `henri versions`,
  `versions:show` and `versions:restore` read it back -- across every
  tenant (`unscoped()`, an operator holds the database), `--tenant`
  narrowing them, and the last two reifying **as the tenant the row
  names**, which is what makes a restore work at all on a tenanted model.
  The guide is `guides/versions.md`.
- Encrypted attributes live in `1.encryption.js` (`henri.encryption`,
  runlevel 1, so a model that declares one finds a keyring already built),
  `base/encryption.js` (the envelope) and `base/rewrap.js` (the rotation
  walk). A field says it in the schema next to its type:
  `ssn: { encrypted: true, type: 'string' }` is randomised,
  `{ encrypted: { deterministic: true } }` keeps an equality and a
  `unique`. The envelope is `henri:v1:<r|d>:<key id>:<base64url(iv|tag|ct)>`,
  AES-256-GCM with three HKDF subkeys per configured key and
  `henri:v1:<scheme>:<Model>.<field>` as the AAD, so a ciphertext only
  opens in the field it was written for (the row is _not_ bound: the threat
  is a dump, not a writer -- the reasoning is in the module header). The key
  is `config.encryption.keys`, never `config.secret`: its home is the
  encrypted credentials or `HENRI_ENCRYPTION_KEYS` (comma separated,
  primary first), the path is masked wherever henri prints a configuration
  value (`ALWAYS_MASKED` in `0.config.js`, indexed paths included) and only
  the eight character key id ever reaches a message. The three adapters each
  hold a copy of `encrypted.js` (the mark, like `external-id.js`) and an
  `encryption.js` (the wiring): Sequelize uses attribute getters, because
  an `afterFind` hook does not fire for an `include`; Mongoose decrypts in
  `post('init')` and over `lean()` results, because a getter skips
  `toObject()`; Drizzle decrypts in `afterLoad`. A randomised column is
  refused as `unique`, as `index` and in a `where`; a deterministic one is
  translated into an `IN` over one envelope per key, so a lookup survives a
  rotation; anything that is not an equality, and any order, is
  `HENRI_ENCRYPTION_NOT_QUERYABLE` rather than an empty result. A
  `string` becomes `text` (randomised) or `varchar(700)` (deterministic,
  480 bytes of plaintext, the MySQL index key being the binding limit).
  Reading throws -- three codes for three incidents (`KEY_UNKNOWN`,
  `UNREADABLE`, `PLAINTEXT`) -- and `henri.encryption.tolerate(fn)` is the
  only way past it (an `AsyncLocalStorage`, not a setting), which is what
  `henri privacy:export`, `plan` and `erase` run inside so a lost key never
  breaks a data subject request. `encrypted` implies `personal`.
  `henri encryption`, `:status` (counts by key id, opens nothing) and
  `:rotate` (walks soft-deleted rows, leaves `updatedAt` alone, never
  overwrites a value it could not read back) are the commands, a backfill is
  a rotation with `config.encryption.readPlaintext` on, `henri audit`
  reports a key in a configuration file and `readPlaintext` left on, and the
  guide is `website/src/content/docs/guides/encryption.md`.
- Internationalization is `1.i18n.js` (`henri.i18n`) and `base/i18n.js`,
  off unless `config/locales` holds a catalogue -- which is the call log's
  rule and matters here because most applications have one language: no
  block and no directory means no catalogue held, **no middleware mounted**,
  no `req.locale`, no `i18n` in the view options, nothing on the client and
  no boot line, for a `fs.existsSync` at boot. A locale is
  `config/locales/<locale>.json` or `<locale>/<namespace>.json`, flattened
  to dotted keys; a leaf is a string or a set of `Intl.PluralRules`
  categories (`other` required, `"=0"` winning over its category), and
  anything else fails the boot. The locale of a request is decided in one
  order and the decision is **visible** -- `req.locale`, `req.localeSource`,
  `Content-Language`, and `Vary: Accept-Language` when the header answered:
  an explicit `req.setLocale()`, the column `i18n.from.user` names, the
  query, a cookie henri reads and never writes, `Accept-Language` by q
  value, the default. The path prefix is deliberately **not** on that list,
  because henri's route table is the source of both the url and the helper
  that prints it. A missing key answers **the key**, never a sentence
  guessed from it, and is recorded in `henri.i18n.missing()` whatever
  `i18n.missing` says (`warn` outside production, `key` in it, `throw` for a
  test suite); `henri doctor` compares the files on disk
  (`i18n.incomplete`, `i18n.orphan`, `i18n.placeholders`). **A translation
  is never escaped and its values always are, at the boundary that renders
  them**: `t()` answers a plain string, the Handlebars `{{t}}` escapes the
  values and returns a `SafeString`, a `<view>.text.hbs` escapes nothing,
  and React escapes its own children -- so markup in a catalogue is markup
  in Handlebars and text in a page. The catalogue reaches a browser once per
  **document** (`henri.i18n.embed()`, called by the two engines) and never
  on an XHR answer, which carries `{ locale, source, url }` whose digest is
  in the file name; `i18n.client` takes `always` and `false`. **The locale
  of a mail is the recipient's and never the request's**: the envelope's
  `locale`, or `for` (the record, read through `henri.i18n.forUser()`),
  which is what makes a mail from a job right, and `deliverLater()` renders
  before it enqueues so a worker needs no catalogue. Dates, numbers,
  currency and the plural rules stay `Intl`'s -- `{{number}}` and `{{date}}`
  forward their hash to it unchanged, and exist only because Handlebars has
  no expressions -- and model attribute names and validation messages are
  not translated, composing with `henri.model.errors()` through
  `t(key, values, { default })`. The guide is `guides/i18n.md`.
- Time zones are `1.time.js` (`henri.time`) and `base/time.js`, and the
  survey in that header is the argument. **Storage was never the problem**:
  every adapter keeps a moment as a moment, measured by writing under
  `Pacific/Kiritimati` (UTC+14) and reading under `Pacific/Niue` (UTC-11)
  -- `integer` epoch ms on drizzle/sqlite, `timestamp with time zone` on
  postgres, `datetime(3)` on mysql, a BSON date on mongoose,
  `DATETIMEOFFSET` on mssql; the one defect is Sequelize's bare `DATETIME`
  on MySQL truncating the milliseconds, which an application does not reach
  because a MySQL store is drizzle's. A `Date` also reaches `res.json()`
  untouched and serializes as ISO-8601 `Z`. What was broken is **rendering
  on the server**: `Intl.DateTimeFormat` with no `timeZone` follows the
  process, so one instant printed as three calendar days depending on the
  deployment. So `config.timeZone` (a name, or `{ default, from }`) is the
  zone a server renders in, defaulting to **`UTC` and not
  `process.env.TZ`** -- a behaviour change, because a value nobody set must
  not move with the deploy. A **person's** zone lives on their record in
  the column `timeZone.from.user` names, exactly where `i18n.from.user`
  puts their language, because **a mail's zone is the recipient's**
  (`Message#zone`, the locale's argument and the only thing a job can ask).
  `req.timeZone`/`req.timeZoneSource` make the decision visible and
  `req.setTimeZone()` sets it; every step but the default is **off until it
  is named**, since no browser sends a zone header on its own, and a zone
  off the wire is a display preference and never an authorization input.
  henri ships no date library: `henri.time.format()` is `Intl.DateTimeFormat`
  with the `timeZone` filled in, `{{date}}` fills in the render's zone (the
  hash still wins) and a page gets `{ zone, source }` in the view options
  next to `i18n`. It **stores nothing** -- the queue's BIGINTs, the trail,
  the call log, the versions, retention's cutoffs and every idempotency key
  are untouched -- and a `date` parameter with no offset is now read as UTC
  rather than in the process's zone, which was the one place the absence of
  a policy reached a stored value. The guide is `guides/time.md`.
- The router (`5.router.js`) expands `config/routes.js` through
  `base/routes.js` (`root`, `resources`/`crud` with `only`/`except`/`omit`,
  `member`, `collection`, `namespace`, `nested`; `@usehenri/cli` requires the
  same module so `henri routes` and `henri doctor` read the same table), sets
  `req._henri` (`csrf`, `flash`, `localUrl`, `paths`, `query`, `user`) and
  `res.render()`, which builds the view options (`data` or a `graphql` query,
  `errors`, `flash`, `paths` filtered by roles and then by the policies)
  and content-negotiates HTML (the engine) or JSON. `res.boom.*` (`base/boom.js`) answers
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
  **The definition itself is derived, not generated into the file**
  (`base/graphql-schema.js` for the SDL, `base/graphql-resolvers.js` for the
  runtime half; core carries both and depends on the `graphql` package for
  neither, because SDL is a string and a resolver is a function).
  `graphql: true` on a model derives its type, `Query.<model>(id: ID!)` and
  `Query.<models>(page, perPage, where)`; `{ generate: true, ... }` takes
  `name`, `queries`, `filters`, `mutations`, `except`, `types` and
  `resolvers`, and an object without `generate` is exactly what the key
  always was. The reason it is derived is the identifier: `id` is `ID!` and
  it is the `externalId`, a declared foreign key is the `externalId` of the
  row it names in both directions, and a written-down copy of that stops
  being true the first time a mark changes -- the same argument
  `base/openapi.js` makes, whose `columnsOf()` and `settingsOf()` it
  borrows. What is never derived comes off the marks: a field marked
  `personal: { expose: false }` is not a field (which is what leaves the
  user's `password` out, with no list of names), a personal field is never
  an argument, a randomised `encrypted` one is never an argument, a `json`
  column has no shape to state. Mutations are opt-in, and every derived
  resolver asks a policy (`show`, `index` plus `policy.scope(user)`,
  `create`/`update`/`destroy`) and publishes through `henri.model.publish()`
  and `henri.privacy.strip()`. `henri graphql` prints the SDL without
  booting, `--summary` says what was left out and why, and `henri doctor`
  reports a declaration that would fail the boot, a derived model with no
  policy or no `scope`, and a hand-written type naming a field that never
  leaves the server.
- Background jobs live in `@usehenri/jobs`. Core carries none of it: the
  package ships the module itself (`"henri": { "module": "./module.js" }`,
  `src/module.js`), so depending on the package is what puts `henri.jobs` in
  the boot (`perform`/`performIn`/`performAt`/`performNow`, `list`, `stats`,
  `dead.*`), at runlevel 4, so `henri jobs` boots to that level and binds no
  port. Installing it is not the same as using it: an application with
  neither `app/jobs` nor a `jobs` block keeps the module inert
  (`henri.jobs.enabled` false, no table created), and one without the package
  has no `henri.jobs` at all. `base/jobs.js` in core is the one place that
  reaches for it -- `deliverLater()` with a `wait` or an `at` fails with the
  install line rather than sending the mail now -- and `henri doctor` reports
  the missing dependency when `app/jobs` holds a file or the configuration
  has a `jobs` block. `henri new` does not add the dependency.
  A job is `app/jobs/<name>.js` exporting `perform(args, context)` plus
  `queue`, `priority`, `maxAttempts`, `timeout` and `backoff`. The queue owns
  `henri_jobs` and `henri_jobs_schedules` and reaches them through
  `adapter.query()` or the MongoDB collections, never through a model; every
  moment is a BIGINT of epoch milliseconds. Claiming is one statement per
  dialect (`FOR UPDATE SKIP LOCKED`, `UPDATE ... ORDER BY ... LIMIT`,
  `UPDLOCK, READPAST`, a subquery on sqlite, `findOneAndUpdate` on MongoDB)
  and the claimed rows are read back by the token it stamped, so two runners
  never perform one job. **A job bounds itself across every runner**
  (`concurrency: 1`, or `{ limit, key, group }`), which `--concurrency` --
  a bound on one _runner_ -- never could. The bound is **not** counted
  inside the claim: a `COUNT(*)` there reads the statement's own snapshot,
  so two runners both see the same room, and `SKIP LOCKED` locks the
  candidate rows rather than the count. Making it exact needs a lock per key,
  which is `pg_advisory_xact_lock`, `GET_LOCK`, `sp_getapplock` and nothing
  at all on MongoDB. So it lives in a third table the queue owns
  (`henri_jobs_limits`), one row per slot with `(limit_key, slot)` as its
  primary key: **a unique index refusing a duplicate**, the one primitive
  that means the same thing on all five backends. The permit is taken
  _before_ the row is claimed, never after -- claim-then-put-back spins the
  loop, which only sleeps when a tick claimed nothing. The claim keeps its
  shape and gains one predicate: `name NOT IN (...)` on the unlimited pass
  (byte identical when nothing is limited) and
  `name IN (...) AND concurrency_key = ?` with a limit of one on the other,
  partitioned by **name** so a job that gains or loses a limit is always in
  exactly one pass. The bound rests on the heartbeat, the same clock the
  recovery does. The one column it stores (`concurrency_key`) is added by a
  **tolerated** `ALTER` inside the idempotent install, and the store _asks
  the table_ rather than trusting it ran: an application with no limit is
  unaffected either way, and one that declares a limit the table cannot hold
  fails the boot (`HENRI_JOB_LIMIT_UNINSTALLED`) rather than running it
  unbounded. **A batch is a set of jobs and one that runs when they are all
  done** (`henri.jobs.batch({ callback, args, jobs })`, or a function that
  adds them, sealed when it resolves). A batch **finishes**, it does not
  succeed: the callback runs once every job has reached a terminal state,
  `dead` included, and is handed the counts under `batch`. Three writes
  carry it. `total` is written once, when the batch is sealed, and never
  moves. `done` is advanced by **one statement per terminal outcome** --
  `SET done = done + 1 ... WHERE finished_at IS NULL AND EXISTS (the job row
still holds this runner's claim token and is terminal)` -- so the counter
  is never read into the process to be written back (four runners finishing
  at once make four increments; sqlite serializes its writers and the
  servers re-evaluate the row under their own lock) and it moves for
  **exactly one** runner, the one whose token-guarded outcome write landed;
  MongoDB is `$inc` plus that same check as a `findOne`, exact because a
  terminal document holding this token can never be claimed again. The
  callback is then enqueued under a unique key of the batch's own -- the
  recurring occurrence's primitive, and a key `keys.js` keeps for the life
  of the row -- and `finished_at` is stamped **after** it, so settling is
  idempotent and a process dying in between is repaired by the sweep. That
  sweep is the other half: it counts the rows of a batch that has not moved
  for `stuckAfter`, which answers both a runner killed between the outcome
  and the count and a job the recovery buried, and it only ever moves a
  batch forward. A job put back gives its slot back
  (`releaseBatch`), and a batch is built where it is created -- adding to a
  sealed one is `HENRI_JOB_BATCH_CLOSED`, asked of the table. Its column
  (`batch_id`) and its table (`henri_jobs_batches`) arrive through the same
  tolerated `ALTER` inside the idempotent install, and `batch()` on a store
  that has neither is `HENRI_JOB_BATCH_UNINSTALLED` rather than a counter
  nothing can hold. **A job carries the tenant it was enqueued in**
  (`tenant`, the third column to arrive through that same tolerated
  `ALTER`, and `SqlStore#tenanted()` asks the table for it): `perform()`
  stamps `henri.tenancy.current()` the way `emit()` defaults its `owner`,
  an explicit `tenant` wins (a _different_ one while a tenant is in scope
  is `HENRI_TENANT_CROSS_WRITE`), and **the runner enters that tenant
  before it calls `perform()`** (`Jobs#scoped`, inside `invoke()` so it
  covers the one call that touches the models). A row with no tenant enters
  none, deliberately: a recurring occurrence, a script, `tenant: null` and
  every pre-upgrade row keep the refusal they had. A batch's tenant rides
  in `callback_options`, which is already stored and already handed to
  `perform()`, so no second table needs the column. The claim is **not**
  narrowed by tenant -- a runner per customer is a scheduling feature --
  and an application with `config.tenancy` on whose table has no column
  fails the boot (`HENRI_JOB_TENANT_UNINSTALLED`).
  `henri.jobs.recur(name, entry)` is the seam a
  framework module uses to ask for a schedule the configuration did not
  write (`henri.retention` is the one that does); an entry the application
  declared under the same name wins. `henri jobs` runs a worker (`--queue`,
  `--concurrency`, `--once`), `henri jobs:install|status|list|batches|dead|
show|perform|retry|discard` drive it (`--tenant` on the last five, and
  every `--json` job carries one); `jobs:status` and
  `henri.jobs.limits()` report the limits and the slots held, and
  `henri.jobs.batches.*` the batches. The module also registers
  `henri.mailers.onDeliverLater()`, so `deliverLater()` enqueues the rendered
  message as the built-in `henri/mail` job.
- Outbound webhooks live in `@usehenri/webhooks`, which peer-depends on core
  and on the queue and ships its own module (`henri.webhooks`, runlevel 4,
  `after: ['cache', 'jobs']`). `henri.webhooks.emit(event, data, { owner })`
  writes one queue row per subscribed endpoint and returns; `register`,
  `endpoints`, `secrets`, `update`, `rotate`, `disable`, `enable`, `remove`
  and `stats` are the rest, and `henri webhooks:*` drives them. The endpoints
  are one table the package owns (`henri_webhooks`), reached through
  `adapter.query()` or the MongoDB collection like the queue's, never a
  model; there is **no deliveries table**, because a delivery is one
  `henri/webhook` job and `henri jobs:list --queue webhooks`,
  `jobs:dead` and `jobs:show` already answer what happened to it. An
  endpoint carries an `owner` (the tenant), which is what an `emit` filters
  by -- one without an owner reaches the endpoints that have none, never a
  tenant's -- and the lookup is cached in `henri.cache` for ten seconds,
  without the secrets. Signing follows **Standard Webhooks**:
  `webhook-id`, `webhook-timestamp` and `webhook-signature`
  (`v1,<base64 hmac-sha256 of id.timestamp.body>`), the secret is
  `whsec_<base64 key>` and several of them sign at once during a rotation
  (`rotate(id, { grace })`); the id is stable across the attempts of one
  delivery and the timestamp is stamped per attempt, so a receiver dedupes on
  verified bytes and a retry stays inside its window. The secrets are stored
  AES-256-GCM under an HKDF of `config.secret`, so rotating `HENRI_SECRET`
  makes them unreadable and says so (`HENRI_WEBHOOK_SECRET_UNREADABLE`). A
  url is checked when the request is made, not at registration (DNS answers
  differently later): scheme, no credentials, then every resolved address
  against the loopback, link-local, private, CGNAT, multicast, reserved,
  documentation and IPv4-in-IPv6 ranges (`src/address.js`, `net.BlockList`),
  and the socket is **pinned** to the address that was checked. A redirect is
  never followed and a `410 Gone` disables the endpoint; both, and a refused
  address, are permanent failures. `webhooks.allowPrivate` and
  `webhooks.allowHttp` lift the first two rules for development, and
  `henri audit` reports either of them in a production configuration.
  Two seams were added to `@usehenri/jobs` for this and are useful on their
  own: `henri.jobs.define(name, definition)` (a package's own job; a file of
  `app/jobs` still wins) and an error carrying `retryable: false`, which the
  queue buries on the spot instead of retrying.
- File uploads live in `@usehenri/uploads`. Core parses no multipart body:
  the package ships the module (`"henri": { "module": "./module.js" }`), so
  depending on it puts `henri.uploads` in the boot at runlevel 3, with
  `before: ['user', 'router']` -- the parser has to run before the CSRF
  middleware, because the `_csrf` field of a multipart form is inside the
  body. It mounts one middleware that always adds `req.files`
  (`{ [field]: UploadedFile[] }`), `req.file(field)` and
  `req.permitFiles(...fields)` -- `req.permit()` for files, which unlinks
  what the controller did not list -- and reads a multipart body with busboy
  under the bounds of `config.uploads` (`maxTotalSize` 25mb, `maxFileSize`
  10mb, `maxFiles` 10, `maxFields` 100, `maxFieldNameSize` 100 bytes,
  `maxFieldSize` defaulting to `config.bodyLimit`; each of the first four
  accepts `false`). Every bound reaches the parser, `Content-Length` is
  checked before one is built, and a refused request is drained (capped) so
  the client reads its `413`. A file's type comes from its first bytes
  (`src/sniff.js`), never from the `Content-Type` or the extension; the
  client's claim is kept as `declaredType`, `config.uploads.allow` matches
  the sniffed type, and `text/html` and `image/svg+xml` are stored under
  `.bin`. The stored name is generated
  (`<yyyy>/<mm>/<32 hex>.<extension of the type>`), the original is cleaned
  metadata, and the storage refuses any other key shape. Nothing is kept
  unless a controller calls `store()`, which answers the record a model holds
  (`{ key, name, type, size, checksum, storage, uploadedAt }`); everything
  else is swept when the response closes. Storage backends implement
  `HenriStorage` (JSDoc at the top of `packages/uploads/src/storage/local.js`:
  `start`, `stop`, `temp`, `put`, `get`, `stat`, `delete`, `url`); the local
  disk ships (`storage/uploads`, `0700`/`0600`, a `.gitignore` of its own),
  anything else is a module id resolved from the application, and
  `henri.uploads.send(res, record)` is how a file is handed back.
  **The storage is not only the disk**: `config.uploads.storage` takes an
  object (`{ adapter, ... }`, the shape `config.shared` and a store already
  have) and `s3` resolves `@usehenri/s3` from the application -- one backend
  over the S3 API for S3, R2, Spaces, MinIO and GCS's compatibility mode,
  told apart by an endpoint and a region. That package carries no dependency
  but `debug`: SigV4 is two hundred lines of `node:crypto` checked against
  the vectors AWS publishes, and the five requests it makes (`PUT`, `GET`,
  `HEAD`, `DELETE`, a presigned `GET`) go out through `node:http`, because
  `Content-Length` is a forbidden header name in `fetch` and S3 refuses a
  `PUT` without one. Its `temp()` is a `LocalStorage`, so a part still lands
  on a local disk before anything authorizes keeping it.
  **`url()` means something now**: `henri.uploads.url(record, { expiresIn,
disposition, filename, type })` is one call whatever the backend -- the
  provider's own presigned url on an object store, and henri's own on the
  local disk (`src/signing.js`: HMAC-SHA256 under an HKDF of `config.secret`
  over the key, the expiry, the disposition, the name and the type, verified
  by the middleware of `src/download.js` at `uploads.urls.path`). Both cover
  the key, the window and how the file is served, so a url is neither
  editable nor replayable past its expiry; until then it **is** a bearer
  capability, which is why `config.uploads.urls` is off by default and
  `url()` refuses (`HENRI_UPLOAD_URLS_DISABLED`) rather than answering null.
  The host is outside henri's signature (`urls.cdn` puts a cache in front);
  SigV4 covers it, so an object store names `storage.publicEndpoint` instead.
  **Variants** are `config.uploads.variants` (named specs only, never a
  request) and `henri.uploads.variant(record, name)`: the key is the source's
  plus a digest of the variant's terms, so the work happens once, on demand,
  never in the request that uploaded, and a `stat` is what a hit costs.
  `sharp` is an **optional peer dependency** resolved from the application
  (`HENRI_UPLOAD_NO_IMAGE_LIBRARY` with the install line without it, and
  `henri doctor` reports it); an SVG is refused, so are more than fifty
  megapixels and every frame but the first, and what the resize produced is
  sniffed before it is stored.
- Controllers may export `before` (`base/hooks.js`): hooks the router runs
  between the role guard and the action, keyed by action (`all`,
  `'show,edit'`) or as `[fn, { run, only, except }]`; a hook that answers ends
  the request, and `before` is one of the five exports that are never an
  action. The same module wraps every action so that returning without
  answering renders `/<controller>/<action>` (`/<controller>` for `index`)
  with what it returned. `req.flash()` (`base/flash.js`) keeps one-shot messages in the
  express session and the views read them once through `flash`.
- The second is `params` (`base/params-schema.js`): what each action
  accepts, in the same shape (`all`, `'index,search'`), one rule per field in
  the henri schema vocabulary (`type`, `required`, `default`, `enum`) plus the
  bounds a request needs (`min`/`max`, `minLength`/`maxLength`, `pattern`,
  `of`, and `array` next to the model types). `2.controllers.js` compiles the
  block at boot, so a rule henri cannot carry out fails the boot naming the
  controller, the action and the key (`HENRI_PARAMS_DECLARATION_INVALID`)
  rather than accepting everything; `controllers.accepts()`/`checks()` and
  `5.router.js` put the check behind the role and policy guards and ahead of
  the `before` hooks. The rule is the source: a textual source (the query
  string, a path parameter, a form body) is **parsed** into the type, a JSON
  body is **checked** and never parsed, so `{"page": "2"}` is refused. What is
  accepted is written back where it came from -- `req.query.page` is the
  number -- and `req.permit()` with no field answers the whole declaration;
  an undeclared key is dropped, never refused. A request that does not match
  answers 422 with `{ field: message }` and `HENRI_PARAMS_INVALID`, negotiated
  like everything else (a browser that posted a form goes back to it with the
  messages in the flash). An action with no declaration is untouched.
- The third is `answers` (`base/answers.js`), the same idea pointing out:
  what each action **answers**, in the same block shape and the same
  vocabulary. It exists because the two directions were not equally
  guarded -- `res.render()`, `res.resource()` and `res.collection()` all
  went through `toPublic()` (publish the foreign keys, then strip what the
  models marked `personal: { expose: false }`) and `res.json()` went
  through nothing, so a hand-built object -- an Inertia page's props
  assembled in the controller, a total next to a list -- carried both out.
  Two things, and the difference matters: **the floor** is that publish and
  that strip on **every JSON answer of every controller action**, declared
  or not, with no setting that turns it off, and **the declaration** is
  opt-in per action. A rule is `{ type, model, from, of, required, expose }`
  or the type itself: `model` names the model whose records a field holds,
  which is the only way an object that never was a record can have its
  foreign keys published; `from` is `'User.gender'`, the column a value came
  from, which binds it to that column's marks under whatever name the answer
  gives it (the one leak a name-based strip cannot see) and fails the boot
  when that column says `expose: false` without `expose: true` next to it;
  and `expose: true` is the declared form of the `include` that
  `res.resource()` takes. **What is not declared does not leave** --
  `req.permit()`'s rule in the other direction, and the safe half -- while a
  declared field that is missing or of another type is a mistake in the
  declaration rather than a leak, so it is reported once per route and only
  refused (500, `HENRI_ANSWERS_MISMATCH`) with `config.api.strict`, the knob
  that already means that for the HAL links. `2.controllers.js` compiles the
  block (`HENRI_ANSWERS_DECLARATION_INVALID`) and `5.router.js` checks it
  against the models at registration, because a controller loads at runlevel
  2 and the models at 3. The gate wraps `res.json()` per route, so henri's
  own endpoints never see it, and it stays **synchronous** unless a foreign
  key nobody eager loaded needs a lookup (`references.prepare()`/`settle()`
  is that split); what henri built itself -- `res.resource`, `res.render`'s
  JSON, `res.boom`, the 404 and 500 pages, an Inertia page object -- is
  marked with `headers.seal()` and passes through untouched. `henri openapi`
  reads it: an operation whose body a controller writes carried
  `x-henri.known: false` and no success status, and one that declares its
  answer now carries the schema. The guide is
  `guides/controllers.md` (`#answers-what-an-action-answers`).
- **Real time is server-sent events** (`base/stream.js`, `4.streams.js`,
  `henri.streams`), and `packages/websocket` -- an unwired socket.io loader,
  private and untouched since 2020 -- was deleted for it. A stream is a
  **route**: `res.stream(topic, { subject })` is a `GET` that does not end on
  the http server henri already runs, through the same router, session, role
  guard and `app/policies` as everything else, and
  `henri.streams.publish(topic, event, data)` is the other half. No second
  protocol, no sticky sessions, no dependency; what a WebSocket buys over it
  is a channel the client writes back on, and a client that wants to write
  back has `POST`, which is authenticated, rate limited, CSRF-checked,
  idempotent and logged. **The topic is the controller's and never the
  client's** -- no endpoint anywhere takes one from a query string. **The
  policy is asked twice**: at subscribe time through `req.authorize()`, where
  a refusal is the ordinary negotiated refusal and _not_ a stream carrying an
  error event (an `EventSource` given a non-2xx stops rather than retrying),
  and **again before every event** -- the subscription's own question plus
  the one about the record the event carries -- because a stream is a
  decision made once and answered from for hours, and asking once would make
  an eight hour subscription as safe as the state of the world when it
  opened. A per-event refusal is **silent** and counted (`dropped`), since
  `event: denied` is the #418 oracle with a politer name, and a stream
  nothing can authorize is refused outright
  (`HENRI_STREAM_POLICY_REQUIRED`) with no setting that lifts it. The data
  goes through the same `toPublic()` gate as `res.resource()` and
  `res.csv()`, and is **always JSON** -- there is no byte escape hatch,
  because bytes are where the gate stops seeing. `streams.maxAge` (15
  minutes) is what bounds how stale the record, the session and the policy
  answer a stream holds may get: henri ends it, the browser reconnects, all
  three are decided again for free. The drain closes every stream
  (`beforeClose` in `base/shutdown.js`, called from `Server#drain()`)
  **before** the listener closes, each with a jittered `retry:`, or a
  response with no last byte would sit through `shutdown.drain` and be
  destroyed on every deploy; `base/timeout.js` takes its timer off on
  `res.emit('henri:stream')`. **Reconnection promises nothing**: the retry
  hint and `req.lastEventId`, no buffer, no replay, and henri never invents
  an `id:` because an id is a promise it cannot keep. The framing walks the
  code points with no regular expression anywhere, and an `event` or `id`
  holding a newline is refused rather than escaped
  (`HENRI_STREAM_EVENT_INVALID`) because it would write raw fields into the
  frame. **A broadcast reaches one process** -- there is no cross-process
  fan-out yet -- which the guide says in a box at the top and which
  `warnSingleProcess()` says on the first stream a process opens whenever
  `manyProcesses()` has evidence. The guide is `guides/streams.md`.
- The fourth boundary is every entry point an application calls
  (`base/arguments.js`), after the configuration, the request and the
  answer: the
- The fourth is `filters` (`base/filters.js`): what a client may narrow and
  order an index by, declared per action in the same shape, and **nothing
  undeclared is filterable or sortable** -- the position `ransack` is famous
  for not taking. A `where` entry is a parameter rule plus `operators` and
  `column`; `sort` is the columns a client may name and `default` the order
  when it names none. The vocabulary is henri's and closed (`eq`, `ne`, `in`,
  `nin`, `lt`, `lte`, `gt`, `gte`, `between`, `null`, `starts`, `ends`,
  `contains`), turned into **the adapter's own condition** the way
  `base/retention.js` spells its cutoff -- `Op` symbols on Sequelize, the `$`
  spellings Mongoose and Drizzle share -- and never into SQL. Every type gets
  the equalities, an ordered one gets the ranges, and **the three text
  operators are opt-in per field** because `contains` on an unindexed column
  is a scan a client can ask for repeatedly; a text value carrying `%` or `_`
  is refused rather than escaped (no dialect agrees on an escape character
  and sqlite has none), and on MongoDB it becomes a fully escaped literal
  `$regex`. What can never be declared fails the **boot**
  (`HENRI_FILTER_DECLARATION_INVALID`): an unknown column, a randomised
  `encrypted` one, anything but an equality on a deterministic one, an order
  over a `text`, `json` or `encrypted` column, a declared foreign key (a
  lookup per term, the refusal `base/graphql-schema.js` makes) and a field
  marked `personal: { expose: false }` (a filter over it is the value one bit
  at a time). `2.controllers.js` compiles the block, `5.router.js` binds it to
  the model and mounts the guard next to the parameter check, and
  `req.filters([{ policy, scope }])` answers `{ where, order, sort, terms }`:
  **the client's condition is intersected with `policy.scope(user)` with an
  `and`**, so a filter narrows a list and can never widen it, and the order
  ends with `externalId` so a page is stable. A request asking for anything
  else is a 422 with `HENRI_FILTER_INVALID` before the action runs.
  `base/pagination.js` already carries the query string into `next`/`prev`,
  so the links carry the filter, and `henri openapi` writes one parameter per
  comparison plus `x-henri.filters`. The guide is `guides/filtering.md`.
- The fifth is `embeds` (`base/embeds.js`): what may travel **next to** a
  record, under `_embedded`. henri answered half of HAL -- `_links` said
  where to go next, and a client that wanted an invoice and its lines made
  two requests, a page of twenty invoices twenty one. A relation is written
  as the **declared foreign key** it goes through, because that is the only
  thing henri can check: `customer: 'customerId'` is a key this model
  declared and the record it names is embedded, `lines: { through:
'Line.invoiceId' }` is a key another model declared at this one and the
  records naming it are; `limit` caps a list and `one: true` says the other
  side holds a single record. A key no model declared as a reference fails
  the boot (`HENRI_EMBED_DECLARATION_INVALID`), for the reason
  `base/references.js` gives: henri reads no field name to decide what
  points where. A client asks with `?embed=lines`, only for what the action
  declared, and anything else is a 422 before the action runs
  (`HENRI_EMBED_INVALID`, at most `config.api.maxEmbeds`); an action with no
  block has no such surface, like an action with no `filters`. **The exit
  gate is the same gate**: the children are handed to the same `toPublic()`
  call as the records they hang off, in one list, so `publish()` and
  `strip()` run over them exactly as over everything else, and there is
  nowhere for an `embed` that skips either pass to be written. An embedded
  record answers what `res.resource()` of it would answer -- the user model
  included, rather than `publicUser()`, because a second rule for one model
  would be a _different_ gate. **The policy is asked per record** (`show`,
  against the child's own policy, the rule `links()` follows), and a record
  it refuses is **absent**: a stub would say "there is a record here you may
  not read", which is the oracle `findById()` was made strict to close. The
  cost is **one statement per relation per answer** whatever the page size
  -- `conditionFor()` and `orderFor()` of `base/filters.js` spell it for the
  three adapters -- and an eager loaded association is deliberately not
  reused, because it honours neither the `limit` nor the order. A record
  with more rows than the declaration promised is reported once per route
  and served its prefix, never refused: the answer is already built by then.
  `henri openapi` writes one `embed` parameter plus `x-henri.embeds`. The
  guide is `guides/api.md` (`#embedding-relations`).
- `res.csv(Model, options)` (`base/csv.js`) is the other half of the same
  tranche: an export that **streams**. No `Content-Length` (there is no
  number without building the file first), a chunked answer, pages of
  `config.api.csv.batch` (500) and `res.write()` returning false awaited
  rather than ignored. The pages are a **cursor** on `externalId` (the
  primary key on a model that opted out), never an `OFFSET`, because an
  offset over a table being written to skips rows and repeats rows -- and a
  uuid v7 is creation order, so a client's `sort` has no say. Every page
  goes through the same `toPublic()` call `res.resource()` uses, so the
  file carries no primary key, publishes its foreign keys and holds no
  column marked `personal: { expose: false }`; the **columns are the
  model's** (the schema plus what the adapter adds, minus what is hidden),
  so a file with no rows still has a header. It is **not** a per-record
  authorization surface -- a hundred thousand rows are not a hundred
  thousand policy questions -- so it takes `req.filters()`'s position: the
  list is what `policy.scope(user)` says it is, `scope: false` is the
  explicit opt-out. Escaping is RFC 4180 **walked, never matched**, plus
  the fifth character RFC 4180 does not mention: a cell starting with `=`,
  `+`, `-`, `@`, a tab or a CR is a formula in every spreadsheet, so a
  **string** that is not a plain number is written quoted with a leading
  apostrophe (`-1.5` is left alone, which is the whole of the false
  positive) and `config.api.csv.formulas: false` turns it off. The bound is
  `config.api.csv.maxRows` (100000), counted **before the headers go out**
  so it is a 413 rather than a short file; and once bytes are on the wire
  henri **destroys the connection** instead of ending the response, because
  a truncated CSV is a valid CSV -- `base/timeout.js`'s wall, one step
  louder. The headers go out with the first 64kb chunk rather than the
  first row, so a small export that fails still gets an ordinary 500. The
  guide is `guides/api.md` (`#exporting-a-csv`).
- The fourth boundary is every entry point an application calls
  (`base/arguments.js`), after the configuration and the request: the
  signature of roughly fifty of them, as data, in the same node vocabulary
  `config-schema.js` uses -- `config-validate.js` exports `problems()` so
  there is one walker and no second schema language, and it
  learned `function` and `date`, the two kinds a call can pass and a JSON
  file cannot. `check(where, args)` raises `HENRI_ARGUMENT_INVALID` naming
  the method, the argument, what was expected and what arrived, and reports
  every problem rather than the first. Three rules: an argument is checked
  once, at the method an application names (`henri.can` and `req.can` both
  funnel into `policies.can`, which is where the check is, and `links`/
  `paths` ask the unchecked `policies.answer` because they loop); `null` is
  not the same as absent for an argument, and _is_ the same for a selector
  inside an options bag but not for a key whose absence has a default; and a
  check never goes inside a loop of henri's own -- `res.collection` checks
  the list and not the rows, and `encryption.encrypt`/`decrypt` guard by
  hand with three `typeof`s because the adapters call them per row. The
  checks always run: there is no build step to compile them out and no
  reason to want one. `HENRI_ARGUMENT_UNKNOWN_TARGET` is the second code, for
  a selector that names nothing (`retention.sweep({ only })`,
  `encryption.rotate({ model })`) rather than a clean, empty, successful run.
  What already refuses well is listed in `UNCHECKED` with the reason, and
  `src/__tests__/arguments.spec.js` is what keeps both true: every method
  `index.d.ts` declares is in one table or the other, every declared
  signature is checked somewhere in the source, and every entry point is
  called with garbage derived from its own nodes. The page is
  `website/src/content/docs/reference/api.md` (`#wrong-calls`).
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
  **henri inlines no CSS and is not going to**: the honest version of
  "apply that `<style>` block to the elements it matches" is a CSS parser,
  a selector engine with specificity, an html parser and an html
  serializer, anything smaller is a regular expression over rendered html,
  and a mangled mail cannot be fixed after it is sent -- so what henri owns
  is the seam. `henri.mailers.onRender(fn)` (`onDeliverLater`'s shape, one
  handler, `null` removes it) is called from `Message#finish()` on every
  message henri renders, a delivery, a `deliverLater()` and a `/_mailers`
  preview alike, with the nodemailer payload and
  `{ mailer, action, view, layout }`. It runs **last, and that is the
  point**: both parts already exist, so an inliner rewriting `html` cannot
  leak a `style=""` attribute into the derived `text/plain`. Throwing fails
  the render rather than sending. `juice` is the three line answer and the
  guide (`guides/mail.md`) says so in those words.
- View engines implement `init()`, `prepare()`, `fallback(router)`,
  `render(req, res, route, opts)` and optionally `reload()` and `close()`. The
  Handlebars engine lives in `core/src/engines/template.js`; `react` resolves
  `@usehenri/react/engine` and `inertia` `@usehenri/inertia/engine` from the app
  (`core/src/engines/*.js` are the loaders). The React engine passes `opts` to
  pages through `req._henri`; `withHenri` reads only that on the server.
  `build({ cwd, config })` on both engines builds without booting henri, which
  is what `henri build` calls.
- `config.assets.prefix` (`base/assets.js`) is where the files the
  production build wrote are loaded from: Vite's `base`, Next's
  `assetPrefix`, said once. **The Content Security Policy is the whole
  trap** -- `script-src 'self'` refuses a script from another origin, so a
  prefix that did not reach the policy is an application that boots,
  answers 200 and paints nothing -- so it is read in one place and used in
  two: the engine writes the urls and `base/headers.js` adds the origin to
  `ASSET_DIRECTIVES` (`script-src`, `style-src`, `font-src`, `img-src`,
  `connect-src`, `worker-src`, `media-src`). `default-src` is deliberately
  untouched: widening it would let the asset host be framed as well, and
  the one thing that falls back to it is a `<link rel="prefetch">`, where a
  refusal costs a warm cache and never a page. The policy names the origin
  in **every environment** while the prefix itself is **production only**
  (in development the dev servers serve from this origin), and it is
  compiled into the bundle rather than only stamped on the document's tags
  -- Vite's `base` for the client and ssr builds, `assetPrefix` in the next
  config. On the react side the channel is **`HENRI_ASSET_PREFIX` and not
  the `conf` object**, measured rather than assumed: next.js 16 answers a
  request through the configuration it loaded off `app/views/next.config.js`
  (which requires `@usehenri/react/engine/conf`, which reads the variable),
  so a prefix handed only to `next({ conf })` reaches the build manifest and
  never a tag -- `build()` sets it on the child's environment and the engine
  sets it on its own. The
  application still serves the files at the same paths, which is what an
  origin-pull CDN pulls from. A path prefix (`/assets`) needs no policy
  change, a renderer with no build is warned that the key does nothing, and
  `henri audit` reports an `http://` prefix in a production configuration
  (`assets.plaintext-prefix`). It is **not** `uploads.urls.cdn`, a cache in
  front of henri's own route that forwards to this application, and the two
  guides say which is which.

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
(`packages/henri` gets the root README), and copies
`website/src/content/docs` into `@usehenri/core/docs`, which is what makes
`henri docs` and the `guide` tool of `henri mcp` answer for the henri an
application runs rather than for whatever the website says today. That
directory is gitignored and does not exist in a checkout, so
`packages/cli/scripts/docs.js` falls through -- the application's core, then
the core next to the command line, then `@usehenri/mcp`, then
`website/src/content/docs` of the monorepo. Falling through is quiet on
purpose (a page beats no page), so `henri doctor` is what says it happened:
`docs.missing` when nothing anywhere ships the pages
(`HENRI_AGENT_NO_DOCS`), `docs.version` when the pages that would be printed
come from another package than the `@usehenri/core` the application runs.
`scripts/smoke.sh` runs `prepublish.js` before it packs, so the whole chain
-- copied, packed, installed, read back -- is exercised there and a `files`
array that forgot them fails.

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
  live PostgreSQL, MySQL, MariaDB or SQL Server with
  `HENRI_TEST_POSTGRES_URL` / `HENRI_TEST_MYSQL_URL` /
  `HENRI_TEST_MARIADB_URL` / `HENRI_TEST_MSSQL_URL` (see above). **SQL
  Server and MariaDB are both exercised now** (`pnpm db:up` brings both,
  `pnpm test:sql:mssql` points the `sequelize`, `mssql` and `jobs` suites at
  the first and `pnpm test:sql:mariadb` points the SQL suites at the second)
  and **neither is in the CI**, which is a cost decision rather than an
  oversight. What is _still_ only offline on SQL Server is what has no
  Sequelize suite at all -- multi-tenancy, the call log. The
  `postgresql` and `mysql` suites are thin now that those packages are
  `@usehenri/drizzle` with a dialect chosen -- they check the choosing and
  reach the server; the model API, the schema format and the migrations are
  `packages/drizzle/__tests__`, which run on the same servers.
  `@usehenri/sequelize`'s own suites still run on sqlite and, when a server
  is there, on PostgreSQL and MySQL: not because an application reaches
  those through Sequelize any more, but because they are the servers
  available to exercise the base class MSSQL rides on, and because the CI
  runs them. The mssql
  adapter has no migrations and is not getting any: `sequelize.sync()`
  creates the tables that are missing in development, a production boot
  changes nothing unless the store sets `sync: true`, and `henri db:status`
  (`packages/sequelize/drift.js`) reads the database back and reports what
  it and the models disagree about, with `--sql` writing the DDL for a
  person to review. Generated, versioned migrations are Drizzle's, and
  `website/src/content/docs/upgrading.md` has the path from one to the
  other. The drift comparison is exercised on sqlite, PostgreSQL, MySQL and
  SQL Server -- including the `ALTER` it writes, run against the server that
  has to accept it -- and sqlite reports a column change without a statement
  because it has no `ALTER COLUMN`.
- `adapter.describe()` is new. It is covered on sqlite offline and on the
  live PostgreSQL and MySQL of `pnpm test:sql:live` for both SQL adapters
  (`packages/{drizzle,sequelize}/__tests__/describe.spec.js`), and on
  MongoDB by `packages/mongoose/__tests__/describe.spec.js` and through the
  demo application core's suite boots. It runs on SQL Server too
  (`pnpm test:sql:mssql`), where `values` is null on an `enum` column and
  that is the right answer: there is no `ENUM` in that catalogue because
  there is none in that dialect. On MariaDB it runs and answers that
  server's own spelling -- `int(11)` where MySQL 8 says `int`, `longtext`
  where it says `json`, and `HENRI_MIGRATION_PUSH_FAILED` for the one case
  that needs a push. Deliberately left: **no row counts**
  (`SELECT count(*)` is a scan per table, and the `query` tool already
  answers it), **no columns for a table no model claims** -- they are named
  and nothing else, because `DESCRIBE <table>` through the query endpoint
  already opens one -- **no classification of what an unclaimed table is**
  (drizzle has `reservedTables()` and Sequelize has no equivalent, and a
  second list in core is the "two ways, one is wrong" problem), and no
  foreign key constraints, check constraints, triggers, views, sequences or
  collations. On a drizzle store the answer carries `migrations` rather
  than `drift`, which is what `henri db:status` answers there.
- The tables henri owns in a drizzle store (`henri_jobs`,
  `henri_jobs_schedules`, `henri_jobs_limits`, `henri_jobs_batches`,
  `henri_trail`, `henri_calls`, `henri_versions`)
  are created through
  raw SQL, so drizzle-kit sees them as tables the schema no longer wants.
  `Drizzle#reservedTables()` is what keeps a push from dropping them, and
  `reservedPrefixes()` covers the one set of names henri cannot write down
  in advance (the partitions of a partitioned call log, one PostgreSQL
  table per period); a table an application renames through `jobs.table`,
  `trail.table`, `calls.table` or `versions.table` is read from the
  configuration, and anything else henri comes to own has to be added
  there.
- drizzle-kit does not alter a mysql table on a push: `henri db:push` and the
  development boot create the tables that are missing and report the ones
  whose columns drifted (`Migrations#completeMySQLPlan`); a mysql schema
  change needs `henri db:generate` then `henri db:migrate`.
- **MariaDB is served by `@usehenri/mysql` and two things do not work
  there**, neither of them henri's, both measured against 10.11.19 and
  11.8.9 by `packages/drizzle/__tests__/mariadb.spec.js` (`pnpm
test:sql:mariadb`, the compose service, `HENRI_TEST_MARIADB_URL`).
  **`include()` is a syntax error**: drizzle-orm 0.45's MySQL dialect eager
  loads with `LEFT JOIN LATERAL (...) ON TRUE` and MariaDB has no `LATERAL`
  derived tables in any version, so `include` and the `embeds` that read
  through it raise 1064; henri writes none of that SQL and has no seam to
  write it differently (`Relation#toArray` hands the `with` tree to
  `db.query.<table>.findMany`). **A push cannot read the schema back**:
  drizzle-kit 0.31 introspects first, and its check-constraint pass reads
  `row["TABLE_NAME"]` out of rows its own query labelled `table_name` --
  dead code on MySQL 8, which has no check constraints there, and live on
  MariaDB, where `JSON` is `LONGTEXT` plus a `CHECK (json_valid(...))` and
  the user model's `roles` is a `json` column. The first push of an empty
  database works and every one after it fails, so `henri db:push` and a
  development boot with the default `"sync"` are out; `"sync": false` plus
  `henri db:generate` and `henri db:migrate` are the way, and
  `db:schema:dump`/`load`, `db:status` and `describe()` all work. What
  henri did fix around it: `Migrations#plan()` runs drizzle-kit through
  `guarded()` (`utils.js`), so a library ending the process with
  `process.exit(1)` and no message becomes `HENRI_MIGRATION_PUSH_FAILED` on
  every dialect; `generate()` writes the migration and warns rather than
  failing when it cannot read the database back afterwards; `dump.js` reads
  MariaDB's `COLUMN_DEFAULT`, which is an SQL **expression** (`NULL` for
  none, `'hi'` already quoted, `current_timestamp(3)` with no
  `DEFAULT_GENERATED`) and used to put `DEFAULT 'NULL'` on every nullable
  column of a dump; and `packages/sequelize/drift.js` asks the server what
  it is (`serverDialect()`) so a `json` column is not reported as
  permanently drifted (`LONGTEXT instead of JSON`, with an `ALTER` that
  changes nothing). Everything else runs: the model API, the exact types,
  time zones, validations, enums, slugs, filters, csv, encryption,
  multi-tenancy, retention, the trail, versions, the call log with its
  `RANGE` partitions, and the job queue's claim, slots and batches --
  through the sequelize target, which is how `@usehenri/jobs` reaches a
  server. `henri new --adapter` does not offer `mariadb`, and **no CI job
  runs any of this**.
- `henri generate scaffold|crud` write the pages of the application's renderer
  (`.jsx` for inertia, `.js` for react) and controllers that follow the adapter
  of the default store (`scripts/adapters.js` maps it to the mongoose,
  sequelize or drizzle flavour), which `henri new --adapter <name>` configures.
  The `template` and `vue` renderers get no generated pages.
  **The pages follow the model file, not only the command line**
  (`fieldsOf()` in `scripts/generate.js`, which reads it off the disk the
  way `hasSlug()` does): the fields are the `name:type` arguments and what
  each of them _is_ comes from `app/models/<Name>.js`. An `enum` column is
  a `<select>` of `Model.enums.<field>` -- **sent by the controller, never
  copied into the page**, which is what the models guide already told
  applications to do -- a `required` column gets a `required` input, and a
  column marked `personal: { expose: false }` is written into no page at
  all, because henri strips it from every answer it builds: the table
  column would be empty forever and the form would post the empty string
  it had to show over the stored value. `FIELDS` in the controller keeps
  it with a comment, since the mark governs answers and a write is not
  one. A `personal` field without `expose: false` is left alone -- whether
  it is stripped is `config.privacy.expose`, which is per environment, and
  a page is one file for all of them. `:enum=draft,live` is the one
  setting a `name:type` pair takes after its type (`parseSetting()`), and
  the grammar is closed there on purpose: it is the mark the pages read
  back, and everything else a column can say belongs in the model file.
  `henri new` writes the sample `Task` model by hand for its `default` and
  the generator reads the `enum` next to it back, which is the worked
  example. Regenerating with `--force` is how pages catch up with a mark
  that changed. **The same read writes the controller's `params` block**
  (`accepted` next to `fields` in `fieldsOf()`): `create` and `update`
  declare the fields `FIELDS` permits, typed, with the `enum` of a column
  that has one -- so a 422 arrives at the boundary, the action is handed
  `false` rather than the truthy string `"false"`, and `henri openapi`
  describes the request from the declaration instead of the model's
  writable columns.
  Three things are left out on purpose and the generated file argues each:
  `required` (this vocabulary means "the key was absent" by it and the
  model means Rails' presence, so the empty string a form posts passes here
  and is refused there -- the same word would be two rules), everything
  else about what makes a record valid (the model's, said once for a job, a
  seed and a console too), and a column that names another model, which the
  comment names rather than dropping in silence -- `base/openapi.js` leaves
  a foreign key untyped in a request body for the same reason. The `enum`
  _is_ copied, unlike a page's, because a controller is compiled at
  runlevel 2 and there is no model to ask until 3. A resource with nothing
  to type gets no block.
- `@usehenri/uploads` is new in 1.2. It recognizes a file rather than
  validating it: a signature table plus a text inference over the first 4kb,
  so a valid header followed by anything is that type, a `.docx` is
  `application/zip` (archives are never opened), and a format with no
  signature is `application/octet-stream`. Direct-to-storage uploads (a
  presigned `PUT` the browser writes to), virus scanning, transcoding and a
  media library are out of scope on purpose and the guide says why.
- `@usehenri/s3` is new in 1.2. Its signing is checked against the vectors
  AWS publishes and its wire against a fake that verifies every signature it
  is sent by recomputing it from the headers that arrived -- which proves
  the wire matches what was signed and nothing about whether AWS would
  accept it. The third leg is `__tests__/live.spec.js` against a real
  server, skipped without `HENRI_TEST_S3_URL` (`pnpm test:s3`, the `Live S3`
  job of the CI, MinIO in Docker:
  `docker run -d -p 9000:9000 -e MINIO_ROOT_USER=henri
-e MINIO_ROOT_PASSWORD=henri-secret quay.io/minio/minio:latest server
/data`). **Nothing is exercised against AWS, R2, Spaces or GCS**: the
  differences those have from MinIO -- IAM, virtual-host style on a real
  domain, an eventual-consistency window, a region redirect -- are covered
  only by the code that handles them. It is not on npm yet: a new package is
  bootstrapped once by a maintainer (see Releasing) before the release
  workflow can publish it.
- Variants are exercised against sharp on the platform the suite runs on,
  which is the only one it can be. The formats a build of libvips was
  compiled with are not henri's to promise: `avif` in particular is present
  in the prebuilt binaries and absent from some distribution packages, and
  `HENRI_UPLOAD_VARIANT_FAILED` is what an application sees when it is.
- `@usehenri/webhooks` is new in 1.2. The endpoints are covered on sqlite
  (and on a live PostgreSQL or MySQL with `pnpm test:sql:live`), on SQL
  Server (`pnpm test:sql:mssql`, which is the one of the three that runs
  this project) and on MongoDB. The address rules are exercised with a resolver of the
  suite's own rather than against the network, and the deliveries against a
  loopback server, which is exactly what the rules refuse -- so the tests
  that prove a refusal and the tests that prove a delivery are different
  suites on purpose. Receiving webhooks, a UI, a subscription policy richer
  than `invoice.*`, `Retry-After` and ordering guarantees are out of scope
  and the guide says why.
- Identity providers are new. The suite runs against a fake provider that is
  strict about henri's half -- it refuses a token request whose
  `redirect_uri`, client credentials or PKCE verifier are wrong, a code is
  single use, and a token opens one profile -- so what it asserts about the
  state, the merge rule, the lockout, the session and the table is real. It
  proves **nothing about a real provider**: which client authentication
  Google, GitHub, Okta or Entra accept, whether they refuse parameters they
  do not know, what their userinfo answers and how (or whether) they spell
  `email_verified` are covered by the configuration and by nothing in the
  suite. The fake is plain http on the loopback, which is what
  `identities.allowHttp` exists for and what a production configuration
  refuses, so nothing exercises TLS, a redirect or a rate limit of a
  provider's. There is no OIDC discovery (the three endpoints are written
  down), no `id_token` parsing on purpose, no refresh token stored, and a
  provider that reuses a subject for a second person would hand that person
  the first one's account -- a stable, never-reused subject is a promise of
  the provider's that the table takes on trust.
- The idempotency and rate-limit stores are in memory unless the app plugs a
  shared store (`config.api.idempotency.store`, `config.rateLimit.store`).
- The rate limit, lockout and idempotency counters are in the process memory
  unless the application names a backend: `config.shared` names one for all
  three (`@usehenri/redis`), and `config.rateLimit.store`,
  `config.user.lockout.store` and `config.api.idempotency.store` still name
  one each. henri cannot tell how many processes run, so the boot says which
  it is and only warns when the environment says there is more than one.
  `@usehenri/redis` is exercised offline (the wiring, the option split, the
  fail-fast) and against a live server with `HENRI_TEST_REDIS_URL`
  (`pnpm test:redis`, the `Live Redis` job of the CI).
- Retention and the access trail are covered on all three adapters:
  mongoose through the demo application core's suite boots (the sweep, the
  receipt, the MongoDB trail and its prune), and Sequelize and Drizzle by
  `packages/{sequelize,drizzle}/__tests__/retention.spec.js`, which run on
  sqlite offline and on the live PostgreSQL and MySQL of
  `pnpm test:sql:live`. The showcase proves both on a real application
  (`showcase/test/retention.test.js`), and the Sequelize file also runs on
  the SQL Server of `pnpm test:sql:mssql`.
- `@usehenri/jobs` is new in 1.1. Its claim is covered against sqlite,
  PostgreSQL, MySQL and MongoDB (`packages/jobs/__tests__/claim.spec.js`,
  `mongo.spec.js`; `pnpm test:sql:live` runs the SQL ones on real servers with
  concurrent connection pools). **SQL Server too**: `pnpm test:sql:mssql`
  runs the same file with four runners and their own pools, so
  `UPDATE ... WHERE id IN (SELECT TOP (n) ... WITH (UPDLOCK, READPAST))` --
  the SKIP LOCKED of that dialect -- is a measured claim rather than a
  snapshotted string.
- The **concurrency limits** are new. `packages/jobs/__tests__/
concurrency.spec.js` proves the negative property the way `claim.spec.js`
  proves the claim -- a queue and a connection pool per runner, and the jobs
  themselves recording their overlap (`__tests__/live.js`), because a count
  taken afterwards cannot tell two jobs that overlapped from two that did
  not. It runs on sqlite offline and on the live PostgreSQL, MySQL and SQL
  Server, and the same file also downgrades a table
  (`ALTER TABLE ... DROP COLUMN`) to prove the upgrade path on a real
  server -- on SQL Server the index has to come off the column first, which
  is what `dropIndex()` in the jobs helpers is for; MongoDB has its own in
  `mongo.spec.js`. **Batches** are proved the same way
  (`packages/jobs/__tests__/batch.spec.js`, and a `batches` block in
  `mongo.spec.js`): a queue and a pool per runner, and the callback itself
  recording what it saw -- one entry per run, plus how many jobs of its
  batch were still waiting or running at that moment, read from the
  database, because neither "exactly once" nor "never early" can be seen by
  counting rows afterwards. The suite covers a half-failed batch, a job
  buried by the recovery, a zombie runner writing its outcome after the job
  was performed again, and the crash between an outcome and its count. What
  is **left** of a batch: no order between its jobs, no batch inside one, no
  cancelling, and no adding to a batch from another process (which is the
  race the seal exists to close). There is **no dashboard and there will not be one**;
  the argument is in the same guide (`#no-dashboard-and-what-to-build-one-from`)
  and it is that `/_routes`, `/_openapi.json` and `/_mailers` describe the
  _application_ while a queue page would display its _data_ -- job arguments,
  which the privacy tranche marks personal -- and that the place a dashboard
  is wanted is production, where henri must mount none. `henri.jobs.limits()`
  and `henri.jobs.batches.*` next to `stats()`, `list()` and `dead.*`, plus
  `--json` on every command, is what an application builds its own read-only
  page from, behind its own policy.
- The call log (`config.calls`) is new. Its table, its join, its bodies and
  its bounded delete are covered on sqlite offline and on the live
  PostgreSQL and MySQL of `pnpm test:sql:live`
  (`packages/drizzle/__tests__/calls.spec.js`), and on MongoDB through the
  demo application core's suite boots. The **partitions only exist on
  PostgreSQL and MySQL**, so that half of the suite is skipped offline;
  the call log has no Sequelize suite at all, so SQL Server is covered
  there only by its generated DDL (and has no partitions either). There is
  no tracing (no span, no propagation
  header: the join is the request id and nothing more), no capture of a
  streamed or non-JSON body, and no cross-process ceiling.
- Model versioning (`options: { versioned: true }`) is new. It is covered
  on sqlite offline and on the live PostgreSQL and MySQL of
  `pnpm test:sql:live` (`packages/{drizzle,sequelize}/__tests__/
versions.spec.js`), and on MongoDB through the demo application core's
  suite boots (`Memo` and `User` are versioned there, which is what
  exercises the password rule and the envelopes), and on SQL Server through
  `pnpm test:sql:mssql`. A **mass write is
  refused rather than recorded row by row**, and that is the tranche's one
  real trade: an application that wants a version per row loops over the
  records (or passes `{ individualHooks: true }` on Sequelize). There is
  no diff of an association, no branch or merge, no restore across a
  schema change that dropped a column, and no route: henri serves no
  version over HTTP, so an application that wants to show a history writes
  the controller and the policy itself.
- The exact types (`decimal`, `bigint`) are new. **On sqlite a comparison
  and an order of a `decimal` go through `CAST(... AS REAL)`**, a double,
  and that is the one approximation henri ships for them: exact to about
  sixteen significant digits, which is the answer PostgreSQL gives for
  every value a person writes down, and the nearest double past that. The
  stored value never goes through it and an equality does not either (the
  text is canonical), and a `bigint` casts to `INTEGER`, which sqlite
  carries on 64 bits. `@usehenri/sequelize` **refuses both types on
  sqlite** at boot (`HENRI_MODEL_TYPE_UNSUPPORTED`, naming the model and
  the field) rather than reading a value back changed: it has no seam to
  keep the digits as text and cast for a comparison. That is unreachable
  through `henri new` -- sqlite goes to Drizzle and Sequelize is only
  under `@usehenri/mssql`. **`@usehenri/mssql` refuses `decimal` for the
  same reason**, found by running these suites against a real SQL Server:
  tedious reads every DECIMAL as `value / Math.pow(10, scale)`
  (`lib/value-parser.js`, `readNumeric`), so `DECIMAL(12, 2)` -2.50 comes
  back -2.5 and `DECIMAL(38, 10)` 12345678901234567890.1234567891 comes
  back 12345678901234567000 -- silently, which is the whole thing
  `base/exact.js` exists to stop. There is no driver option and no parser
  above it (Sequelize's mssql `parserStore` is handed the number tedious
  already made), so refusing is the only answer that is not a lie; an
  amount there goes in a `bigint` of cents. A `bigint` **is** exact on SQL
  Server -- tedious hands that one back as a string -- and the suite writes
  and reads both ends of the signed 64-bit range. henri ships no arithmetic
  and rounds nothing: a value that does not fit the scale is a validation
  failure, and what to do about it is the application's.
- The query seam and the N+1 detector (`config.queries`) are new. They are
  covered on sqlite offline and on the live PostgreSQL and MySQL of
  `pnpm test:sql:live` (`packages/{drizzle,sequelize}/__tests__/
queries.spec.js`), on MongoDB by `packages/mongoose/__tests__/
queries.spec.js`, and on a real application by the showcase's cost test.
  and on SQL Server through `pnpm test:sql:mssql`. Three limits are
  deliberate and in the guide: the
  detector counts **model calls**, so a statement count is a different
  number and the showcase keeps one counter of each, labelled; a Mongoose
  `populate` reports one event per operation rather than one per model call,
  because `pre` and `post` are two callbacks with no scope between them; and
  repetition is only ever counted **within one request**, so nothing is
  detected in a job, in the console or across requests. There is no history
  of findings, no span (the join is the request id and nothing more) and no
  fix applied on anyone's behalf.
- The declared filters (`filters` in a controller) are new. Two limits are
  deliberate and in the guide. A **text value carrying `%` or `_` is
  refused** rather than escaped: the wildcards are what the surface exists
  to keep out, no dialect agrees on an escape character and sqlite has none
  without an `ESCAPE` clause core would have to write as SQL -- so an
  application that wants wildcard search writes that query itself. And the
  three text operators are **case-insensitive on the collations the
  adapters open by default** (`ILIKE` on postgres, `$options: 'i'` on
  MongoDB, `LIKE` elsewhere); a binary collation matches exactly, which is
  the database's decision. The condition and the order are covered on
  sqlite offline and on the live PostgreSQL and MySQL of
  `pnpm test:sql:live` (`packages/{drizzle,sequelize}/__tests__/
filters.spec.js`), on MongoDB through the demo application core's suite
  boots (`get /memos/search`), and on a real index page by the showcase.
  and on SQL Server through `pnpm test:sql:mssql`. There is no `or` between
  filters, no free-text
  search across columns, no cursor paging, no filtering across an
  association and no operator an application can add.
- `res.csv()` is new. What was **deliberately left**: no other delimiter
  (a `.csv` is comma separated), no `xlsx` and no other format, no
  background export mailed as a link (that is a job and a storage
  decision), no client-chosen columns or order (`columns` is the caller's
  word, and the file is always in creation order), and **no per-record
  policy question** -- argued above and in the guide. The formula guard
  **changes the bytes** of a cell it neutralizes, which is said out loud
  rather than hidden. Coverage: the escaping, the filename and the settings
  offline; the whole path on MongoDB through the demo application core's
  suite boots (`get /memos/report` for the scope and the escaping,
  `get /admin/people.csv` for the exit gate, which is where every
  `expose: false` column of that application lives); and the cursor on
  sqlite offline plus the live PostgreSQL and MySQL of `pnpm test:sql:live`
  (`packages/{drizzle,sequelize}/__tests__/csv.spec.js`). What no suite
  proves is a **real** interruption over a socket: `push`, `drained` and
  `interrupted` are exercised against a fake response, so what is checked
  is that henri destroys rather than ends -- not what a particular client
  does with that.
- The declared embeds (`embeds` in a controller, `_embedded` in the answer)
  are new. What was **deliberately left**, each with its reason in the
  header of `base/embeds.js`: no `_links` on an embedded record (nothing
  declares which controller serves a model, and a guessed href is worse than
  none), **no nesting** (`?embed=lines.product` is a query and a policy
  question per record per level), nothing from `res.render()` (`_embedded`
  is a HAL word), no filtering or ordering of an embedded relation from the
  query string, and no reuse of an association the controller eager loaded
  -- so a controller that eager loads _and_ embeds pays for both. Two
  limits are real rather than deliberate: a relation is bound to the model
  the **controller is named after** (there is no `model:` override the way
  `filters` has one), and a to-many relation is read with a global
  `limit x parents + 1` rather than a per-parent top-N, so a page whose
  rows go past that bound loses whole records at the end of the page --
  reported once per route, never refused. Coverage: MongoDB through the
  demo application core's suite boots (`get /memos?embed=owner` and
  `get /profile/memos`, including the policy refusal and the `expose:
false` columns of the user model), sqlite offline and the live PostgreSQL
  and MySQL of `pnpm test:sql:live`
  (`packages/{drizzle,sequelize}/__tests__/embeds.spec.js`, which also
  count the statements), and SQL Server through `pnpm test:sql:mssql`.
- Model validations (`validates`) are new, and this is the tranche that
  landed the declaration plus the validators that work identically on all
  three. What was **deliberately left**: no `unique` (argued above and in
  the guide), no cross-record rule, no model-level rule filed under `base`,
  no `if`/`unless` condition, no message of one's own per constraint (only
  a `validate` returning a string), no `on: 'create'` / `on: 'update'`
  selector, and no `Model.valid?`/`errors` on an unsaved instance -- a
  refused write throws, as it always did. The **schema keys the adapters
  brought and henri did not** are untouched and are still not portable:
  drizzle's `min`, `max`, `minLength`, `maxLength`, `match`, `validate`,
  `trim`, `lowercase` and `select` are drizzle's, mongoose passes its own
  through, and sequelize refuses every one of them at boot except its own
  `validate` object -- which is why a `validate` function there now fails
  the boot pointing at `validates` rather than doing nothing. Coverage:
  sqlite and MongoDB offline, PostgreSQL and MySQL through
  `pnpm test:sql:live`, and SQL Server through `pnpm test:sql:mssql`. Two known holes henri refuses
  rather than checks are in the error catalogue
  (`HENRI_MODEL_VALIDATION_UNCHECKED_WRITE`), and `Model.upsert()` on
  Sequelize is treated as a partial write, so a required column it does
  not name is left to the database's `NOT NULL`.
- Enum predicates and scopes are new. What was **deliberately left**: the
  bang (argued above), a scope that answers records, an `or` between two
  values (`{ status: { $in: [...] } }` is not portable by hand -- that is
  `filters`' `in` operator, or a condition written for the adapter), a
  scope on the **record** side of an association, and any state machine at
  all -- no transition table, no guard, no callback. **A predicate is a
  method of a record, so a page never has one**: a React or Inertia page
  receives the column and compares it, and `Model.enums.<field>` is what
  crosses over. An association that shadows a generated name is not caught,
  because `associate()` runs after the models are built. `henri generate
model` gained `status:string:enum=draft,live` in the CLI tranche below,
  and the pages a scaffold writes read the mark back -- but **a predicate
  is still never on a page**, so a generated page compares the column or
  maps over `Model.enums`. Coverage: sqlite and MongoDB offline
  (`packages/{drizzle,mongoose,sequelize}/__tests__/enums.spec.js`, plus
  the demo application in `packages/core/src/__tests__/enums.spec.js`),
  PostgreSQL and MySQL through `pnpm test:sql:live`, and the showcase's
  `Proposal` on a real application, and SQL Server through
  `pnpm test:sql:mssql` (where an `enum` is an `NVARCHAR` held by an `isIn`
  rule, since that dialect has no `ENUM` column of its own).
- Multi-tenancy (`config.tenancy`) is new, and this tranche landed the
  column, the resolution, the query default and the refusals. The negative
  property -- tenant A cannot read or write tenant B's rows -- is proved on
  sqlite offline and on the live PostgreSQL and MySQL of
  `pnpm test:sql:live` (`packages/drizzle/__tests__/tenancy.spec.js`, over
  `find`, `count`, `paginate`, an eager loaded association, a mass update, a
  mass destroy, `instance.save()`, a soft delete and a restore) and on
  MongoDB (`packages/mongoose/__tests__/tenancy.spec.js`); the wiring of a
  real request -- the middleware mounted after passport, the mismatch 404
  and the refused sign-in -- is
  `packages/core/src/__tests__/tenancy-http.spec.js`, which boots the demo
  application with `HENRI_CONFIG_JSON__tenancy`. The **model** wiring on
  MSSQL rides the Sequelize adapter and has **no coverage of its own**:
  the rest of that adapter runs against a real SQL Server now
  (`pnpm test:sql:mssql`), but there is no Sequelize tenancy suite for it
  to point at -- the queue's tenant column is covered there, and the models
  are not. The **queue and the version table were the two known gaps
  and are closed**: both carry a `tenant` column, proved by
  `packages/jobs/__tests__/tenancy.spec.js` (sqlite offline plus the live
  PostgreSQL and MySQL: the stamp, the cross-write refusal, the listing,
  `retryAll`/`discardAll`, the scope the runner enters, two tenants
  overlapping in one process, the batch callback, and a downgraded table
  for the upgrade) -- **and on SQL Server**, since that file is in the
  `jobs` project `pnpm test:sql:mssql` runs, which makes the queue the one
  tenancy surface that adapter covers -- and by a `tenants` block in
  `packages/jobs/__tests__/mongo.spec.js`, and by
  `packages/drizzle/__tests__/versions-tenancy.spec.js` (the same targets:
  the write, the scoped read, the refusal without a tenant, `get()`
  answering null, the restore refusals, the boot refusal with the probe
  forced false, and the pre-upgrade rows). What is **still deliberately
  left**: no runner per tenant (the claim is not narrowed -- one customer's
  backlog getting a runner of its own is scheduling, with a fairness
  question attached); no per-tenant retention period or prune, since
  `versions.keep`, `jobs.keepCompleted`, `calls.keep` and `trail.keep` are
  one number for the application and the sweeps run across every tenant;
  no backfill of the rows either upgrade left behind, because a job's
  tenant is not recoverable at all and a version's is an `UPDATE` from the
  records it names that only the application can write (the guide has it);
  the trail and the call log are shared **on purpose** (operator records,
  one hash chain, and an admin page built over them is the application's own
  cross-tenant view to scope); the flag store is shared and a per-tenant
  rollout is a `group` gate the application writes; the rate limit and the
  lockout stay keyed by address; and there is no `henri tenants` command,
  because henri holds no list of tenants.

- Slugs are new. There is **no history table**: `on: 'change'` retires the
  old url the moment the title is written, and henri answers no `301` --
  `friendly_id`'s answer is a table on four adapters plus a redirect, a
  retention rule and a reach for the erasure, and it is a tranche of its
  own. Also not here: a slug unique per tenant or per parent (a composite
  index henri would have to write into a migration it does not own), a
  route that resolves a name across models, and any romanization at all --
  the fold is `String#normalize` plus eleven letters, so a title with no
  Latin in it produces nothing and the discriminator is what answers.
  `privacy:erase` does **not** rewrite a slug, because rewriting an
  identifier 404s every url that pointed at the record; a `from` marked
  `personal: { expose: false }` is refused at boot, and a plain
  `personal: true` one is allowed and said out loud in the guide.
  Coverage: sqlite and MongoDB offline, PostgreSQL and MySQL through
  `pnpm test:sql:live`, the demo application's own `Article` resource for
  the router and the HAL links, and
  `packages/cli/__tests__/generate.spec.js` for the generator, and SQL
  Server through `pnpm test:sql:mssql` -- which is what found that a
  duplicate slug answered the name SQL Server gave the constraint instead
  of the field (`Sql#nameUniqueConstraints`).
- The migration safety checks are new. What they read is **one file**: a
  migration that is safe on its own and catastrophic next to the deploy it
  ships with is not something a file can show, so the deploy order is not
  checked and the guide says so. They do not count rows either -- the
  refusal is "this shape is dangerous on a table with rows", not "this
  would take 412 rows away", which is `db:rollback`'s answer and needs an
  inverse to compute. A MySQL executable comment (`/*!40101 ... */`) is
  read as a comment, so a statement hidden in one is not seen; drizzle-kit
  writes none, and treating it as code would mean refusing statements that
  will not run on the server in front of you. The checks are covered on
  sqlite offline and on the live PostgreSQL and MySQL of
  `pnpm test:sql:live` (`packages/drizzle/__tests__/{safety,engines,
review}.spec.js`, the middle one being the claims about the databases
  themselves); **MSSQL has no migrations at all**, so nothing there applies,
  and no adapter but drizzle has a migration to read.
- Streams (`res.stream()`, `henri.streams`) are new, and the one thing
  missing is the big one: **there is no cross-process fan-out**. A
  connection lives on the process that accepted it, so behind two workers a
  `publish()` reaches half the subscribers and nothing errors. The seam it
  would go through is `config.shared` (`henri.shared`), the way
  `base/maintenance.js` already reaches every process, and it is a tranche
  of its own: pub/sub is a dedicated subscriber connection rather than the
  key-value surface `@usehenri/redis` exposes today, and the policy has to
  be re-asked on the receiving process, where the subject record is not in
  hand. Until then the guide says so in a box at the top, the boot line
  says where a broadcast reaches, and `warnSingleProcess()` warns on the
  first stream when the environment has evidence of more than one process
  -- which cannot see a second machine, so its silence is not a clearance.
  Also deliberately absent, each argued in the guide: any replay, buffer or
  delivery guarantee (`Last-Event-ID` is handed over and used for nothing);
  a client library (`new EventSource(url)` is the client library);
  receiving, which is a `POST`; presence or rooms (`count(topic)` is
  this process's connections and must not be presented as presence); and a
  topic a client can name. Coverage: the framing, the walks, the registry
  and the drain hook offline, and the whole path over a **real socket**
  against the booted demo application
  (`packages/core/src/__tests__/stream.spec.js` opens `http.request`
  connections to `get /memos/:id/events` and `get /memos/live` and reads
  the frames) -- the subscribe-time refusal, the per-event refusal, the
  exit gate over a model with `expose: false` columns, and the drain. What
  no suite proves is a **proxy** in front of it: `no-transform` and
  `X-Accel-Buffering` are what henri sends, and whether a particular nginx
  or CDN honours them is not something this repository measures.
- The scaffolded app pins ESLint 9 because `eslint-plugin-react` does not
  support ESLint 10 yet.
