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

- [#358](https://github.com/usehenri/henri/pull/358) [`7fd13f6`](https://github.com/usehenri/henri/commit/7fd13f631b75f7aa152b73046b50c6902ae3ca93) Thanks [@reel](https://github.com/reel)! - Bind every password hash to the row it belongs to, so a hash copied onto another row stops verifying.
  
  A hash is a value, and a value can be moved. Someone who can **write** your database but does not have the pepper cannot forge a hash, so they do the next best thing: they take a hash whose password they know — their own account's — and copy it onto somebody else's row, or onto a row they invented. The pepper never saw this coming, because the key is global: the same key recomputes the same hash wherever the bytes land. The pepper answers "you cannot make a hash"; this answers "you cannot move one".
  
  New hashes fold the record's `externalId` (the uuid v7 every record already carries) into what is hashed, keyed by the pepper, and are stored in the same column behind a `$henri-bound$v=1$` marker. No schema change, no migration, and no extra cost per sign-in: the marker says which of the two preimages to build, so verification hashes exactly once. `@node-rs/argon2` has no `associatedData`, and its `secret` is spoken for by the pepper, so the identity goes into a keyed pre-hash — the shape the pepper already used to give bcrypt a key it does not have.
  
  **Upgrading.** Nothing to do, and nobody is locked out. Every hash you have is unbound and keeps verifying; each is written back bound the next time its owner signs in successfully, the same way a bcrypt hash becomes argon2id. The curve of "how many are bound" is the curve of "who has signed in since the upgrade", so it never finishes on its own: an account that never signs in again stays unbound forever. `config.user.password.binding.allowUnbound: false` ends the migration by refusing whatever is left — count before you set it, `SELECT count(*) FROM users WHERE password NOT LIKE '$henri-bound$%'`.
  
  **Set a pepper.** Without `HENRI_PASSWORD_PEPPER` the binding is unkeyed: it still stops a hash being copied, but someone who can write rows can recompute a bound one for the row they are targeting. And be clear about the residual even with a pepper: an attacker who can write anything can also write `external_id`. Freeing the value they need means damaging the row it came from, because the column is unique, so they cannot silently clone their own account — but this is a defence against relocating a hash, not against a writable database.
  
  **Two API changes.** `henri.user.compare()` now wants the user rather than its hash (`henri.user.compare(password, user)`), because a bound hash cannot be checked without the record it belongs to; handing it a bound hash alone rejects with an error that says so instead of answering "invalid credentials" to a password that is right. And a **mass password write that matches more than one row is refused** with a validation error on `password`: one hash belongs to one record, and writing an unbound one instead would quietly reopen the door. `User.create()`, `user.save()`, `user.update()`, `User.findByIdAndUpdate()`, `User.bulkCreate()`, `insertMany()` and a `Model.update()` whose condition matches one row are all unaffected.
  
  `config.user.password.binding` is `true` (the default), `false`, or `{ enabled, allowUnbound }`. A user model that opted out of `externalId` cannot bind, keeps writing exactly the hashes it wrote before, and henri says so at boot.
  
  **`@usehenri/mongoose` fixes two holes this work uncovered.** `Model.insertMany()` runs no document middleware, so it was writing the password it was given **to the collection in the clear** and keeping whatever `roles` came with it — `insertMany([{ email, password, roles: ['admin'] }])` created an admin with a plaintext password. It now hashes and resets roles like every other create. `Model.bulkWrite()` runs no middleware either and would have done the same; a password written that way is now refused rather than stored in the clear.
  
  **`@usehenri/sequelize`** now honours `passwordsHashed` in `bulkCreate` and in the mass update as it already did on `create` and `save`: `bulkCreate(rows, { passwordsHashed: true })` and `User.update({ password: hash }, { passwordsHashed: true, where })` used to hash the hashes, leaving accounts nobody could sign in to.

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

- [#393](https://github.com/usehenri/henri/pull/393) [`93060a8`](https://github.com/usehenri/henri/commit/93060a86df795dbbd99bf1895beb0cf14c4b86de) Thanks [@reel](https://github.com/reel)! - Every entry point an application calls checks what it is called with.
  
  JavaScript is not strongly typed and TypeScript erases at runtime, so henri validates exhaustively at its boundaries and trusts what is inside. The configuration was the first boundary and the request a controller answers was the second. This is the third and the last one an application can reach: the roughly fifty methods on `henri.*`, on `req` and on `res`.
  
  Until now some of them threw something a person could act on, some threw a `TypeError` three frames down naming a variable of henri's rather than the mistake, and some did nothing at all — so the application found out later, or never.
  
  **A call henri cannot honour raises `HENRI_ARGUMENT_INVALID`**, naming the method, the argument, what was expected and what arrived, with every problem reported rather than the first:
  
  ```
  henri.cache.fetch(fn) must be a function, but it is the number 42
  req.pagination(overrides.perPage) must be a whole number above zero, but it is the string "abc"
  res.render(options) must be an object, but it is the string "oops"
  henri.privacy.erase(options.stratgy) is not one of its options: did you mean "options.strategy"?
  ```
  
  The signatures are data (`src/base/arguments.js`) in the node vocabulary `config-schema.js` already established — no dependency, and no second schema language: `config-validate.js` gained `problems(node, value, key)`, so one walker serves both, and it learned the two kinds a call can pass and a JSON file cannot, `function` and `date`.
  
  **Eight of these were answering something wrong rather than refusing**, and those are the changes worth reading:
  
  - `res.negotiate({})` answered `406 Not Acceptable`, which blames the client's `Accept` header for a mistake in the controller; a non-function handler threw from inside express with no henri frame in the stack.
  - `res.render(route, 'oops')` read the string as a GraphQL query — and said so only in development. `data` and `graphql` together silently discarded the data.
  - `req.pagination({ perPage: 'abc' })` produced `NaN` and handed it to the ORM as `.limit(NaN)` and to the HAL paging links.
  - `res.resource(record, null)` threw a destructuring `TypeError` from the parameter list, over the good message just below it; a non-array `include` reached a substring match where it **un-hides a field marked `personal: { expose: false }`**.
  - `henri.privacy.erase(record)` took any object as the person it named, so a record carrying no primary key reached the erasure as `{ id: undefined }` — every row, on some adapters.
  - `henri.mail.send(message)` with no recipient succeeded under `NODE_ENV=test`, where the transport is nodemailer's json one, and failed only in production.
  - `deliverLater({ delay: 60 })` ignored the misspelled key, which is a mail that leaves immediately.
  - `henri.cache.fetch()` refused a bad `ttl` only _after_ the function had run, so it rejected the call and threw away the value it had just computed.
  
  **A selector that names nothing is its own refusal**, `HENRI_ARGUMENT_UNKNOWN_TARGET`: `henri.retention.sweep({ only: 'Propsal' })` and `henri.encryption.rotate({ model: 'Usr' })` used to report a clean, successful, empty run, which is exactly what somebody reads as the work being done — an operator dropping the old key after a rotation that rotated nothing.
  
  Three rules decide where a check goes, and each is in the module header. **An argument is checked once, at the method an application names**: `henri.can()` and `req.can()` both funnel into `henri.policies.can()`, so that is the one that checks, and the loops in `links()`/`paths()` ask an unchecked body they share. **`null` is not the same as absent for an argument** — `options = {}` only fills in for `undefined` — and _is_ the same for a selector inside an options bag, though not for a key whose absence has a default. **A check never goes inside a loop of henri's own**: `res.collection(records)` checks the list and not the rows, and `henri.encryption.encrypt`/`decrypt` guard by hand with three `typeof`s and no allocation, because the adapters call them once per row per encrypted column. The checks run in production too: there is no build step to compile them out, and a check missing from the one place a wrong call is expensive is not worth having.
  
  **What already refuses well was left alone, and saying so is part of it.** A bad cache key, an unstorable cache value, a trail entry with no action, an unknown mailer and a model's own declarations all keep their own codes and messages. `henri.model.errors()`, `henri.policies.get()` and `henri.config.has()` stay total and answer `null` or `false`. `henri.reporter.report()` stays deliberately lenient — it runs on a failure path, so refusing a wrong call there would lose the failure it was called about — and its `null` options no longer read as "the error handler threw".
  
  **None of it can fall behind.** `src/__tests__/arguments.spec.js` walks the surface the way the configuration's own test does: every method `index.d.ts` declares is checked or listed with the reason it is not, every declared signature is checked somewhere in the source, and every entry point is called with garbage derived from its own declaration. A new public method that forgets its check fails it. The declarations moved with the code — `res.negotiate()` now takes an html handler, a json one, or both and never neither, `RenderOptions` is `data` or `graphql` and never both, an erasure strategy is one of the four henri has — and `types/core.test-d.ts` makes eleven of the wrong calls part of the type test.

- [#401](https://github.com/usehenri/henri/pull/401) [`e031900`](https://github.com/usehenri/henri/commit/e031900082f28aec72af4cda9cd959f932e2ebc7) Thanks [@reel](https://github.com/reel)! - The user module and the account flows check what they are called with.
  
  They were the two interfaces the previous pass left out of `base/arguments.js` on purpose, because everything they do sits on an authentication path, where a refusal that says too much becomes an account-enumeration oracle. Both come off that list now, and the line is drawn by **whose mistake it is**: a value the caller chose is a coded refusal, a value a visitor sent keeps the answer it always had.
  
  **`henri.user.compare()` never resolves `false`, and its failures are told apart by their code and by nothing else** — the message a mismatch carries is the one word it always was, so handing it to a client says exactly what it said before:
  
  - `HENRI_USER_PASSWORD_MISMATCH` is a wrong password **and** no account at all (`null`), which cost the same: an address nobody has is now checked against a hash bound to a uuid no row has, the way `POST /login` already checks an unknown address, so your own sign-in endpoint cannot be timed to find out which addresses are registered.
  - `HENRI_USER_PASSWORD_UNVERIFIABLE` is a record carrying no hash to check against. `findById()`, `req.user` and a deserialized session all deselect the password column, so passing one of those answered "invalid credentials" to the right password, for ever.
  - `HENRI_ARGUMENT_INVALID` is a second argument that is not a user.
  
  **Eight more were answering something plausible rather than refusing**, and each of these is what somebody eventually debugs:
  
  - `henri.user.publicUser(42)` answered a user-shaped object carrying an identifier that named no row — and that object goes to a view and to a JSON body.
  - `henri.user.encrypt(password, { identiy: user })` hashed happily and wrote an **unbound** hash: the whole of `config.user.password.binding` gone, with nothing said anywhere. The near miss is now named.
  - `henri.accounts.urlFor(42)` built `https://example.com42` and mailed it.
  - `henri.accounts.tokenFor(user, 'reset')` — the _key_ of `PURPOSE`, not its value — minted a link that was given the confirmation seed and that nothing henri mounts could ever spend: a link generated successfully that will always fail.
  - `henri.accounts.register(null)` threw a `TypeError` one frame down.
  - `henri.accounts.sendReset(42)`, `sendConfirmation(42)` and `requestPasswordReset(42)` each did nothing at all, quietly, and answered as if they had.
  - `henri.accounts.requestEmailChange(42, address)` answered `{ email: 'could not be changed' }`, blaming the address for a wrong user.
  - `henri.accounts.allowed(undefined)` — a gate — answered **yes** about nobody, because the branch that says "confirmation is off" answers before it looks at the record.
  
  **A user with no identifier is nobody, not the string `"undefined"`.** The three adapters answer `userId()` with `String(user._id || user.id)`, so a record carrying no key came back as a truthy nine-letter string that every guard written against it let through: `serializeUser()`'s `if (!id)`, `accounts.identify()`'s `null`, and the `id` of the public user. It then named a session, the subject of a signed token and the user a view was handed. The adapter facade reads it back as nobody now, whichever half answered.
  
  **What a visitor sent is not checked, and that is the point.** `resetPassword(token, password)` and `confirm(token)` take whatever followed the link and answer `reason: 'malformed'` or `reason: 'password'`, which is what an expired, a spent and a forged link all answer; `requestEmailChange`'s address answers `{ errors: { email } }`, because it has a form to put the message on; `validatePassword()` stays a verdict and never a throw; and `findByEmail()` / `findById()` still answer the `null` an unknown address answers, for every value that names nobody. `requestPasswordReset(email)` and `requestConfirmation(email)` are the pair in between — they answer `Promise<void>`, so they have nowhere to say "that is not an address" and refuse anything that is not a string, behind an endpoint that already answers `422` for one, with the same loose test the store validates the column with and never a stricter one.
  
  The reasoning is per method, in the headers of `4.user.js`, `base/accounts.js` and `base/arguments.js`. `src/__tests__/arguments.spec.js` also reads a wrapped declaration properly now: it took the first line of one alone, so every signature written across several lines looked like it took no arguments and was exempt from the whole file.

- [#340](https://github.com/usehenri/henri/pull/340) [`62fac46`](https://github.com/usehenri/henri/commit/62fac46fd6cae5581979b73daf99700fd246e0ea) Thanks [@reel](https://github.com/reel)! - The environment configures an application: `DATABASE_URL` and any configuration key.
  
  `DATABASE_URL` sets `stores.default.url`, the way Rails has read it forever and the way every hosting provider hands you a database. It carries no `HENRI_` prefix on purpose — a prefixed alias would mean writing `HENRI_DATABASE_URL=$DATABASE_URL` in every deployment — and it applies only when the configuration already declares a `stores.default`, since a url does not say which adapter to load; when it does not, the boot says so and moves on.
  
  Every other key is `HENRI_CONFIG__<key>`, `__` between the path segments and the segments verbatim: `HENRI_CONFIG__port=8080`, `HENRI_CONFIG__stores__reporting__url=...`, `HENRI_CONFIG__user__afterLogin=/dashboard`. **The type comes from the configuration file, henri never guesses it**: a number for `port`, `true`/`false` for a boolean, JSON for an object, and a string for a key no file declares, so a connection string that looks like a number stays a string. `HENRI_CONFIG_JSON__<key>` parses JSON in every case, which is how a nested object or an array is set. A value that does not fit its key fails the boot naming the variable and the type it expected, and so does a variable set to nothing: a missing variable is not an override and never becomes an empty string. No error message ever quotes the value.
  
  Precedence, lowest first: the configuration file, then `HENRI_SECRET` / `HENRI_HOST` / `DATABASE_URL`, then `HENRI_CONFIG__<key>` — the same story as the two overrides that already existed. Every key the environment provided is printed at boot (`config ✏ from the environment => port = 8080 => HENRI_CONFIG__port`), with the names `config.filterParameters` covers masked, plus the password of a connection string, which no filter list would name. `henri.config.fromEnv` holds the `{ key, variable }` pairs, never the values.
  
  A container image therefore needs no configuration file written at start time: commit `config/production.json` and pass the rest as environment variables.

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

- [#388](https://github.com/usehenri/henri/pull/388) [`bcf4ce2`](https://github.com/usehenri/henri/commit/bcf4ce22bcd294844504164fac1fa4aef1ffec41) Thanks [@reel](https://github.com/reel)! - Controllers declare the shape of what each action accepts.
  
  `req.permit('title', 'year')` picks fields by name and says nothing about what they hold. `?year=banana` reached the model, and what a person saw was whatever the ORM said — a 500 on a good day, a silent `NaN` on a bad one. There was no way for an action to say what it takes.
  
  There is now, in the block `before` already established: an export the router reads, keyed by action, never an action itself.
  
  ```js
  module.exports = {
    params: {
      all: { format: { type: 'string', enum: ['html', 'json'] } },
      create: {
        title: { type: 'string', required: true, maxLength: 120 },
        year: { type: 'integer', min: 1400, max: 2100 },
        tags: { type: 'array', of: 'uuid', maxLength: 5 },
      },
      'index,search': { page: { type: 'integer', min: 1, default: 1 } },
    },
  
    create: async (req, res) =>
      res.resource(await Task.create(req.permit()), { status: 201 }),
  };
  ```
  
  The vocabulary is the one the models already use — `type`, `required`, `default`, `enum` — plus the bounds a request genuinely needs: `min`/`max` for a number, `minLength`/`maxLength` for a length (characters of a string, items of a list), `pattern`, and `of` for a list, which a query string produces on its own. No dependency was added and no second vocabulary invented.
  
  **Coercion is the interesting half, and the source is the rule.** A textual source — the query string, a path parameter, a form body — is _parsed_ into the declared type: `?page=2` arrives as the number `2`, `?active=on` as `true`, `?at=2024-01-02` as a `Date`, because a string is all a client can send there. A JSON body is _checked_ and never parsed: `{"page": "2"}` is a caller sending a string where a number was declared, and it is refused. JSON can say `2`; it said `"2"`.
  
  What is accepted is written back where it came from, so `req.query.page` is the number and not the string, and `req.permit()` **with no field at all** answers everything the declaration accepted, defaults included. An undeclared key is still dropped, never refused — a bookmarked url carrying `utm_source` is a link somebody shared, not an attack.
  
  A request that does not match never reaches the action. It answers `422` with one message per field under `data.errors` — the `{ field: message }` shape `henri.model.errors()` already normalizes an ORM's validation failure to, so a form reads one thing whichever side refused it — and carries `HENRI_PARAMS_INVALID`. A browser that posted a form goes back to the page it came from with the messages in the flash; anything else gets the negotiated page or the JSON.
  
  **A declaration henri cannot carry out fails the boot**, naming the controller, the action and the key (`HENRI_PARAMS_DECLARATION_INVALID`): an unknown type, an unknown key (`requird`), a constraint the type does not take (`min` on a string), a `default` the rule itself refuses, a selector naming an action the controller does not export. A declaration that quietly accepts everything is the failure this exists to remove.
  
  The check runs where the guards already are: behind the role guard and the policy, ahead of the `before` hooks, so a hook that loads a record already sees the coerced value. An action that declares nothing is untouched, and `req.permit(...)` is unchanged.

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

- [#350](https://github.com/usehenri/henri/pull/350) [`4274567`](https://github.com/usehenri/henri/commit/4274567e20a980657f07df9ec7db25296c7d55f5) Thanks [@reel](https://github.com/reel)! - Three answers to the dynamic pass: `Permissions-Policy`, a Content Security Policy without wildcards, and a password below the policy as a validation failure.
  
  The ZAP baseline scan that `henri audit` now has a companion for reads the answers a running application gives, and it found two headers and one status code worth changing.
  
  **`Permissions-Policy` is sent for every application.** helmet sets no such header, and an absent one is a permission granted: any script the page runs may ask for the camera, the microphone or the location, and the person is prompted. henri denies them, along with the other powerful features. Name the ones you use with `config.helmet.permissionsPolicy` (`"geolocation=(self)"`), or `false` to send nothing.
  
  **The Content Security Policy names its origins.** helmet's defaults leave `https:` in `style-src` and `font-src`, which is every host on the internet. A stylesheet or a font from somewhere else is now an origin you name in `config.helmet`, like a script already was.
  
  **A password below the policy is a 422, not a 500.** `henri.user.encrypt()` threw a plain `Error`, so a `User.create()` with a short password came out of the adapter as an unrecognized failure: `henri.model.errors()` answered `null`, the controller rethrew and the person got a 500 carrying the raw message. It now throws with the shape every adapter rejects an invalid write with, so a controller that already handles a validation failure handles this one without knowing it exists:
  
  ```js
  try {
    user = await User.create(req.permit('email', 'password'));
  } catch (error) {
    const errors = henri.model.errors(error); // { password: 'must be at least 12 characters' }
  
    if (!errors) {
      throw error;
    }
  
    return res.boom.badData('the account could not be created', { errors });
  }
  ```
  
  The error also carries `codes` (`missing`, `too_short`, `too_long`) for a client that translates the message itself.

- [#347](https://github.com/usehenri/henri/pull/347) [`aea429c`](https://github.com/usehenri/henri/commit/aea429ca99338a62370ab3e3d94bdc6b8c227601) Thanks [@reel](https://github.com/reel)! - Raise the security floor: argon2id hashing, a password policy, a per-account sign-in lockout, an origin check on CSRF, and bounds on the GraphQL endpoint.
  
  **Passwords.** New hashes use argon2id when `@node-rs/argon2` resolves — a new `optionalDependency` of `@usehenri/core`, so the install picks up a prebuilt binary where one exists and skips it silently where none does — and bcrypt at cost 12 (was 10) otherwise. Both formats always verify, and a hash below the current parameters is written again the next time its owner signs in successfully, which is how an application changes algorithm without a migration. `config.user.password` configures the algorithm and its parameters, and takes an optional `pepper`: a server-side key, its own rather than `config.secret`, that makes a stolen table useless offline. Losing the pepper makes every peppered password unverifiable.
  
  **The minimum password length moves from 6 to 12**, configurable as `config.user.password.minLength` with a floor of 8, plus a 72 byte maximum so bcrypt never silently truncates. The policy governs setting a password and is never applied when verifying one, so nobody already registered is locked out. `henri.user.validatePassword(password)` answers `{ valid, errors: [{ code, message }] }` without throwing, for a form that has to say what is wrong.
  
  **Per-account lockout.** Ten failed sign-in attempts against one account inside fifteen minutes and it refuses attempts for the rest of the window, whoever is sending them — the rate limiter only ever counted per address. Failures are counted for unknown emails too, so the `429` is not an account-enumeration oracle. `config.user.lockout` retunes or disables it, and takes a shared express-rate-limit store.
  
  **CSRF checks the origin too.** On top of the double-submit token, an unsafe request carrying a session cookie must come from an origin the application recognizes (`Sec-Fetch-Site`, then `Origin`), which is what closes the sibling-subdomain and cookie-injection cases the token alone does not. Requests without a session cookie, and bearer-token requests, are untouched. `config.csrf` takes `{ origin, trustedOrigins }` and inherits whatever `config.cors` already allows.
  
  **GraphQL.** `/_henri/gql` refuses queries past a depth (10), alias (15), complexity (1000 fields, fragments expanded) or token (5000) limit, before a resolver runs, and stops resolving when the client disconnects or the request times out. `config.graphql` is now an object as well as a path, adding `authenticated`, `roles`, `loopbackOnly` and `introspection`: the endpoint had no guard of its own.
  
  `@usehenri/mongoose` gains `save({ passwordsHashed: true })`, which writes a hash straight through the way the sequelize and drizzle adapters already did; core uses it to upgrade a stored hash after a successful sign-in.

- [#378](https://github.com/usehenri/henri/pull/378) [`8a8e3b3`](https://github.com/usehenri/henri/commit/8a8e3b33d7967b81f66633aa25c3075318f01d60) Thanks [@reel](https://github.com/reel)! - A Sequelize store stops changing the production schema by itself, and `henri db:status` reads it back
  
  Until now every SQL boot ran `sequelize.sync()`, in every environment. In development that is the point; in production it was DDL applied at boot, from whatever the models happened to say, with nobody reviewing it — and because `sync()` only creates what is missing and never alters what exists, it also hid every table that was already wrong.
  
  A production boot now changes nothing. It compares the database with the models instead and warns about each difference. A store that wants the old behaviour asks for it with `"sync": true`, which `henri audit` reports as `schema.autosync`. Development is unchanged, and so is the drizzle adapter, which already refused to push in production.
  
  `henri db:status` now answers on a Sequelize store (`mysql`, `postgresql`, `mssql`), which is the one `db:` command they can honestly serve: it reports a missing table, a missing column, a column whose type or nullability differs, a missing index, and a column that is in the database and in no model. `--sql` writes the DDL that would close the difference, for you to read and run — henri applies none of it and never writes a `DROP`. `--json` carries `clean` and the differences, so a deploy can check that production matches the code. On sqlite a column change is reported without a statement, because sqlite has no `ALTER COLUMN`.
  
  The Sequelize adapters still have no migrations and are not getting any: generated, versioned migrations are the drizzle adapter's, and the upgrade guide now documents the path from a `sync()`-built database to drizzle migrations without dropping it. `henri db:generate`, `db:migrate` and `db:push` on a Sequelize store answer the new `HENRI_CLI_MIGRATIONS_UNSUPPORTED` and point there. `henri doctor` gained `schema.migrations-ignored` and `schema.migrations-pending`.

- [#389](https://github.com/usehenri/henri/pull/389) [`831aa5c`](https://github.com/usehenri/henri/commit/831aa5c011f3432630c68b8d26755d2582f82f74) Thanks [@reel](https://github.com/reel)! - Logs a machine can read, and one place an application hears about the failures henri catches.
  
  **`config.logs.format`.** `henri.pen` is a pretty printer — aligned module names, colours, a pencil, `+3ms` — which is the right output in a terminal and the wrong one everywhere an application runs: nothing can index it, no field can be queried, and the timestamp, the level, the module name and the request id all exist in the process and are spent on alignment. `"json"` writes one object per line instead: `time` (ISO 8601, UTC), `level`, `module`, `requestId` (the one `X-Request-Id` already threads through `pen`), `msg`, `data` — every object argument — and `err`, with the failure's [error code](https://usehenri.io/reference/errors/) and its `cause` chain. Nothing else: no hostname, no pid, no version, because whatever runs the process knows those better than henri does.
  
  `"auto"` is the default and it is json in production, pretty everywhere else. The environment decides it and not the terminal: a container writes to a pipe and so does a development server behind a process manager, so a format that changed with whether stdout happens to be a tty would be one nobody could rely on. Every `pen.info` / `warn` / `error` / `fatal` call site keeps working and the pretty output is unchanged.
  
  **The masking is not optional.** Every object that becomes a field goes through the masking the pretty output already applied, at every depth: `config.filterParameters` as substrings, and the fields the models marked `personal` matched exactly — one redactor now, in `base/redact.js`, shared by `pen` and the reporter, so "the same masking" is a fact rather than two implementations that agree today. That is the whole risk of the change, said out loud: a logger is a machine for faithfully serializing whatever object it was handed, where the pretty format used to summarize it into a line nobody parsed. A _message_ is still not masked, in either format. No logging dependency was added — pino and winston bring transports, serializers and a version to follow into ten published packages, and what was needed is one file.
  
  **`henri.reporter`.** The other half. henri answers failures and tells nobody: a module that will not start fails the boot and prints a stack, a request that throws gets a 500 and a log line, a rejection nobody handled reaches `pen.fatal`. `henri.reporter.onError(handler)` — the shape `henri.mailers.onDeliverLater()` established: one handler, `null` removes it — hears all three, once each. It is built with the instance rather than registered as a module, because the first failure worth reporting is a module that would not start.
  
  The handler gets `{ at, code, error, meta, request, requestId, source }`, and what it never gets is the point: **nothing that came from the client and nothing about a person.** `request` is the method, the route _pattern_ (`/artworks/:id`) and the status — no url, no query string, no body, no params, no headers, no cookies, no session, no user; the path is left out because `/users/ada@example.com` is a path in some applications and a personal field in all of them. Two deliberate exceptions: the `error` is handed over untouched (a reporter exists for the stack), and `meta` is whatever `report()` was called with, masked like a log line.
  
  A 4xx is not reported — it is an answer, not a failure. `pen.fatal()` does not report, because it returns an Error and whoever throws it is the one who knows whether it ends a boot or a request. A dead job does not either: `@usehenri/jobs` already keeps the arguments, every attempt and the error in a durable row that `henri jobs:dead` reads back. A handler that throws is logged and forgotten, one that hangs is given up on after two seconds — so it takes neither the request nor the boot with it — and no handler at all costs a property read.
  
  New configuration key `logs` (`format`: `auto`, `json`, `pretty`), new `henri.reporter`, and a new [Logs and error reporting](https://usehenri.io/guides/logs/) guide. OpenTelemetry and vendor integrations are explicitly out of scope: this is the seam they sit on.

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

- [#374](https://github.com/usehenri/henri/pull/374) [`0b32fbd`](https://github.com/usehenri/henri/commit/0b32fbde19c95da8fe07fab76933840a4242c71c) Thanks [@reel](https://github.com/reel)! - `henri.cache`: a cache store with `fetch`, on this process's memory or on the backend `config.shared` already names.
  
  `henri.cache.fetch(key, [options], fn)` answers from the cache or runs the function and keeps what it returned; `get`, `set`, `delete`, `clear` and `scope(name)` are the store underneath, and `stats()` says what it has been doing. Every entry has a TTL (`config.cache.ttl`, five minutes by default) — there is no way to keep a value forever, by accident or on purpose.
  
  **The stampede.** A key that expires under load is missed by every request at once. `fetch` keeps one promise per key while the function runs and hands it to everyone who missed it, so a hundred concurrent misses of one key in one process run the function once. Across processes the bound is the number of processes, deliberately: a cross-process lock needs a lease, and a lease means guessing how long the function may take — guess short and it runs twice anyway, guess long and one crashed process blocks every reader of that key.
  
  **Two backends, named once.** Without `config.shared` the cache is this process's memory, bounded twice (`maxEntries`, 1000, and `maxSize`, 32mb) and evicting the least recently used, so it cannot become a leak. With `config.shared` — the block that already says where the rate limit, the sign-in lockout and the idempotency keys are counted — the cache is on that backend, in a key space of its own, with nothing else to configure. `config.cache.store` still names a module of its own for whoever wants the cache somewhere the counters are not.
  
  **What a value may be.** JSON, plus `Date` (which comes back a `Date`). A model instance, any other class instance, `undefined`, `NaN`, `Infinity`, a `Map`, a `Set`, a `Buffer`, a `RegExp`, a function, a symbol, a bigint or anything circular is refused with `HENRI_CACHE_VALUE_UNSUPPORTED`, naming where it sat and what it was but never what it held — rather than stored to come back wrong. A value bigger than `maxEntrySize` (256kb) is not stored at all: `set` answers `false` and says so once, and nothing is ever truncated.
  
  **A backend that is down is a miss**, whatever `config.shared.onError` says. The counters block because a guard that cannot count is not a guard; a cache holds no truth, so refusing a request over a copy would turn an optimization into an outage. Every fallthrough is logged at most once every ten seconds, like the counters'. Keys reaching a log line are masked by `config.filterParameters`, and values never reach one.
  
  **henri invalidates nothing for you**: no model callback, no query cache, no route. `delete` is yours to call, and with the memory backend it reaches one process — which is the reason a deployment running several of them wants `config.shared`.
  
  New configuration key `cache` (`ttl`, `maxEntries`, `maxSize`, `maxEntrySize`, `store`, `enabled`; `false` turns the cache off). `@usehenri/redis` gains a raw mode on its key-value store, so the cache's already-encoded entry is not wrapped in JSON a second time, and a `clear(prefix)` that walks its own key space with `SCAN` and `UNLINK` — never `FLUSHDB`. See the new [Caching](https://usehenri.io/guides/caching/) guide.

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

- [#362](https://github.com/usehenri/henri/pull/362) [`9173000`](https://github.com/usehenri/henri/commit/91730005efa88f073bfaaf67078c3ec0e137b459) Thanks [@reel](https://github.com/reel)! - The development file watcher moves to chokidar 5
  
  It watches the same directories and reloads the same way; the major is chokidar's own, not a change in what henri does with it. Verified against a booted application: touching the controllers still reloads every module.

- [#310](https://github.com/usehenri/henri/pull/310) [`b161e1b`](https://github.com/usehenri/henri/commit/b161e1b8fad94af2d2afc351dc1bc07dabbb1379) Thanks [@reel](https://github.com/reel)! - `upgrade-insecure-requests` is only sent to requests that arrived over https.
  
  On a page served over plain http the directive rewrote every later request of that page to https, including the redirect a controller answers after a `POST`. The record was written and the browser then failed against a server that speaks http, so the page never followed the redirect and the form looked broken with only a network error in the console. It hit every app checked with `henri build && henri server --production` locally and every deployment served over http. The directive now follows `req.secure`, which honours `trustProxy` and `X-Forwarded-Proto`, so apps behind a TLS proxy keep it and `config.helmet` can still add it everywhere.

- [#343](https://github.com/usehenri/henri/pull/343) [`9f868f3`](https://github.com/usehenri/henri/commit/9f868f3d9162fa218e34304110210e6949f97d5c) Thanks [@reel](https://github.com/reel)! - The development server finds its port by binding rather than by asking first, and `detect-port` is no longer a dependency.
  
  Asking whether a port is free and binding it afterwards leaves a window for anything else to take it in between: the same race that made the test suite answer from the wrong server. The server now binds the port it wants and walks up on `EADDRINUSE` in development, where a busy port outside development stays an error the operator sees. That also removes a package from every henri application's dependency tree, which is one fewer thing that can lose its provenance.

- [#324](https://github.com/usehenri/henri/pull/324) [`3c1c5b8`](https://github.com/usehenri/henri/commit/3c1c5b83ea135b000ddd6ffbfd05457b000f2f7c) Thanks [@reel](https://github.com/reel)! - Under `NODE_ENV=test` the server lets the kernel hand it a port instead of looking for a free one first.
  
  `server.start()` called `detect(port)` and then `listen()` on whatever it answered, which is two operations with a gap in between: anything else binding meanwhile — another suite booting its own application, a supertest listener, a database picking a port the same way — could take it, and the boot then failed with `port 3000 already in use`, or worse, succeeded on a port another suite believed it owned and answered its requests. Asking for port `0` is a single operation and cannot race; `henri.server.port` and `henri.server.url` report the port the kernel gave. Development and production keep the port from the configuration.

- [#338](https://github.com/usehenri/henri/pull/338) [`aa3f90b`](https://github.com/usehenri/henri/commit/aa3f90bd6f42bb05431c33f3e4bf2202cb6bb7c6) Thanks [@reel](https://github.com/reel)! - The derived plain text part of a mail no longer keeps a fragment of a malformed tag. Stripping tags in one pass turns `<scr<script>ipt>` into `<script`, and an unterminated opener matches no tag pattern at all, so a crafted or simply broken document left something element shaped in the text a reader sees. Tags are now removed until the string stops changing, and a leftover opener is dropped. A less-than sign that is not a tag is untouched.

- [#398](https://github.com/usehenri/henri/pull/398) [`ec1c8c4`](https://github.com/usehenri/henri/commit/ec1c8c419f4d9063a7617472b2970fdb8a929fa1) Thanks [@reel](https://github.com/reel)! - The boot report masks the password of a connection string wherever the string
  is, not only when the value is the url itself.
  
  `DATABASE_URL` has always printed `postgres://henri:[FILTERED]@host/db`. The
  same url arriving inside an object — `HENRI_CONFIG_JSON__stores`, or a store
  block from the encrypted credentials — went through the redaction that matches
  _key names_, and `url` is a name no `filterParameters` list would ever hold, so
  the password was printed in the clear. Both paths now walk the value and mask
  every connection string in it.

- [#390](https://github.com/usehenri/henri/pull/390) [`01a561a`](https://github.com/usehenri/henri/commit/01a561aa58650ec15df1c2659795a5e4c5bbfd53) Thanks [@reel](https://github.com/reel)! - Two places the logs printed what everything else masks.
  
  `config.encryption.keys` is the key that opens every encrypted column. `0.config.js` keeps it out of the configuration report and out of every validation message, and only the eight character key id reaches a message — but that covers the paths henri prints itself. An application that logs its own configuration, which a structured `json` line now serializes faithfully, printed the key in full:
  
  ```
  { encryption: { keys: [ 'deadbeef…deadbeef' ] }, password: '[FILTERED]' }
  ```
  
  because the substring filters are `password`, `token`, `secret` and `authorization`, and none of them is `keys`.
  
  The fix is not a fifth default filter: `config.filterParameters` **replaces** the list, so an application that adds `apiKey` to it, or sets it to `false`, would take the protection away by widening it. `base/redact.js` gained an `ALWAYS_MASKED` of its own instead — the `ALWAYS_MASKED` of `0.config.js` one level down, the same name matched as a substring over any object rather than as a configuration path. Anything containing `encryption` is masked in everything `henri.pen` writes, in both formats, whatever `filterParameters` says, and there is no setting that turns it off. It is a substring so that it masks the whole `encryption` block rather than one name inside it; the cost is that a field called `encryptionStatus` is masked too, which is the collateral `password` already takes on `passwordChangedAt`. It also closes a third path: `HENRI_CONFIG_JSON__encryption='{"keys":[…]}'` arrives under the path `encryption`, which the configuration's own list — `encryption.keys` — did not cover, and the boot report printed it.
  
  Second, `config.requestTimeout` logged `req.originalUrl` unredacted, so a request that timed out wrote to the log what the 500 path is careful not to — a `?token=…`, an address in a query. It now goes through the same masking, and so does the `DEBUG=henri:csrf` line for a refused cross-origin request. Both of those, and the error handler, take the masking from the running instance now (`urlRedactor()`), so a query parameter named by the application's own `filterParameters` or by a `personal` model field is masked in a log line too — the error handler had been using the built-in defaults only.

- [#346](https://github.com/usehenri/henri/pull/346) [`e865d94`](https://github.com/usehenri/henri/commit/e865d945d65419ac676f5a2fe3ba3b6114a1e53d) Thanks [@reel](https://github.com/reel)! - Two things the routes file used to do quietly.
  
  A route declared twice now warns at boot when the later entry points at a different controller, naming both entries and both controllers. Later still wins, which is what lets a line correct a `resources` block above it, and repeating the same entry stays silent.
  
  A controller name is now checked where it is written. `{ controller: 'ship ' }` used to travel all the way to the loader and surface as a missing controller, sending you to look for a file that was right there; it now fails at boot naming the route and saying what a controller name may contain. The same applies to the action after the `#`.

- [#326](https://github.com/usehenri/henri/pull/326) [`18715f9`](https://github.com/usehenri/henri/commit/18715f90ea8958dc57da1bb029b8209c36b84cc6) Thanks [@reel](https://github.com/reel)! - Three fixes found by building a full application on the framework (`showcase/`).
  
  `henri db:seed` boots the user module. It stopped at runlevel 3 (the models), and creating a user goes through `henri.user.encrypt()` to hash its password, so any `db/seeds.js` that wrote a user failed with `Cannot read properties of undefined (reading 'encrypt')` — which is every seed file of an application with authentication. Seeds now boot to runlevel 4; the migration commands still stop at 3, since they need no session.
  
  `henri generate agents` reads the store from the configuration. It always wrote an `AGENTS.md` describing the `disk` adapter and the Mongoose query API, whatever the application ran on, so a coding agent in a Drizzle or Sequelize application was handed the wrong model API in the first paragraph it read. The renderer was already read from the configuration; the adapter now is too (`adapterOf()`, next to `apiOf()`).
  
  The HAL guard leaves Inertia page objects alone. A route expanded from `resources` or `crud` reported (and, with `config.api.strict`, refused with a `500`) every JSON answer without `_links` — including the `{ component, props, url, version }` object the Inertia view engine answers a client-side visit with, which is a rendered page and not an API answer. Navigating between two pages of a `resources` route under `api.strict` answered `500`; without it, every visit logged a false warning. Answers carrying the `X-Inertia` header are no longer checked.

- [#353](https://github.com/usehenri/henri/pull/353) [`16824e8`](https://github.com/usehenri/henri/commit/16824e8fe9ccc6a04dab5d9b2481c29ff4f6b64b) Thanks [@reel](https://github.com/reel)! - henri says when a renderer is installed and never configured
  
  `config.renderer` defaults to handlebars, which is right for an application with no view engine and confusing for one that installed `@usehenri/inertia`, wrote pages and wonders why they are not the ones being rendered. Nothing fails, so nothing said anything.
  
  The boot now names it once:
  
  ```text
    view ✏  @usehenri/inertia is installed but "renderer" is not set, so pages are rendered with handlebars => add "renderer": "inertia" to your configuration
  ```
  
  Only when the key is absent. An explicit `"renderer": "template"` is a decision and is left alone.
  
  Closes [#40](https://github.com/usehenri/henri/issues/40), open since 2018.

- [#399](https://github.com/usehenri/henri/pull/399) [`c0c16e8`](https://github.com/usehenri/henri/commit/c0c16e873ba440aee9832160553cbb12ab81bd2c) Thanks [@reel](https://github.com/reel)! - `henri openapi` describes the parameters an action declared, and the 422 they answer.
  
  The parameter check of a `params` declaration is registered next to the guards whatever the verb, so a `GET` declaring `page: { type: 'integer', min: 1 }` answers 422 on `?page=banana`. The document tied 422 to `mutating && idempotency`, so it denied that answer — and where it did emit one, the component said the `Idempotency-Key` had been reused, which is a different failure fixed a different way.
  
  The document now reads the declarations, from `henri.controllers.accepts()` on a booted application and from the same `declarations()` compiler over the controller files in the command, so both write the same document:
  
  - the declared fields are the query, path and body parameters of the operation, with the types, the bounds and the enums the rule wrote. A mutating action that declares `params` gets that as its request body — what henri actually checks — instead of the model's writable columns, which stay in `components.schemas` as `<Model>Input`.
  - every 422 names its cause: `InvalidParameters` (the parameter check), `IdempotencyMismatch` (the key was reused for a different request), `UnprocessableEntity` (both can happen on that operation), and `ValidationFailed` for the account endpoints henri mounts, which used to share the idempotency wording.
  - a controller the command could not load, or whose declaration would fail the boot, is marked rather than described as accepting nothing: `x-henri.params.read: false` on the operation, `info.x-henri.params.unread` in the document and a section in `henri openapi --summary`.
  
  `x-henri.enforced` is a list now (`['_links', 'params']`), because a route can enforce both.

## 1.1.0

### Minor Changes

- [#308](https://github.com/usehenri/henri/pull/308) [`f99341c`](https://github.com/usehenri/henri/commit/f99341cdf05b9306bfca0c8385aee1661fc77f4f) Thanks [@reel](https://github.com/reel)! - The JSON API follows HATEOAS (HAL), honours `Idempotency-Key`, is rate limited and picks up the Rails request conventions.
  
  - `res.resource(record, { type, links, status })` and `res.collection(records, { type, page, perPage, total, links })` answer HAL: the public fields plus `_links` (`self`, `collection`, `edit`, `update`, `destroy`; `first`/`prev`/`next`/`last`, `create`, `new` on collections) built from the router's path helpers and filtered by the roles of the current user. Collections embed their items under `_embedded.<type>`, carry `count`, `page`, `perPage`, `total` and the `Link` / `X-Total-Count` headers. `application/hal+json` is served when asked for, `application/json` otherwise; a 201 sets `Location`. `res.negotiate({ html, json })` picks the page or the JSON answer. The JSON branch of `res.render()` keeps its shape and gains `_links`. Routes expanded from `resources`/`crud` that answer JSON without `_links` are reported once per route, and refused (500) when `config.api.strict` is true.
  - `Idempotency-Key` on POST, PUT, PATCH and DELETE routes (Stripe semantics): the first answer is stored for `config.api.idempotency.ttl` (24h) and replayed with `Idempotency-Replayed: true`; a key still in flight answers 409, a key reused with another request 422. Keys are scoped per user, session or ip. `idempotent: false` opts a route out; `henri.api.idempotencyStore` (`{ get, set, delete }`) or `config.api.idempotency.store` plug a shared store.
  - Rate limiting (express-rate-limit, `RateLimit`/`RateLimit-Policy` draft-7 headers, `Retry-After`, 429 through `res.boom.tooManyRequests`): `config.rateLimit` (`{ windowMs: 60000, max: 600 }`, per user or ip, not enforced in development), `POST /login` and the register-style paths at 10 per minute (`config.rateLimit.auth`), and `rateLimit: { windowMs, max }` per route. `config.rateLimit.store` plugs a shared store.
  - `X-Request-Id` is accepted or generated, exposed as `req.id`, echoed on every answer and written in every `pen` line of the request. Helmet secure headers (`config.helmet`) with a CSP that lets Next dev, Turbopack and Vite HMR work in development. `config.filterParameters` (`password`, `token`, `secret`, `authorization`) are masked in everything `pen` prints. Weak ETags and `If-None-Match` → 304 on JSON. `req.pagination()` reads `page` and `per_page` (bounded by `config.api.maxPerPage`). `Accept: application/vnd.henri.v1+json` sets `req.apiVersion`, and the `version` route option refuses other versions with a 406. `GET /_henri/health` pings the stores (200 or 503). `Cache-Control: no-store` on authenticated JSON. `config.bodyLimit` (1mb) and `config.requestTimeout` (30s, 503).
  - `henri generate scaffold|crud` write controllers using `res.resource`/`res.collection`, `req.pagination()` and `req.permit()`, with a 201 + `Location` on create and a 204 on destroy; `henri generate test <name>` checks the HAL links when the name has a `resources`/`crud` route.

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - Login, sessions and request parameters are hardened and work on every adapter.
  
  - User lookups go through the adapter contract (`findUserByEmail`, `findUserById`, `userId`, `toPlain`, with Mongoose/Sequelize fallbacks in core), so login on SQL stores checks the right user and sessions hold the right id. `henri.user.findByEmail()`, `findById()` and `publicUser()` are exposed to apps.
  - Only the public representation of a user (`{ id, email, roles }` plus `config.user.public`) reaches views, `req._henri.user` and JSON answers. `config.user` accepts an object: `{ model, public, loginPath, afterLogin, sessionMaxAge }`.
  - `req.permit(...fields)` and `henri.params(req).permit()` return the permitted fields only; use them instead of `req.body` when creating or updating records.
  - The session cookie is `httpOnly`, `SameSite=Lax`, `Secure` in production, lives 30 days by default (`config.user.sessionMaxAge`) and is only written once something is stored in it. `trust proxy` is enabled (`config.trustProxy`).
  - `POST /login` answers `{ user }` to JSON clients and redirects browsers (`config.user.afterLogin`); failures are `401`/`400` or a redirect to `<loginPath>?error=invalid`. `POST /logout` destroys the session; `GET /logout` is deprecated and answers `405`.
  - Double-submit CSRF protection: the `henri.csrf` cookie must be sent back as `X-CSRF-Token` (or `X-XSRF-TOKEN`, the axios/Inertia convention) or `_csrf` on unsafe requests carrying a session (`config.csrf: false` disables it, bearer tokens are exempt). The token is available as `req._henri.csrf` and `withHenri` adds the header to `fetch()` and `hydrate()`.
  - Routes with `roles` deny with `401`/`403` JSON or a redirect to `config.user.loginPath`, and warn at boot when no user model exists instead of crashing per request.
  - The session store survives model reloads: express-session talks to a proxy that follows the current adapter.

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - Lifecycle, HTTP and error-handling hardening of the core.
  
  - Errors are no longer swallowed: a misconfigured store, adapter, view or controller fails the boot with the original error (`henri.init()` rejects with an `Error` whose `cause` is the module error). `pen.fatal()` returns an `Error` to throw.
  - `henri.reload()` is serialized (a call during a reload queues exactly one more run) and only evicts the application's own files from the require cache. `henri.stop()` stops every module even when one fails and resolves with the array of errors. `SIGINT`/`SIGTERM` stop the server gracefully with a 5 s hard-exit timeout; a second signal exits at once.
  - HTTP: the server binds to `127.0.0.1` outside production (`config.host` or `HENRI_HOST` override it), CORS is opt-in (`config.cors`), `x-powered-by` is gone, `/_routes` and `/_controllers` are served only in development and only from loopback. Unmatched routes get a content-negotiated 404 and controller errors a logged, negotiated 500 (message and stack in development only).
  - Mailer: an SMTP/transport object always creates and verifies the transport; `"test"` uses an Ethereal account; `NODE_ENV=test` uses nodemailer's JSON transport unless `henri.forceMail` is set.
  - Handlebars engine: exact page resolution (`pages/<route>.{hbs,html,htm}` then `pages/<route>/index.*`), compiled-template cache invalidated on change and reload, 404 without a page, 500 with the stack logged on template errors, view options exposed as `@user`, `@paths`, `@query` data variables.
  - `graphql.run(query, variables, contextValue)` forwards a context to the resolvers.
  - Configuration: `.env` in the application directory is loaded on boot and `HENRI_SECRET` provides the `secret`.
  - `utils.checkPackages()` never installs anything: it prints the install command for the detected package manager (pnpm, yarn or npm) and throws.
  - The Vue renderer only loads with `experimental.vue: true`. `BaseModule` lost its unused `setup()`, `start()` and `info()` stubs.
  - Removed dependencies: `include-all`, `callsite`, `internal-ip`, `server-timings`, `lodash`, `@inquirer/prompts`, `cross-spawn`, `compare-versions`, `jest`.

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - New `@usehenri/inertia` view engine: the Inertia.js protocol on Vite with React 19 pages and server-side rendering, selected with `"renderer": "inertia"`. Pages read the controller data with `useHenri()`, navigate with `<Link>` and submit with `<Form>` through Inertia's router. `henri new <app> --renderer inertia` scaffolds an application using it; `henri build` produces the client and server bundles.

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - Tests run on Vitest. `henri test` spawns the app's Vitest with `NODE_ENV=test`
  and exits with its code (extra arguments are passed through). `@usehenri/testing`
  boots the app in-process and exports `setup`, `teardown`, `request`, `agent` and
  `henri`, plus `@usehenri/testing/setup-file` for Vitest's `setupFiles` (henri and
  the model globals are available in every test file). The core `tests` module no
  longer loads jest at boot; jest is not a dependency anymore.

### Patch Changes

- [#305](https://github.com/usehenri/henri/pull/305) [`a2cf383`](https://github.com/usehenri/henri/commit/a2cf383d6f3b4405b73816bc38175ad6f308dff4) Thanks [@reel](https://github.com/reel)! - New `@usehenri/drizzle` store adapter on Drizzle ORM: sqlite (better-sqlite3), postgres (pg) and mysql (mysql2) behind one Rails-like model API. An app selects it with `"stores": { "default": { "adapter": "drizzle", "dialect": "sqlite", "url": "file:.henri/app.db" } }` and installs the driver it needs.
  
  - Models compile the henri model format (`string|text|number|integer|float|boolean|date|json|uuid`, `required`, `default`, `enum`, `unique`, `index`, plus `select: false`, `min`, `max`, `minLength`, `maxLength`, `match`, `validate`, `lowercase`, `trim`, `references`) into Drizzle tables per dialect: plural snake_case tables, snake_case columns, `id` primary keys, `createdAt`/`updatedAt` with `options.timestamps`, pg enum types and mysql enums.
  - Model API: `create`, `find`, `findOne`, `findById`, `all`, `count`, `exists`, `pluck`, `update`, `destroy`, `findByIdAndUpdate`, `findByIdAndDelete`, `findOneAndUpdate`, `findOneAndDelete` and their Mongoose and Sequelize aliases; lazy chains `where().order().limit().offset().include().withHidden().first()/last()/count()`; instances with `save`, `update`, `destroy`, `reload`, `changed`, `toJSON`; `ValidationError` with `errors[field].message` (the shape the generated controllers read), unique violations included; `beforeValidate`, `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDestroy`, `afterDestroy` hooks; `belongsTo`, `hasMany`, `hasOne` in `associate(models)` with eager loading through `include()`; `adapter.transaction(fn)` with implicit joining.
  - User model: `email` unique, lowercased, trimmed and validated; `password` hashed on create and on every update that sets it, never selected by default; `roles` JSON, dropped from mass assignment unless `{ unsafe: true }`, `user.hasRole()`, `user.setRoles()`, `User.setRoles(id, roles)`.
  - Sessions: an express-session store on a `henri_sessions` table (get/set/destroy/touch/all/clear/length, expiry with the cookie, periodic sweep).
  - Migrations in `db/migrations` (drizzle-kit layout): `henri db:generate`, `henri db:migrate`, `henri db:push`, `henri db:status` (`henri db <command>` works too). Development boots push the schema unless the store sets `"sync": false`; production boots apply the migrations with `"migrate": true` and warn about pending ones otherwise.
  - Core accepts `"adapter": "drizzle"`.

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - The published packages declare their `files`: the tarballs no longer ship the
  test suites and every package carries the LICENSE, a README and its changelog.
  `@usehenri/websocket` is no longer published (it was never wired into core).

## 1.0.2

### Patch Changes

- [#289](https://github.com/usehenri/henri/pull/289) [`64f7356`](https://github.com/usehenri/henri/commit/64f73564802c156bad4fe0955a4d373a7f984363) Thanks [@reel](https://github.com/reel)! - Remove dependencies flagged by npm audit: `express-boom` (pulled in an unpatched `hoek`) is replaced by a small built-in `res.boom` helper with the same response shape, `node-notifier` is dropped (`pen.notify()` now prints to the console in development), and the React forms use `lodash/get` and `lodash/set` instead of the unpatched `lodash.set` package.

## 1.0.1

No changes in this release.

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

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.37.2](https://github.com/usehenri/henri/compare/v0.37.1...v0.37.2) (2020-01-13)

**Note:** Version bump only for package @usehenri/core





## [0.37.1](https://github.com/usehenri/henri/compare/v0.37.0...v0.37.1) (2019-12-24)


### Features

* **core:** check the configuration syntax on boot ([a022475](https://github.com/usehenri/henri/commit/a022475))
* **core:** prettier for JSON syntax validation ([b882e95](https://github.com/usehenri/henri/commit/b882e95))
* **disk:** use local mongdb instead of disk ([#87](https://github.com/usehenri/henri/issues/87)) ([7ee22c0](https://github.com/usehenri/henri/commit/7ee22c0))





# [0.37.0](https://github.com/usehenri/henri/compare/v0.36.5...v0.37.0) (2019-09-23)

**Note:** Version bump only for package @usehenri/core





## [0.36.5](https://github.com/usehenri/henri/compare/v0.36.4...v0.36.5) (2019-09-23)

**Note:** Version bump only for package @usehenri/core





## [0.36.4](https://github.com/usehenri/henri/compare/v0.36.3...v0.36.4) (2019-09-18)

**Note:** Version bump only for package @usehenri/core





## [0.36.3](https://github.com/usehenri/henri/compare/v0.36.2...v0.36.3) (2019-09-18)

**Note:** Version bump only for package @usehenri/core





## [0.36.2](https://github.com/usehenri/henri/compare/v0.36.1...v0.36.2) (2019-09-04)


### Bug Fixes

* **core:** upgrade bounce to @hapi/bounce ([5c12326](https://github.com/usehenri/henri/commit/5c12326))





## [0.36.1](https://github.com/usehenri/henri/compare/v0.36.0...v0.36.1) (2019-09-04)


### Bug Fixes

* **core:** migrate from bcrypt-js to bcrypt ([89eccf3](https://github.com/usehenri/henri/commit/89eccf3))





# [0.36.0](https://github.com/usehenri/henri/compare/v0.35.2...v0.36.0) (2019-09-04)

**Note:** Version bump only for package @usehenri/core





## [0.35.2](https://github.com/usehenri/henri/compare/v0.35.1...v0.35.2) (2019-07-04)

**Note:** Version bump only for package @usehenri/core





## [0.35.1](https://github.com/usehenri/henri/compare/v0.35.0...v0.35.1) (2019-06-28)

**Note:** Version bump only for package @usehenri/core





# [0.35.0](https://github.com/usehenri/henri/compare/v0.34.7...v0.35.0) (2019-06-19)

**Note:** Version bump only for package @usehenri/core





## [0.34.7](https://github.com/usehenri/henri/compare/v0.34.6...v0.34.7) (2019-06-10)

**Note:** Version bump only for package @usehenri/core





## [0.34.6](https://github.com/usehenri/henri/compare/v0.34.6-alpha.0...v0.34.6) (2019-05-28)


### Bug Fixes

* **cli:** checks for yarn and min version ([3892f6b](https://github.com/usehenri/henri/commit/3892f6b))





## [0.34.6-alpha.0](https://github.com/usehenri/henri/compare/v0.34.5...v0.34.6-alpha.0) (2019-04-22)

**Note:** Version bump only for package @usehenri/core





## [0.34.5](https://github.com/usehenri/henri/compare/v0.34.4...v0.34.5) (2019-04-18)

**Note:** Version bump only for package @usehenri/core





## [0.34.4](https://github.com/usehenri/henri/compare/v0.34.4-alpha.4...v0.34.4) (2019-04-12)

**Note:** Version bump only for package @usehenri/core





## [0.34.4-alpha.4](https://github.com/usehenri/henri/compare/v0.34.4-alpha.3...v0.34.4-alpha.4) (2019-03-28)

**Note:** Version bump only for package @usehenri/core





## [0.34.4-alpha.3](https://github.com/usehenri/henri/compare/v0.34.4-alpha.2...v0.34.4-alpha.3) (2019-02-15)


### Bug Fixes

* **graphql:** update the schema on hot reload. ([f3babdc](https://github.com/usehenri/henri/commit/f3babdc))





## [0.34.4-alpha.2](https://github.com/usehenri/henri/compare/v0.34.4-alpha.1...v0.34.4-alpha.2) (2019-02-15)

**Note:** Version bump only for package @usehenri/core





## [0.34.4-alpha.1](https://github.com/usehenri/henri/compare/v0.34.4-alpha.0...v0.34.4-alpha.1) (2018-12-13)

**Note:** Version bump only for package @usehenri/core





## [0.34.4-alpha.0](https://github.com/usehenri/henri/compare/v0.34.3...v0.34.4-alpha.0) (2018-12-03)


### Bug Fixes

* **graphql:** migrating from runQuery to executeOperation ([9fe3081](https://github.com/usehenri/henri/commit/9fe3081))





## [0.34.3](https://github.com/usehenri/henri/compare/v0.34.2...v0.34.3) (2018-11-06)


### Bug Fixes

* **router:** remove debug message ([f76ad37](https://github.com/usehenri/henri/commit/f76ad37))


### Features

* **graphql:** warn on graphql/models schema errors ([4a1509d](https://github.com/usehenri/henri/commit/4a1509d)), closes [#55](https://github.com/usehenri/henri/issues/55) [#44](https://github.com/usehenri/henri/issues/44)





## [0.34.1](https://github.com/usehenri/henri/compare/v0.34.0...v0.34.1) (2018-10-31)


### Bug Fixes

* **henri:** lower limited runlevel warning ([5725183](https://github.com/usehenri/henri/commit/5725183))





# [0.34.0](https://github.com/usehenri/henri/compare/v0.33.1...v0.34.0) (2018-10-30)


### Features

* **router:** name middlewares ([74c700c](https://github.com/usehenri/henri/commit/74c700c))
* **router:** on demand routes status (press U or R in console) ([4fb0791](https://github.com/usehenri/henri/commit/4fb0791))





## [0.33.1](https://github.com/usehenri/henri/compare/v0.33.0...v0.33.1) (2018-10-29)


### Bug Fixes

* **router:** sending user as null ([14a241f](https://github.com/usehenri/henri/commit/14a241f))





# [0.33.0](https://github.com/usehenri/henri/compare/v0.32.0...v0.33.0) (2018-10-26)


### Features

* **router:** requiring `config/routes.js`, adding deprecation msg. ([44224f5](https://github.com/usehenri/henri/commit/44224f5))
* **testing:** adding the base for user testing ([47c8e85](https://github.com/usehenri/henri/commit/47c8e85))
* **testing:** adding the package ([e2ec87b](https://github.com/usehenri/henri/commit/e2ec87b))





# [0.32.0](https://github.com/usehenri/henri/compare/v0.31.1...v0.32.0) (2018-10-23)


### Features

* **graphql:** upgrade to latest version ([6ab85ad](https://github.com/usehenri/henri/commit/6ab85ad))





# [0.31.0](https://github.com/usehenri/henri/compare/v0.30.3...v0.31.0) (2018-10-17)


### Bug Fixes

* **utils:** pass henri instance to syntax method ([ffb753f](https://github.com/usehenri/henri/commit/ffb753f))


### Features

* **routes:** adding paths to /_routes ([05d8668](https://github.com/usehenri/henri/commit/05d8668))





<a name="0.30.3"></a>
## [0.30.3](https://github.com/usehenri/henri/compare/v0.30.2...v0.30.3) (2018-09-28)


### Bug Fixes

* **router:** adding debug information ([f3b9817](https://github.com/usehenri/henri/commit/f3b9817))





<a name="0.30.2"></a>
## [0.30.2](https://github.com/usehenri/henri/compare/v0.30.1...v0.30.2) (2018-09-26)


### Bug Fixes

* **henri:** henri should be scoped and always referred internally as this.henri (avoids leaks in testing) ([b046cc4](https://github.com/usehenri/henri/commit/b046cc4))





<a name="0.30.0"></a>
# [0.30.0](https://github.com/usehenri/henri/compare/v0.29.3...v0.30.0) (2018-09-26)

**Note:** Version bump only for package @usehenri/core





<a name="0.29.3"></a>
## [0.29.3](https://github.com/usehenri/henri/compare/v0.29.2...v0.29.3) (2018-08-29)

**Note:** Version bump only for package @usehenri/core





<a name="0.29.0"></a>
# [0.29.0](https://github.com/usehenri/henri/compare/v0.28.0...v0.29.0) (2018-08-23)


### Bug Fixes

* **router:** only give routes based on user roles ([7d63743](https://github.com/usehenri/henri/commit/7d63743))
* **user:** make sure req.user is not available ([7968dfa](https://github.com/usehenri/henri/commit/7968dfa))


### Features

* **router:** add the omit key -- closes [#43](https://github.com/usehenri/henri/issues/43) ([a8c8f4d](https://github.com/usehenri/henri/commit/a8c8f4d))





<a name="0.28.0"></a>
# [0.28.0](https://github.com/usehenri/henri/compare/v0.27.0...v0.28.0) (2018-07-13)


### Bug Fixes

* **server:** do not watch lock files ([15f489e](https://github.com/usehenri/henri/commit/15f489e))
* **workers:** show that workers are disabled while reloading ([de0a7b5](https://github.com/usehenri/henri/commit/de0a7b5))


### Features

* **router:** experimental => try to extract data/gql from res.render ([8891d78](https://github.com/usehenri/henri/commit/8891d78))
* **workers:** add the --skip-workers flag to run without workers ([d21e913](https://github.com/usehenri/henri/commit/d21e913))




<a name="0.27.0"></a>
# [0.27.0](https://github.com/usehenri/henri/compare/v0.26.1...v0.27.0) (2018-07-12)


### Bug Fixes

* **utils:** simplify prettier's parsing ([4f78611](https://github.com/usehenri/henri/commit/4f78611))


### Features

* **workers:** add the workers module ([816e24e](https://github.com/usehenri/henri/commit/816e24e))




<a name="0.26.1"></a>
## [0.26.1](https://github.com/usehenri/henri/compare/v0.26.0...v0.26.1) (2018-06-22)


### Bug Fixes

* **react:** remove react-hot-loader ([1aa8795](https://github.com/usehenri/henri/commit/1aa8795))




<a name="0.26.0"></a>
# [0.26.0](https://github.com/usehenri/henri/compare/v0.25.0...v0.26.0) (2018-06-21)




**Note:** Version bump only for package @usehenri/core

<a name="0.25.0"></a>
# [0.25.0](https://github.com/usehenri/henri/compare/v0.24.0...v0.25.0) (2018-05-22)


### Bug Fixes

* **react:** missing packages in react template ([9dc57bd](https://github.com/usehenri/henri/commit/9dc57bd))




<a name="0.24.0"></a>
# [0.24.0](https://github.com/usehenri/henri/compare/v0.23.0...v0.24.0) (2018-05-11)


### Bug Fixes

* **core:** add mailer package optional on test (to speed up things) ([c655d11](https://github.com/usehenri/henri/commit/c655d11))
* **graphql:** small typo? ([a34192a](https://github.com/usehenri/henri/commit/a34192a))


### Features

* **core:** add res.hbs() to render handlebars templates ([26e432f](https://github.com/usehenri/henri/commit/26e432f))
* **graphql:** henri.gql should be accessible globally ([081473b](https://github.com/usehenri/henri/commit/081473b))
* **graphql:** upgrade to graphql-tools 3.0.0 ([15115b4](https://github.com/usehenri/henri/commit/15115b4))
* **mailer:** add mail feature, closes [#37](https://github.com/usehenri/henri/issues/37) ([ea67980](https://github.com/usehenri/henri/commit/ea67980))




<a name="0.23.0"></a>
# [0.23.0](https://github.com/usehenri/henri/compare/v0.22.0...v0.23.0) (2018-04-23)


### Bug Fixes

* **model:** throw errors instead of pen.fatal ([0a8700d](https://github.com/usehenri/henri/commit/0a8700d))


### Features

* **core:** show if booted from the global cli or not ([cf9f4d0](https://github.com/usehenri/henri/commit/cf9f4d0))




<a name="0.22.0"></a>
# [0.22.0](https://github.com/usehenri/henri/compare/v0.21.3...v0.22.0) (2018-04-17)


### Bug Fixes

* **user:** failing to deserialize. need upcoming fix for disk ([7bd2f1c](https://github.com/usehenri/henri/commit/7bd2f1c))


### Features

* **cli:** return a function (better tests) ([292e111](https://github.com/usehenri/henri/commit/292e111))
* **core:** adding bounce to utils ([40b7671](https://github.com/usehenri/henri/commit/40b7671))
* **core:** better error handling ([2be66b6](https://github.com/usehenri/henri/commit/2be66b6))
* **model:** inject henri to the stores ([a32c29a](https://github.com/usehenri/henri/commit/a32c29a))
* **template:** using promise to read partials et al ([ca73cc1](https://github.com/usehenri/henri/commit/ca73cc1))
* **user:** session storage per database provider, closes [#34](https://github.com/usehenri/henri/issues/34) ([50d5831](https://github.com/usehenri/henri/commit/50d5831))




<a name="0.21.2"></a>
## [0.21.2](https://github.com/usehenri/henri/compare/v0.21.1...v0.21.2) (2018-04-10)


### Bug Fixes

* **core:** completion of react move -- cleaning packages ([d6ef57b](https://github.com/usehenri/henri/commit/d6ef57b))
* **react:** moving react engine to react package... nextjs lifting ([c90fa4c](https://github.com/usehenri/henri/commit/c90fa4c))




<a name="0.21.1"></a>
## [0.21.1](https://github.com/usehenri/henri/compare/v0.21.0...v0.21.1) (2018-04-10)


### Bug Fixes

* **core:** reordering packages ([de5655f](https://github.com/usehenri/henri/commit/de5655f))
* **view:** get next from the run dir ([e826ff9](https://github.com/usehenri/henri/commit/e826ff9))




<a name="0.21.0"></a>
# [0.21.0](https://github.com/usehenri/henri/compare/v0.20.2...v0.21.0) (2018-04-10)


### Bug Fixes

* **cli:** add back the console only startup mode ([4c915be](https://github.com/usehenri/henri/commit/4c915be))
* **core:** better watch support and no html file linting? ([086c221](https://github.com/usehenri/henri/commit/086c221))
* **core:** indentation problem ([bb16439](https://github.com/usehenri/henri/commit/bb16439))
* **core:** middleware switching ([7ea60f4](https://github.com/usehenri/henri/commit/7ea60f4))
* **core:** need to await init ([ff8aa9e](https://github.com/usehenri/henri/commit/ff8aa9e))
* **core:** template should use this.henri ([b3ecfde](https://github.com/usehenri/henri/commit/b3ecfde))
* **router:** starting view with await and fixing crud route building ([5a99857](https://github.com/usehenri/henri/commit/5a99857))
* **view:** call the engine init function, yep, call it ([a4b277b](https://github.com/usehenri/henri/commit/a4b277b))
* **view:** should call the good checkPackages? ([fc21732](https://github.com/usehenri/henri/commit/fc21732))


### Features

* **core:** adding a BaseModule; modules should extend this ([9705410](https://github.com/usehenri/henri/commit/9705410))
* **core:** adding all modules and moving middleware management ([54715d1](https://github.com/usehenri/henri/commit/54715d1))
* **core:** adding boom for better responses ([5b80ced](https://github.com/usehenri/henri/commit/5b80ced))
* **core:** consolidating core ([9f72b35](https://github.com/usehenri/henri/commit/9f72b35))
* **core:** correcting graphql target ([40c1eae](https://github.com/usehenri/henri/commit/40c1eae))
* **core:** graphql support ([53419e5](https://github.com/usehenri/henri/commit/53419e5))
* **core:** moving things to core. adding modules ([14a8c5c](https://github.com/usehenri/henri/commit/14a8c5c))
* **core:** moving view module ([11918bf](https://github.com/usehenri/henri/commit/11918bf))
* **core:** we no longer use config package ([86160d6](https://github.com/usehenri/henri/commit/86160d6))
* **view:** use handlebars instead of template literals, reload partials ([b0e16ab](https://github.com/usehenri/henri/commit/b0e16ab))
* **vue:** adding vue (nuxt.js) support to the new view handler ([05869b6](https://github.com/usehenri/henri/commit/05869b6))
