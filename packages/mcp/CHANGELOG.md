# @usehenri/mcp

## 1.2.0

### Minor Changes

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

- [#314](https://github.com/usehenri/henri/pull/314) [`b45f7c8`](https://github.com/usehenri/henri/commit/b45f7c8e6a02d8e84ec648ebd58803936934cae3) Thanks [@reel](https://github.com/reel)! - `henri new` and `henri init` take `--adapter disk|drizzle|mongoose|mysql|postgresql|mssql` (and `--dialect sqlite|postgres|mysql` with drizzle) to pick the store of the new application. `disk` stays the default, so nothing changes without the flag.
  
  The adapter drives the whole scaffold: the store block of `config/default.json`, a `config/test.json` on its own database, the dependencies and the driver (`better-sqlite3`, `pg` or `mysql2` for drizzle, allow-listed in `pnpm-workspace.yaml` when it needs a build), the README and AGENTS.md, and the sample `Task` resource. `henri generate scaffold|crud` now reads the adapter back from the configuration and writes a controller against the model API that store really has: Mongoose on `disk` and `mongoose`, Sequelize (`findAll`, `findByPk`, `row.update()`) on `mysql`, `postgresql` and `mssql`, the Rails-like Drizzle model (`query().offset().limit()`, `count`, `findByIdAndUpdate`) on `drizzle`. `henri doctor` knows the new combinations, including the driver a drizzle dialect needs.

### Patch Changes

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

- [#342](https://github.com/usehenri/henri/pull/342) [`1b316c6`](https://github.com/usehenri/henri/commit/1b316c6f3c5d5eb5752c70b534092d1052956cc6) Thanks [@reel](https://github.com/reel)! - Real background jobs, in a new package: `@usehenri/jobs`.
  
  What henri called workers was a hook that ran a file at boot, and the documented example was a `setInterval`. There was no way to say "send this mail later" or "process this upload in the background": no queue, no retries, no schedule, and nothing to look at when something failed. Rails has had that for a decade and now ships a database-backed queue by default; this is henri's.
  
  A job is `app/jobs/<name>.js` exporting `perform(args, context)` alongside its `queue`, `priority`, `maxAttempts`, `timeout` and `backoff` — the shape models and controllers already use. `henri generate job <name>` writes one and `henri destroy job <name>` removes it. The application enqueues with `henri.jobs.perform(name, args, options)`, `performIn(delay, ...)` and `performAt(date, ...)`, which write one row and return; `performNow()` runs one inline for tests and the console. Arguments are stored as JSON and anything that would not survive the round trip — a model instance, a function, `undefined`, a `Date` that would come back a string, a cycle — is refused with the path that holds it instead of being dropped silently.
  
  `henri jobs` runs a worker process: it claims jobs, performs `jobs.concurrency` of them at a time, honours the recurring schedules, puts back the jobs of runners that died and stops on `SIGINT`, `SIGTERM` and `SIGQUIT` after finishing what it holds. `--queue` limits it to some queues and `--once` drains what is due and exits. Several runners are meant to run at once against one database: claiming is a single statement on every dialect — `FOR UPDATE SKIP LOCKED` on PostgreSQL, `UPDATE ... ORDER BY ... LIMIT` on MySQL, `UPDLOCK, READPAST` on MSSQL, a subquery on sqlite, an atomic `findOneAndUpdate` per document on MongoDB — so it is its own transaction, the state is part of its own `WHERE`, and the rows it took carry a token it reads them back by. No job is ever performed twice because two runners raced.
  
  A job that throws is retried with an exponential backoff and, once out of attempts, kept in a **dead letter queue** with its error, its stack and the history of every attempt. The queue is at-least-once, so the guide says to write a job the way you would write a webhook handler: the outcome of an attempt is fenced by the token of the claim it belongs to, so a runner that was recovered from cannot write over the one that took its job, but a job that was recovered from does run twice. `henri jobs:dead`, `jobs:show <id>`, `jobs:retry` and `jobs:discard` drive it from the command line, `henri.jobs.dead.*` from the application. `henri jobs:status` gives the counts by queue and state, the timings of the finished jobs and how long the oldest due job has waited — with `--json`, like every other henri command.
  
  Recurring jobs are declared under `jobs.recurring` in the configuration (a five-field cron expression read in UTC, or a plain `every` interval) and honoured by the runner itself, with no second process. Missed runs do not pile up: the moment that follows is computed from now, so an hour of downtime on an hourly job costs one run, not sixty.
  
  The queue owns `henri_jobs` and `henri_jobs_schedules` and reaches them through the store adapter's own `query()` or its MongoDB collections, never through a model, so it cannot collide with the application's schema and works on a store that has no models at all. `henri jobs:install` creates the tables and is idempotent; the boot creates them too unless `jobs.install` says otherwise.
  
  `henri.mailers.deliverLater()` now goes through it: core registers the delivery handler, and the rendered message becomes a job on the `mailers` queue, retried and visible like any other.
  
  `app/workers` is untouched and still the right answer for a long-lived process that starts with the server. The [Jobs guide](https://usehenri.io/guides/jobs/) says when to reach for which.

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

### Patch Changes

- Updated dependencies [[`f8ad32f`](https://github.com/usehenri/henri/commit/f8ad32fd996560337bda5f87332ecab4e5902ce9), [`f99341c`](https://github.com/usehenri/henri/commit/f99341cdf05b9306bfca0c8385aee1661fc77f4f), [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e), [`a2cf383`](https://github.com/usehenri/henri/commit/a2cf383d6f3b4405b73816bc38175ad6f308dff4), [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e), [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e), [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e)]:
  - @usehenri/cli@1.1.0
