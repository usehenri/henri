# Change Log

## 1.2.0

### Minor Changes

- [#352](https://github.com/usehenri/henri/pull/352) [`1e23664`](https://github.com/usehenri/henri/commit/1e23664829bd1a356de28f404cfb21c9ae211388) Thanks [@reel](https://github.com/reel)! - Registration, password reset and email confirmation, as part of the framework.
  
  henri mounted sessions, `POST /login` and `POST /logout`, and the store added `email`, `password` and `roles`. Everything after that — creating an account, resetting a password, proving you can read an address — was left to every application, which is exactly where hand-rolled authentication goes wrong: tokens that never expire, resets that leave the thief's session signed in, confirmation links that leak in a `Referer`, and answers that tell an attacker which addresses are registered. Rails 8 generates the whole thing and every Laravel and Adonis starter kit ships it; this is henri's.
  
  Three blocks of `config.user` mount seven endpoints, ahead of the application's routes and on every renderer and every adapter:
  
  ```json
  {
    "user": {
      "signup": { "fields": ["name"] },
      "passwordReset": true,
      "confirmation": { "required": true }
    }
  }
  ```
  
  `POST /signup` creates an account and opens a session; `POST /password/forgot`, `GET /password/reset/:token` and `POST /password/reset` are the reset; `GET /confirm/:token`, `POST /confirm` and `POST /account/email` are the confirmation and the address change. Each answers JSON to API clients and redirects browsers, the way `POST /login` does, and each is also a method on `henri.accounts` for an application that would rather answer them from its own controller. `roles` stays unassignable, the password is still hashed by the store and never selected, and the address is still unique and lowercased.
  
  **The tokens are signed, not stored.** One HMAC over the application secret covers the token's purpose, its expiry and a seed taken from the state the action is about to change — the password hash for a reset, the address and its confirmation date for a confirmation. Performing the action moves the seed, so a link works once, expires on its own, cannot be replayed for another purpose or against another account, and a database leak hands over nothing usable because forging one needs the secret. The other side of that coin, which the configuration guide now says where secrets are rotated: rotating `secret` invalidates every link that has not been used yet.
  
  **A reset signs the other devices out.** It stamps the new `passwordChangedAt` column, and every session opened before that moment stops resolving to a user on its next request — no scan of the session store, no extra read per request. Which matters, because the usual reason someone resets a password is believing that somebody else has it.
  
  **Neither flow says whether an address is registered.** A reset request and a confirmation resend answer `202` with the same body, and henri writes that answer _before_ it looks anything up: the lookup, the token and the mail all run after the response, so the time a client can measure carries nothing either. An address change writes nothing until the link sent to the new address is followed, so an address nobody proved they can read never becomes the address of an account.
  
  The mails come from an `auth` mailer that ships with henri, with its views and its previews, so a fresh application can reset a password before anyone has written a template; an application overrides one view (`app/views/mailers/auth/reset.hbs`) or one action (`app/mailers/auth.js`) and keeps the rest. Delivery goes through `deliverLater()`, so the job queue takes it when there is one and an SMTP timeout never blocks a request.
  
  `henri generate authentication` writes the whole story into an application, in the shape Rails 8 does: the configuration, the user model when there is none, the controller, the five pages for whichever renderer the application uses, the mailer and its views, the routes and a test suite covering the properties rather than the happy path.
  
  A handler that refuses a form and redirects now reaches the next page: what it puts in the flash under `errors` arrives as the `errors` a page already reads, so post/redirect/get carries its messages per field on both renderers. `henri generate authentication` is exposed by the MCP server like the other generators.
  
  The user model gains two nullable date columns on every adapter, `confirmedAt` and `passwordChangedAt`. A Drizzle application needs a migration for them (`henri db:generate`); Mongoose and the Sequelize adapters add them on their own. Turning `confirmation.required` on in an application that already has users means backfilling `confirmedAt` first, or they cannot sign in.

- [#360](https://github.com/usehenri/henri/pull/360) [`5b627ad`](https://github.com/usehenri/henri/commit/5b627adfa37e9f16bc75af96cc8ff5308a91f688) Thanks [@reel](https://github.com/reel)! - An agent can ask the running application, not only read its files.
  
  `henri mcp` gains seven tools that answer against a booted henri instead of
  the source: `errors` (the last failures with their stack and the request that
  caused each one, keyed by `X-Request-Id`), `logs` (the lines `henri.pen` wrote,
  by level, by text or by request id), `query` (one read against a store through
  its adapter), `records` (a page of a model, or one record, read through the
  model rather than the driver), `runtime_routes` (what the router actually
  mounted, including the routes whose controller is missing), `request` (make one
  request against the application and read the status, the headers, the body and
  the request id) and `guide` (henri's own documentation at the version
  installed, shipped with the package). A new `henri://runtime` resource
  describes the process that answered.
  
  The MCP server attaches to the development server already running when it finds
  one -- that is where the errors, the logs and, with the `disk` store, the
  database are -- and starts one itself otherwise, stopping it when the editor
  disconnects. Every answer says which of the two happened and on which url.
  `HENRI_MCP_AUTOSTART=0` forbids starting one.
  
  `@usehenri/core` grows the surface behind it: `GET/POST /_henri/runtime`
  (`src/base/runtime.js`), mounted only outside production and only for the
  loopback interface, requiring `X-Henri-Runtime: 1` and refusing anything
  carrying `Origin` or `Sec-Fetch-Site`. It answers reads only: one `SELECT`,
  `WITH ... SELECT`, `EXPLAIN`, `SHOW` or `DESCRIBE`, checked with its strings
  and comments removed, and refused with the offending word if anything that
  writes, locks, waits or reads a file survives. Everything it answers is
  redacted with `filterParameters` (`password` always) and bounded, and says when
  it truncated. Nothing is recorded in production: no ring buffer, no endpoint,
  no opt-in.

- [#342](https://github.com/usehenri/henri/pull/342) [`1b316c6`](https://github.com/usehenri/henri/commit/1b316c6f3c5d5eb5752c70b534092d1052956cc6) Thanks [@reel](https://github.com/reel)! - Real background jobs, in a new package: `@usehenri/jobs`.
  
  What henri called workers was a hook that ran a file at boot, and the documented example was a `setInterval`. There was no way to say "send this mail later" or "process this upload in the background": no queue, no retries, no schedule, and nothing to look at when something failed. Rails has had that for a decade and now ships a database-backed queue by default; this is henri's.
  
  A job is `app/jobs/<name>.js` exporting `perform(args, context)` alongside its `queue`, `priority`, `maxAttempts`, `timeout` and `backoff` — the shape models and controllers already use. `henri generate job <name>` writes one and `henri destroy job <name>` removes it. The application enqueues with `henri.jobs.perform(name, args, options)`, `performIn(delay, ...)` and `performAt(date, ...)`, which write one row and return; `performNow()` runs one inline for tests and the console. Arguments are stored as JSON and anything that would not survive the round trip — a model instance, a function, `undefined`, a `Date` that would come back a string, a cycle — is refused with the path that holds it instead of being dropped silently.
  
  `henri jobs` runs a worker process: it claims jobs, performs `jobs.concurrency` of them at a time, honours the recurring schedules, puts back the jobs of runners that died and stops on `SIGINT`, `SIGTERM` and `SIGQUIT` after finishing what it holds. `--queue` limits it to some queues and `--once` drains what is due and exits. Several runners are meant to run at once against one database: claiming is a single statement on every dialect — `FOR UPDATE SKIP LOCKED` on PostgreSQL, `UPDATE ... ORDER BY ... LIMIT` on MySQL, `UPDLOCK, READPAST` on MSSQL, a subquery on sqlite, an atomic `findOneAndUpdate` per document on MongoDB — so it is its own transaction, the state is part of its own `WHERE`, and the rows it took carry a token it reads them back by. No job is ever performed twice because two runners raced.
  
  A job that throws is retried with an exponential backoff and, once out of attempts, kept in a **dead letter queue** with its error, its stack and the history of every attempt. The queue is at-least-once, so the guide says to write a job the way you would write a webhook handler: the outcome of an attempt is fenced by the token of the claim it belongs to, so a runner that was recovered from cannot write over the one that took its job, but a job that was recovered from does run twice. `henri jobs:dead`, `jobs:show <id>`, `jobs:retry` and `jobs:discard` drive it from the command line, `henri.jobs.dead.*` from the application. `henri jobs:status` gives the counts by queue and state, the timings of the finished jobs and how long the oldest due job has waited — with `--json`, like every other henri command.
  
  Recurring jobs are declared under `jobs.recurring` in the configuration (a five-field cron expression read in UTC, or a plain `every` interval) and honoured by the runner itself, with no second process. Missed runs do not pile up: the moment that follows is computed from now, so an hour of downtime on an hourly job costs one run, not sixty.
  
  The queue owns `henri_jobs` and `henri_jobs_schedules` and reaches them through the store adapter's own `query()` or its MongoDB collections, never through a model, so it cannot collide with the application's schema and works on a store that has no models at all. `henri jobs:install` creates the tables and is idempotent; the boot creates them too unless `jobs.install` says otherwise.
  
  `henri.mailers.deliverLater()` now goes through it: core registers the delivery handler, and the rendered message becomes a job on the `mailers` queue, retried and visible like any other.
  
  `app/workers` is untouched and still the right answer for a long-lived process that starts with the server. The [Jobs guide](https://usehenri.io/guides/jobs/) says when to reach for which.

- [#403](https://github.com/usehenri/henri/pull/403) [`b559fb7`](https://github.com/usehenri/henri/commit/b559fb72b391eeb21a3f6a0cda1515e01ecbfafc) Thanks [@reel](https://github.com/reel)! - The call log records the address the request came from, and says how sure it is.
  
  An inbound row gains three columns: `client`, the address henri believes the
  request came from; `peer`, the address that actually opened the socket; and
  `source`, how `client` was decided. Every forwarding header is text a client
  typed, so henri believes one only when the configuration can support it:
  `X-Forwarded-For` through express' `trustProxy`, and a header express will
  not read (`cf-connecting-ip` and friends) through the new
  `calls.address.header` **and** `calls.address.from`, which lists the proxies
  allowed to set it. Naming a header without `from` fails the boot
  (`HENRI_CALLS_ADDRESS_UNVERIFIABLE`).
  
  A blanket `trustProxy: true` in front of a forwarded request records **no
  client address at all** and says `unverified`, keeping the peer. An address
  that is a guess is worse than an empty column: an operator reading a call log
  is answering "who did this", and the empty column asks a question where the
  guess answers one. `henri audit` reports the combination
  (`calls.address-unverified`), and reports a `from` covering every address
  (`calls.address-from-any`).
  
  An address is personal data, so it gets the care the rest of that table gets.
  It lives in columns of its own and the forwarding headers are masked out of
  the stored header blob, which is the one place an erasure cannot reach.
  `calls.address.anonymize` truncates it to a `/24` or a `/48`, keeping the
  prefix length in the value; it is off by default, because the column exists
  to answer "who did this" and a `/24` answers "somebody in this city".
  
  A person's rows now answer a data subject request: `henri privacy:export`
  carries them under a `calls` key and `henri privacy:erase` writes over the
  `actor`, both addresses and the four payload columns, leaving the moment, the
  method, the route, the status and the request id. The access trail is
  unchanged and records no address on purpose -- it holds no values, which is
  what lets it outlive the erasure it recorded -- and `henri.reporter` still
  carries nothing from the client.
  
  A `henri_calls` table created before this release gains the three columns on
  the next boot; the store adds what is missing.

- [#397](https://github.com/usehenri/henri/pull/397) [`1c0dfe8`](https://github.com/usehenri/henri/commit/1c0dfe84a98eff2122512256c4f42ec7ccde4212) Thanks [@reel](https://github.com/reel)! - Call logs, inbound and outbound: `henri.calls`.
  
  Two records joined by the request id henri already threads through everything — the call an application answered, and every call it made because of it — so that "what happened during request `X`" is one question with one answer:
  
  ```bash
  henri calls 018f5c2e-1f2a-7c31-9f0a-2b7c1d3e4f56
  ```
  
  ```
    2026-09-06T14:22:31.004Z  <- 201        84ms  POST   /orders
    2026-09-06T14:22:31.019Z  -> 200        41ms  POST   https://api.billing.test/v1/charges
                                service billing
    2026-09-06T14:22:31.062Z  -> 200        12ms  POST   https://hooks.example.test/orders
                                service webhooks
  ```
  
  Both directions live in one table henri owns (`henri_calls`, a `direction` column), reached through the store adapter's `query()` or a MongoDB collection the way the access trail reaches its own. One table rather than two because the join is the whole point: one `SELECT` on one index instead of two reads and a merge.
  
  **It is the deliberate opposite of the access trail, and the guide says so in its first paragraph.** The trail records field _names_, counts and digests and refuses a value; it is hash-chained evidence kept for a year. A call log holds **values** — the body that came in, the body that went out — because one that does not is a slower copy of the web server's access log. It is a debugging instrument: sampled, capped, kept for thirty days, and never evidence of anything. Neither substitutes for the other.
  
  Four bounds keep it from being a denial of service, and each of them is a decision rather than a default:
  
  - **Off unless configured.** No `config.calls`, no table, no middleware, no allocation. When it is on, the middleware is mounted right after the request id and before everything else, so a request refused by the rate limit, the body parser or the CSRF check — exactly the one worth having — is in the log.
  - **The write never blocks the answer.** A finished call goes onto a bounded buffer and the response goes out; a timer writes with one multi-row `INSERT`. A flush that fails is reported once and dropped rather than retried, because a call log that can fail a request turns a database hiccup into an outage. What the buffer drops is counted, and `henri calls:stats` says so.
  - **The payload is capped before it is stored** (`calls.maxBody`, 8kb, with a truncation marker), and only a body henri can _walk_ is stored at all — a plain object or an array is redacted key by key, a string, a buffer or an HTML page is a size and a shape. That is why the response body is taken from `res.json(value)` rather than off the socket.
  - **What one client can cause is bounded twice.** `calls.sample` bounds the steady state proportionally; `calls.maxPerSecond` is an absolute per-process ceiling, because one percent of a million requests a second is still ten thousand rows a second. The sampling decision is a hash of the request id **seeded with `config.secret`**: a hash so the inbound call and every outbound call it caused agree in every process without carrying state, and seeded because the request id comes from a header a client chooses. `calls.always` keeps the failures sampling dropped, without their bodies.
  
  It holds values, so the redaction is the feature. Everything stored goes through the redactor of `config.filterParameters` and the `personal` marks, at every depth, and on top of that `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-csrf-token`, `x-api-key` and `webhook-signature` are masked whatever the configuration says, a url loses its userinfo, and the person is their `externalId` and never an address.
  
  `calls.keep` (30 days) is pruned by the retention sweep, and **where the dialect has range partitions it drops periods instead of rows**: `calls.partition: "day"` on PostgreSQL and MySQL makes the sweep a metadata operation whatever the table held, which is the difference between a sweep that works at ten million rows and one that times out. There is always a catch-all partition, so no row is ever refused for want of one. sqlite, SQL Server and MongoDB have no ranges and get a bounded delete loop; asking them to partition fails the boot rather than being ignored.
  
  henri wraps nobody's HTTP client: `henri.calls.track()` and `henri.calls.outbound()` are the seam, two lines around whatever an application already uses. The calls henri makes itself are populated without anything to write — every mail send, and every webhook delivery attempt, whose request id is stamped into the delivery job at `emit()` time so a delivery three retries later still joins the request that caused it.
  
  `henri calls [<request-id>]`, `henri calls:stats` and `henri calls:sweep --yes` are the commands, `config.calls` is the configuration, and the guide is [Call logs](https://usehenri.io/guides/calls/).

- [#355](https://github.com/usehenri/henri/pull/355) [`43689b4`](https://github.com/usehenri/henri/commit/43689b47b2f15852a78fe686f60833be8e891b72) Thanks [@reel](https://github.com/reel)! - `henri db:create`, `db:drop` and `db:reset`
  
  `henri db:migrate` connects to a database. It cannot make one, so every application wrote that step by hand — the showcase in this repository carried a `db/create.js` doing exactly it — which is a framework telling on itself, since it is the same twenty lines for everybody.
  
  ```bash
  henri db:create                 # the database config/<env>.json points at
  NODE_ENV=test henri db:reset    # drop, create, migrate, seed
  henri db:drop --force           # in production, asked for twice
  ```
  
  `db:create` reads the configuration, the environment, `DATABASE_URL` and the encrypted credentials the way henri does and stops there, because a store cannot connect to a database that does not exist yet. Then it talks to the server with the driver the application already installed: PostgreSQL and MySQL on the server's maintenance connection, SQLite as a file, and MongoDB not at all, since it makes a database on its first write and saying so is more useful than pretending to act. Running it twice is not an error.
  
  `db:reset` drops, creates, brings the schema up — from `db/migrations` when the application has migrations, from the models when it does not, which is the same choice a `henri server` boot makes on a fresh database — and runs `db/seeds.js` when it exists.
  
  `db:drop` and `db:reset` refuse to act when `NODE_ENV` is `production` unless `--force` says it was meant. A database name is an identifier, so it is checked against a character set and quoted rather than bound as a parameter, and nothing printed by these commands carries the store's password.

- [#377](https://github.com/usehenri/henri/pull/377) [`b278119`](https://github.com/usehenri/henri/commit/b2781190de436eb5838e866446c9a0c8210bb6ca) Thanks [@reel](https://github.com/reel)! - Content Security Policy nonces: `"csp": { "nonce": true }`
  
  Every response draws a fresh nonce (16 bytes of the system CSPRNG, base64url),
  `script-src` names it and loses `'unsafe-inline'` -- which the browser ignores
  next to a nonce anyway, so the header now says what the browser does. The value
  reaches your code as `res.locals.cspNonce`, `req._henri.nonce` and the `nonce`
  view option.
  
  The renderers carry it: the Inertia engine writes it on every script, style and
  fetching link of the document (its own tags, the shell's, the ones Vite injects
  in development and the ones the server bundle returned) and adds
  `<meta property="csp-nonce">`, which is what Vite's own runtime reads for the
  styles it injects and the chunks `__vitePreload` loads; the React engine gets it
  through Next's pages router, which reads the nonce off the request's
  `Content-Security-Policy` header; Handlebars gets a `{{nonce}}` helper. The Vue
  renderer cannot, and the boot fails with `HENRI_VIEW_NONCE_UNSUPPORTED` rather
  than sending a policy the document does not honour -- a view engine of your own
  opts in with `supportsNonce = true`.
  
  `style-src` deliberately keeps `'unsafe-inline'` and never gets the nonce: a
  `style=""` attribute cannot carry one, and React, Inertia and Vite all set them.
  
  The nonce costs 62ns a response (the secure-headers middleware goes from 147ns
  to 209ns a request): the bytes come out of a pool refilled with
  `crypto.randomFillSync` and the header is serialized once per protocol and cut
  in two around the nonce, instead of the ~1.5µs `crypto.randomBytes` plus helmet
  re-joining the header would cost.
  
  `henri audit` gains `csp.script-unsafe-inline` (ASVS V14.4.3): a `script-src`
  of the application's own that allows `'unsafe-inline'` with no nonce beside it.

- [#412](https://github.com/usehenri/henri/pull/412) [`1616e34`](https://github.com/usehenri/henri/commit/1616e343a612be2bffffcfa5b23bfa8ad191bbe3) Thanks [@reel](https://github.com/reel)! - A declared shape for what leaves, the way `params` declares what arrives.
  
  `res.render()`, `res.resource()` and `res.collection()` have always gone through one gate on the way out: a foreign key leaves as the `externalId` of the row it names, and a field a model marked `personal: { expose: false }` is dropped. `res.json()` went through nothing, and that was not a corner: an Inertia page whose props are assembled in the controller, a JSON route answering a total next to a list, any object built by hand — none of them is a record, so nothing published its foreign keys and nothing stripped what the model said must never leave.
  
  ```js
  // what the models said never leaves, leaving
  res.json({ rows: [{ email: user.email, gender: user.gender }] });
  ```
  
  **The floor.** Every JSON answer of every controller action now goes through the same publish and the same strip, in the same order, whether or not the action declared anything. There is no setting that turns it off: the mark is the model's word about a person, and a controller is not where it is overruled. henri's own answers — the HAL envelope, the page options, `res.boom.*`, the 404 and 500 pages, an Inertia page object — are left exactly as they were, because they went through the gate already or are an envelope of their own.
  
  **The declaration.** Opt-in per action, in the block `before` and `params` already established, with the same selectors and the same vocabulary:
  
  ```js
  module.exports = {
    answers: {
      all: { total: 'integer' },
      index: {
        rows: { model: 'Memo', type: 'array' },
        who: { from: 'User.email', type: 'string' },
      },
    },
  };
  ```
  
  `model` names the model whose records a field holds, and it is the only way an object that never was a record can have its foreign keys published — henri reads no field name, so a hand-built `{ ownerId }` was an opaque string until the controller said what it was. `from` is `'User.email'`, the column a value came from: the field then obeys that column's marks under whatever name the answer gives it, which is the one leak a strip matching by name cannot see, and a `from` pointing at a column marked `expose: false` fails the boot unless the rule says `expose: true` — the declared form of the `include` that `res.resource()` takes.
  
  **What is not declared does not leave.** That is `req.permit()`'s rule pointed the other way: the declaration is the list, an undeclared key is dropped and never refused. It costs an existing application nothing, because an action that declares nothing keeps every byte it sends. The other half goes the other way: a field that was declared and is missing, or holds another type, is a mistake in the declaration rather than something leaking, so it is reported once per route and only refused with `config.api.strict` — the setting that already meant that for the HAL links — as a 500 carrying `HENRI_ANSWERS_MISMATCH`. A rule henri cannot carry out fails the boot with `HENRI_ANSWERS_DECLARATION_INVALID`, naming the controller, the action and the field.
  
  `res.json()` stays synchronous whenever it can, which is nearly always: the walk is free, and only a foreign key nobody eager loaded costs a lookup.
  
  `henri openapi` reads it. An operation whose body a controller writes carried the statuses henri produces, `x-henri.known: false` and no success status at all; one that declares its answer now carries a `200` built from the declaration — a `$ref` to the model's record schema for a field naming a model, the column's own schema for a field naming one, and `additionalProperties: false`, because the document says what the gate does.

- [#404](https://github.com/usehenri/henri/pull/404) [`ab5a8e4`](https://github.com/usehenri/henri/commit/ab5a8e4a88c80cca070a2b8ad398c80babdaff11) Thanks [@reel](https://github.com/reel)! - A model's GraphQL definition is derived from the schema it already declares.
  
  A model that wanted GraphQL wrote its types out by hand, in SDL, immediately below the henri schema that had just said the same thing — the field names again, the types again, and the resolvers to go with them ([#68](https://github.com/usehenri/henri/issues/68), open since 2019). `graphql: true` is now the whole key:
  
  ```js
  module.exports = {
    graphql: true,
    schema: {
      title: { type: 'string', required: true },
      year: { type: 'integer' },
    },
  };
  ```
  
  which serves `type Artwork { id: ID! title: String! year: Int ... }`, `artwork(id: ID!)` and `artworks(page:, perPage:, where:)` — an `ArtworkPage`, so no derived query is unbounded.
  
  **It is derived at boot, not written into the file, and that is the decision worth stating.** A generator would have handed over an honest copy that stops being true the first time a column, a `personal` mark, an `encrypted` mark or `config.externalIds` changes; the definition depends on all four. henri already refuses that trade for the OpenAPI document, for the HAL `_links` and for what a foreign key publishes as. `henri graphql` prints the derived SDL without booting — paste it into a model's own `types` when you want to own it — and `henri graphql --summary` says what was left out of each model and why.
  
  **`id` is the `externalId`.** The primary key is not a field, it is not an argument, and `artwork(id:)` resolves through `findById()`, which takes the public identifier and nothing else. A declared foreign key is an `ID` carrying the target row's `externalId`, and a mutation writing one takes an `externalId` back and looks the row up: the identifier rule, in both directions.
  
  **What is never derived is read off the model, not off a list of names.** A field marked `personal: { expose: false }` is not a field — which is what leaves the user's `password` out, since `base/privacy.js` marks it that way on every application with a user model. A field marked `personal: true` is a field and never an argument: a value you may read on a record you are allowed to see is not one anybody may search by. A randomised `encrypted` field is never an argument either, because henri refuses that query with `HENRI_ENCRYPTION_NOT_QUERYABLE` and a field the framework will not query has no business being a queryable one. A `json` column has no shape GraphQL could state, so it is left for a scalar of your own.
  
  **Queries by default, mutations on request.** `graphql: { generate: true, mutations: true }` adds `createArtwork`, `updateArtwork` and `deleteArtwork`; nothing writes unless a model asks, because a delete mutation on the endpoint of an application that never wanted one is a hole. The block also takes `name`, `queries`, `filters`, `except`, and the `types` and `resolvers` you write yourself, which are merged on top of the derived ones and win.
  
  **Every derived resolver goes through `app/policies`, and there is no setting that turns that off.** One record asks `show`; a refusal and a row that is not there both answer `null`, the same non-oracle `findById()` follows. A list asks `index` and then asks the policy what the list _is_ — `scope(user)` is the condition it filters by, and a `where` argument narrows that and never widens it. Mutations ask `create`, `update` and `destroy`. Policies fail closed, so a model with `graphql: true` and no `app/policies/<model>.js` serves an empty page and a null record: opting a model into GraphQL is not opting it out of authorization. Everything answered is published and stripped by the same two functions every other answer goes through.
  
  `henri doctor` reports the three things that are otherwise invisible: a `graphql` key that would fail the boot (`graphql.declaration`), a derived model with no policy behind it or a policy with no `scope(user)` behind its list query (`graphql.policy`), and a hand-written definition naming a field marked `personal: { expose: false }` (`graphql.exposed`) — the drift a derived definition cannot have.
  
  A model that writes `graphql: { types, resolvers }` is untouched: nothing is derived unless `generate` asks for it. Four codes are new: `HENRI_API_GRAPHQL_INVALID_DECLARATION`, `HENRI_API_GRAPHQL_SCOPE_REQUIRED`, `HENRI_API_GRAPHQL_DENIED` and `HENRI_API_GRAPHQL_UNKNOWN_REFERENCE`. The [GraphQL guide](https://usehenri.io/guides/graphql/) has the whole table.

- [#394](https://github.com/usehenri/henri/pull/394) [`345a102`](https://github.com/usehenri/henri/commit/345a10230f7a07ca1ef88676abcbbc07e84dd479) Thanks [@reel](https://github.com/reel)! - `henri doctor` reads what would fail a boot. It checked the conventions and
  stopped short of the failures that only show up when something starts, which
  is rarely a good moment — and is exactly what a coding agent cannot see.
  
  Eleven checks more, all of them from the files. An environment file replaces
  `config/default.json` whole rather than merging into it, so every one of them
  is now read and compared: a model naming a store one of them does not hold
  (`models.store`) and a store adapter one of them configures and nothing
  installs (`deps.declared`, which names the file that asked) are the two that
  used to wait for the deploy. Then `jobs.store`, `webhooks.store` or
  `trail.store` naming a store that is not next to it (`config.store`); a route asking for a policy
  `app/policies` does not hold, which the policies refuse rather than allow
  (`routes.policy`); a file of `app/jobs` with no `perform` (`jobs.perform`); a
  recurring schedule naming a job that is not there, which fails nothing and
  simply never runs (`jobs.recurring`); a mailer action with no view
  (`mailers.view`); an `app/modules` file whose name a core module already has,
  whose `needs` nothing provides, or a dependency whose `"henri": { "module" }`
  points at a file that is gone (`modules.name`, `modules.needs`,
  `modules.package`); and the henri packages installed at two versions, which
  are published together (`deps.version`).
  
  Two more keep the application's own description honest: `agents.stale` when
  `AGENTS.md` names a renderer or a store the configuration no longer names —
  an agent that trusts it writes code this application cannot run — and
  `views.renderer` when a page imports the other view engine or carries an
  extension the configured one does not resolve. Every file under
  `app/views/pages` is read for the second one, not only the pages a
  `resources` route names: the Inertia engine resolves through
  `import.meta.glob('./pages/**/*.jsx')`, so a `.js` file there is loaded by
  nothing and says so nowhere — and the page no route points at is exactly
  where that hides.
  
  The schema of a store is the one question asked over a connection, next to
  the shared store and behind the same `--no-reach`: `schema.behind` when a
  store answers and `db/migrations` holds migrations it has not applied, and
  `schema.unreachable` when it did not answer. A store that is down and a store
  that is behind are different problems with different fixes, and doctor never
  reports one as the other; drift against the models stays with
  `henri db:status`, which boots the application to compare them.
  
  Every problem gains a `code`: the henri error code the boot would raise, and
  `null` where the convention is doctor's own. The rest of the `--json` shape,
  the check names and the exit codes are unchanged.
  
  Two older behaviours are corrected on the way. `schema.migrations-pending`
  reported itself against `config/production.json` whether or not that file
  existed, and told the reader to put `"migrate": true` in it — an environment
  file replaces `config/default.json` whole rather than merging into it, so
  someone who created it for the flag alone would lose the store block and get
  the boot failure `models.store` is there to catch. It now names the file only
  when there is one to open, and says the deploy first. And the comment
  stripper the file readers share blanked from a `//` inside a string literal,
  so a model or a mailer carrying a url could silently stop being read past
  that line; it knows strings now.

- [#387](https://github.com/usehenri/henri/pull/387) [`43d267f`](https://github.com/usehenri/henri/commit/43d267f0f9d192b2c01e89c3925b7daf5000041b) Thanks [@reel](https://github.com/reel)! - Drizzle is henri's SQL data layer: `henri new` defaults to it, and `@usehenri/postgresql` and `@usehenri/mysql` are it
  
  **This is a breaking change.** It rewrites what an existing store does rather than adding to it, and there is no compatibility switch. It is here rather than in a 2.0 because henri has no installed base to protect; if you have an application on `@usehenri/postgresql` or `@usehenri/mysql`, read the second half of this.
  
  **`henri new` scaffolds a drizzle store on sqlite.** `file:.henri/app.db`, `:memory:` under `NODE_ENV=test`, `@usehenri/drizzle` and `better-sqlite3` in the dependencies. This is Rails' default: nothing to start on the first run, a file the `.gitignore` already covers, migrations from the first day, and a database that is a real one on the last. The zero-config MongoDB store is `henri new --adapter disk`, one flag away and otherwise unchanged. `--adapter` now takes `drizzle` (the default), `postgresql`, `mysql`, `mssql`, `mongoose` and `disk`, and `--dialect sqlite|postgres|mysql` works on its own now that drizzle is the default adapter.
  
  The first run costs nothing extra: `better-sqlite3` 13 ships its compiled addon for darwin, linux, linuxmusl and win32 on arm64 and x64, so the scaffold lists it as `better-sqlite3: false` under `allowBuilds` — pnpm skips a `node-gyp rebuild` that needs a C++ toolchain and produces nothing that gets loaded. The Dockerfile of a sqlite application installs no toolchain either, and says instead that the database file lives inside the container unless a volume is mounted over it.
  
  **`@usehenri/postgresql` and `@usehenri/mysql` are `@usehenri/drizzle` with the dialect and the driver chosen.** The package names, the `--adapter postgresql` and `--adapter mysql` flags and the `"adapter": "postgresql"` store value are unchanged; the ORM behind them is not. The name means "henri's PostgreSQL adapter", and henri's PostgreSQL adapter is Drizzle. A store on one of them now has generated, versioned migrations (`henri db:generate`, `db:migrate`, `db:push`, `db:status`), needs no `dialect` key, and needs no driver in the application: `pg` and `mysql2` ship with the adapter package. `"adapter": "mariadb"` is `@usehenri/mysql` and follows.
  
  What that costs an application already on one of them: the global is the drizzle model, not a Sequelize `ModelStatic`. `findAll`, `findOne`, `findByPk`, `create`, `count`, `destroy`, `instance.update()` and `instance.destroy()` mean the same thing; `Model.scope()`, `findAndCountAll()`, `bulkCreate()`, `upsert()`, `increment()`, the association mixins and `instance.previous()` are gone and throw. Tables and columns are named the drizzle way (`tasks`, `created_at`, not `Tasks`, `createdAt`), so a database built by `sequelize.sync()` is not the one this adapter looks for. `website/src/content/docs/upgrading.md` has the list and the order to work through it.
  
  **The spellings that would have silently meant something else are refused.** This is the part that matters even if you never wrote a line of Sequelize. `Model.update(values, { where })` is Sequelize's argument order and the opposite of this adapter's: read as written it updates the rows matching the _values_ and sets a column called `where`, which answered "1 row updated" and changed nothing. It now raises the new `HENRI_MODEL_INVALID_QUERY`. So does a condition keyed by Sequelize's `Op` symbols (`Object.keys()` cannot see a symbol, so the condition narrowed nothing and the query answered every row), an empty operator object under a field, and `instance.get({ plain: true })`. An option the adapter does not read — `attributes`, `fields`, `raw`, `transaction`, `individualHooks`, `lock`, `plain` — raises the new `HENRI_MODEL_UNKNOWN_OPTION` instead of being dropped, because a dropped `fields` is a mass assignment somebody thought they had bounded. A model file's `options` takes `timestamps`, `paranoid`, `externalId`, `personal` and `retention`; one declaring `indexes`, `scopes`, `defaultScope`, `hooks`, `tableName`, `underscored` or `freezeTableName` fails the boot naming the key and what to write instead, rather than starting an application whose author believes it has an index it does not have.
  
  **`@usehenri/sequelize` is the SQL Server story, and only that.** Drizzle has no SQL Server dialect — drizzle-orm 0.45 ships pg, mysql, sqlite, singlestore and gel; drizzle-kit 0.31 generates for postgresql, mysql, sqlite, turso, singlestore and gel — so Sequelize is how henri reaches one, `@usehenri/mssql` is built on it, and neither is going anywhere. Everything an mssql store does differently from every other SQL store (no migrations, `sequelize.sync()` in development, nothing in production, `henri db:status` for the drift) follows from that one fact, and the documentation now says so rather than describing four equal SQL adapters.

- [#385](https://github.com/usehenri/henri/pull/385) [`89dda62`](https://github.com/usehenri/henri/commit/89dda62da456a0a55600e79cfb65ce89f11258e2) Thanks [@reel](https://github.com/reel)! - Encrypted attributes: a field that is ciphertext in the database and a plain
  string in the model.
  
  ```js
  schema: {
    ssn: { encrypted: true, type: 'string' },
    badge: { encrypted: { deterministic: true }, type: 'string', unique: true },
  }
  ```
  
  The three adapters honour it. `person.ssn` is the string it always was; the
  column holds `henri:v1:r:<key id>:<base64url>` — AES-256-GCM, with the model,
  the field and the scheme authenticated with the value, so a ciphertext only
  opens where it was written.
  
  The key is `config.encryption.keys`, never `config.secret`. Its home is the
  encrypted credentials of the environment (`henri credentials:edit`) or
  `HENRI_ENCRYPTION_KEYS`; `henri audit` reports a key found in a `config/*.json`
  and nothing henri prints ever holds key material — only the eight character key
  id.
  
  `encrypted: true` is randomised, so nothing can query it and henri refuses
  rather than matching nothing; `{ deterministic: true }` keeps an equality and a
  `unique`, and gives away which rows share a value. Only `string` and `text` may
  be encrypted, a `string` column becomes `text` (randomised) or `varchar(700)`
  (deterministic), and the fields henri itself queries — `email`, `password`,
  `roles` on the user model — cannot be marked.
  
  Rotation ships with it. `keys` is a list: every key decrypts, the first one
  encrypts, so adding one in front is a deploy. `henri encryption:status` counts
  what the columns hold by key id without opening a value, and
  `henri encryption:rotate` rewrites everything under the key that writes —
  soft-deleted rows included, `updatedAt` untouched, and never overwriting a value
  it could not read back. A backfill of a table that is already full is the same
  command, with `config.encryption.readPlaintext` on for the length of the
  migration.
  
  A value that will not decrypt throws, with a different code for a key that is
  missing, bytes that were changed and a column still in the clear;
  `henri.encryption.tolerate(fn)` is the one way past it, and it is what
  `henri privacy:export` and `henri privacy:erase` run inside so that a lost key
  costs a `null` and a line in the document rather than the whole request. A field
  marked `encrypted` is `personal` unless the model says otherwise, so it is
  masked in the logs, exported and erased.
  
  See the guide: https://usehenri.io/guides/encryption/

- [#340](https://github.com/usehenri/henri/pull/340) [`62fac46`](https://github.com/usehenri/henri/commit/62fac46fd6cae5581979b73daf99700fd246e0ea) Thanks [@reel](https://github.com/reel)! - Encrypted credentials, per environment: `henri credentials:edit`.
  
  `config/credentials/<env>.json.enc` holds the secrets of one environment and is committed with the application; the key that opens it never is. A deployment then carries one secret instead of twenty, and adding a secret to staging is a commit rather than a round of environment variables.
  
  - **JSON, not YAML.** henri's configuration is JSON, and the decrypted object is applied over it key by key, so both files are written the same way and henri needs no parser it does not already have.
  - **The key** is `HENRI_CREDENTIALS_KEY`, or `config/credentials/<env>.key` (64 hexadecimal characters); the variable wins. `henri new` ignores `config/credentials/*.key` from the first commit, `henri credentials:edit` adds the line when it generates a key, and `henri doctor` reports a key that is not ignored (`credentials.ignored`) or that reached the git index (`credentials.committed`). A file with no key stops the boot naming both the file and the variable — never a silent boot without secrets.
  - **AES-256-GCM**, from node's own crypto. The envelope is one line, `henri:v1:<iv>:<tag>:<ciphertext>`, and the environment name is authenticated with the content, so a modified file, a wrong key and a `production.json.enc` renamed to `staging.json.enc` all fail loudly instead of decrypting to nonsense. No message quotes the file, the key or a decrypted value, in a log line, an error or `--json`.
  - **Precedence**: over the configuration file, under the environment. Each leaf of the decrypted object replaces that one key, so `{ "mail": { "auth": { "pass": "x" } } }` leaves the rest of `mail` alone, and the values are read with `henri.config.get('mail.auth.pass')`. The boot prints the paths the credentials provided and where the key came from, never the values; `henri.config.fromCredentials` holds the same paths.
  
  `henri credentials:edit [--env <name>]` decrypts into a file only you can read (`0600`, in a directory `mkdtemp` creates), opens `EDITOR` or `VISUAL` on it, and encrypts what comes back. The plaintext is removed on every exit path: the editor closing, the editor failing, invalid JSON, and an interrupted process. The first edit of an environment writes the key, the ignore line and a fresh `secret`. `henri credentials:show` prints the decrypted credentials on stdout, and with `--json` the key paths only.

- [#370](https://github.com/usehenri/henri/pull/370) [`d9f3be4`](https://github.com/usehenri/henri/commit/d9f3be49c5929d929a220220bf6e72fdcb135595) Thanks [@reel](https://github.com/reel)! - Every failure henri raises now has a stable code.
  
  Rust prints `E0382`, TypeScript `TS2345`, Next.js a link to a page. henri had
  four names, all in the command line — `USAGE`, `FAILED`, `NOT_A_PROJECT`,
  `NEEDS_TTY` — and its runtime failures had none at all: a boot that stopped, a
  model that would not load, a store that refused a schema key, a view engine
  that was missing, all of them a message and nothing else. A message gets
  reworded; a code does not.
  
  Ninety-one of them, in one namespace across core, the adapters, the queue, the
  view engines, the command line and `henri mcp`:
  
  ```
  HENRI_MODEL_UNKNOWN_TYPE
  HENRI_BOOT_CIRCULAR_DEPENDENCY
  HENRI_STORE_URL_MISSING
  HENRI_VIEW_INERTIA_UNAVAILABLE
  ```
  
  `HENRI_` makes the whole code unique enough to search the web with, the area
  says which part of the framework raised it, and the reason reads without a
  lookup — the shape of node's own `ERR_*` codes, and of the four names the
  command line already had.
  
  The code reaches you wherever the failure does. In the boot log:
  
  ```
  view ✏  HENRI_VIEW_UNKNOWN_RENDERER => Unable to load 'reactt' renderer...
  ```
  
  In the error body of the JSON API, next to what it already answered with:
  
  ```json
  {
    "statusCode": 500,
    "error": "Internal Server Error",
    "code": "HENRI_STORE_NOT_STARTED",
    "message": "Internal Server Error"
  }
  ```
  
  In the terminal and in `--json`, where a boot failure now keeps the code of
  what actually went wrong instead of collapsing into `FAILED`:
  
  ```
  $ henri server
    henri server failed [HENRI_CONFIG_ENV_TYPE]: HENRI_CONFIG__port is not a number, and "port" is one in the configuration
  
  $ henri server --json
  {"error":{"code":"HENRI_CONFIG_ENV_TYPE","command":"server","exitCode":1,"hint":null,"message":"..."}}
  ```
  
  And in the answers of `henri mcp`, so an agent branches on the code rather
  than on the wording.
  
  The catalogue is `packages/core/error-codes.json`: one entry per code with
  what it means, what usually causes it and how to fix it, published as
  [the error code reference](https://usehenri.io/reference/errors/). It is data,
  and a test compares it with the source and with the page — every code raised
  has an entry, every entry is raised somewhere, no two mean the same thing.
  
  `config.errors.url` turns a code into a link. It is a template holding
  `{code}` (`"https://example.com/e/{code}"`), unset by default: henri ships no
  address, and nothing prints a link until you give it one.
  
  **Breaking**: the `code` of `henri <command> --json` now names the failure
  rather than the exit status. `USAGE` is `HENRI_CLI_USAGE`, `FAILED`
  `HENRI_CLI_FAILED`, `NOT_A_PROJECT` `HENRI_CLI_NOT_A_PROJECT`, `NEEDS_TTY`
  `HENRI_CLI_NEEDS_TTY`, `CONFIG_INVALID` `HENRI_CONFIG_INVALID`; a command may
  now answer something finer still. The `exitCode`, and the exit status itself,
  are unchanged: a script branching on `0`, `1`, `2`, `3` or `4` keeps working.
  The codes of `@usehenri/jobs` (`UNKNOWN_JOB`, `BAD_ARGUMENTS`, `TIMEOUT`, ...)
  and of `henri mcp` (`NO_SERVER`, `UNREACHABLE`, ...) moved into the same
  namespace for the same reason.

- [#414](https://github.com/usehenri/henri/pull/414) [`c44f025`](https://github.com/usehenri/henri/commit/c44f025acec3d5bbbb57e2310d02184a1053a10d) Thanks [@reel](https://github.com/reel)! - Failures say what to do next, not only what happened.
  
  Every failure henri raises on its own behalf already carried a code, and `error-codes.json` already held the best writing in the project: one entry per code with what it means, what usually causes it and **how to fix it**. That "how to fix it" reached a website page and nothing else. Meanwhile a good number of the messages a person actually reads — the boot log, the terminal, a JSON error body — said what happened and stopped.
  
  **The catalogue's fix is now the hint.** A coded failure that carries no hint of its own reaches the command line (`henri <command>`, and `--json`'s `hint`) and `henri mcp` with the catalogue's next step attached. One hundred and ninety-three instructions that used to live on a page a person had to find are now printed where the failure is.
  
  **The messages themselves name the next action.** A missing boot dependency says which module to register and where; a dependency above the boot ceiling says to lower the runlevel or run the whole application, and that `henri analyze` prints the levels; a cycle says to drop one declaration or turn a `needs` into an `after`. A module that is not shaped like one says what to write (`extend @usehenri/core/module`, `async init()`, a unique `name`). An unknown store adapter lists the adapters instead of "check your configuration file"; a model with no store names the file, the configuration key and the stores that do exist. A development `404` says `henri routes` prints the table. The model field errors of all three adapters name the model, and the incomplete ones show the field written correctly.
  
  **Seven request-time failures henri owns had no code at all**, so a client saw a status and a sentence and no stable name to look up:
  
  | Failure                                                   | Code                                |
  | --------------------------------------------------------- | ----------------------------------- |
  | A CSRF token that does not match                          | `HENRI_USER_CSRF_INVALID`           |
  | An unsafe request from an origin this application refuses | `HENRI_USER_CSRF_ORIGIN_REFUSED`    |
  | More requests than the rate limit allows                  | `HENRI_API_RATE_LIMITED`            |
  | An `Idempotency-Key` that is not shaped like one          | `HENRI_API_IDEMPOTENCY_KEY_INVALID` |
  | A key reused for a different request                      | `HENRI_API_IDEMPOTENCY_KEY_REUSED`  |
  | A key another request is still holding                    | `HENRI_API_IDEMPOTENCY_IN_PROGRESS` |
  | A guarded request the shared store could not count        | `HENRI_STORE_SHARED_UNAVAILABLE`    |
  
  Each one's message now names what to do about it, and `HENRI_POLICY_SCOPE_REQUIRED` is the eighth: `henri.policies.scope()` on a policy that declares none threw a bare `TypeError`. **A refused policy deliberately gets no code**: it answers 404 by default so it is not an oracle, and a distinct code in that body would be one.
  
  `henri.encryption.modelOf()` was raising `HENRI_ENCRYPTION_NO_KEY` for a model that is not loaded, which is neither what happened nor what to do; it raises `HENRI_ARGUMENT_UNKNOWN_TARGET`, the code whose entry already described exactly this. `config.shared`, `config.policies` and `config.cache` now raise `HENRI_CONFIG_INVALID` like `config.csrf` already did, rather than an uncoded `TypeError`.
  
  **And the instructions have to be true.** A "how to fix it" naming a command that does not exist sends a person down a path that ends nowhere — one entry named `henri credentials:init`, which henri has never had. `src/__tests__/error-codes.spec.js` now checks, for every entry: every `` `henri …` `` it prints is a real command, read from `packages/cli` itself (the `commands` of its package.json, the `COMMANDS` a group's script exports, the generators of `generate.js`) rather than from a copy; every configuration key it names is one `base/config-schema.js` declares, `stores.default.url` matching the record it is declared as; and every `fix` is present and says something the `what` did not.

- [#410](https://github.com/usehenri/henri/pull/410) [`67cfb20`](https://github.com/usehenri/henri/commit/67cfb200ea0e0b31bacf2af183db6467b0fa011d) Thanks [@reel](https://github.com/reel)! - **`decimal` and `bigint` are henri types.** The vocabulary had no exact
  number: a model asking for `DECIMAL` got a `double` and one asking for
  `BIGINT` got a 32-bit `integer`, so money was binary floating point on the
  default adapter and a large identifier was a column that refused every
  insert past 2,147,483,647.
  
  `decimal` takes a `precision` (total digits, 19 by default, 38 at most --
  what every dialect henri writes carries) and a `scale` (digits after the
  point, 4 by default). `bigint` is a signed 64-bit integer and takes
  neither. Per dialect: `numeric(p, s)`/`bigint` on PostgreSQL,
  `decimal(p, s)`/`bigint` on MySQL, `Decimal128`/BSON `BigInt` on MongoDB,
  `DECIMAL(p, s)`/`BIGINT` on SQL Server, and `text` on sqlite, which has
  neither an exact decimal nor a 64-bit integer better-sqlite3 hands back
  whole. The stored value is exact everywhere; on sqlite a comparison and an
  order go through a cast, `INTEGER` for a `bigint` (exact, sqlite carries
  64 bits) and `REAL` for a `decimal` -- the one approximation, and the guide
  says so.
  
  **A value of either type is an exact decimal string in JavaScript**, on all
  three adapters: `'19.99'`, `'9223372036854775807'`. Not a `number`, which
  is what the column choice exists to avoid; not a `BigInt`, which
  `JSON.stringify` throws on and henri serializes records in a dozen places;
  not an object, which needs a dependency and survives JSON no better.
  node-postgres, mysql2 and `Decimal128.toString()` already hand back
  strings, so it is the shortest path rather than a conversion. On the way in
  henri takes a string, a `number` (through its shortest round-tripping
  representation, so `19.99` is `'19.99'`) or a `BigInt`. The validators, the
  JSON serialization, the HAL payloads, the OpenAPI description (a `string`
  with a `pattern`, because a JSON number is a double), the GraphQL
  derivation (`String`, because a `Float` would undo it), the query compiler,
  the `params` declarations and the version diffs all agree on that.
  
  **A value the column would have changed is refused rather than rounded**:
  more decimal places than the scale, more digits than the precision, a
  `bigint` outside the 64-bit range, and a JavaScript number that is not a
  safe integer. `0.1 + 0.2` fails validation instead of landing in the
  column. henri does not round money.
  
  **The compatibility spellings point at the real types now.** In a drizzle
  model `DECIMAL`, `NUMERIC` and `BIGINT` resolve to the exact types instead
  of a double and a 32-bit integer; in a sequelize model
  `DataTypes.DECIMAL(10, 2)` is read as the henri decimal and gets the same
  string boundary. Two things are refused at boot instead of downgraded, both
  naming the model and the field (`HENRI_MODEL_TYPE_UNSUPPORTED`): either
  type on a sqlite store served by `@usehenri/sequelize`, whose driver reads
  both through a JavaScript number; and a bare `DataTypes.DECIMAL`, which
  MySQL makes `DECIMAL(10, 0)`.
  
  `henri generate model thing price:decimal` writes `precision: 12, scale: 2`,
  because the default is rarely what money wants.

- [#376](https://github.com/usehenri/henri/pull/376) [`e661f98`](https://github.com/usehenri/henri/commit/e661f98fe8f8acce15aa10ce2dc320c5a2cb006f) Thanks [@reel](https://github.com/reel)! - The public identifier goes all the way: a foreign key travels as one, and a
  primary key stops resolving
  
  1.2 gave every record an `externalId` and took its own primary key out of
  what leaves the server. Two holes were left, and both are closed here.
  
  **A foreign key is the `externalId` of the row it names.** A proposal that
  belongs to a speaker answered `speakerId: 4812` -- another row's sequential
  id -- so enumeration survived one relation away. `res.render()`,
  `res.resource()` and `res.collection()` now replace every _declared_ foreign
  key on the way out, and a key that names no row is `null`, never the number.
  henri reads what the model said (`belongsTo()`, `references: { model }`,
  Mongoose's `ref`) and never a field name; a Mongoose `refPath`, a `ref` given
  as a function and a column that points at a row without saying so are left
  alone, and the guide says so. The cost is bounded: one call covers a whole
  answer, an eager-loaded association is used when its primary key matches the
  key it is standing in for, and the rest is one statement per target model
  rather than one per record.
  
  **`Model.findById()` takes the public identifier and nothing else.**
  `GET /tasks/4812` used to answer next to the uuid, so guessing a number still
  worked and the uuid bought nothing. A primary key now gets the same `null` an
  unknown uuid gets -- the controller answers its own 404, and nothing in the
  answer says which of the two it was. `findByIdAndUpdate()` and
  `findByIdAndDelete()` refuse the same values.
  
  **`findByKey()` is the new lookup for a primary key**, on all three adapters,
  for the server-side code that legitimately holds one; `findByExternalId()` is
  the explicit other half. `findByPk()` is an alias of `findByKey()` on the
  Sequelize adapters and on Drizzle, and no longer accepts a uuid. It fails
  closed: a value the key column cannot hold answers `null` instead of a
  database error. henri's own session and token lookups take either identifier,
  so signing in and staying signed in are unaffected.
  
  **`henri.model.publish()`** is the same gate, exposed: a controller that
  presents its records hands `res.resource()` a plain object, and a plain
  object carries no model, so publish first and present second.
  
  `config.externalIds` (`lookup`, `references`) restores either behaviour for
  an application that cannot move yet, and `henri audit` reports both
  (`externalIds.lookup-any`, `externalIds.references-disabled`, ASVS V4.2.1).
  A model with `options: { externalId: false }` is unaffected by any of it, and
  so is a foreign key pointing at one.
  
  Upgrading: change `Model.findById(record.id)` to `Model.findByKey(record.id)`
  wherever the value came from the database. `Model.findById(req.params.id)`
  needs no change -- that is the case this is for.

- [#402](https://github.com/usehenri/henri/pull/402) [`e1f68c5`](https://github.com/usehenri/henri/commit/e1f68c5add471c8129e7131dce93310cda907533) Thanks [@reel](https://github.com/reel)! - `AGENTS.md` is generated from the application, not templated.
  
  The file a coding agent reads before it writes anything used to be a Handlebars template with a renderer conditional and a store conditional, which had two problems that got worse with every release. A template cannot leave out what an application does not use, so a Drizzle application carried Mongoose sentences and an application with no queue carried the queue's — and the file was at its size budget, with every new feature fighting for lines in it. And it described the application `henri new` made rather than the one in front of the agent, so it went stale the first time somebody swapped a store, changed renderer or installed a package. That is why `agents.stale` had to exist at all.
  
  `henri generate agents` now reads the application and writes what is true of it:
  
  ```bash
  henri generate agents          # write or refresh AGENTS.md, CLAUDE.md and .mcp.json
  henri generate agents --json   # { created, updated, skipped } like any generator
  ```
  
  The renderer and its page extension, the stores and their adapters, the models and the marks they carry (`personal`, `encrypted`, `paranoid`, a `retention` rule), the routes as the router really expands them, the controllers, the policies, the jobs, the mailers, the workers, the modules and which henri packages are installed. Nothing is booted: the readers are the ones `henri doctor` already had (`exportsOf`, `listModules`, `storeOf`, `mailerActions`) plus `base/routes.js`'s own expansion, so there is no second opinion about what an application is. An application without `@usehenri/jobs` gets no paragraph about the queue and no `henri jobs` row in its command table; a Drizzle application gets the Drizzle model API and the migration commands and no sentence about Mongoose; a model marked `personal` is what puts `henri privacy:export` in the table. The last line of the "Do not" section names the packages the application does _not_ have, which is the line that stops an agent reaching for an API that is not installed.
  
  **Regenerating cannot lose what you wrote.** Everything henri writes sits between two markers, and the rest of the file is copied through byte for byte:
  
  ```markdown
  <!-- henri:agents 1 app=045d7a7b2a0f gen=42e21bae9532 -->
  
  # app: conventions for coding agents
  
  ...
  
  <!-- /henri:agents -->
  
  ## House rules
  
  Always run `make check` before a commit.
  ```
  
  The opening marker carries two short digests, each doing one job: `app` is what the application was when the file was written, and `gen` is what henri wrote in the region. So the command can tell its own text from a hand edit, and in three of the four cases it writes nothing you did not ask for — a missing file is written whole, an untouched region is rewritten in place, a region somebody edited by hand is left alone with the reason, and a file carrying no region at all is somebody's own `AGENTS.md` and is left alone too. `--force` is the only way past either refusal, which makes the failure mode "your text is kept" rather than "your text was kept unless".
  
  **`henri new` writes the file through the same call**, after the configuration, the models, the routes and the sample resource are on disk, and the directory is the only argument either path takes — so a scaffolded `AGENTS.md` and a regenerated one are the same bytes, and a test says so.
  
  **Size is the constraint that makes it good.** The generated region is budgeted at 150 lines and a fresh application lands around a hundred, down from a template that was pressing 170 with every tranche fighting for room. A line earns its place by being a convention that changes what an agent writes here, a fact about this application it cannot get from the documentation, or a command that will actually run here. What went out was manual: the MCP tool inventory (the server advertises its own tools), the exit-code table, the full `res.boom` list, the Tailwind explanation and the setup instructions for features an application does not have yet. That is the division of labour between the three pieces — `AGENTS.md` is the always-loaded part, `henri mcp` is the part fetched on demand (`guide` serves henri's documentation at the version installed, `routes`, `models` and `config` answer for the application), and `henri doctor` checks the claims.
  
  `agents.stale` got sharper with it: a file henri wrote is compared on that `app` digest, so a model added or a package installed is drift too, not only a switched renderer or store. A file written by hand is still compared on the renderer and the store its own sentence names.
  
  The guide is [Coding agents](https://usehenri.io/guides/agents/#agentsmd-is-generated).

- [#373](https://github.com/usehenri/henri/pull/373) [`2c8a826`](https://github.com/usehenri/henri/commit/2c8a8265262dbf6ea5c3e73e8e7892a230d4d0f0) Thanks [@reel](https://github.com/reel)! - `config.shared`: one backend for the counters that only worked with one process
  
  The rate limit, the sign-in lockout and the idempotency keys each keep a
  number per key, and all three were kept in the process's memory unless the
  application named a store in three separate configuration keys. Two processes
  therefore meant two sets of counters: a rate limit that is twice what it says,
  a lockout an attacker escapes by being routed elsewhere, and an idempotency
  key that stops being idempotent.
  
  `config.shared` is the one place to say where they live instead:
  
  ```json
  {
    "shared": {
      "adapter": "redis",
      "url": "redis://127.0.0.1:6379",
      "prefix": "lineup:",
      "onError": "closed"
    }
  }
  ```
  
  `@usehenri/redis` is the backend, a package an application installs
  (`pnpm add @usehenri/redis`), resolved from the application the way a store
  adapter is; nothing is added to an application that does not name it. It talks
  to Redis through node-redis and counts the rate limits with `rate-limit-redis`.
  `rateLimit.store`, `user.lockout.store` and `api.idempotency.store` keep
  working and still win, key by key.
  
  When the backend does not answer, `shared.onError` decides: `closed` (the
  default) refuses the request with a `503` and a `Retry-After`, `open` serves it
  uncounted; either is logged, at most once every ten seconds per counter. The
  idempotency keys are always closed, whatever `onError` says. A backend that is
  unreachable at boot does not fail the boot: the client keeps reconnecting and
  `GET /readyz` reports it (`"shared": { "ok": false }`), so the process leaves
  the load balancer instead of the fleet.
  
  The boot says which it is on every application -- `counted in redis (fail
  closed)` or `counted in this process` -- and warns outright when the
  environment says this process is one of several (a cluster worker, a numbered
  pm2 instance, `WEB_CONCURRENCY`, a Heroku dyno past the first) and no shared
  backend is configured. `henri doctor` reports a shared store that does not
  answer (`shared.unreachable`) and asks for the adapter package when the
  configuration names one; `--no-reach` skips the connection.
  
  Sessions are not part of this: they already go through the database adapter,
  which every process shares.

- [#409](https://github.com/usehenri/henri/pull/409) [`46d5dbc`](https://github.com/usehenri/henri/commit/46d5dbcc983c03e96ae5a87d7288c5d8a5adbc24) Thanks [@reel](https://github.com/reel)! - Internationalization, out of the box: `henri.i18n`.
  
  An application that needs a second language today writes its own lookup, its own locale detection and its own fallbacks — badly, and differently in the controllers, the views and the mails. henri now owns all three: `config/locales/<locale>.json` (or `<locale>/<namespace>.json`) is read at boot, `req.t()`/`henri.i18n.t()` is the lookup, `{{t}}` is the Handlebars helper, `useTranslation()` is the Inertia and React hook, and a mail carries its own locale.
  
  **An application with one language pays 5 µs at boot and nothing per request.** With no `config/locales` directory and no `i18n` block the module is inert: no catalogue is held, no middleware is mounted — not one that returns early, one that is not in the stack — `req.locale` and `req.t` are not set, `res.render()` carries no `i18n` key, nothing reaches the client and the boot prints no line. That is the call log's rule, and most applications have one language.
  
  **The locale of a request is decided in one order, and the decision is visible.** An explicit `req.setLocale()`, then the column `i18n.from.user` names on the signed-in user, then `?locale=`, then a cookie henri **reads and never writes**, then `Accept-Language` negotiated by q value, then the default. What answered is on the request as `req.localeSource`, on the wire as `Content-Language`, and in the view options. The path prefix is deliberately not on that list: `/fr/notes` is a routing decision, and stripping a prefix at the edge would make `notes_path()` lie to every page that prints it — the guide shows the two-line `namespace` instead.
  
  **A key nobody translated answers the key, never a sentence guessed from it.** A humanized key reads like a translation, ships like one and is invisible in a review, which is how an application ends up half translated. `i18n.missing` adds a warning (the default outside production), silence, or `HENRI_LOCALE_TRANSLATION_MISSING` — the mode a test suite sets, and the only one that fails a build. Every mode records the key in `henri.i18n.missing()`, and `henri doctor` compares the files on disk: `i18n.incomplete`, `i18n.orphan`, and `i18n.placeholders` for a key whose `{name}` values differ between locales, which is what prints a literal `{count}` on somebody's page.
  
  **A translation is never escaped and its values always are, at the boundary that renders them.** `t()` answers a plain string, because a controller putting one in a JSON body would otherwise ship `&amp;` to a client that is not a browser. The Handlebars helper escapes the values and returns a `SafeString`, which is what lets a translation carry `<strong>` while a name carries nothing; the plain part of a mail escapes nothing, because `text/plain` has no markup; and React escapes its own children, so a translation carrying markup shows as text there. That last difference is real and the guide states it rather than papering over it.
  
  **The catalogue reaches the browser once per document, not once per visit.** An Inertia visit and a client-side navigation carry `{ locale, source, url }` and no strings — the browser asking for one loaded a document to get here — and the url carries the digest of the catalogue in its file name, so a language change mid-session is one immutable, forever-cacheable request. `i18n.client` takes `always` and `false` for the other two trades.
  
  **The locale of a mail is the recipient's, and it is never the request's.** An administrator acting on somebody else's account, a nightly digest and a job retrying an hour later all produce a mail whose reader is not whoever made the request, and two of those have no request at all. A message says `locale`, or names the recipient with `for` and henri reads `i18n.from.user` off the record — which is what makes a mail from a job right. `deliverLater()` renders before it enqueues, so a worker needs no catalogue.
  
  **Dates, numbers and currency stay `Intl`'s**, and so do the plural rules: `Intl.PluralRules` knows more locales than any hand-written rule, and an exact `"=0"` form wins over its category. The two Handlebars helpers `{{number}}` and `{{date}}` exist only because a template cannot call a function with named arguments; their hash is the `Intl` options object, unchanged. Model attribute names and validation messages are not translated either — `henri.model.errors()` composes with `t(key, values, { default })` in one line, and the guide shows it.

- [#413](https://github.com/usehenri/henri/pull/413) [`ba97ea9`](https://github.com/usehenri/henri/commit/ba97ea968f0b34cd67b7a3e803ecd34543b8aaaf) Thanks [@reel](https://github.com/reel)! - Signing in with somebody else's identity provider, and the merge rule that decides who ends up owning the account.
  
  `omniauth` is the second biggest thing in Rails authentication and nothing has replaced it, but the strategy was never the work: passport has one for every provider. The work is the part a framework alone can do — an identity table beside the user model, a callback that lives inside the CSRF, session and lockout machinery henri already owns, and a rule for what happens when a provider hands over an address that already belongs to somebody here. That last one is what applications get wrong, and getting it wrong hands a password account to whoever can obtain an ID token for its address.
  
  ```json
  {
    "user": {
      "identities": {
        "providers": {
          "acme": {
            "authorizationUrl": "https://acme.example/oauth/authorize",
            "tokenUrl": "https://acme.example/oauth/token",
            "userinfoUrl": "https://acme.example/oauth/userinfo",
            "clientId": "...",
            "clientSecret": "...",
            "scope": ["openid", "email"]
          }
        }
      }
    }
  }
  ```
  
  henri ships **no provider list and no provider secrets**. There is no `github` in the source and nothing to fill in for one: an application names its providers, and the client secret belongs in the encrypted credentials (`henri credentials:edit`) or in the environment — `henri audit` reports one written in a `config/*.json` the way it already reports an encryption key there.
  
  **The merge rule refuses.** A callback whose verified address already belongs to an account answers `exists`, opens no session, writes nothing, and tells the person to sign in the way they already do and then link the provider from their account. Linking automatically on `email_verified` is the wrong answer three times over: it lets a stranger change which credentials open an account, it collapses that account's security to the weakest provider it can be linked from, and `email_verified` is a provider's belief about a mailbox rather than a statement about who owns an account in your database — and half the providers do not send it at all, so reading "absent" as "verified" builds the takeover by accident. The third possibility, _link only when the session already belongs to that user_, is right and is not a setting because it is the **flow**: a callback started from a signed-in session is a link, always, and it is the only automatic link henri makes. `merge: "verified"` exists for the single-tenant application whose provider is its own corporate identity provider; it needs that provider marked `trusted`, and `henri audit` reports the pair.
  
  **An address the provider did not verify decides nothing.** It is never matched against an account and never creates one, and the refusal is written **before the user table is read**, so an address that has an account and one that has none are the same answer at the same price — the property the account flows already keep. A person who is already linked signs in whatever the address says, because the credential is the subject the provider issues and never the address, which is also why two providers claiming one address are two rows rather than a merge.
  
  The endpoints go inside the machinery rather than beside it. `POST /auth/:provider` leaves through the double-submit CSRF token and the origin check, which this one route asks for itself even when the visitor holds no session cookie — the middleware waives the check there, because there is normally no session for a third-party page to ride on, and a visitor about to sign in is exactly the person who has none (`GET` answers `405`, so a third-party page cannot start an authentication in a visitor's browser); `GET /auth/:provider/callback` comes back to a `state` minted per attempt, kept in the session, single use and expiring, with PKCE S256 whose verifier never leaves the server; the session identifier is new before the person is in it; and the per-account lockout of `POST /login` is checked and cleared here too, so a provider is not a way around it — but a failed callback is never _counted_, because there is nothing to guess at a callback and counting would only hand somebody a way to lock an address out. `POST /auth/:provider/unlink` refuses to take away the last way into an account.
  
  `henri_identities` is a table henri owns the way the queue and the access trail own theirs — raw SQL through the adapter or a MongoDB collection, never a model — because **a row is a credential**: whoever can write one can sign in as whoever it points at, and a model would put `provider` and `subject` behind an application's own mass assignment, scaffold and routes. A row records what it is allowed to imply (`signin`, or `verify` for a provider that identifies a person and never opens a session on its own) and how it came to be (`signup`, `session` or `verified`), and both are read from the row rather than from the configuration, so changing a provider never promotes what was linked under the old rule. `henri privacy:export` lists a person's providers without the subject, and `henri privacy:erase` deletes the rows rather than anonymizing them, because an anonymized credential still opens the account.
  
  henri never parses an `id_token`: the profile is what `userinfoUrl` answers to a request henri makes with the access token, which is the same claims over a channel that is already authenticated and none of the JWKS, key rotation and algorithm confusion. And henri is a client, never an OAuth _provider_ — that is a different product.
  
  `henri generate authentication` writes the sign-in buttons and an account page for linking and unlinking, both rendered from whatever the configuration names, so an application with no provider gets no button and a sentence saying where a provider goes.

- [#349](https://github.com/usehenri/henri/pull/349) [`0fe4c89`](https://github.com/usehenri/henri/commit/0fe4c898862feed6338e8da101d84b9ea2463ce9) Thanks [@reel](https://github.com/reel)! - `henri new` scaffolds an Inertia application. The default renderer is now `inertia`.
  
  A new application gets `"renderer": "inertia"` in `config/default.json`, `.jsx` pages under `app/views/pages` and a Vite build. `henri new --renderer react` still scaffolds the Next.js application, and that engine is supported: it is frozen on the pages router rather than removed, because the contract that hands a controller's data to a page (`withHenri` reading `req._henri` on the server) has no equivalent in the app router. Both renderers now get the same sample: `henri new` scaffolds the `Task` resource with the generators on either one, so the Inertia template no longer ships a hand-written sample page of its own.
  
  `henri generate scaffold` and `henri generate crud` follow the `renderer` of the application, read back from its configuration. An Inertia application gets `.jsx` pages using `useHenri()`, `<Form>` and `router`; a React one keeps getting `.js` pages using `withHenri` and `@usehenri/react/forms`. The renderer is also what a failed write answers a browser with: the Inertia controllers call `res.inertia.errors()` and render the form page again, the React ones answer the `422` their forms read, and API clients get the same `422` from both. `henri generate test` writes the Inertia page object assertions next to the HAL ones in an Inertia application.
  
  Nothing changes for an existing application: its `renderer` key is what the boot and the generators read, and there is no migration.

- [#357](https://github.com/usehenri/henri/pull/357) [`5ccd537`](https://github.com/usehenri/henri/commit/5ccd537b3621b54d11e7f24ccca39643ae7d5cf7) Thanks [@reel](https://github.com/reel)! - `@usehenri/jobs` registers itself
  
  The queue was already a package, but `@usehenri/core` carried the module that
  loaded it: an application without `@usehenri/jobs` still had a `henri.jobs`,
  an inert object whose every method explained what to install. The package
  ships the henri module itself now (`"henri": { "module": "./module.js" }`),
  the way `@usehenri/graphql` does, so depending on it is what puts
  `henri.jobs` in the boot -- at level 4, so `henri jobs` still binds no port.
  
  An application that uses jobs needs `@usehenri/jobs` in its `package.json`,
  which it almost certainly already has -- nothing worked without it. `henri
  doctor` reports it as a missing dependency as soon as `app/jobs` holds a file
  or the configuration has a `jobs` block, and `henri jobs` says the same.
  Nothing else changes: the queue, the runner, the retries, the dead letter
  queue, the recurring schedules, the tables and every `henri jobs` command are
  untouched, and installing the package is still not the same as using it -- an
  application with neither `app/jobs` nor a `jobs` block creates no table.
  
  An application that does not use jobs has nothing to install and hears
  nothing at boot. `henri.jobs` is `undefined` rather than an object that does
  nothing, which the type declarations say too, so code reading it guards with
  `henri.jobs &&`. The one thing that now speaks up is a mail that cannot be
  delivered when it was asked to be: `deliverLater({ wait })` or
  `deliverLater({ at })` without a queue fails with the install line instead of
  sending the message immediately. `deliverLater()` with nothing to honour is
  unchanged -- it delivers out of band, silently.
  
  `henri new` does not add the dependency: the scaffold's `app/jobs` is empty,
  so the module would be inert in every application that never writes a job.

- [#371](https://github.com/usehenri/henri/pull/371) [`9895cbf`](https://github.com/usehenri/henri/commit/9895cbf4be85b476e341a5be915e3049e5a027de) Thanks [@reel](https://github.com/reel)! - Policies: authorization that can see the record.
  
  `roles` on a route answers "may this kind of person reach this endpoint". It
  cannot answer "may this person read _this_ proposal", which is the question
  every application actually has and the one broken access control keeps winning
  on. henri now has an answer: `app/policies/<model>.js`, one function per
  action, taking the user and the record.
  
  - **One way to ask**, everywhere the answer is needed:
    `henri.can(user, 'update', proposal)`, the request-scoped `req.can()`, and
    `req.authorize()`, which resolves with the record and refuses when the policy
    says no.
  - **It fails closed.** A model with no policy, an action with no rule and a
    rule that throws all mean no, and only the boolean `true` allows -- a truthy
    string is not a yes. There is no setting that turns any of that into one.
  - **`policy` on a route** registers a guard beside the role guard rather than
    instead of it. It answers the actions that need no record before the action
    runs; `res.resource()` enforces the rest, and `config.policies.verify`
    reports an action that answered without ever asking.
  - **`_links` and `paths` lose what the policy refuses**, the way they already
    lose what a role refuses. A page that cannot link where its reader may not go
    is what stops the leak. `res.resource()` and `res.collection()` take a
    `subject` for controllers that answer with a presentation of the record.
  - **A refusal answers 404** by default, so it says nothing about whether the
    record exists; `config.policies.status: 403` and a per-call `{ status }`
    override it. An anonymous visitor gets a 401 and, in a browser, the login
    page.
  - **Scoping is the other half**: `scope(user)` on a policy says what a list is
    filtered by, and `req.scope('proposal')` hands the value to your ORM. henri
    never looks inside it, and a policy without one throws rather than quietly
    meaning "everything".
  - `henri generate policy Proposal speakerId` writes the policy and its test,
    `henri destroy policy Proposal` removes them, and `henri audit` reports a
    policy that nothing asks (`policies.unenforced`, ASVS V4.2.1).
  
  See the new [Policies](https://usehenri.io/guides/policies/) guide.

- [#356](https://github.com/usehenri/henri/pull/356) [`5a150d5`](https://github.com/usehenri/henri/commit/5a150d576208571c32b9cd12827d035e31ed4313) Thanks [@reel](https://github.com/reel)! - Answer liveness and readiness separately, and drain the requests in flight on `SIGTERM`.
  
  **Two probes, not one.** `GET /livez` says the process is running and answering; it never touches a store, because a database outage must not restart a process that is otherwise healthy — the restart fixes nothing and the loop drops every request the container was serving. `GET /readyz` says it can serve traffic: the stores answered, the boot is finished and no shutdown has started; anything else is a `503` with a `reason` (`starting`, `shutting down`, `a store did not answer`). `GET /healthz` and `GET /_henri/health` answer readiness beside them, the first for a proxy that only knows that name and the second so a deployment already pointing at it keeps working. All four are unauthenticated and run before the session and the limiters, as the health check always did.
  
  `/healthz` is the ambiguous one, and worth one line: the name says "health" without saying which of the two questions it answers, so one deployment wires it to liveness and the next to readiness. henri answers readiness there, which is what `/_henri/health` has always done and the safer of the two guesses — a readiness answer read as liveness restarts a container whose database is down. Point a liveness probe at `/livez`.
  
  **A store failure no longer echoes the driver.** The body says `"error": "timeout"` or `"error": "unreachable"` instead of the message the driver raised, which carries the connection string — with its user and sometimes its password — and was in the body of every non-production answer. The message is still logged.
  
  **`SIGINT` and `SIGTERM` drain.** They used to stop the modules straight away, which cut whatever was being served: a rolling deploy could answer half a request. Now readiness turns `503` while the port is still open, so a load balancer that polls has a chance to stop sending; `config.shutdown.delay` (`0`) keeps serving that long; the listener closes and the idle keep-alive sockets are hung up, which is what would otherwise hold the close open for their whole idle timeout; the requests in flight run to their end within `config.shutdown.drain` (10 seconds) before their sockets are destroyed, with a line in the log saying how many; and only then does `henri.stop()` walk the modules backwards. Keep `delay + drain` under your platform's termination grace period.
  
  `config.shutdown.signals: false` leaves the signals to an application that wants to own them, which then calls `henri.server.shutdown('SIGTERM')` itself. A `henri jobs` runner never starts the server and keeps draining its own way: it stops claiming, finishes the jobs it holds and writes their outcomes.

- [#337](https://github.com/usehenri/henri/pull/337) [`a1c6769`](https://github.com/usehenri/henri/commit/a1c6769099e3dc28b22b5338a2a57b13bdf69f7a) Thanks [@reel](https://github.com/reel)! - Mailers with views, layouts and previews.
  
  - **`app/mailers`.** A mailer is a file whose exported functions are actions
    returning the message they want sent (`to`, `subject`, the `data` its view
    needs); `defaults` applies to every message of the mailer and `previews`
    holds the sample data. They are loaded like controllers, reload with the
    application, and are reachable as `henri.mailers.<name>.<action>(...)`,
    `henri.mailers.message(name, action, args)` and
    `henri.mailers.deliver(name, action, ...args)`. A message answers
    `render()`, `deliver()` and `deliverLater()`.
  - **`app/views/mailers`.** Mail views are rendered by henri's Handlebars
    environment — the one every application has whatever its `renderer`, with
    the application's partials — unless the view engine implements
    `renderMail({ view, layout, data, meta })`, which is asked first.
    `app/views/mailers/layouts/mailer.hbs` wraps every message around
    `{{{body}}}`; `config.mailers.layout`, a mailer's `defaults.layout` and an
    action's `layout` pick another one, and `layout: false` renders the view
    alone.
  - **A plain text part on every message.** It is derived from the rich part
    (blocks become blank lines, list items get a dash, links keep their target,
    entities are decoded) so the two never drift apart; a `<action>.text.hbs`
    next to the view wins when the plain part deserves its own wording, and a
    `text` set by the action wins over both.
  - **Previews.** `/_mailers` lists the mailers and renders one with its sample
    data without delivering anything (`?part=html|text|json`). Like `/_routes`
    and `/_controllers` it exists only in development and only answers requests
    from the machine running the server; `config.mailers.previews: false` turns
    it off and nothing turns it on elsewhere.
  - **Delivering later.** `deliverLater()` renders the message and hands the
    plain, serializable nodemailer payload to the handler registered with
    `henri.mailers.onDeliverLater(fn)`, so a queue only has to call
    `henri.mail.send(message)` on the other side. Without a handler henri sends
    it out of band and logs failures; `henri.mailers.drain()` (and
    `henri.stop()`) waits for the deliveries in flight. It is not a queue.
  - **New configuration key** `mailers`: `from`, `layout` and `previews`.
  - `henri generate mailer <name> [action ...]` writes the mailer, a view per
    action and the layouts; `henri destroy mailer <name>` removes the mailer and
    its views. Both are exposed by `henri mcp`.
  - `henri.mail.send()` is unchanged.

- [#375](https://github.com/usehenri/henri/pull/375) [`dd2731d`](https://github.com/usehenri/henri/commit/dd2731d6a20fd96aa1be1aeb5e6ec0155001326b) Thanks [@reel](https://github.com/reel)! - Personal data: mark a field in the model, and henri does the rest
  
  A model now says which of its fields are about a person, in the schema, next
  to the type: `name: { personal: true, type: 'string' }`. Four things follow
  from the mark.
  
  - **The logs.** Every personal field name is masked in what `pen` prints and
    in the errors and log lines `henri mcp` records — matched exactly, next to
    the substring filters of `config.filterParameters`. **The email address of
    the user model is personal, so it is masked from now on**, in every log line
    of every application.
  - **What leaves the server.** `personal: { expose: false }` drops a field from
    every answer henri builds — `res.render()`, `res.resource()`,
    `res.collection()` and the public user — everywhere, at every depth. Nothing
    else changes: a field marked `personal: true` is sent exactly as it was
    before, because dropping `email` by default would break every application.
    `res.render(view, { data, include: ['phone'] })` is how the person's own
    page gets one back, and `config.privacy.expose: false` flips the default for
    applications that want the strict reading.
  - **`henri privacy:export <who>`** hands a person everything the application
    holds about them: their own record and every record of every model linked to
    them, soft-deleted rows included.
  - **`henri privacy:erase <who>`** removes them. A soft delete is never an
    erasure and a soft-deleted row is erased like any other; the records that
    reference the person survive while the person is anonymized in place
    (`options: { personal: { onErase: 'anonymize' | 'delete' | 'orphan' |
  'retain' } }`); the plan is refused before anything is written when it cannot
    be carried out; and every erasure leaves a receipt naming what it touched,
    with an HMAC of the identity rather than the identity.
  
  `henri privacy` prints the map the way `henri routes` prints the routes,
  `henri.privacy` is the same thing from the application (a "download my data"
  and a "delete my account" button are three lines), `henri audit` reports a
  field that is plainly about a person and carries no mark
  (`privacy.unmarked`, ASVS V8.3.4), and `config.privacy` holds `expose`,
  `onErase` and `receipts`.
  
  The three adapters accept the key and keep it out of the column, so a marked
  model generates exactly the schema it did before.

- [#406](https://github.com/usehenri/henri/pull/406) [`b7038ce`](https://github.com/usehenri/henri/commit/b7038ceaa430f4a0b9eaf7e983fc2844421bf636) Thanks [@reel](https://github.com/reel)! - Model versions: the history of a record, kept row by row.
  
  A model asks, and nothing else changes:
  
  ```js
  options: {
    versioned: true;
  }
  ```
  
  From then on every create, update and delete of that model writes one row into a table henri owns (`henri_versions`): when, the model, the record's **`externalId`** — never its primary key — the event, the attributes that moved as old to new, the actor and the request id.
  
  ```
  $ henri versions Article
  
    2026-03-04T10:12:44.918Z  update   Article 018f2a41-…-7000-…
      01a077c7-…  actor 018f0a11-…  request 4f2c…
      title: The old headline -> The new headline
      published: false -> true
  ```
  
  **Off costs nothing, and off is the default.** No model saying `versioned` means no table created, no hook registered on any model, no middleware mounted and no boot line — the same bargain the call log makes. `config.versions` says only where the table lives and how long a row is kept; it turns nothing on.
  
  **This is not the access trail, and the difference is the point.** The trail records field _names_, counts and digests and **refuses a value**. A version exists to hold the values: without the old value there is no reconstructing the record, and without that this would be a worse trail. The trail answers _who saw this record_, the call log answers _what did this request do_, and a version answers _what did this record used to say_. None of the three substitutes for another.
  
  **What a row holds per event** follows one rule. A `create` holds every stored field as `[null, value]` — the new side already _is_ the record. An `update` holds the fields that moved, and **a soft delete is one of these**: the row is still in the table with `deletedAt` set, so the diff describes it exactly. Only a `destroy` — the row leaving the database — carries a `snapshot`, and that is the whole reason snapshots exist: a diff describes a change _to something_, and after a real delete there is no something left to fold back from.
  
  **The actor and the request id are the join, and nothing carries them.** `base/request-id.js` already keeps the request id in an `AsyncLocalStorage`, and the module puts the signed-in person on the same store, so `record.save()` four calls deep in a service is recorded against whoever is signed in. Outside a request henri says so rather than guessing — `actor` is null, `source` is `system` — and `henri.versions.acting({ actor, source }, fn)` is how a job, a console session or a seed says better.
  
  **It holds values, so it inherits the privacy machinery rather than sidestepping it.** In order: a field the model left out (`only` / `except`) is not stored and not named; **`password` is never stored** on any model, whatever `filterParameters` says; a field marked `encrypted` is stored as its **envelope**, written with the field's own context so it opens where the row's does, and never as its plaintext; and a name `filterParameters` matches is not stored. A change with no values is `null` rather than a masked string, because a mask is a value a restore would write into the column.
  
  A field marked `personal` **is** stored, and the guide argues it: dropping it would empty the history of exactly the models worth versioning — who changed this person's address, and to what. What makes that safe is that the rows are reachable. `henri privacy:erase` reaches them (`versions.onErase`: `follow` takes the versions of a deleted record away and empties the erased values out of the versions of a record that survives; `delete` takes them all; `retain` leaves them and says so in the receipt, and in every case the person stops being an actor), `henri privacy:export` hands a person the history held about them, and the retention sweep prunes them (`versions.keep`).
  
  **`reify` reads and `restore` writes**, which is the difference between them. `reify()` answers the record as it was immediately after a version, touching nothing, by folding **backwards** from the live record — backwards because the live row is the one thing certainly complete, and folding forwards from the create would answer a record that never existed the first time a version was pruned. It may be partial and says so. `restore()` puts that back — an update on a record that still exists, an insert under the same `externalId` on one that was destroyed, so every link that named it still does — and **refuses an inexact reconstruction** (`HENRI_VERSION_INCOMPLETE`) unless forced, because a read that is missing a field lets you see the gap and a write that is missing one would silently change the record.
  
  **A mass write on a versioned model is refused** (`HENRI_VERSION_MASS_WRITE`). `Model.update(where, attrs)` runs the hooks once and without instances, so recording nothing for a hundred changed rows would make the history lie, and a history that silently misses changes reads as evidence and is not. Recording one entry per row was the other option and it was declined twice over: it turns an update into a full read of every matching row, and the read and the update are not one statement, so a row that changed in between would be recorded with a diff that never happened. The refusal names the loop that replaces it, `{ versions: false }` is the way through and is a decision rather than a silence, and Sequelize's `{ individualHooks: true }` is honoured as its own answer. A mass **create** is never refused: it has no before state, so nothing is lost.
  
  `henri versions`, `henri versions:show` and `henri versions:restore` read it back with `--json` like everything else, the codes are the `version` area of the catalogue, and the guide is [Model versions](https://usehenri.io/guides/versions/).

- [#344](https://github.com/usehenri/henri/pull/344) [`1ea0f85`](https://github.com/usehenri/henri/commit/1ea0f85066b86fba31f58937cc10abb6359e6a26) Thanks [@reel](https://github.com/reel)! - Modules order themselves by name, and the boot is introspectable
  
  henri booted like SysV init: eight fixed run levels, every module hardcoding a number, each level starting together and waiting for the whole of the previous one. A module now says where it goes and henri computes the order.
  
  - **`needs`** names the modules it cannot work without: they must be registered, and they finish before it starts. **`after`** and **`before`** order it without requiring anything, which is the half a dependency cannot express — `before: ['router']` is how a module registers a middleware in time. Everything the graph does not separate starts at the same time.
  - **`runlevel` keeps working**, as a supported way to pin and not a shim: a module that names nothing is ordered by its number alone, after every module of a lower level and before every module of a higher one, exactly as before. The number also stays the module's slot, which is what `new Henri({ runlevel })` and other people's numeric pins are measured against.
  - **The graph is built before anything starts.** A name nobody provides, a dependency the boot ceiling left out, or a cycle fails the boot with the modules named, the loaded modules listed and a suggestion for a typo. A boot that fails halfway names the module that threw, what was still running and what never started.
  - **An application can finally ship a module** (issue [#54](https://github.com/usehenri/henri/issues/54), open since 2018). Nothing scanned an application for modules and the command line loaded none, so the documented `henri.modules.add()` meant abandoning `henri server` and booting core yourself. henri now reads three sources before the boot: `app/modules/*.js`, loaded the way `app/models` is (a module that does not name itself takes the name of its file); the packages the application depends on that declare `"henri": { "module": "./module.js" }` in their own package.json, so somebody can publish one and somebody else use it by installing it; and `config/modules.js` for anything else, listing module instances, module classes or package names. They are ordinary modules from there on: they pin themselves, and they take part in reload and shutdown. `henri about` lists `app/modules`.
  - **`henri analyze`** (and `henri.analyze()`) prints what the boot did: the order, how long each module took, what it waited on and why, which dependency actually held it up, the critical path and the level chart. `henri analyze <module>` answers it for one module, `--json` for a script, `--level` for a partial boot.
  - **A reload is ordered by the same graph**, and modules can implement `release()`: it is called on every module that has one, backwards, before anything rebuilds under it. A module implementing neither `reload()` nor `release()` sees no difference.
  - **Shutdown is the reverse of the graph** rather than a fold over the levels, so a module always stops before the ones it depends on — the HTTP server now closes before the stores it talks to. It still continues past a module that throws and reports every error.
  - The legacy `tests` module (level 7) is removed: `henri test` runs Vitest and `@usehenri/testing` boots the application. The levels now go from 0 to 6.

- [#379](https://github.com/usehenri/henri/pull/379) [`e31a3f7`](https://github.com/usehenri/henri/commit/e31a3f73e7e8facf3cedf7460f115e57995f32c3) Thanks [@reel](https://github.com/reel)! - `henri openapi`: a machine-readable description of what an application exposes, generated from its routes rather than hand-written.
  
  ```bash
  henri openapi                      # the OpenAPI 3.1 document, on stdout
  henri openapi --out openapi.json   # written to a file the application commits
  henri openapi --summary            # what it covers, and what henri cannot know
  ```
  
  Most frameworks cannot generate a good one, because they know nothing about their own answers, and the description ends up a second copy of the application that drifts. henri knows the routes (`config/routes.js`, expanded the way the router expands it), the models (its own schema format, plus the columns the adapters add), the answers (HAL with `_links`, the boom error envelope with its code, the paging, `Idempotency-Key`, the versioned media type), who may call what (`roles` on a route, a policy per record) and what leaves (a field marked `personal: { expose: false }` is dropped; a declared foreign key travels as the related row's `externalId`). All of that is derived, and nothing in the document is a convention henri hopes an application follows.
  
  The other half is what henri **cannot** know, and it is the half that makes the document worth reading. A controller can answer anything: `res.render()` is not JSON, and a hand-written route points at an action henri never wrapped. Those operations carry no success status at all — only the failures henri answers before the action runs, plus a `default` response that says, in words, that the body is the application's. Nothing in a response schema is `required` and every schema is open, because an action may present its records before sending them. A request body is the model's writable columns, all optional, and a foreign key gets no type, because `req.permit()` is the controller's decision. Every operation carries `x-henri.known`, so a reader never has to guess how much was derived. An honest `unknown` beats a wrong `object`.
  
  The document is OpenAPI **3.1** (JSON Schema 2020-12: a published foreign key is `type: ["string", "null"]`, and "anything" is `{}` — neither is expressible in 3.0). It is validated against the specification by the test suites of core, the command line and the showcase, and the showcase suite calls the application and checks that the status, the shape and the headers of a real answer are the ones the document named.
  
  It lives as a file the application commits, and as `GET /_openapi.json` on a booted application — development only and from the loopback interface only, like `/_routes` and `/_controllers`, because the document names every route, its roles and its policy. `henri mcp` exposes it as the `openapi` tool, which is the fastest way for a coding agent to learn an application's HTTP surface.
  
  Out of scope on purpose: a UI, request validation from the document, client generation, and GraphQL, which has a schema of its own. The guide is `usehenri.io/guides/openapi/`.

- [#400](https://github.com/usehenri/henri/pull/400) [`2689779`](https://github.com/usehenri/henri/commit/26897798b840fd28a4bc091c050a83457b36905d) Thanks [@reel](https://github.com/reel)! - OpenTelemetry, out of the box: `henri.telemetry`.
  
  henri answers three observability questions already — `pen` says what happened, `henri.reporter` says what failed, `henri.analyze()` says what the boot did — and each of them from one process. None of them says where the time went inside one request, and none of them follows that request into the queue, the mail transport or a webhook receiver. This is the fourth: a trace, through OpenTelemetry, which is the only vendor-neutral way to hand one to whatever the deployment already runs.
  
  **henri ships the instrumentation and none of the pipeline.** `@opentelemetry/api` is an **optional peer dependency**; there is no SDK, no exporter, no sampler, no resource and no collector address, because those belong to the deployment that knows the service name, the environment and how much traffic it can afford to keep. The guide shows the smallest bootstrap that works, and it is the application's file.
  
  **An application that does not install the api pays nothing**, and nothing here is not a flag tested per request. Nothing is installed at all: the middleware is not mounted, the store adapter is not wrapped, no instrument is created, `@opentelemetry/api` is never required, and there is no boot line, because there is nothing to say. Measured on an empty JSON route at 30 000 requests: the baseline with the package absent, +1.3 to 2.2 µs per request with it present and no SDK registered, +2.4 to 4.6 µs while exporting.
  
  **What a span carries is the error reporter's rule, word for word**, because a span attribute is a log field with a different name on it. A request span is named for its route _pattern_ (`GET /artworks/:id`) and carries the method, the route, the status and `henri.request_id` — the four of them, from `requestOf()`, which is literally the reporter's own function, so the two cannot drift. Nothing that came from the client is in a span: no url, no path, no query, no body, no parameters, no headers, no user, no SQL text, no mail recipient, no job arguments and no webhook body. That is a deliberate departure from the HTTP semantic conventions, which ask a server span for `url.path`, and the reason is the reporter's: `/users/ada@example.com` is a path in some applications and a personal field in all of them. Attributes an application passes to `henri.telemetry.span()` go through the masking of a log line.
  
  The children are the boundaries henri already knows, without reaching into anybody's driver: `adapter.query()` (the raw SQL henri runs on its own behalf — the queue's claim, the trail's insert), the view render, the mail send, a job run in `@usehenri/jobs` and a delivery attempt in `@usehenri/webhooks`. A model call an application makes is deliberately not one: that is `@opentelemetry/instrumentation-pg` and its siblings, registered in the same bootstrap, and their spans land under henri's request span because the context is already active. The **boot** is a span too, and it is reconstructed from `henri.analyze()` after the fact, with the timings it had already measured — so nothing is timed twice and nothing runs during a boot for the sake of a trace. A boot that failed is emitted with the module that failed carrying the error.
  
  **Propagation, and which identifier wins.** An incoming `traceparent` is honoured, so a request that arrives inside somebody else's trace continues it; `henri.telemetry.inject()` writes one onto the requests henri makes for the application, which today is a webhook delivery, inside the span of the attempt the receiver is answering. `traceparent` decides the trace and `X-Request-Id` decides the request id, and **neither is derived from the other**: inventing a trace id from a request id would orphan the parent that is waiting, and a trace usually spans several requests, so a trace id is not unique per request. The span carries `henri.request_id`, which is the join between a log line and a trace. `traceparent` is not written onto the response, because it would hand an internal identifier to whoever asked and `X-Request-Id` already answers that need.
  
  **The metrics are the four that mean something**: `http.server.request.duration` by method, route and status — whose count _is_ the request count, which is why there is no counter beside it — `henri.jobs.queue.depth`, `henri.jobs.claim.duration` and `henri.cache.operations`. The last is read straight off the counters `henri.cache.stats()` already kept, and it and the queue depth are observable instruments, so nothing is recorded while a request runs.
  
  **When the exporter is down or slow, a span is dropped** — the cache's rule, where a dead backend is a miss. henri owns none of the pipeline: nothing is ever awaited, `forceFlush()` is never called, there is no queue and no map of open spans here, and every span ends in a `finally` or when the response closes. A sampled-out span costs an object. A tracer that throws is logged and, after five failures, telemetry turns itself off for the life of the process and says so once.
  
  `config.telemetry` is `{ enabled, metrics, propagate, spans }`, or `false`. Leave it out and telemetry follows the package: on when `@opentelemetry/api` resolves from the application, off when it does not. `enabled: true` says the application requires it, and a boot without the package then fails with `HENRI_TELEMETRY_UNAVAILABLE` rather than going quiet.
  
  `henri doctor` reports `deps.declared` when `enabled` is `true` and the package is in no `package.json`, so that boot failure is one a check catches first.

- [#383](https://github.com/usehenri/henri/pull/383) [`72cd1d3`](https://github.com/usehenri/henri/commit/72cd1d35ffb99311bbca815c1f6ab41ee3682f64) Thanks [@reel](https://github.com/reel)! - Outbound webhooks, signed and retried, in a new package: `@usehenri/webhooks`.
  
  Every application that integrates with anything eventually pushes events to a url a customer typed into a settings form. Everyone writes it by hand, and everyone gets the same two parts wrong: the signature, which is what lets the receiver believe the request, and the url, which is a server-side request forgery with a registration form in front of it. The queue landing in 1.1 made the rest of it nearly free, so here it is.
  
  The surface is one call: `await henri.webhooks.emit('invoice.paid', payload)` writes one row per subscribed endpoint and returns. `register()`, `rotate()`, `disable()` and `remove()` manage the endpoints from the application, and `henri webhooks:add|list|show|update|rotate|disable|enable|remove|send|status|install` from the command line. Endpoints carry an `owner`, which is the tenant they belong to: an `emit()` with an owner reaches that owner's endpoints, one without reaches the endpoints that have none, and henri will not fan an event across tenants for you.
  
  **Signing** follows [Standard Webhooks](https://www.standardwebhooks.com) to the byte — `webhook-id`, `webhook-timestamp` and `webhook-signature`, HMAC-SHA256 over `id.timestamp.body`, base64, behind a `v1,` scheme prefix — so a receiver with any Standard Webhooks library verifies henri with nothing written. GitHub and Shopify sign only the body, which replays forever and cannot be deduplicated; Stripe adds the timestamp and is what this is closest to. henri differs from Stripe in three ways on purpose: the timestamp is its own header, the signature is base64, and **the delivery id is part of the signed content** — the same `webhook-id` on every attempt of one delivery, so "have I already processed this?" is answered from authenticated bytes rather than from a body nobody has verified yet. Nothing a receiver could route on is sent outside the signature: the event type is in the signed body and in no header. The guide carries the verification snippet a receiver pastes, and `signature.spec.js` runs that exact transcription against what the package signs, so the page cannot drift from the code. Secrets rotate with a grace during which both sign, and are stored encrypted (AES-256-GCM under a key derived from `secret`).
  
  **Delivery is a job** and nothing else, so the retries, the exponential backoff, the dead letter queue and the operator's view of all of it are the queue's: `henri jobs:list --queue webhooks`, `henri jobs:dead`, `henri jobs:show <id>`, `henri jobs:retry <id>`. There is no deliveries table. Eight attempts, ten seconds tripling to six hours — about three days. A `2xx` is a delivery; a `5xx`, a timeout, a connection error and any other `4xx` are retried; a `3xx` is a failure that is **not** retried and is never followed, because a redirect is the receiver choosing a url after henri checked the one it was given; a `410 Gone` is not retried either and disables the endpoint.
  
  **A url is checked when the request is made**, not when it was registered, because DNS answers differently later. Every address the name resolves to is refused if it is loopback, link-local (where `169.254.169.254` lives), private, carrier-grade NAT, multicast, reserved, documentation, or an IPv4 address wearing an IPv6 costume — and one bad answer refuses the name. The socket then connects to the address that was checked and to no other, so nothing can resolve the name a second time in between. `webhooks.allowPrivate` and `webhooks.allowHttp` lift it for a development configuration, and `henri audit` reports either of them in production (`webhooks.private-addresses-allowed`, a new A10:2021 category in the report, and `webhooks.http-allowed`).
  
  Two seams were added to `@usehenri/jobs` for it, and both are useful on their own. `henri.jobs.define(name, definition)` lets a package ship a job of its own without asking every application to write a file that forwards the call — a file of `app/jobs` with the same name still wins. And an error carrying `retryable: false` is buried on the spot with its reason instead of spending every attempt to learn the same thing: a `410 Gone`, an address that must not be reached, a payload a remote API will refuse identically in six hours.
  
  `henri new` does not install any of this. The guide is [Webhooks](https://usehenri.io/guides/webhooks/), and it says what is deliberately left out: receiving webhooks, a UI, a subscription policy richer than `invoice.*`, `Retry-After`, ordering guarantees, and anything that needs a message broker.

- [#341](https://github.com/usehenri/henri/pull/341) [`a2e1ec2`](https://github.com/usehenri/henri/commit/a2e1ec29df52462f12ebaae9bfbc1ad4f427b27f) Thanks [@reel](https://github.com/reel)! - Every record gets a public uuid, and the numeric id stops leaving the server.
  
  **This is a breaking change for an existing application: urls change, JSON payloads change, and a database migration is required.** The [upgrading guide](https://usehenri.io/upgrading/) has the migration for each adapter.
  
  The primary key is unchanged — a `bigint` on SQL, an `ObjectId` on MongoDB — and it is still what the foreign keys, the joins and the indexes are made of. What changes is that it is now internal. Alongside it every model carries `externalId`: a uuid in an `external_id` column that is `NOT NULL` and `UNIQUE` in the database itself, generated on the insert when the caller brings none. It is the only identifier that leaves the server, so nothing outside can see or guess a sequential number: `/tasks/42` becomes `/tasks/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11`, a serialized record has `externalId` and no `id` (no `_id` on MongoDB), and `_links`, the `Location` header of a `201`, the path helpers, the view options and `publicUser()` all carry the uuid.
  
  The values are UUID version 7 (RFC 9562), time ordered: the column is unique, indexed and written on every insert, and a version 4 uuid would land in a different page of the b-tree every time where a version 7 appends to the right edge like the bigint it hides. `crypto.randomUUID()` only makes version 4, so the adapters generate their own; a uuid supplied by the caller is accepted whatever its version.
  
  `Model.findById()` takes either identifier, so a controller keeps handing it `req.params.id`: a uuid is 36 characters with four dashes, and neither a number nor a 24 character `ObjectId` can look like one. `findByIdAndUpdate()`, `findByIdAndDelete()` and, on the Sequelize adapters, `findByPk()` take both too, and `findById()` is new on the Sequelize adapters.
  
  Nothing about associations changes: `belongsTo`, `hasMany`, `include()` and `populate()` still work on the primary key, and a foreign key column still holds a number.
  
  `options: { externalId: false }` opts a model out, and it then behaves exactly as it did before.

- [#411](https://github.com/usehenri/henri/pull/411) [`afead74`](https://github.com/usehenri/henri/commit/afead7489498ed42e1893a25123ea772cac2ca09) Thanks [@reel](https://github.com/reel)! - An adapter that says what it ran, and the N+1 detection that follows from it.
  
  `bullet` is the most-installed development tool in the Rails world after the linters, and henri had nothing like it. It had `include()`, a guide that told you to use it, and no way to find out when you had not. The reason nobody outside henri could write that check either was more basic: **no adapter emitted anything when it ran a query**, so there was nothing to listen to.
  
  So there are two halves, in that order. `henri.queries` is the seam — every adapter reports every model call — and the N+1 detector is a listener on it, on in development and in test, off in production.
  
  ```
  warn  queries  GET /proposals/:id  Track.findById ran 24 times at
                 app/controllers/ProposalsController.js:41 (18.3ms) --
                 load them together: one Track.find({ id: [...] }) for the
                 whole set, or include('track') on the query that fetched
                 the parents
  ```
  
  **The seam is at the model call, not the statement**, and that is the decision everything else follows from. It is the only level at which henri can give _advice_ — a driver instrumentation can already tell you forty statements ran, and `@opentelemetry/instrumentation-pg` does that better than henri would; only henri knows they were forty `Proposal.findById` calls and that one `Proposal.find({ id: [...] })` replaces them. It is also the only level whose number you can act on: `paginate()` is two statements and one decision, and on MySQL so is an insert, because the dialect has no `RETURNING`.
  
  And it is the level that matches what is actually wrong. Measuring the adapters rather than assuming: **`include()` on Drizzle compiles to a single correlated json subquery**, so the classic Rails lazy-association N+1 does not exist there at all. A detector written to `bullet`'s mental model would walk a Drizzle application, find nothing, and report success. What remains — a loop issuing one `find`/`findById` per record where one call for the set would do — is a count of model calls. So, said plainly everywhere because a person reading "40 queries" assumes the other thing: **the threshold counts model calls, never statements.**
  
  **An event carries names and numbers, and no SQL.** `{ at, store, adapter, dialect, model, operation, method, keys, shape, duration, rows, requestId, source, callsite }`. At the model call there is no statement to carry, which is the happy half; the unhappy half is why it would have been refused anyway. **Sequelize's query generator interpolates values into the text it runs** — `findAll({ where: { name: 'ada' } })` reaches the driver as `WHERE "name" = 'ada'`, on the ordinary path — while Drizzle parameterizes and Mongoose has no statement at all. A `sql` field would have been safe on two adapters and a copy of your rows on the third, which is worse than no field because it is the leak nobody would look for. `keys` is column **names**, which is the rule the access trail already established: a field name is schema, a field value is personal data.
  
  `callsite` is one frame, the first belonging to the application's own files. `bullet`'s value was never that it counted queries; it is that it names the line.
  
  **The join is the request id and there is only one.** The same `AsyncLocalStorage` the call log keys its rows by, every `pen` line carries, and a span carries as `henri.request_id`. There is no trace id, and **telemetry deliberately does not consume this seam**: statements stay the driver's own instrumentation to trace, `adapter.query()` keeps its span and gains an event, and no model call ever becomes a span. `base/telemetry.js` was amended to say where that line now sits.
  
  A finding goes to the log (one warning per request, at the end, when the count is final), to `X-Henri-Queries` in development, and — with `queries.detect.raise` — to a thrown `HENRI_QUERIES_N_PLUS_ONE` at the moment the threshold is crossed, so the stack names the call that went one too far. That last one is the CI gate, the way `Bullet.raise = true` is in a Rails suite. It does **not** go to `henri.reporter`: an N+1 is a slow answer, not a failure, and an application that wired Sentry to page someone should not be paged for a slow page. `henri audit` reports `queries.detect.raise` left on in a production configuration.
  
  Each adapter maps its own layer. Drizzle and Sequelize wrap their statics, because both answer promises, plus Drizzle's `Relation.prototype` once per process for the lazy `where().toArray()` path. Mongoose uses schema middleware instead, because `Model.find()` answers a lazy chainable `Query` and wrapping it would have executed it early and turned every `find().sort()` in every henri application into a promise; the cost is that an operation that fans out (`populate`) reports once per operation rather than once per model call, which the guide says out loud.
  
  **Off costs nothing**, the way the call log and telemetry mean it: no hook registered on any adapter, no middleware mounted, nothing allocated per query, and no flag tested on a hot path. Measured on Drizzle over in-memory sqlite — the harshest framing, since the call itself is only 26µs — the default adds 9.2µs per model call, two thirds of which is capturing the call site (`"callsites": false` drops it). Against a real database that is a fraction of a percent, and it is still off in production by default.
  
  `config.queries` is the whole configuration: absent means on outside production, `false` is off everywhere, `{ "enabled": true }` is the production opt-in. The guide is [N+1 detection](https://usehenri.io/guides/queries/).

- [#315](https://github.com/usehenri/henri/pull/315) [`a4ecba5`](https://github.com/usehenri/henri/commit/a4ecba50c663f4d5c741adbb6cd9bc0eefe0e5cc) Thanks [@reel](https://github.com/reel)! - Rails ergonomics for models and the database: seeds, timestamps by default, soft deletes, `paginate()` and one validation error shape.
  
  **Behaviour change: timestamps are on by default.** Every model now gets `createdAt` and `updatedAt`, like every Rails table; `options: { timestamps: false }` opts out. Before this, the Mongoose (`disk`, `mongoose`) and Drizzle adapters added them only with `options: { timestamps: true }` — the Sequelize adapters (`mysql`, `postgresql`, `mssql`) already added them by default, so nothing changes there. On MongoDB there is nothing to do; on Drizzle the models gain two `NOT NULL` columns, so a production database needs a migration (`henri db:generate`, then `henri db:migrate`) before deploying. `henri generate model` no longer writes `options: { timestamps: true }`. See the [upgrading guide](https://usehenri.io/upgrading/#timestamps-are-on-by-default).
  
  **`henri db:seed` and `db/seeds.js`** (Rails' `db/seeds.rb`). Boots the models only — no views, no workers — requires `db/seeds.js` and awaits what it exports, with the models and the henri instance available. It works on every adapter, unlike the migration commands of `henri db`. `--file=<path>` runs another file, `--json` prints the result and the usual `{ error: { command, message, hint, code, exitCode } }` envelope, and a missing seed file is a usage error reported before anything boots. `henri new` scaffolds the file with the idempotent `find or create` idiom commented out.
  
  **Soft deletes with `options: { paranoid: true }`** (Rails' `acts_as_paranoid`), on every adapter: deleting stamps `deletedAt`, queries hide the stamped records, `{ force: true }` really deletes and `restore()` brings a record back. Mongoose gets a schema plugin (query middleware plus replacements for `deleteOne`, `deleteMany`, `findOneAndDelete`, `findByIdAndDelete` and `doc.deleteOne()`), Sequelize uses its own `paranoid`, and Drizzle honours the scope in relations, `count()`, `update()` and `paginate()` and adds `withDeleted()`/`onlyDeleted()`.
  
  **`Model.paginate({ page, perPage })`** on every adapter, answering `{ records, page, perPage, total, pages }`: `await Task.paginate(req.pagination())` replaces a find and a count, and everything else in the object is the adapter's own query (`where`, `sort`/`order`, `include`, `select`, ...). On Drizzle relations paginate too: `Task.where({ done: false }).paginate({ page: 2 })`.
  
  **`henri.model.errors(error)`** turns a Mongoose, Sequelize or Drizzle validation failure — a duplicate key included — into `{ field: message }`, and answers `null` for anything else so a controller can rethrow. An error with no field of its own is filed under `base`.
  
  The controllers written by `henri generate scaffold` and `crud` use `Model.paginate(req.pagination())` and `henri.model.errors()`, so a generated index is one query and a generated 422 has the same body on every store. Regenerate them with `--force` to pick both up.

- [#319](https://github.com/usehenri/henri/pull/319) [`baec3fd`](https://github.com/usehenri/henri/commit/baec3fd22be92bf8ffbaeb251b0b6c2771f8347a) Thanks [@reel](https://github.com/reel)! - Rails ergonomics in the router and the controllers.
  
  - **`before` hooks.** A controller can export `before`, henri's `before_action`:
    an object keyed by action (`all`, `show`, `'create,update'`) or an array of
    functions and `{ run, only, except }` selectors. Hooks are `(req, res, next)`
    or async `(req, res)`, run once the route is allowed, in declaration order,
    and one that answers ends the request. `before` is the one export of a
    controller that is never routable.
  - **Flash messages.** `req.flash('notice', 'Saved')` queues a message in the
    session and `req.flash('notice')` reads and clears it, so it survives exactly
    one redirect. Views get the whole bag as `flash` next to `data` and `paths`
    (`{{@flash.notice}}` in Handlebars, the `flash` prop or `useHenri().flash` in
    React and Inertia); a request that renders nothing leaves the messages alone.
    Without a user model, and therefore without a session, `req.flash()` is a
    no-op rather than an error.
  - **Implicit render.** An action that returns without answering renders
    `/<controller>/<action>` (`/<controller>` for `index`) with what it returned
    as `data`, the way rails renders `tasks/show`. Actions that answer explicitly
    are untouched; `return false` opts out.
  - **A fuller routes DSL.** `config/routes.js` gains `root` (`GET /`), `only`
    and `except` on `resources`/`crud` (`omit` still works and is deprecated),
    `member` and `collection` extra routes, `namespace <name>` and `nested`
    resources (`/posts/:post_id/comments`). Path helpers stay
    `<action>_<controller>_path`, and the expansion now lives in one place
    (`@usehenri/core/src/base/routes`), which `henri routes`, `henri doctor` and
    the generators read instead of their own copy.
  - `henri generate scaffold|crud` write a `before` hook loading the record of
    `:id` once, `update`/`destroy` work on it instead of querying again, and
    `new` returns instead of rendering.

- [#396](https://github.com/usehenri/henri/pull/396) [`ada4794`](https://github.com/usehenri/henri/commit/ada4794204a72cf6e4bfe691a08933df92dd7ff4) Thanks [@reel](https://github.com/reel)! - `henri db:rollback` and `db/schema.sql`
  
  Two things Rails has that the migration story here did not: undoing the last migration, and one file saying what the database actually looks like.
  
  ```bash
  henri db:rollback              # the last migration
  henri db:rollback --step=2     # the last two, newest first
  henri db:schema:dump           # writes db/schema.sql from the database
  henri db:schema:load           # creates that schema in an empty database
  ```
  
  **Rolling back.** drizzle-kit generates forward-only SQL, so there is no `down` — and the three ways to get one are not equally honest. A hand-written `down.sql` puts the inverse of a computed diff on the person least able to check it, and rots silently because nothing runs it until the day it matters. Writing one at `db:generate` time freezes that same inverse, in a folder that invites hand-edits (drizzle-kit's own answer to a rename is "edit the generated SQL"), so it goes wrong in the direction nobody looks. henri does neither: it computes the inverse **when you ask for it**, by handing drizzle-kit the two snapshots `db/migrations/meta` already holds in the other order. Nothing new is stored, nothing can go stale, and what runs is the inverse of the schema `db:status` believes in.
  
  It refuses three things rather than lying about them:
  
  - **A migration that removed a table or a column** (`HENRI_MIGRATION_IRREVERSIBLE`). Its inverse would recreate them empty, and an empty column is not the column that was dropped. There is no flag for this one: undoing a destructive migration is a restore from a backup, and henri will not pretend otherwise.
  - **A migration whose `.sql` changed since it was applied** (`HENRI_MIGRATION_EDITED`). The database records the sha256 of the file it ran; when the file on disk hashes to something else, henri does not know what ran and will not guess.
  - **A rollback that would drop rows that are there** (`HENRI_MIGRATION_DESTRUCTIVE`). Not "a statement that matches `DROP`" — the tables and columns the inverse removes are counted first. Undoing the migration you applied a minute ago on a database nothing was written into is quiet; one that would take 412 rows away says so and needs `--force`, the way `db:push` already does.
  
  Rolling back moves the database, not the folder: the `.sql` and its snapshot stay where they are, `db:status` reports the migration pending again, and `db:migrate` applies it again.
  
  **The dump.** `db/schema.sql` is read from the **database**, not from the migration chain. A dump built from the chain agrees with the chain by construction: it is a second copy of files already in the repository, and it can never catch the `ALTER` somebody ran by hand or the `db:push` that was never turned into a migration — which are the two reasons to read a dump at all. The cost is that it is written where a database is reachable, and it is not hidden.
  
  Two runs against the same schema give the same bytes: tables ordered by name, indexes and foreign keys by their statements, columns in the position the database keeps them. MySQL is read through `information_schema` rather than `SHOW CREATE TABLE`, which prints the `AUTO_INCREMENT` counter and would move the file on every insert. The header names the migration the database was at, so the dump and `db:status` cannot disagree.
  
  Loading it is supported. `db:schema:load` creates everything the dump describes and records the migrations through the one it names as applied, leaving anything newer pending — which is how a test database is built without replaying the chain. It refuses a table it would create that already exists (`HENRI_MIGRATION_DATABASE_NOT_EMPTY`) and never empties a database to get its way, so it has no `--force`; a table the dump says nothing about is left alone.
  
  An `mssql` store answers neither (it is on Sequelize, it has no migration history for a dump to name, and `db:status` reads it back instead), and a `mongoose` one has no schema to write down. Both say so with `HENRI_CLI_MIGRATIONS_UNSUPPORTED` rather than doing half of it.
  
  Also fixed: `henri db:generate` recorded a migration as applied on MySQL whenever the push it checks against had no statements — which on MySQL is also what a drifted table looks like, since drizzle-kit does not alter one there. A drifted table is now part of that answer, so the history stops claiming a migration ran that did not.

- [#354](https://github.com/usehenri/henri/pull/354) [`fd59971`](https://github.com/usehenri/henri/commit/fd59971af2237b62a4fac78ec99c1e1dfbaab92b) Thanks [@reel](https://github.com/reel)! - `henri credentials:rotate`: a new key, the same secrets
  
  A key that may have leaked has to stop opening the file, and until now that meant a manual sequence — show the values, generate a key, edit, paste everything back — which is exactly the kind of thing that ends with a secret in a shell history.
  
  ```bash
  henri credentials:rotate --env production
  ```
  
  The file is re-encrypted under a fresh key and the values are untouched. The current key has to open the file first, so a rotation is never a way to lose the contents, and the re-encrypted file is read back before the new key is stored: a rotation that cannot be verified puts the old file back and changes nothing.
  
  The new key is written to `config/credentials/<env>.key`, or printed once when `HENRI_CREDENTIALS_KEY` held the old one, because a deployment that deliberately has no key file should not be given one. `--json` never prints it. The old key opens nothing afterwards, so everything holding a copy needs the new one before its next boot.
  
  Closes [#57](https://github.com/usehenri/henri/issues/57), open since 2018.

- [#367](https://github.com/usehenri/henri/pull/367) [`6bc8a44`](https://github.com/usehenri/henri/commit/6bc8a4494136e8b634938d643894214f757dd796) Thanks [@reel](https://github.com/reel)! - `henri new` writes a Dockerfile, and the CLI becomes a dependency of the application
  
  An application scaffolded with henri had no way to be deployed that henri had an opinion about, so everybody wrote the same forty lines. Rails has shipped one since 7.1.
  
  The generated `Dockerfile` is a two stage build: install the production dependencies, compile the views with `henri build` (which needs no database), then a runtime image that runs as the `node` user with a health check on `/readyz` and no package manager left in it. `.dockerignore` keeps `node_modules`, `.env`, the credentials keys, `.henri` and the build output out of the context.
  
  It is written for the application it belongs to. The install line matches the package manager `henri new` picked. An application on a store with a native driver gets a build toolchain in the build stage and only there, because `better-sqlite3` has no prebuilt binary for every node and platform pair. And an application on the zero-config store is told, at the top of the file, that this store runs a MongoDB inside the process and is not what an image runs on, with the two flags that pick a real one.
  
  **`henri` moves from the development dependencies to the dependencies.** `henri server` is how the application runs, not a tool used to build it, so an image built with a production-only install has to have it, and `npm i -g henri` being present on whatever deploys is not something to rely on. Existing applications are unaffected; add `henri` to your `dependencies` if you deploy with `--omit=dev` or `--prod`.
  
  Verified by building and running the generated image rather than by reading it: `docker build`, then `docker run`, then the endpoints. Two things it found on the way, both fixed here: the copied directory belonged to root so a store that writes beside the code could not start, and the sqlite driver needed a compiler the slim image does not carry.

- [#350](https://github.com/usehenri/henri/pull/350) [`4274567`](https://github.com/usehenri/henri/commit/4274567e20a980657f07df9ec7db25296c7d55f5) Thanks [@reel](https://github.com/reel)! - `henri audit` checks an application against the OWASP Application Security Verification Standard, from its files alone.
  
  Knowing whether an application does the things a web application is judged on used to mean hiring someone. `henri audit` answers the checkable part of that question in the shape `henri doctor` already had: nothing booted, a stable name per check, `--json`, and an exit code.
  
  ```text
    henri audit: 2 findings in 30 checks (1 high, 1 medium, 0 low; failing on medium)
  
    high    csrf.disabled              config/production.json
            A01:2021 Broken Access Control / ASVS V4.2.2 (L1)
            cross-site request forgery protection is turned off, so any site can post to this one with the visitor session
            -> Remove "csrf": false. A JSON client that sends Authorization: Bearer, or no session cookie at all, is already exempt
  ```
  
  The standard underneath is the ASVS 4.0.3, because it is the one written to be verified: numbered requirements, at levels, that an answer can be measured against. The Top 10 (2021) rides along as a second label on every finding, because that is what a report is read against outside a security team.
  
  What it checks: a secret or a database password written in `config/*.json`; a `.env` or a credentials key that reached a commit; a `HENRI_SECRET` that is too short or reads like a placeholder; CSRF, helmet, the rate limiters, the parameter filters or the request timeout turned off; a `cors` that accepts any origin; `trustProxy: true`; a session that outlives 30 days; a `user.public` naming a credential; a model write that takes `req.body` whole; `{ unsafe: true }`; a raw query built by interpolation; a record answered as the ORM returned it; unescaped output in a view; an action of a resource left without a role while its siblings have one; a GraphQL endpoint that asks for no session, or one of its cost bounds set to `false`; and the known advisories of the production dependencies.
  
  Every check answers something that is true or false from the repository. Nothing here prints advice: henri's own defaults are never reported, because they are secure until an application turns them off, and what only a deployment knows — whether a proxy sits in front, whether TLS terminates before the process — is not checked at all. `henri audit --checks` prints the catalogue with the requirement and level each one maps to, so the answer is what an application has covered and not only what it failed.
  
  - `--fail-on=<severity>` decides what exits with `1`: `medium` by default, `none` to report without failing. A finding in `config/test.json` is reported one severity lower.
  - `--no-deps` skips the dependency advisories, which is the only step that reaches the network. That step asks the package manager about the **production** dependencies at **high and critical** only, and says so as a `low` finding rather than failing when it cannot run.
  - `henri doctor` runs the same static checks and adds one `security.findings` warning when they find something, so the habit of running `doctor` is enough to notice.
  - The `henri` MCP server exposes it as the `audit` tool.
  
  The new [Security](https://usehenri.io/guides/security/) page carries the other half, and is the more useful one: the table of what henri does for every application — the hashing, the session cookie, the headers, the CSRF token, the rate limits, the role guards, the `externalId` — next to what stays yours, and the gaps henri has not closed yet.

- [#378](https://github.com/usehenri/henri/pull/378) [`8a8e3b3`](https://github.com/usehenri/henri/commit/8a8e3b33d7967b81f66633aa25c3075318f01d60) Thanks [@reel](https://github.com/reel)! - A Sequelize store stops changing the production schema by itself, and `henri db:status` reads it back
  
  Until now every SQL boot ran `sequelize.sync()`, in every environment. In development that is the point; in production it was DDL applied at boot, from whatever the models happened to say, with nobody reviewing it — and because `sync()` only creates what is missing and never alters what exists, it also hid every table that was already wrong.
  
  A production boot now changes nothing. It compares the database with the models instead and warns about each difference. A store that wants the old behaviour asks for it with `"sync": true`, which `henri audit` reports as `schema.autosync`. Development is unchanged, and so is the drizzle adapter, which already refused to push in production.
  
  `henri db:status` now answers on a Sequelize store (`mysql`, `postgresql`, `mssql`), which is the one `db:` command they can honestly serve: it reports a missing table, a missing column, a column whose type or nullability differs, a missing index, and a column that is in the database and in no model. `--sql` writes the DDL that would close the difference, for you to read and run — henri applies none of it and never writes a `DROP`. `--json` carries `clean` and the differences, so a deploy can check that production matches the code. On sqlite a column change is reported without a statement, because sqlite has no `ALTER COLUMN`.
  
  The Sequelize adapters still have no migrations and are not getting any: generated, versioned migrations are the drizzle adapter's, and the upgrade guide now documents the path from a `sync()`-built database to drizzle migrations without dropping it. `henri db:generate`, `db:migrate` and `db:push` on a Sequelize store answer the new `HENRI_CLI_MIGRATIONS_UNSUPPORTED` and point there. `henri doctor` gained `schema.migrations-ignored` and `schema.migrations-pending`.

- [#320](https://github.com/usehenri/henri/pull/320) [`325d0aa`](https://github.com/usehenri/henri/commit/325d0aa0e16dc3c86bfb6bbfa26fdb344a382a76) Thanks [@reel](https://github.com/reel)! - `henri new` scaffolds a styled application: Tailwind CSS v4, out of the box, on both renderers.
  
  The nine-line Sass stylesheet is gone. `app/views/styles/index.css` is now the whole stylesheet of a new application: `@import 'tailwindcss' source(none)` with the `@source` globs of `pages/` and `components/`, a `color-scheme: light dark` root and a body rule. The React template compiles it with `@tailwindcss/postcss` through a new `app/views/postcss.config.mjs` (next.js reads its PostCSS configuration from `app/views`); the Inertia template merges the `@tailwindcss/vite` plugin into `app/views/vite.config.mjs`. Both work in development and in production, Inertia's server-side rendering included, and every `henri new --adapter` combination gets the same wiring.
  
  The sample pages are written with it. The welcome page, the Inertia tasks page and the five view templates behind `henri generate scaffold` (index, show, new, edit, `_form`) render a designed page instead of unstyled text, with a dark mode that follows the operating system through Tailwind's `dark:` variant. The class lists long enough to hide the markup sit in a `const` at the top of the page, so `useHenri()`, `withHenri` and the form handling stay in plain sight.
  
  The generated `AGENTS.md` has a `## Styling` section stating the convention (one stylesheet, utility classes in the pages, no `tailwind.config.js`, `dark:` on every colour), and the generated `README.md` says how to drop Tailwind: nothing in henri depends on it, the classes are plain strings in the pages.

- [#351](https://github.com/usehenri/henri/pull/351) [`fda9366`](https://github.com/usehenri/henri/commit/fda9366e9ed2b072764a995c5aa60205ca7a4725) Thanks [@reel](https://github.com/reel)! - GraphQL moves out of core into `@usehenri/graphql`
  
  The GraphQL layer is now a package of its own. `@usehenri/core` no longer
  depends on `@apollo/server`, `@as-integrations/express5`,
  `@graphql-tools/merge`, `@graphql-tools/schema` or `graphql`, so an
  application that never mounts a schema stops installing them.
  
  An application that uses GraphQL adds one dependency,
  `npm install @usehenri/graphql`, and nothing else changes: the package ships
  the henri module itself, so depending on it is what puts `henri.graphql` in
  the boot, with the same `run()`, `endpoint`, `active`, error classes and
  `toApolloError()`. The endpoint is still `/_henri/gql` (still configurable
  with the `graphql` key) and the schema is still built from the models'
  `graphql` keys.
  
  `@usehenri/core/module` is the base class a module package extends, and this
  is the first package to use it: it is the supported path, so a module of your
  own no longer reaches into `@usehenri/core/src/base/module`.
  
  Without the package henri says so instead of going quiet: a model declaring a
  `graphql` key fails the boot with the install line, `res.render(view, { graphql })`
  fails the request with it, and `henri doctor` reports it as a missing
  dependency. `henri.graphql` is `undefined` rather than an object that does
  nothing, which the type declarations say too, and a page has no `graphql` key
  among its view options.

- [#372](https://github.com/usehenri/henri/pull/372) [`1a86acb`](https://github.com/usehenri/henri/commit/1a86acbf15e4a43e5fb81277bb22e101c06e77a4) Thanks [@reel](https://github.com/reel)! - File uploads, in a new package: `@usehenri/uploads`.
  
  An application installs it and gets `henri.uploads`, `req.files`,
  `req.file(field)` and `req.permitFiles(...fields)` — `req.permit()` for files,
  which removes what a controller did not ask for on the spot. `store()` moves a
  file into the storage and answers the record to write to a model
  (`{ key, name, type, size, checksum, storage, uploadedAt }`), and
  `henri.uploads.send(res, record)` streams it back as a download.
  
  The parser is busboy, and every bound is enforced as it reads rather than
  checked afterwards: `maxTotalSize` (25mb, checked against `Content-Length`
  first and counted again as the bytes arrive), `maxFileSize` (10mb), `maxFiles`
  (10), `maxFields` (100), `maxFieldNameSize` (100 bytes) and `maxFieldSize`,
  which defaults to `config.bodyLimit`. The type of a file is decided from its
  first bytes, never from the `Content-Type` or the extension the client sent,
  and `uploads.allow` matches that. The stored name is generated, so no name a
  client sends ever reaches a path. Files land in `storage/uploads` (`0700`,
  objects `0600`), outside everything the application serves, and nothing is kept
  unless a controller calls `store()` — a request that is refused, times out or is
  abandoned leaves no temporary file behind.
  
  The local disk is one implementation of a documented `HenriStorage` contract;
  an object store is another, named by module id in `config.uploads.storage` and
  resolved from the application. henri ships no S3 client.
  
  `@usehenri/core` gains the `uploads` configuration key (validated whether or
  not the package is installed), the `req.files`/`req.file`/`req.permitFiles`
  declarations, and `res.boom.payloadTooLarge()` and
  `res.boom.unsupportedMediaType()`.
  
  `henri audit` gains three checks: `uploads.limits-disabled` (V12.1.1),
  `uploads.type-check-disabled` (V12.2.1) and `uploads.root-served` (V12.4.1).

- [#381](https://github.com/usehenri/henri/pull/381) [`41470bf`](https://github.com/usehenri/henri/commit/41470bf378d83ca3d35d00e8c31796fea5eb15e0) Thanks [@reel](https://github.com/reel)! - Retention, and the access trail.
  
  A model now says how long it keeps its records, in its options:
  
  ```js
  options: {
    retention: { action: 'anonymize', after: '2y', from: 'decidedAt' },
  },
  ```
  
  `action` is one of the three verbs henri already had -- `delete`,
  `soft-delete` (only on a `paranoid` model) and `anonymize` (exactly what an
  erasure writes) -- and `from` is the date column the clock starts on, which
  is rarely `createdAt`. A record whose `from` is null never ages out and is
  counted separately. A model with more than one class of records writes a
  list of named rules with a `where` each.
  
  `henri.retention.sweep()` enforces them and needs nothing installed:
  `henri retention:sweep --yes` is what a cron line runs, and with
  `@usehenri/jobs` installed `config.retention.schedule` registers the
  recurring `henri/retention` job. The boot says which of the two it is, by
  name, so a rule nothing applies is never silent.
  
  Two things stand between a wrong rule and a deleted table: a rule writes
  nothing until its token is in `config.retention.approved` (a line in the
  configuration, so a person, a diff and a review), and
  `config.retention.batch` bounds one run. `henri retention:sweep` without
  `--yes` plans, counts and prints, and writes nothing. Every sweep leaves a
  receipt in `config.retention.receipts`.
  
  `config.trail` turns on the access trail: an append-only, hash-chained
  record of who read or changed personal data, in a table henri owns. It
  records the export, the erasure, every retention sweep and -- with
  `trail.reads` -- the answers henri serializes; `henri.trail.record()` is how
  an application adds its own. It holds field names, counts, public
  identifiers and digests, and refuses anything else
  (`HENRI_TRAIL_VALUE_REFUSED`). `henri trail`, `henri trail:about <who>` (which
  answers from an address whose digest is all that is stored) and
  `henri trail:verify` read it back.
  
  `henri.jobs.recur(name, entry)` is the seam a framework module uses to ask
  for a schedule the configuration did not write; an entry the application
  declared under the same name still wins.
  
  The drizzle adapter no longer offers to drop the tables henri owns
  (`henri_jobs`, `henri_jobs_schedules`, `henri_trail`): a push that obeyed
  would have taken an application's job history or its audit trail with it.

- [#314](https://github.com/usehenri/henri/pull/314) [`b45f7c8`](https://github.com/usehenri/henri/commit/b45f7c8e6a02d8e84ec648ebd58803936934cae3) Thanks [@reel](https://github.com/reel)! - `henri new` and `henri init` take `--adapter disk|drizzle|mongoose|mysql|postgresql|mssql` (and `--dialect sqlite|postgres|mysql` with drizzle) to pick the store of the new application. `disk` stays the default, so nothing changes without the flag.
  
  The adapter drives the whole scaffold: the store block of `config/default.json`, a `config/test.json` on its own database, the dependencies and the driver (`better-sqlite3`, `pg` or `mysql2` for drizzle, allow-listed in `pnpm-workspace.yaml` when it needs a build), the README and AGENTS.md, and the sample `Task` resource. `henri generate scaffold|crud` now reads the adapter back from the configuration and writes a controller against the model API that store really has: Mongoose on `disk` and `mongoose`, Sequelize (`findAll`, `findByPk`, `row.update()`) on `mysql`, `postgresql` and `mssql`, the Rails-like Drizzle model (`query().offset().limit()`, `count`, `findByIdAndUpdate`) on `drizzle`. `henri doctor` knows the new combinations, including the driver a drizzle dialect needs.

- [#339](https://github.com/usehenri/henri/pull/339) [`8e44e7e`](https://github.com/usehenri/henri/commit/8e44e7e882dd8741b3ac632651b453389d76bf2c) Thanks [@reel](https://github.com/reel)! - Type declarations for the API an application touches.
  
  Every published package now ships hand-written `.d.ts` files, pointed at by
  `types` and included in `files`. henri stays JavaScript: there is no build step,
  no `.ts` file in an application and nothing to install.
  
  - **`@usehenri/core`** declares the `henri` global (`config`, `pen`, `model`,
    `user`, `router`, `server`, `mail`, `graphql`, `validator`, `addMiddleware`,
    ...), the request and response additions (`req.permit()`, `req.pagination()`,
    `req.flash()`, `req.id`, `req.apiVersion`, `req._henri`, `res.render()`,
    `res.hbs()`, `res.boom.*`, `res.resource()`, `res.collection()`,
    `res.negotiate()`), and the shape of the three files an application writes:
    `Controller`, `RoutesFile`, `ModelFile`, plus `Configuration` for
    `config/default.json`. The routes keys are checked as far as a type can check
    them, so `'gett /tasks'` and `only: ['list']` are type errors.
  - **`@usehenri/react`** declares `withHenri`, `useHenri`, `request`,
    `RequestError` and the form components with their props;
    **`@usehenri/inertia`** `useHenri`, `Form`, `pathFor`, `getRoute`, `request`,
    `resolvePage` and `henriViteConfig()` (`Link`, `Head`, `router`, `usePage` and
    `useForm` re-export Inertia's own types); **`@usehenri/testing`** `setup`,
    `teardown`, `request`, `agent` and `henri`. Neither view package depends on
    `@types/react`.
  - **`henri new` writes a `jsconfig.json`** with `types: ["@usehenri/core"]`, so
    an editor knows the `henri` global and completes everything above with no
    setup. The generators write the one JSDoc line that binds a file to its shape
    (`/** @type {import('@usehenri/core').Controller} */`), on controllers, model
    files and `config/routes.js`.
  
  The models themselves stay untyped: `Task` is a Mongoose, Sequelize or Drizzle
  model whose fields come from your schema, and henri does not pretend to know
  it. See the new [Types](https://usehenri.io/reference/types/) page.

- [#407](https://github.com/usehenri/henri/pull/407) [`de1c1e0`](https://github.com/usehenri/henri/commit/de1c1e02ed83d13dcfeb8e44012f309eb663f03e) Thanks [@reel](https://github.com/reel)! - Uploads that survive a second machine: an object store, signed urls and variants
  
  `@usehenri/uploads` shipped one backend — the local disk — and said `url()`
  was allowed to answer `null` forever. Two application processes on two
  machines therefore did not share uploads at all, a link to a stored file
  meant writing a controller and a route for every one of them, and a
  thumbnail meant leaving the framework entirely. All three are closed here.
  
  **`@usehenri/s3`, a new package.** `config.uploads.storage` takes an object
  now (`{ "adapter": "s3", "bucket": "…", "region": "…" }`, the shape
  `config.shared` and a store already have) and `s3` resolves the package from
  the application. One backend speaks to S3, R2, Spaces, MinIO and GCS's
  interoperability mode; what tells them apart is an endpoint and a region. It
  carries no dependency but `debug` — AWS Signature Version 4 is two hundred
  lines of `node:crypto`, checked against the vectors AWS publishes. Every
  safety property survives the move: the key is generated and refused if it is
  not, the type still comes from the bytes and becomes the object's
  `Content-Type`, the original name is metadata, and a part still lands on a
  private local file that only `store()` promotes.
  
  **Signed urls.** `henri.uploads.url(record, { expiresIn, disposition,
  filename, type })` is one call whatever the backend: the provider's own
  signature on an object store, henri's own (an HMAC over the key, the expiry,
  the disposition, the name and the type, verified by a route it mounts) on
  the local disk. Neither can be edited to name another object, widened, or
  replayed past its expiry. Until then a signed url **is** a bearer
  capability, so `config.uploads.urls` is off by default and `url()` refuses
  with `HENRI_UPLOAD_URLS_DISABLED` rather than answering `null`.
  `uploads.urls.cdn` puts a cache in front of henri's own, whose signature
  deliberately does not cover the host.
  
  **Variants.** `config.uploads.variants` declares them by name and
  `henri.uploads.variant(record, 'thumb')` answers a record like any other.
  The key is the source's plus a digest of the variant's terms, so the work
  happens once, on demand, and never in the request that uploaded. `sharp` is
  an **optional peer dependency** resolved from the application: without it
  `variant()` refuses with `HENRI_UPLOAD_NO_IMAGE_LIBRARY` and the install
  line rather than quietly answering the original, and `henri doctor` reports
  it. A name never comes from a request, an SVG is refused, a source is
  bounded at fifty megapixels and one frame, no metadata is carried forward,
  and what the resize produced is sniffed before it is stored.
  
  New configuration: `uploads.storage` in its object form, `uploads.urls`
  (`expiresIn`, `path`, `cdn`) and `uploads.variants`. New codes:
  `HENRI_UPLOAD_NO_IMAGE_LIBRARY`, `HENRI_UPLOAD_STORAGE_FAILED`,
  `HENRI_UPLOAD_STORAGE_MISCONFIGURED`, `HENRI_UPLOAD_URLS_DISABLED`,
  `HENRI_UPLOAD_URL_EXPIRED`, `HENRI_UPLOAD_URL_INVALID`,
  `HENRI_UPLOAD_VARIANT_FAILED`, `HENRI_UPLOAD_VARIANT_UNKNOWN`,
  `HENRI_UPLOAD_VARIANT_UNSUPPORTED`. `henri doctor` asks for
  `@usehenri/s3` and `sharp` when the configuration names them.

- [#345](https://github.com/usehenri/henri/pull/345) [`4b4677d`](https://github.com/usehenri/henri/commit/4b4677d4a09d39fe50b1fa4af577600342578daf) Thanks [@reel](https://github.com/reel)! - The configuration is checked against a schema at boot, before any module starts.
  
  JavaScript is not strongly typed and TypeScript erases at runtime, so henri checks its own inputs — exhaustively at the boundaries, and the configuration is the first one. Every key henri owns is declared in `@usehenri/core` (`src/base/config-schema.js`) as data: the type it accepts, what to say when something else arrives, and what to do about it. `0.config.js` runs it once the file has loaded and the credentials and the environment have been applied over it, so a wrong value fails on the first line of the boot rather than three modules in, where the message would have named the reader instead of the mistake.
  
  **Every problem is reported, not the first one.** Somebody fixing a configuration file should not discover its faults one boot at a time.
  
  **An error names the key, what was expected, what arrived, and where the value came from** — the file, the credentials, or the variable, because `port must be a number` is unhelpful when the culprit is an environment variable three deployments away:
  
  ```
  config ✖ "port" must be a port number between 1 and 65535, but it is the string "eight thousand" => from config/production.json
  config ✖ "stores.default.adapter" must be one of disk, drizzle, mariadb, mongoose, mssql, mysql, postgresql, but it is the string "redis" => from HENRI_CONFIG__stores__default__adapter
  config ✖ "secret" must be a string, but it is a number => from the credentials (config/credentials/production.json.enc)
  ```
  
  A value the `filterParameters` name, and anything the credentials provided, is printed as its type alone; the password of a connection string is always masked. The boot fails with a `ConfigurationError` whose `code` is `CONFIG_INVALID`, whose message names how many problems there are and on which keys, and which carries them all as `{ key, level, message, expected, received, source, hint }`. `henri server` prints them under the failure and exits `1`; `henri server --json` puts them in `{ "error": { "code", "message", "hint", "problems" } }` on stderr.
  
  **An unknown key is a warning, never a failure**: an application may carry keys of its own, and `henri.config.get()` is how it reads them. But a key that is a near miss of one henri owns says so and names the right one (`"renderers" is not a henri configuration key: did you mean "renderer"?`), because that is the actual mistake being made. Inside a store, where everything henri does not declare is forwarded to the driver, only a near miss is worth a word.
  
  **`henri doctor` runs the same schema** over every `config/*.json` without booting and without a database — the checks are `config.invalid`, `config.adapter` and `config.unknown`.
  
  Two smaller changes come with it. An environment variable now takes the type the schema declares when the configuration file has no value at that path (`HENRI_CONFIG__port=8080` is the number `8080` in an application whose file never names a port); the file still wins when it does have one, and a key henri does not own is still a string. And a boot failure reaches the command line through its error envelope — `henri server failed: ...` and the hint — instead of a raw object dump.
  
  The schema cannot drift from the type declarations or the documentation: `@usehenri/core`'s suite compares it key by key with the `Configuration` interface of `index.d.ts` and with the table of the configuration page, and refuses a key that lives in only one of the three.

### Patch Changes

- [#323](https://github.com/usehenri/henri/pull/323) [`7071e76`](https://github.com/usehenri/henri/commit/7071e766f060ff28804549adcb22f73c18adff90) Thanks [@reel](https://github.com/reel)! - Both view engines warned at every boot that `sass` was missing, whether or not the application had any `.scss` to compile. Since the scaffold styles with Tailwind and writes no Sass, a new app carried the dependency only to silence that warning. The engines now look for an authored `.scss` under `app/views` first, skipping build output, and `henri new` no longer adds `sass`. An app that writes Sass keeps working and still gets the warning when the package is missing.

- [#314](https://github.com/usehenri/henri/pull/314) [`b45f7c8`](https://github.com/usehenri/henri/commit/b45f7c8e6a02d8e84ec648ebd58803936934cae3) Thanks [@reel](https://github.com/reel)! - Fix `henri new` picking the wrong package manager, and two Inertia scaffold problems.
  
  `henri new` probed `pnpm --version` then `yarn --version` and took the first that answered. A version manager shim (mise, asdf) answers non-zero outside a project it manages, so a pnpm machine got a yarn application with no `pnpm-workspace.yaml`, and the first `pnpm install` failed with `ERR_PNPM_IGNORED_BUILDS`. The manager is now, in order: `--pm pnpm|yarn|npm` (new flag on `new` and `init`), the `packageManager` field, the lockfile, `npm_config_user_agent` (the manager that ran the command), then the probe. The choice and where it came from are printed, and `pnpm-workspace.yaml` is written whatever the manager is, since npm and yarn ignore it.
  
  A fresh Inertia application now ships `test/tasks.test.js`, so `henri test` is green from the first minute instead of exiting `1` on "No test files found", and its `eslint.config.js` declares the model globals of `app/models`, the Vitest globals and `vitest.config.js` like the React one does.
  
  `henri doctor` no longer reports an installed ESM-only dependency as missing (`@inertiajs/react declared in package.json but not installed`): `resolvePackageJson` falls back to reading `node_modules/<name>/package.json` from disk when the package's `exports` map has no `require` and no `./package.json` condition.

- [#326](https://github.com/usehenri/henri/pull/326) [`18715f9`](https://github.com/usehenri/henri/commit/18715f90ea8958dc57da1bb029b8209c36b84cc6) Thanks [@reel](https://github.com/reel)! - Three fixes found by building a full application on the framework (`showcase/`).
  
  `henri db:seed` boots the user module. It stopped at runlevel 3 (the models), and creating a user goes through `henri.user.encrypt()` to hash its password, so any `db/seeds.js` that wrote a user failed with `Cannot read properties of undefined (reading 'encrypt')` — which is every seed file of an application with authentication. Seeds now boot to runlevel 4; the migration commands still stop at 3, since they need no session.
  
  `henri generate agents` reads the store from the configuration. It always wrote an `AGENTS.md` describing the `disk` adapter and the Mongoose query API, whatever the application ran on, so a coding agent in a Drizzle or Sequelize application was handed the wrong model API in the first paragraph it read. The renderer was already read from the configuration; the adapter now is too (`adapterOf()`, next to `apiOf()`).
  
  The HAL guard leaves Inertia page objects alone. A route expanded from `resources` or `crud` reported (and, with `config.api.strict`, refused with a `500`) every JSON answer without `_links` — including the `{ component, props, url, version }` object the Inertia view engine answers a client-side visit with, which is a rendered page and not an API answer. Navigating between two pages of a `resources` route under `api.strict` answered `500`; without it, every visit logged a false warning. Answers carrying the `X-Inertia` header are no longer checked.

- [#399](https://github.com/usehenri/henri/pull/399) [`c0c16e8`](https://github.com/usehenri/henri/commit/c0c16e873ba440aee9832160553cbb12ab81bd2c) Thanks [@reel](https://github.com/reel)! - `henri openapi` describes the parameters an action declared, and the 422 they answer.
  
  The parameter check of a `params` declaration is registered next to the guards whatever the verb, so a `GET` declaring `page: { type: 'integer', min: 1 }` answers 422 on `?page=banana`. The document tied 422 to `mutating && idempotency`, so it denied that answer — and where it did emit one, the component said the `Idempotency-Key` had been reused, which is a different failure fixed a different way.
  
  The document now reads the declarations, from `henri.controllers.accepts()` on a booted application and from the same `declarations()` compiler over the controller files in the command, so both write the same document:
  
  - the declared fields are the query, path and body parameters of the operation, with the types, the bounds and the enums the rule wrote. A mutating action that declares `params` gets that as its request body — what henri actually checks — instead of the model's writable columns, which stay in `components.schemas` as `<Model>Input`.
  - every 422 names its cause: `InvalidParameters` (the parameter check), `IdempotencyMismatch` (the key was reused for a different request), `UnprocessableEntity` (both can happen on that operation), and `ValidationFailed` for the account endpoints henri mounts, which used to share the idempotency wording.
  - a controller the command could not load, or whose declaration would fail the boot, is marked rather than described as accepting nothing: `x-henri.params.read: false` on the operation, `info.x-henri.params.unread` in the document and a section in `henri openapi --summary`.
  
  `x-henri.enforced` is a list now (`['_links', 'params']`), because a route can enforce both.
- Updated dependencies [[`1e23664`](https://github.com/usehenri/henri/commit/1e23664829bd1a356de28f404cfb21c9ae211388), [`5b627ad`](https://github.com/usehenri/henri/commit/5b627adfa37e9f16bc75af96cc8ff5308a91f688), [`1b316c6`](https://github.com/usehenri/henri/commit/1b316c6f3c5d5eb5752c70b534092d1052956cc6), [`7fd13f6`](https://github.com/usehenri/henri/commit/7fd13f631b75f7aa152b73046b50c6902ae3ca93), [`b559fb7`](https://github.com/usehenri/henri/commit/b559fb72b391eeb21a3f6a0cda1515e01ecbfafc), [`1c0dfe8`](https://github.com/usehenri/henri/commit/1c0dfe84a98eff2122512256c4f42ec7ccde4212), [`93060a8`](https://github.com/usehenri/henri/commit/93060a86df795dbbd99bf1895beb0cf14c4b86de), [`e031900`](https://github.com/usehenri/henri/commit/e031900082f28aec72af4cda9cd959f932e2ebc7), [`9173000`](https://github.com/usehenri/henri/commit/91730005efa88f073bfaaf67078c3ec0e137b459), [`62fac46`](https://github.com/usehenri/henri/commit/62fac46fd6cae5581979b73daf99700fd246e0ea), [`b278119`](https://github.com/usehenri/henri/commit/b2781190de436eb5838e866446c9a0c8210bb6ca), [`b161e1b`](https://github.com/usehenri/henri/commit/b161e1b8fad94af2d2afc351dc1bc07dabbb1379), [`1616e34`](https://github.com/usehenri/henri/commit/1616e343a612be2bffffcfa5b23bfa8ad191bbe3), [`bcf4ce2`](https://github.com/usehenri/henri/commit/bcf4ce22bcd294844504164fac1fa4aef1ffec41), [`ab5a8e4`](https://github.com/usehenri/henri/commit/ab5a8e4a88c80cca070a2b8ad398c80babdaff11), [`43d267f`](https://github.com/usehenri/henri/commit/43d267f0f9d192b2c01e89c3925b7daf5000041b), [`9f868f3`](https://github.com/usehenri/henri/commit/9f868f3d9162fa218e34304110210e6949f97d5c), [`89dda62`](https://github.com/usehenri/henri/commit/89dda62da456a0a55600e79cfb65ce89f11258e2), [`62fac46`](https://github.com/usehenri/henri/commit/62fac46fd6cae5581979b73daf99700fd246e0ea), [`d9f3be4`](https://github.com/usehenri/henri/commit/d9f3be49c5929d929a220220bf6e72fdcb135595), [`c44f025`](https://github.com/usehenri/henri/commit/c44f025acec3d5bbbb57e2310d02184a1053a10d), [`67cfb20`](https://github.com/usehenri/henri/commit/67cfb200ea0e0b31bacf2af183db6467b0fa011d), [`e661f98`](https://github.com/usehenri/henri/commit/e661f98fe8f8acce15aa10ce2dc320c5a2cb006f), [`2c8a826`](https://github.com/usehenri/henri/commit/2c8a8265262dbf6ea5c3e73e8e7892a230d4d0f0), [`46d5dbc`](https://github.com/usehenri/henri/commit/46d5dbcc983c03e96ae5a87d7288c5d8a5adbc24), [`ba97ea9`](https://github.com/usehenri/henri/commit/ba97ea968f0b34cd67b7a3e803ecd34543b8aaaf), [`5ccd537`](https://github.com/usehenri/henri/commit/5ccd537b3621b54d11e7f24ccca39643ae7d5cf7), [`9895cbf`](https://github.com/usehenri/henri/commit/9895cbf4be85b476e341a5be915e3049e5a027de), [`5a150d5`](https://github.com/usehenri/henri/commit/5a150d576208571c32b9cd12827d035e31ed4313), [`3c1c5b8`](https://github.com/usehenri/henri/commit/3c1c5b83ea135b000ddd6ffbfd05457b000f2f7c), [`aa3f90b`](https://github.com/usehenri/henri/commit/aa3f90bd6f42bb05431c33f3e4bf2202cb6bb7c6), [`a1c6769`](https://github.com/usehenri/henri/commit/a1c6769099e3dc28b22b5338a2a57b13bdf69f7a), [`ec1c8c4`](https://github.com/usehenri/henri/commit/ec1c8c419f4d9063a7617472b2970fdb8a929fa1), [`dd2731d`](https://github.com/usehenri/henri/commit/dd2731d6a20fd96aa1be1aeb5e6ec0155001326b), [`b7038ce`](https://github.com/usehenri/henri/commit/b7038ceaa430f4a0b9eaf7e983fc2844421bf636), [`1ea0f85`](https://github.com/usehenri/henri/commit/1ea0f85066b86fba31f58937cc10abb6359e6a26), [`01a561a`](https://github.com/usehenri/henri/commit/01a561aa58650ec15df1c2659795a5e4c5bbfd53), [`e31a3f7`](https://github.com/usehenri/henri/commit/e31a3f73e7e8facf3cedf7460f115e57995f32c3), [`2689779`](https://github.com/usehenri/henri/commit/26897798b840fd28a4bc091c050a83457b36905d), [`72cd1d3`](https://github.com/usehenri/henri/commit/72cd1d35ffb99311bbca815c1f6ab41ee3682f64), [`a2e1ec2`](https://github.com/usehenri/henri/commit/a2e1ec29df52462f12ebaae9bfbc1ad4f427b27f), [`afead74`](https://github.com/usehenri/henri/commit/afead7489498ed42e1893a25123ea772cac2ca09), [`a4ecba5`](https://github.com/usehenri/henri/commit/a4ecba50c663f4d5c741adbb6cd9bc0eefe0e5cc), [`baec3fd`](https://github.com/usehenri/henri/commit/baec3fd22be92bf8ffbaeb251b0b6c2771f8347a), [`e865d94`](https://github.com/usehenri/henri/commit/e865d945d65419ac676f5a2fe3ba3b6114a1e53d), [`4274567`](https://github.com/usehenri/henri/commit/4274567e20a980657f07df9ec7db25296c7d55f5), [`aea429c`](https://github.com/usehenri/henri/commit/aea429ca99338a62370ab3e3d94bdc6b8c227601), [`8a8e3b3`](https://github.com/usehenri/henri/commit/8a8e3b33d7967b81f66633aa25c3075318f01d60), [`18715f9`](https://github.com/usehenri/henri/commit/18715f90ea8958dc57da1bb029b8209c36b84cc6), [`831aa5c`](https://github.com/usehenri/henri/commit/831aa5c011f3432630c68b8d26755d2582f82f74), [`16824e8`](https://github.com/usehenri/henri/commit/16824e8fe9ccc6a04dab5d9b2481c29ff4f6b64b), [`fda9366`](https://github.com/usehenri/henri/commit/fda9366e9ed2b072764a995c5aa60205ca7a4725), [`1a86acb`](https://github.com/usehenri/henri/commit/1a86acbf15e4a43e5fb81277bb22e101c06e77a4), [`0b32fbd`](https://github.com/usehenri/henri/commit/0b32fbde19c95da8fe07fab76933840a4242c71c), [`c0c16e8`](https://github.com/usehenri/henri/commit/c0c16e873ba440aee9832160553cbb12ab81bd2c), [`41470bf`](https://github.com/usehenri/henri/commit/41470bf378d83ca3d35d00e8c31796fea5eb15e0), [`8e44e7e`](https://github.com/usehenri/henri/commit/8e44e7e882dd8741b3ac632651b453389d76bf2c), [`de1c1e0`](https://github.com/usehenri/henri/commit/de1c1e02ed83d13dcfeb8e44012f309eb663f03e), [`4b4677d`](https://github.com/usehenri/henri/commit/4b4677d4a09d39fe50b1fa4af577600342578daf)]:
  - @usehenri/core@1.2.0

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

- [#308](https://github.com/usehenri/henri/pull/308) [`f99341c`](https://github.com/usehenri/henri/commit/f99341cdf05b9306bfca0c8385aee1661fc77f4f) Thanks [@reel](https://github.com/reel)! - The JSON API follows HATEOAS (HAL), honours `Idempotency-Key`, is rate limited and picks up the Rails request conventions.
  
  - `res.resource(record, { type, links, status })` and `res.collection(records, { type, page, perPage, total, links })` answer HAL: the public fields plus `_links` (`self`, `collection`, `edit`, `update`, `destroy`; `first`/`prev`/`next`/`last`, `create`, `new` on collections) built from the router's path helpers and filtered by the roles of the current user. Collections embed their items under `_embedded.<type>`, carry `count`, `page`, `perPage`, `total` and the `Link` / `X-Total-Count` headers. `application/hal+json` is served when asked for, `application/json` otherwise; a 201 sets `Location`. `res.negotiate({ html, json })` picks the page or the JSON answer. The JSON branch of `res.render()` keeps its shape and gains `_links`. Routes expanded from `resources`/`crud` that answer JSON without `_links` are reported once per route, and refused (500) when `config.api.strict` is true.
  - `Idempotency-Key` on POST, PUT, PATCH and DELETE routes (Stripe semantics): the first answer is stored for `config.api.idempotency.ttl` (24h) and replayed with `Idempotency-Replayed: true`; a key still in flight answers 409, a key reused with another request 422. Keys are scoped per user, session or ip. `idempotent: false` opts a route out; `henri.api.idempotencyStore` (`{ get, set, delete }`) or `config.api.idempotency.store` plug a shared store.
  - Rate limiting (express-rate-limit, `RateLimit`/`RateLimit-Policy` draft-7 headers, `Retry-After`, 429 through `res.boom.tooManyRequests`): `config.rateLimit` (`{ windowMs: 60000, max: 600 }`, per user or ip, not enforced in development), `POST /login` and the register-style paths at 10 per minute (`config.rateLimit.auth`), and `rateLimit: { windowMs, max }` per route. `config.rateLimit.store` plugs a shared store.
  - `X-Request-Id` is accepted or generated, exposed as `req.id`, echoed on every answer and written in every `pen` line of the request. Helmet secure headers (`config.helmet`) with a CSP that lets Next dev, Turbopack and Vite HMR work in development. `config.filterParameters` (`password`, `token`, `secret`, `authorization`) are masked in everything `pen` prints. Weak ETags and `If-None-Match` → 304 on JSON. `req.pagination()` reads `page` and `per_page` (bounded by `config.api.maxPerPage`). `Accept: application/vnd.henri.v1+json` sets `req.apiVersion`, and the `version` route option refuses other versions with a 406. `GET /_henri/health` pings the stores (200 or 503). `Cache-Control: no-store` on authenticated JSON. `config.bodyLimit` (1mb) and `config.requestTimeout` (30s, 503).
  - `henri generate scaffold|crud` write controllers using `res.resource`/`res.collection`, `req.pagination()` and `req.permit()`, with a 201 + `Location` on create and a 204 on destroy; `henri generate test <name>` checks the HAL links when the name has a `resources`/`crud` route.

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

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - New `@usehenri/inertia` view engine: the Inertia.js protocol on Vite with React 19 pages and server-side rendering, selected with `"renderer": "inertia"`. Pages read the controller data with `useHenri()`, navigate with `<Link>` and submit with `<Form>` through Inertia's router. `henri new <app> --renderer inertia` scaffolds an application using it; `henri build` produces the client and server bundles.

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - Tests run on Vitest. `henri test` spawns the app's Vitest with `NODE_ENV=test`
  and exits with its code (extra arguments are passed through). `@usehenri/testing`
  boots the app in-process and exports `setup`, `teardown`, `request`, `agent` and
  `henri`, plus `@usehenri/testing/setup-file` for Vitest's `setupFiles` (henri and
  the model globals are available in every test file). The core `tests` module no
  longer loads jest at boot; jest is not a dependency anymore.

### Patch Changes

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - The published packages declare their `files`: the tarballs no longer ship the
  test suites and every package carries the LICENSE, a README and its changelog.
  `@usehenri/websocket` is no longer published (it was never wired into core).
- Updated dependencies [[`f99341c`](https://github.com/usehenri/henri/commit/f99341cdf05b9306bfca0c8385aee1661fc77f4f), [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e), [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e), [`a2cf383`](https://github.com/usehenri/henri/commit/a2cf383d6f3b4405b73816bc38175ad6f308dff4), [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e), [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e), [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e)]:
  - @usehenri/core@1.1.0

## 1.0.2

### Patch Changes

- Updated dependencies [[`64f7356`](https://github.com/usehenri/henri/commit/64f73564802c156bad4fe0955a4d373a7f984363)]:
  - @usehenri/core@1.0.2

## 1.0.1

### Patch Changes

- [#287](https://github.com/usehenri/henri/pull/287) [`1f71bcb`](https://github.com/usehenri/henri/commit/1f71bcb8285e7853e7df15941dab02067cc9d219) Thanks [@reel](https://github.com/reel)! - `henri new` scaffolds apps that depend on the `@usehenri/*` packages at the CLI's own version instead of the 0.37 line, and the generated `pnpm-workspace.yaml` warns instead of failing when pnpm meets a transitive build script that is not allow-listed. `henri server` and `henri console` now run the `@usehenri/core` the app depends on when it has one, falling back to the CLI's own copy.
- Updated dependencies []:
  - @usehenri/core@1.0.1

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
  - @usehenri/core@1.0.0

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.37.2](https://github.com/usehenri/henri/compare/v0.37.1...v0.37.2) (2020-01-13)

**Note:** Version bump only for package @usehenri/cli





## [0.37.1](https://github.com/usehenri/henri/compare/v0.37.0...v0.37.1) (2019-12-24)

**Note:** Version bump only for package @usehenri/cli





# [0.37.0](https://github.com/usehenri/henri/compare/v0.36.5...v0.37.0) (2019-09-23)

**Note:** Version bump only for package @usehenri/cli





## [0.36.5](https://github.com/usehenri/henri/compare/v0.36.4...v0.36.5) (2019-09-23)

**Note:** Version bump only for package @usehenri/cli





## [0.36.4](https://github.com/usehenri/henri/compare/v0.36.3...v0.36.4) (2019-09-18)

**Note:** Version bump only for package @usehenri/cli





## [0.36.3](https://github.com/usehenri/henri/compare/v0.36.2...v0.36.3) (2019-09-18)

**Note:** Version bump only for package @usehenri/cli





## [0.36.2](https://github.com/usehenri/henri/compare/v0.36.1...v0.36.2) (2019-09-04)

**Note:** Version bump only for package @usehenri/cli





## [0.36.1](https://github.com/usehenri/henri/compare/v0.36.0...v0.36.1) (2019-09-04)

**Note:** Version bump only for package @usehenri/cli





# [0.36.0](https://github.com/usehenri/henri/compare/v0.35.2...v0.36.0) (2019-09-04)


### Bug Fixes

* **cli:** capitalize model name outside of scaffold ([e87ec2f](https://github.com/usehenri/henri/commit/e87ec2f))


### Features

* **cli:** add required option in generate script ([31ce3af](https://github.com/usehenri/henri/commit/31ce3af))





## [0.35.2](https://github.com/usehenri/henri/compare/v0.35.1...v0.35.2) (2019-07-04)


### Bug Fixes

* **cli:** specify Prettier parser and fix the routes path. ([4295707](https://github.com/usehenri/henri/commit/4295707)), closes [#66](https://github.com/usehenri/henri/issues/66)


### Features

* **cli:** adding destroy (d) command ([bf036bc](https://github.com/usehenri/henri/commit/bf036bc)), closes [#67](https://github.com/usehenri/henri/issues/67)





## [0.35.1](https://github.com/usehenri/henri/compare/v0.35.0...v0.35.1) (2019-06-28)

**Note:** Version bump only for package @usehenri/cli





# [0.35.0](https://github.com/usehenri/henri/compare/v0.34.7...v0.35.0) (2019-06-19)

**Note:** Version bump only for package @usehenri/cli





## [0.34.7](https://github.com/usehenri/henri/compare/v0.34.6...v0.34.7) (2019-06-10)

**Note:** Version bump only for package @usehenri/cli





## [0.34.6](https://github.com/usehenri/henri/compare/v0.34.6-alpha.0...v0.34.6) (2019-05-28)


### Bug Fixes

* **cli:** use yarn when available ([eee2c35](https://github.com/usehenri/henri/commit/eee2c35))


### Features

* **cli:** install react by default ([13314c1](https://github.com/usehenri/henri/commit/13314c1))





## [0.34.6-alpha.0](https://github.com/usehenri/henri/compare/v0.34.5...v0.34.6-alpha.0) (2019-04-22)

**Note:** Version bump only for package @usehenri/cli





## [0.34.5](https://github.com/usehenri/henri/compare/v0.34.4...v0.34.5) (2019-04-18)

**Note:** Version bump only for package @usehenri/cli





## [0.34.4](https://github.com/usehenri/henri/compare/v0.34.4-alpha.4...v0.34.4) (2019-04-12)

**Note:** Version bump only for package @usehenri/cli





## [0.34.4-alpha.4](https://github.com/usehenri/henri/compare/v0.34.4-alpha.3...v0.34.4-alpha.4) (2019-03-28)

**Note:** Version bump only for package @usehenri/cli





## [0.34.4-alpha.3](https://github.com/usehenri/henri/compare/v0.34.4-alpha.2...v0.34.4-alpha.3) (2019-02-15)

**Note:** Version bump only for package @usehenri/cli





## [0.34.4-alpha.2](https://github.com/usehenri/henri/compare/v0.34.4-alpha.1...v0.34.4-alpha.2) (2019-02-15)

**Note:** Version bump only for package @usehenri/cli





## [0.34.4-alpha.1](https://github.com/usehenri/henri/compare/v0.34.4-alpha.0...v0.34.4-alpha.1) (2018-12-13)

**Note:** Version bump only for package @usehenri/cli





## [0.34.4-alpha.0](https://github.com/usehenri/henri/compare/v0.34.3...v0.34.4-alpha.0) (2018-12-03)

**Note:** Version bump only for package @usehenri/cli





## [0.34.3](https://github.com/usehenri/henri/compare/v0.34.2...v0.34.3) (2018-11-06)

**Note:** Version bump only for package @usehenri/cli





## [0.34.2](https://github.com/usehenri/henri/compare/v0.34.1...v0.34.2) (2018-10-31)


### Features

* **cli:** adding build command to CLI ([d805bca](https://github.com/usehenri/henri/commit/d805bca))





## [0.34.1](https://github.com/usehenri/henri/compare/v0.34.0...v0.34.1) (2018-10-31)

**Note:** Version bump only for package @usehenri/cli





# [0.34.0](https://github.com/usehenri/henri/compare/v0.33.1...v0.34.0) (2018-10-30)

**Note:** Version bump only for package @usehenri/cli





## [0.33.1](https://github.com/usehenri/henri/compare/v0.33.0...v0.33.1) (2018-10-29)

**Note:** Version bump only for package @usehenri/cli





# [0.33.0](https://github.com/usehenri/henri/compare/v0.32.0...v0.33.0) (2018-10-26)


### Bug Fixes

* **cli:** removing start-henri.js (legacy) ([7f125c8](https://github.com/usehenri/henri/commit/7f125c8))


### Features

* **cli:** adding s cli shortcut for server ([e6b8547](https://github.com/usehenri/henri/commit/e6b8547))
* **router:** move routes to the config directory in template ([a0e6cde](https://github.com/usehenri/henri/commit/a0e6cde))
* **testing:** adding the base for user testing ([47c8e85](https://github.com/usehenri/henri/commit/47c8e85))
* **testing:** adding the package ([e2ec87b](https://github.com/usehenri/henri/commit/e2ec87b))





# [0.32.0](https://github.com/usehenri/henri/compare/v0.31.1...v0.32.0) (2018-10-23)

**Note:** Version bump only for package @usehenri/cli





# [0.31.0](https://github.com/usehenri/henri/compare/v0.30.3...v0.31.0) (2018-10-17)

**Note:** Version bump only for package @usehenri/cli





<a name="0.30.3"></a>
## [0.30.3](https://github.com/usehenri/henri/compare/v0.30.2...v0.30.3) (2018-09-28)

**Note:** Version bump only for package @usehenri/cli





<a name="0.30.2"></a>
## [0.30.2](https://github.com/usehenri/henri/compare/v0.30.1...v0.30.2) (2018-09-26)

**Note:** Version bump only for package @usehenri/cli





<a name="0.30.0"></a>
# [0.30.0](https://github.com/usehenri/henri/compare/v0.29.3...v0.30.0) (2018-09-26)


### Bug Fixes

* **cli:** adding vue js eslint support by default ([f98fd40](https://github.com/usehenri/henri/commit/f98fd40))





<a name="0.29.3"></a>
## [0.29.3](https://github.com/usehenri/henri/compare/v0.29.2...v0.29.3) (2018-08-29)


### Bug Fixes

* **cli:** change the routes to something useful ([9e1fd33](https://github.com/usehenri/henri/commit/9e1fd33))
* **cli:** provide basic react eslint configuration on install ([7628d6e](https://github.com/usehenri/henri/commit/7628d6e))





<a name="0.29.2"></a>
## [0.29.2](https://github.com/usehenri/henri/compare/v0.29.1...v0.29.2) (2018-08-23)


### Bug Fixes

* **cli:** update nextjs related packages ([c853ce9](https://github.com/usehenri/henri/commit/c853ce9))





<a name="0.29.0"></a>
# [0.29.0](https://github.com/usehenri/henri/compare/v0.28.0...v0.29.0) (2018-08-23)

**Note:** Version bump only for package @usehenri/cli





<a name="0.28.0"></a>
# [0.28.0](https://github.com/usehenri/henri/compare/v0.27.0...v0.28.0) (2018-07-13)


### Features

* **workers:** add the --skip-workers flag to run without workers ([d21e913](https://github.com/usehenri/henri/commit/d21e913))




<a name="0.27.0"></a>
# [0.27.0](https://github.com/usehenri/henri/compare/v0.26.1...v0.27.0) (2018-07-12)


### Features

* **react:** add --force-build for views ([271ee77](https://github.com/usehenri/henri/commit/271ee77)), closes [#53](https://github.com/usehenri/henri/issues/53)
* **workers:** add the workers module ([816e24e](https://github.com/usehenri/henri/commit/816e24e))




<a name="0.26.1"></a>
## [0.26.1](https://github.com/usehenri/henri/compare/v0.26.0...v0.26.1) (2018-06-22)




**Note:** Version bump only for package @usehenri/cli

<a name="0.26.0"></a>
# [0.26.0](https://github.com/usehenri/henri/compare/v0.25.0...v0.26.0) (2018-06-21)




**Note:** Version bump only for package @usehenri/cli

<a name="0.25.0"></a>
# [0.25.0](https://github.com/usehenri/henri/compare/v0.24.0...v0.25.0) (2018-05-22)




**Note:** Version bump only for package @usehenri/cli

<a name="0.24.0"></a>
# [0.24.0](https://github.com/usehenri/henri/compare/v0.23.0...v0.24.0) (2018-05-11)


### Bug Fixes

* **cli:** about command was not using promises ([cc3e727](https://github.com/usehenri/henri/commit/cc3e727))




<a name="0.23.0"></a>
# [0.23.0](https://github.com/usehenri/henri/compare/v0.22.0...v0.23.0) (2018-04-23)




**Note:** Version bump only for package @usehenri/cli

<a name="0.22.0"></a>
# [0.22.0](https://github.com/usehenri/henri/compare/v0.21.3...v0.22.0) (2018-04-17)


### Features

* **cli:** return a function (better tests) ([292e111](https://github.com/usehenri/henri/commit/292e111))




<a name="0.21.2"></a>
## [0.21.2](https://github.com/usehenri/henri/compare/v0.21.1...v0.21.2) (2018-04-10)


### Bug Fixes

* **cli:** better packages usage ([4eaae0f](https://github.com/usehenri/henri/commit/4eaae0f))




<a name="0.21.1"></a>
## [0.21.1](https://github.com/usehenri/henri/compare/v0.21.0...v0.21.1) (2018-04-10)




**Note:** Version bump only for package @usehenri/cli

<a name="0.21.0"></a>
# [0.21.0](https://github.com/usehenri/henri/compare/v0.20.2...v0.21.0) (2018-04-10)


### Bug Fixes

* **cli:** about command not working well ([3d12d17](https://github.com/usehenri/henri/commit/3d12d17))
* **cli:** about was failing on windows, using cross-spawn ([ee80cf2](https://github.com/usehenri/henri/commit/ee80cf2))
* **cli:** add back the console only startup mode ([4c915be](https://github.com/usehenri/henri/commit/4c915be))
* **cli:** add crud to the help message ([1616527](https://github.com/usehenri/henri/commit/1616527))
* **cli:** better about! ([f86e7b4](https://github.com/usehenri/henri/commit/f86e7b4))
* **cli:** data should be present in the return (data or graphql) ([5bc73a2](https://github.com/usehenri/henri/commit/5bc73a2))


### Features

* **cli:** adding --debug and --production flags ([7794837](https://github.com/usehenri/henri/commit/7794837))
* **cli:** inspect flag -- works really well with vscode ([e2feae6](https://github.com/usehenri/henri/commit/e2feae6))
* **cli:** we now depend on [@usehenri](https://github.com/usehenri)/core mainly ([1453067](https://github.com/usehenri/henri/commit/1453067))
* **core:** consolidating core ([9f72b35](https://github.com/usehenri/henri/commit/9f72b35))
* **core:** moving things to core. adding modules ([14a8c5c](https://github.com/usehenri/henri/commit/14a8c5c))




<a name="0.20.2"></a>
## [0.20.2](https://github.com/usehenri/henri/compare/v0.20.1...v0.20.2) (2018-01-27)


### Bug Fixes

* **cli:** helper header is a function ([33ed0b9](https://github.com/usehenri/henri/commit/33ed0b9))




<a name="0.20.1"></a>
## [0.20.1](https://github.com/usehenri/henri/compare/v0.20.0...v0.20.1) (2017-12-07)


### Bug Fixes

* **view:** seems like yarn workspaces broke next packages resolution. i don't get it. ([073d40a](https://github.com/usehenri/henri/commit/073d40a))




<a name="0.20.0"></a>
# [0.20.0](https://github.com/usehenri/henri/compare/v0.19.0...v0.20.0) (2017-12-07)


### Features

* **router:** go back to :id params ([26e19d4](https://github.com/usehenri/henri/commit/26e19d4))




<a name="0.19.0"></a>
# [0.19.0](https://github.com/usehenri/henri/compare/v0.18.0...v0.19.0) (2017-11-25)


### Bug Fixes

* **cli:** remove the logs also, and recreate directory ([ca13738](https://github.com/usehenri/henri/commit/ca13738))


### Features

* **cli:** add the generate crud cli ([f20f4d1](https://github.com/usehenri/henri/commit/f20f4d1))
* **cli:** adding generators for models and controllers ([64ea839](https://github.com/usehenri/henri/commit/64ea839))
* **cli:** adding show view to scaffold ([839d510](https://github.com/usehenri/henri/commit/839d510))
* **cli:** adding the about command ([aac06a2](https://github.com/usehenri/henri/commit/aac06a2))
* **cli:** adding the edit page to scaffold ([05393aa](https://github.com/usehenri/henri/commit/05393aa))
* **cli:** adding the scaffold command! generates a small MVC [WIP] ([23e4f6e](https://github.com/usehenri/henri/commit/23e4f6e))
* **user:** add roles support (mongoose) ([4bb0f59](https://github.com/usehenri/henri/commit/4bb0f59))




<a name="0.18.0"></a>
# [0.18.0](https://github.com/usehenri/henri/compare/v0.17.0...v0.18.0) (2017-11-17)




**Note:** Version bump only for package @usehenri/cli

<a name="0.17.0"></a>
# [0.17.0](https://github.com/usehenri/henri/compare/v0.16.1...v0.17.0) (2017-11-09)


### Bug Fixes

* **cli:** boilerplate package.json was old ([173c712](https://github.com/usehenri/henri/commit/173c712))


### Features

* **cli:** adding outdated notifier ([6c7beb1](https://github.com/usehenri/henri/commit/6c7beb1))
* **user:** add support for custom user model (defaults to 'user' ([5180d61](https://github.com/usehenri/henri/commit/5180d61))




<a name="0.16.1"></a>
## [0.16.1](https://github.com/usehenri/henri/compare/v0.16.0...v0.16.1) (2017-10-06)




**Note:** Version bump only for package @usehenri/cli

<a name="0.16.0"></a>
# [0.16.0](https://github.com/usehenri/henri/compare/v0.15.5...v0.16.0) (2017-10-06)


### Features

* **cli:** adding clean command ([ed90bf7](https://github.com/usehenri/henri/commit/ed90bf7))
* **cli:** adding react by default (next) ([4716354](https://github.com/usehenri/henri/commit/4716354))
* **cli:** check if it's a valid henri installation ([240d009](https://github.com/usehenri/henri/commit/240d009))




<a name="0.15.5"></a>
## 0.15.5 (2017-07-17)


### Bug Fixes

* **cli:** process.exit should return 1 on fail ([841c0da](https://github.com/usehenri/henri/commit/841c0da))



<a name="0.15.2"></a>
## 0.15.2 (2017-07-05)


### Features

* **henri:** switch back to yarn and upgrade packages ([15e1664](https://github.com/usehenri/henri/commit/15e1664))



<a name="0.15.0"></a>
# 0.15.0 (2017-07-05)


### Bug Fixes

* **server:** fix static files being served in the wrong folder ([5b58ad8](https://github.com/usehenri/henri/commit/5b58ad8))



<a name="0.14.0"></a>
# 0.14.0 (2017-07-05)



<a name="0.13.1"></a>
## 0.13.1 (2017-07-05)


### Bug Fixes

* **server:** moved error handler but port is out of scope. fixing. ([5916aaf](https://github.com/usehenri/henri/commit/5916aaf))



<a name="0.13.0"></a>
# 0.13.0 (2017-07-05)



<a name="0.12.0"></a>
# 0.12.0 (2017-07-05)


### Features

* **henri:** removing nodemon, long live hot reload.. ([62e8018](https://github.com/usehenri/henri/commit/62e8018))



<a name="0.11.0"></a>
# 0.11.0 (2017-07-05)


### Bug Fixes

* **config:** early log registration and addModule global ([d4e5c88](https://github.com/usehenri/henri/commit/d4e5c88))
* **view:** fix resolvers to use package deps ([cadc666](https://github.com/usehenri/henri/commit/cadc666)), closes [#15](https://github.com/usehenri/henri/issues/15)



<a name="0.10.0"></a>
# 0.10.0 (2017-07-05)



<a name="0.9.3"></a>
## 0.9.3 (2017-07-05)



<a name="0.9.0-alpha.7"></a>
# 0.9.0-alpha.7 (2017-07-05)


### Bug Fixes

* **cli:** do nothing when name does not resolve ([6aff9be](https://github.com/usehenri/henri/commit/6aff9be))


### Features

* **cli:** add the console ([d9e4098](https://github.com/usehenri/henri/commit/d9e4098))
* **cli:** adding cli ([50dbe5a](https://github.com/usehenri/henri/commit/50dbe5a))
* **cli:** adding the new command ([3a83e68](https://github.com/usehenri/henri/commit/3a83e68))
* **cli:** adding the pages and components folders to template ([f544ad9](https://github.com/usehenri/henri/commit/f544ad9))
