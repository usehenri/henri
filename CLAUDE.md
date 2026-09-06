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
plus `@usehenri/testing/setup-file` for `setupFiles`). It also owns the
factories: `test/factories/<name>.js` exports `{ attributes, traits, model,
after }`, a value is a literal or a function of the build context
(`attrs`, `build`, `create`, `sequence`, `traits`, `uid`) resolved on demand,
and `create`/`build`/`createList`/`defineFactory` are the calls
(`packages/testing/factory.js`, `guides/testing.md`). An override always wins
and is never made, which is what keeps `create('proposal', { speakerId })`
from making a second user. `packages/demo` is such an app and is what core's
tests boot; `showcase/test/factories` is the worked example.

Every project runs its test files at the same time, core included: each of
its files boots the demo application on a port the kernel assigns and a
MongoDB of its own (`packages/disk/port.js`), and `vitest.setup.js` binds
every host-less `listen()` to `127.0.0.1` so the reservation is exact. What
those files still share is `packages/demo/.tmp`, so anything written there
has to be named per record or per process. An application's own suite keeps
`fileParallelism: false` unless each file gets a database of its own.

## Layout

| Path                           | Package               | Role                                                                                                                                                                                                                                                                      |
| ------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/henri`               | `henri`               | The CLI binary users install; delegates to `@usehenri/cli`.                                                                                                                                                                                                               |
| `packages/cli`                 | `@usehenri/cli`       | `new`, `init`, `server`, `console`, `routes`, `openapi`, `graphql`, `generate` (incl. `authentication`), `destroy`, `build`, `test`, `db`, `jobs`, `webhooks`, `privacy`, `encryption`, `calls`, `doctor`, `audit`, `mcp`, `clean`, `about`, `analyze`; the app templates |
| `packages/core`                | `@usehenri/core`      | The framework: modules, server, router, models, views, users, policies, mail, i18n                                                                                                                                                                                        |
| `packages/mongoose`            | `@usehenri/mongoose`  | MongoDB adapter (Mongoose 9)                                                                                                                                                                                                                                              |
| `packages/disk`                | `@usehenri/disk`      | Zero-config local MongoDB (mongodb-memory-server) on top of mongoose                                                                                                                                                                                                      |
| `packages/drizzle`             | `@usehenri/drizzle`   | henri's SQL data layer: Drizzle ORM (sqlite, postgres, mysql) with drizzle-kit migrations (`henri db:*`). The default of `henri new`, on sqlite                                                                                                                           |
| `packages/postgresql`, `mysql` | `@usehenri/*`         | `@usehenri/drizzle` with the dialect and the driver chosen; `mariadb` is served by `@usehenri/mysql`                                                                                                                                                                      |
| `packages/sequelize`           | `@usehenri/sequelize` | Sequelize 6, only under `@usehenri/mssql`: Drizzle has no SQL Server dialect                                                                                                                                                                                              |
| `packages/mssql`               | `@usehenri/mssql`     | SQL Server, on `@usehenri/sequelize`. No migrations; `henri db:status` reports the drift                                                                                                                                                                                  |
| `packages/react`               | `@usehenri/react`     | Next.js 16 view engine (pages router), `withHenri`, `useHenri`, form components; supported and frozen                                                                                                                                                                     |
| `packages/inertia`             | `@usehenri/inertia`   | Inertia.js view engine on Vite + React 19; the default renderer of `henri new`                                                                                                                                                                                            |
| `packages/jobs`                | `@usehenri/jobs`      | Background jobs: a database backed queue with retries, a dead letter queue and recurring jobs (`henri jobs`), new in 1.1; ships its own module, left core in 1.2                                                                                                          |
| `packages/graphql`             | `@usehenri/graphql`   | GraphQL: the models' types and resolvers merged and served by Apollo Server; left core in 1.2                                                                                                                                                                             |
| `packages/webhooks`            | `@usehenri/webhooks`  | Outbound webhooks: endpoints henri stores, Standard Webhooks signatures, an SSRF check at request time; delivers through the queue, new in 1.2                                                                                                                            |
| `packages/uploads`             | `@usehenri/uploads`   | File uploads: bounded multipart parsing (busboy), files typed by their bytes and a storage seam; ships its own module, new in 1.2                                                                                                                                         |
| `packages/s3`                  | `@usehenri/s3`        | Uploads on an object store: one backend over the S3 API (S3, R2, Spaces, MinIO), SigV4 and presigned urls, new in 1.2                                                                                                                                                     |
| `packages/redis`               | `@usehenri/redis`     | The shared store of `config.shared`: the rate limit, the sign-in lockout and the idempotency keys counted in Redis instead of one process                                                                                                                                 |
| `packages/testing`             | `@usehenri/testing`   | Boots an app for Vitest and binds supertest to it                                                                                                                                                                                                                         |
| `packages/mcp`                 | `@usehenri/mcp`       | `henri mcp`: stdio MCP server exposing routes, models, generators, tests and doctor to coding agents                                                                                                                                                                      |
| `packages/websocket`           | private               | Not published, never wired into core                                                                                                                                                                                                                                      |
| `packages/demo`                | private               | Demo app used by core's tests (`NODE_ENV=test` chdirs into it)                                                                                                                                                                                                            |
| `showcase`                     | private               | Lineup, the showcase application (Inertia + Drizzle on PostgreSQL); its own suite, `pnpm test:showcase`                                                                                                                                                                   |
| `website`                      | private               | usehenri.io, deployed by Vercel from `website/`, master only (`vercel.json`)                                                                                                                                                                                              |

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
  the schema: `port`, `host`, `cors`, `renderer`, `inertia`, `experimental`,
  `stores`, `secret`, `url`, `user` (string or `{ model, public, loginPath,
afterLogin, sessionMaxAge, signup, passwordReset, confirmation }`),
  `baseRole`, `externalIds`, `policies`, `trustProxy`, `csrf`, `graphql`,
  `mail`, `mailers`, `api`, `jobs`, `webhooks`, `rateLimit`, `shared`,
  `cache`, `helmet`, `csp`, `filterParameters`, `logs`, `telemetry`,
  `encryption`, `privacy`, `retention`, `trail`, `calls`, `queries`,
  `versions`, `i18n`, `bodyLimit`, `uploads`, `requestTimeout`, `shutdown`,
  `errors`.
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
- `SIGINT` and `SIGTERM` drain before they stop (`base/shutdown.js`,
  `2.server.js`): readiness turns 503, `config.shutdown.delay` passes, the
  listener closes and the idle keep-alives are hung up, the requests in
  flight finish within `config.shutdown.drain`, and only then does
  `henri.stop()` run. `config.shutdown.signals: false` leaves the signals to
  the application. `henri jobs` boots to runlevel 4, never starts the server
  and drains its own way (the runner stops claiming and finishes what it
  holds).
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
  `transaction()` and, on SQL, `query()` and `drift()` (what the database
  and the models disagree about, which `henri db:status` prints and a
  production boot warns about). Core loads them from the app cwd
  with `utils.resolveFrom('@usehenri/<adapter>')`. Model files use the henri
  schema format (`type: 'string'|'text'|'number'|'integer'|'float'|'decimal'|
'bigint'|'boolean'|'date'|'json'|'uuid'`, `required`, `default`, `enum`,
  `unique`, `index`),
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
  anonymous visitor). `policy: true` on a route registers the guard next to
  the role guard rather than instead of it; what the gate cannot decide is
  enforced by `res.resource()` (unless the action already asked that question)
  and reported by `config.policies.verify`. `res.resource`/`res.collection`
  take a `subject` for controllers answering with a presentation of the
  record. `policy.scope(user)` is the query seam: henri hands the value back
  untouched, and a policy without one throws rather than meaning "everything".
  `henri generate policy <Model> [ownerColumn]` writes the file and its test,
  and `henri audit` reports a policy nothing asks (`policies.unenforced`).
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
  (the wiring) the way each has an `encryption.js`. `henri versions`,
  `versions:show` and `versions:restore` read it back, and the guide is
  `guides/versions.md`.
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
  never perform one job. `henri.jobs.recur(name, entry)` is the seam a
  framework module uses to ask for a schedule the configuration did not
  write (`henri.retention` is the one that does); an entry the application
  declared under the same name wins. `henri jobs` runs a worker (`--queue`,
  `--concurrency`, `--once`), `henri jobs:install|status|list|dead|show|
perform|retry|discard` drive it. The module also registers
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
  the request, and `before` is one of the three exports that are never an
  action. The same module wraps every action so that returning without
  answering renders `/<controller>/<action>` (`/<controller>` for `index`)
  with what it returned. `req.flash()` (`base/flash.js`) keeps one-shot messages in the
  express session and the views read them once through `flash`.
- The second one is `params` (`base/params-schema.js`): what each action
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
- The fourth boundary is every entry point an application calls
  (`base/arguments.js`), after the configuration, the request and the
  answer: the
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
  generated DDL), and no adapter is exercised against MariaDB. The
  `postgresql` and `mysql` suites are thin now that those packages are
  `@usehenri/drizzle` with a dialect chosen -- they check the choosing and
  reach the server; the model API, the schema format and the migrations are
  `packages/drizzle/__tests__`, which run on the same servers.
  `@usehenri/sequelize`'s own suites still run on sqlite and, when a server
  is there, on PostgreSQL and MySQL: not because an application reaches
  those through Sequelize any more, but because they are the servers
  available to exercise the base class MSSQL rides on. The mssql
  adapter has no migrations and is not getting any: `sequelize.sync()`
  creates the tables that are missing in development, a production boot
  changes nothing unless the store sets `sync: true`, and `henri db:status`
  (`packages/sequelize/drift.js`) reads the database back and reports what
  it and the models disagree about, with `--sql` writing the DDL for a
  person to review. Generated, versioned migrations are Drizzle's, and
  `website/src/content/docs/upgrading.md` has the path from one to the
  other. The drift comparison is exercised on sqlite, PostgreSQL and MySQL;
  on MSSQL neither it nor the DDL it would write is covered, and sqlite
  reports a column change without a statement because it has no
  `ALTER COLUMN`.
- The tables henri owns in a drizzle store (`henri_jobs`,
  `henri_jobs_schedules`, `henri_trail`, `henri_calls`, `henri_versions`)
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
- `henri generate scaffold|crud` write the pages of the application's renderer
  (`.jsx` for inertia, `.js` for react) and controllers that follow the adapter
  of the default store (`scripts/adapters.js` maps it to the mongoose,
  sequelize or drizzle flavour), which `henri new --adapter <name>` configures.
  The `template` and `vue` renderers get no generated pages.
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
  (and on a live PostgreSQL or MySQL with `pnpm test:sql:live`) and on
  MongoDB; MSSQL only has its generated DDL covered offline, like the rest
  of that adapter. The address rules are exercised with a resolver of the
  suite's own rather than against the network, and the deliveries against a
  loopback server, which is exactly what the rules refuse -- so the tests
  that prove a refusal and the tests that prove a delivery are different
  suites on purpose. Receiving webhooks, a UI, a subscription policy richer
  than `invoice.*`, `Retry-After` and ordering guarantees are out of scope
  and the guide says why.
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
  (`showcase/test/retention.test.js`). MSSQL has only its generated DDL
  covered, like the rest of that adapter.
- `@usehenri/jobs` is new in 1.1. Its claim is covered against sqlite,
  PostgreSQL, MySQL and MongoDB (`packages/jobs/__tests__/claim.spec.js`,
  `mongo.spec.js`; `pnpm test:sql:live` runs the SQL ones on real servers with
  concurrent connection pools). MSSQL only has its generated DDL and claim
  statement covered offline, like the rest of that adapter.
- The call log (`config.calls`) is new. Its table, its join, its bodies and
  its bounded delete are covered on sqlite offline and on the live
  PostgreSQL and MySQL of `pnpm test:sql:live`
  (`packages/drizzle/__tests__/calls.spec.js`), and on MongoDB through the
  demo application core's suite boots. The **partitions only exist on
  PostgreSQL and MySQL**, so that half of the suite is skipped offline;
  MSSQL has neither partitions nor coverage beyond its generated DDL, like
  the rest of that adapter. There is no tracing (no span, no propagation
  header: the join is the request id and nothing more), no capture of a
  streamed or non-JSON body, and no cross-process ceiling.
- Model versioning (`options: { versioned: true }`) is new. It is covered
  on sqlite offline and on the live PostgreSQL and MySQL of
  `pnpm test:sql:live` (`packages/{drizzle,sequelize}/__tests__/
versions.spec.js`), and on MongoDB through the demo application core's
  suite boots (`Memo` and `User` are versioned there, which is what
  exercises the password rule and the envelopes). MSSQL has only its
  generated DDL covered, like the rest of that adapter. A **mass write is
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
  under `@usehenri/mssql` -- and MSSQL itself has only its generated DDL
  covered, like the rest of that adapter. henri ships no arithmetic and
  rounds nothing: a value that does not fit the scale is a validation
  failure, and what to do about it is the application's.
- The query seam and the N+1 detector (`config.queries`) are new. They are
  covered on sqlite offline and on the live PostgreSQL and MySQL of
  `pnpm test:sql:live` (`packages/{drizzle,sequelize}/__tests__/
queries.spec.js`), on MongoDB by `packages/mongoose/__tests__/
queries.spec.js`, and on a real application by the showcase's cost test.
  MSSQL rides the Sequelize mapping and has no coverage of its own, like the
  rest of that adapter. Three limits are deliberate and in the guide: the
  detector counts **model calls**, so a statement count is a different
  number and the showcase keeps one counter of each, labelled; a Mongoose
  `populate` reports one event per operation rather than one per model call,
  because `pre` and `post` are two callbacks with no scope between them; and
  repetition is only ever counted **within one request**, so nothing is
  detected in a job, in the console or across requests. There is no history
  of findings, no span (the join is the request id and nothing more) and no
  fix applied on anyone's behalf.
- The scaffolded app pins ESLint 9 because `eslint-plugin-react` does not
  support ESLint 10 yet.
