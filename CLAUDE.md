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

| Path                                    | Package               | Role                                                                                                                                                                                                                        |
| --------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/henri`                        | `henri`               | The CLI binary users install; delegates to `@usehenri/cli`.                                                                                                                                                                 |
| `packages/cli`                          | `@usehenri/cli`       | `new`, `init`, `server`, `console`, `routes`, `openapi`, `generate` (incl. `authentication`), `destroy`, `build`, `test`, `db`, `jobs`, `privacy`, `doctor`, `audit`, `mcp`, `clean`, `about`, `analyze`; the app templates |
| `packages/core`                         | `@usehenri/core`      | The framework: modules, server, router, models, views, users, policies, mail                                                                                                                                                |
| `packages/mongoose`                     | `@usehenri/mongoose`  | MongoDB adapter (Mongoose 9)                                                                                                                                                                                                |
| `packages/disk`                         | `@usehenri/disk`      | Zero-config local MongoDB (mongodb-memory-server) on top of mongoose                                                                                                                                                        |
| `packages/sequelize`                    | `@usehenri/sequelize` | Shared SQL adapter (Sequelize 6)                                                                                                                                                                                            |
| `packages/mysql`, `postgresql`, `mssql` | `@usehenri/*`         | Dialect packages on top of `@usehenri/sequelize`                                                                                                                                                                            |
| `packages/drizzle`                      | `@usehenri/drizzle`   | SQL adapter on Drizzle ORM (sqlite, postgres, mysql) with drizzle-kit migrations (`henri db:*`), new in 1.1                                                                                                                 |
| `packages/react`                        | `@usehenri/react`     | Next.js 16 view engine (pages router), `withHenri`, `useHenri`, form components; supported and frozen                                                                                                                       |
| `packages/inertia`                      | `@usehenri/inertia`   | Inertia.js view engine on Vite + React 19; the default renderer of `henri new`                                                                                                                                              |
| `packages/jobs`                         | `@usehenri/jobs`      | Background jobs: a database backed queue with retries, a dead letter queue and recurring jobs (`henri jobs`), new in 1.1; ships its own module, left core in 1.2                                                            |
| `packages/graphql`                      | `@usehenri/graphql`   | GraphQL: the models' types and resolvers merged and served by Apollo Server; left core in 1.2                                                                                                                               |
| `packages/uploads`                      | `@usehenri/uploads`   | File uploads: bounded multipart parsing (busboy), files typed by their bytes and a storage seam; ships its own module, new in 1.2                                                                                           |
| `packages/redis`                        | `@usehenri/redis`     | The shared store of `config.shared`: the rate limit, the sign-in lockout and the idempotency keys counted in Redis instead of one process                                                                                   |
| `packages/testing`                      | `@usehenri/testing`   | Boots an app for Vitest and binds supertest to it                                                                                                                                                                           |
| `packages/mcp`                          | `@usehenri/mcp`       | `henri mcp`: stdio MCP server exposing routes, models, generators, tests and doctor to coding agents                                                                                                                        |
| `packages/websocket`                    | private               | Not published, never wired into core                                                                                                                                                                                        |
| `packages/demo`                         | private               | Demo app used by core's tests (`NODE_ENV=test` chdirs into it)                                                                                                                                                              |
| `showcase`                              | private               | Lineup, the showcase application (Inertia + Drizzle on PostgreSQL); its own suite, `pnpm test:showcase`                                                                                                                     |
| `website`                               | private               | usehenri.io, deployed by Vercel from `website/`                                                                                                                                                                             |

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
passwordReset, confirmation }`), `baseRole`, `externalIds`, `policies`,
  `trustProxy`, `csrf`, `graphql`, `mail`, `mailers`, `api`, `jobs`,
  `rateLimit`, `shared`, `cache`, `helmet`, `filterParameters`, `privacy`,
  `retention`, `trail`, `externalIds`, `bodyLimit`, `uploads`,
  `requestTimeout`, `shutdown`, `errors`, `policies`.
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
- Store adapters implement one contract (JSDoc `HenriAdapter` at the top of
  `packages/sequelize/index.js` and `packages/mongoose/index.js`):
  `new Adapter(name, config, henri)`, `addModel(model, userModelName)`,
  `getModels()`, `start()`, `stop()`, async `getSessionConnector(session)`,
  `findUserByEmail()`, `findUserById()`, `userId()`, `toPlain()`,
  `references()`, async `externalIdsOf(model, keys)`, `ping()`,
  `transaction()` and, on SQL, `query()` and `drift()` (what the database
  and the models disagree about, which `henri db:status` prints and a
  production boot warns about). Core loads them from the app cwd
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
  adapters have no migrations and are not getting any: `sequelize.sync()`
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
  `henri_jobs_schedules`, `henri_trail`) are created through raw SQL, so
  drizzle-kit sees them as tables the schema no longer wants.
  `Drizzle#reservedTables()` is what keeps a push from dropping them; a
  table an application renames through `jobs.table` or `trail.table` is
  read from the configuration, and anything else henri comes to own has to
  be added there.
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
  signature is `application/octet-stream`. Image processing, direct-to-S3
  signed uploads, a CDN story and virus scanning are out of scope on purpose
  and the guide says why. No S3 storage ships, only the local disk.
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
- The scaffolded app pins ESLint 9 because `eslint-plugin-react` does not
  support ESLint 10 yet.
