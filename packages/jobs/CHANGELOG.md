# @usehenri/jobs

## 1.2.0

### Minor Changes

- [#342](https://github.com/usehenri/henri/pull/342) [`1b316c6`](https://github.com/usehenri/henri/commit/1b316c6f3c5d5eb5752c70b534092d1052956cc6) Thanks [@reel](https://github.com/reel)! - Real background jobs, in a new package: `@usehenri/jobs`.
  
  What henri called workers was a hook that ran a file at boot, and the documented example was a `setInterval`. There was no way to say "send this mail later" or "process this upload in the background": no queue, no retries, no schedule, and nothing to look at when something failed. Rails has had that for a decade and now ships a database-backed queue by default; this is henri's.
  
  A job is `app/jobs/<name>.js` exporting `perform(args, context)` alongside its `queue`, `priority`, `maxAttempts`, `timeout` and `backoff` — the shape models and controllers already use. `henri generate job <name>` writes one and `henri destroy job <name>` removes it. The application enqueues with `henri.jobs.perform(name, args, options)`, `performIn(delay, ...)` and `performAt(date, ...)`, which write one row and return; `performNow()` runs one inline for tests and the console. Arguments are stored as JSON and anything that would not survive the round trip — a model instance, a function, `undefined`, a `Date` that would come back a string, a cycle — is refused with the path that holds it instead of being dropped silently.
  
  `henri jobs` runs a worker process: it claims jobs, performs `jobs.concurrency` of them at a time, honours the recurring schedules, puts back the jobs of runners that died and stops on `SIGINT`, `SIGTERM` and `SIGQUIT` after finishing what it holds. `--queue` limits it to some queues and `--once` drains what is due and exits. Several runners are meant to run at once against one database: claiming is a single statement on every dialect — `FOR UPDATE SKIP LOCKED` on PostgreSQL, `UPDATE ... ORDER BY ... LIMIT` on MySQL, `UPDLOCK, READPAST` on MSSQL, a subquery on sqlite, an atomic `findOneAndUpdate` per document on MongoDB — so it is its own transaction, the state is part of its own `WHERE`, and the rows it took carry a token it reads them back by. No job is ever performed twice because two runners raced.
  
  A job that throws is retried with an exponential backoff and, once out of attempts, kept in a **dead letter queue** with its error, its stack and the history of every attempt. The queue is at-least-once, so the guide says to write a job the way you would write a webhook handler: the outcome of an attempt is fenced by the token of the claim it belongs to, so a runner that was recovered from cannot write over the one that took its job, but a job that was recovered from does run twice. `henri jobs:dead`, `jobs:show <id>`, `jobs:retry` and `jobs:discard` drive it from the command line, `henri.jobs.dead.*` from the application. `henri jobs:status` gives the counts by queue and state, the timings of the finished jobs and how long the oldest due job has waited — with `--json`, like every other henri command.
  
  Recurring jobs are declared under `jobs.recurring` in the configuration (a five-field cron expression read in UTC, or a plain `every` interval) and honoured by the runner itself, with no second process. Missed runs do not pile up: the moment that follows is computed from now, so an hour of downtime on an hourly job costs one run, not sixty.
  
  The queue owns `henri_jobs` and `henri_jobs_schedules` and reaches them through the store adapter's own `query()` or its MongoDB collections, never through a model, so it cannot collide with the application's schema and works on a store that has no models at all. `henri jobs:install` creates the tables and is idempotent; the boot creates them too unless `jobs.install` says otherwise.
  
  `henri.mailers.deliverLater()` now goes through it: core registers the delivery handler, and the rendered message becomes a job on the `mailers` queue, retried and visible like any other.
  
  `app/workers` is untouched and still the right answer for a long-lived process that starts with the server. The [Jobs guide](https://usehenri.io/guides/jobs/) says when to reach for which.

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

### Patch Changes

- [#359](https://github.com/usehenri/henri/pull/359) [`a4d53bf`](https://github.com/usehenri/henri/commit/a4d53bf155d0d6f62800864258fa49615a794a9d) Thanks [@reel](https://github.com/reel)! - A duration with a long run of whitespace is refused in constant time
  
  `'5m'`, `'2h'` and their friends were matched by a pattern with `\s*` at both ends. Around an optional group that is quadratic: on `'1'` followed by sixty thousand spaces the two star quantifiers split the run between them one position at a time, which measured two seconds before the value was refused. A duration reaches the parser from `henri jobs:perform --in=`, and from whatever an application passes to `enqueue()`, so it is not always a value its author typed.
  
  The surrounding whitespace is trimmed before the pattern runs rather than matched by it. The same input is now refused in under a millisecond, and a test pins it.
- Updated dependencies [[`1e23664`](https://github.com/usehenri/henri/commit/1e23664829bd1a356de28f404cfb21c9ae211388), [`5b627ad`](https://github.com/usehenri/henri/commit/5b627adfa37e9f16bc75af96cc8ff5308a91f688), [`1b316c6`](https://github.com/usehenri/henri/commit/1b316c6f3c5d5eb5752c70b534092d1052956cc6), [`7fd13f6`](https://github.com/usehenri/henri/commit/7fd13f631b75f7aa152b73046b50c6902ae3ca93), [`b559fb7`](https://github.com/usehenri/henri/commit/b559fb72b391eeb21a3f6a0cda1515e01ecbfafc), [`1c0dfe8`](https://github.com/usehenri/henri/commit/1c0dfe84a98eff2122512256c4f42ec7ccde4212), [`93060a8`](https://github.com/usehenri/henri/commit/93060a86df795dbbd99bf1895beb0cf14c4b86de), [`e031900`](https://github.com/usehenri/henri/commit/e031900082f28aec72af4cda9cd959f932e2ebc7), [`9173000`](https://github.com/usehenri/henri/commit/91730005efa88f073bfaaf67078c3ec0e137b459), [`62fac46`](https://github.com/usehenri/henri/commit/62fac46fd6cae5581979b73daf99700fd246e0ea), [`b278119`](https://github.com/usehenri/henri/commit/b2781190de436eb5838e866446c9a0c8210bb6ca), [`b161e1b`](https://github.com/usehenri/henri/commit/b161e1b8fad94af2d2afc351dc1bc07dabbb1379), [`1616e34`](https://github.com/usehenri/henri/commit/1616e343a612be2bffffcfa5b23bfa8ad191bbe3), [`bcf4ce2`](https://github.com/usehenri/henri/commit/bcf4ce22bcd294844504164fac1fa4aef1ffec41), [`ab5a8e4`](https://github.com/usehenri/henri/commit/ab5a8e4a88c80cca070a2b8ad398c80babdaff11), [`43d267f`](https://github.com/usehenri/henri/commit/43d267f0f9d192b2c01e89c3925b7daf5000041b), [`9f868f3`](https://github.com/usehenri/henri/commit/9f868f3d9162fa218e34304110210e6949f97d5c), [`89dda62`](https://github.com/usehenri/henri/commit/89dda62da456a0a55600e79cfb65ce89f11258e2), [`62fac46`](https://github.com/usehenri/henri/commit/62fac46fd6cae5581979b73daf99700fd246e0ea), [`d9f3be4`](https://github.com/usehenri/henri/commit/d9f3be49c5929d929a220220bf6e72fdcb135595), [`c44f025`](https://github.com/usehenri/henri/commit/c44f025acec3d5bbbb57e2310d02184a1053a10d), [`67cfb20`](https://github.com/usehenri/henri/commit/67cfb200ea0e0b31bacf2af183db6467b0fa011d), [`e661f98`](https://github.com/usehenri/henri/commit/e661f98fe8f8acce15aa10ce2dc320c5a2cb006f), [`2c8a826`](https://github.com/usehenri/henri/commit/2c8a8265262dbf6ea5c3e73e8e7892a230d4d0f0), [`46d5dbc`](https://github.com/usehenri/henri/commit/46d5dbcc983c03e96ae5a87d7288c5d8a5adbc24), [`ba97ea9`](https://github.com/usehenri/henri/commit/ba97ea968f0b34cd67b7a3e803ecd34543b8aaaf), [`5ccd537`](https://github.com/usehenri/henri/commit/5ccd537b3621b54d11e7f24ccca39643ae7d5cf7), [`9895cbf`](https://github.com/usehenri/henri/commit/9895cbf4be85b476e341a5be915e3049e5a027de), [`5a150d5`](https://github.com/usehenri/henri/commit/5a150d576208571c32b9cd12827d035e31ed4313), [`3c1c5b8`](https://github.com/usehenri/henri/commit/3c1c5b83ea135b000ddd6ffbfd05457b000f2f7c), [`aa3f90b`](https://github.com/usehenri/henri/commit/aa3f90bd6f42bb05431c33f3e4bf2202cb6bb7c6), [`a1c6769`](https://github.com/usehenri/henri/commit/a1c6769099e3dc28b22b5338a2a57b13bdf69f7a), [`ec1c8c4`](https://github.com/usehenri/henri/commit/ec1c8c419f4d9063a7617472b2970fdb8a929fa1), [`dd2731d`](https://github.com/usehenri/henri/commit/dd2731d6a20fd96aa1be1aeb5e6ec0155001326b), [`b7038ce`](https://github.com/usehenri/henri/commit/b7038ceaa430f4a0b9eaf7e983fc2844421bf636), [`1ea0f85`](https://github.com/usehenri/henri/commit/1ea0f85066b86fba31f58937cc10abb6359e6a26), [`01a561a`](https://github.com/usehenri/henri/commit/01a561aa58650ec15df1c2659795a5e4c5bbfd53), [`e31a3f7`](https://github.com/usehenri/henri/commit/e31a3f73e7e8facf3cedf7460f115e57995f32c3), [`2689779`](https://github.com/usehenri/henri/commit/26897798b840fd28a4bc091c050a83457b36905d), [`72cd1d3`](https://github.com/usehenri/henri/commit/72cd1d35ffb99311bbca815c1f6ab41ee3682f64), [`a2e1ec2`](https://github.com/usehenri/henri/commit/a2e1ec29df52462f12ebaae9bfbc1ad4f427b27f), [`afead74`](https://github.com/usehenri/henri/commit/afead7489498ed42e1893a25123ea772cac2ca09), [`a4ecba5`](https://github.com/usehenri/henri/commit/a4ecba50c663f4d5c741adbb6cd9bc0eefe0e5cc), [`baec3fd`](https://github.com/usehenri/henri/commit/baec3fd22be92bf8ffbaeb251b0b6c2771f8347a), [`e865d94`](https://github.com/usehenri/henri/commit/e865d945d65419ac676f5a2fe3ba3b6114a1e53d), [`4274567`](https://github.com/usehenri/henri/commit/4274567e20a980657f07df9ec7db25296c7d55f5), [`aea429c`](https://github.com/usehenri/henri/commit/aea429ca99338a62370ab3e3d94bdc6b8c227601), [`8a8e3b3`](https://github.com/usehenri/henri/commit/8a8e3b33d7967b81f66633aa25c3075318f01d60), [`18715f9`](https://github.com/usehenri/henri/commit/18715f90ea8958dc57da1bb029b8209c36b84cc6), [`831aa5c`](https://github.com/usehenri/henri/commit/831aa5c011f3432630c68b8d26755d2582f82f74), [`16824e8`](https://github.com/usehenri/henri/commit/16824e8fe9ccc6a04dab5d9b2481c29ff4f6b64b), [`fda9366`](https://github.com/usehenri/henri/commit/fda9366e9ed2b072764a995c5aa60205ca7a4725), [`1a86acb`](https://github.com/usehenri/henri/commit/1a86acbf15e4a43e5fb81277bb22e101c06e77a4), [`0b32fbd`](https://github.com/usehenri/henri/commit/0b32fbde19c95da8fe07fab76933840a4242c71c), [`c0c16e8`](https://github.com/usehenri/henri/commit/c0c16e873ba440aee9832160553cbb12ab81bd2c), [`41470bf`](https://github.com/usehenri/henri/commit/41470bf378d83ca3d35d00e8c31796fea5eb15e0), [`8e44e7e`](https://github.com/usehenri/henri/commit/8e44e7e882dd8741b3ac632651b453389d76bf2c), [`de1c1e0`](https://github.com/usehenri/henri/commit/de1c1e02ed83d13dcfeb8e44012f309eb663f03e), [`4b4677d`](https://github.com/usehenri/henri/commit/4b4677d4a09d39fe50b1fa4af577600342578daf)]:
  - @usehenri/core@1.2.0
