---
title: Security
description: What henri does for every application, what stays yours, and henri audit, which checks the second half against the ASVS.
sidebar:
  order: 14
---

Security work splits in two, and confusing the halves is what makes it
exhausting. One half is the same in every application, so henri does it: the
headers, the CSRF token, the session cookie, the password hashing, the rate
limits, the parameter filters. The other half is yours, because only your
application knows who may read a proposal.

This page is both halves. The first table is what you inherit, so you can stop
carrying it. The rest is `henri audit`, which reads your files and tells you
what is left.

```bash
henri audit            # the findings, worst first; exit 1 on medium and above
henri audit --checks   # what it can determine, and against which requirement
henri audit --json     # the same, for a script or a coding agent
```

The standard underneath is the [OWASP Application Security Verification
Standard](https://owasp.org/www-project-application-security-verification-standard/)
4.0.3, because it is the one written to be verified: numbered requirements, at
levels, that an answer can be measured against. The [Top
10](https://owasp.org/Top10/) rides along as a second label on every finding,
because that is what a report is read against outside a security team — but it
is an awareness document, ten categories chosen for teaching, and an audit
shaped by it would inherit that shape.

## What henri does for every application

Nothing below needs a configuration key. It is on unless you turn it off, and
`henri audit` reports the turning off, never the default.

| ASVS                       | What henri does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V2 Authentication          | Passwords are hashed with argon2id where `@node-rs/argon2` installs and with bcrypt (cost 12) everywhere else, by the adapter, on create and on update, and a stored hash below the current parameters is upgraded on the next sign-in. A hash is never selected by a query: `password` is `select: false` on Mongoose and Drizzle and excluded from the Sequelize default scope. Twelve characters is the shortest password accepted, and an unknown email is compared against a throwaway hash so a wrong address and a wrong password take the same time. `POST /login` is limited to 10 attempts a minute per address, along with `/register`, `/signup`, `/password`, `/forgot-password` and `/reset-password`, and one account refuses sign-in after 10 consecutive failures in fifteen minutes, whoever is asking. Every hash is bound to the `externalId` of the row it belongs to, so a hash copied onto another row -- a duplicated entry, a planted account -- stops verifying; the hashes written before that keep working and are rebound as their owners sign in.                                                                                                                                         |
| V3 Session management      | `express-session` with the session in your database, not in the process memory. The `henri.sid` cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`, and lasts `user.sessionMaxAge` (30 days). Logging out destroys the session server side and clears the cookie.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| V4 Access control          | `roles` on a route registers a guard the router runs before the action: anonymous gets a redirect to `loginPath` or a `401`, signed in without the role a `403`. [Policies](/guides/policies/) answer the other question -- may this person act on _this_ record -- from `app/policies/<model>.js`, and they fail closed: no policy, no rule for the action and a rule that threw all mean no, and only the boolean `true` allows. A refusal answers `404` by default, so it says nothing about whether the record exists. The `paths` a view receives and the `_links` of every HAL answer are filtered by the roles of the viewer and then by the policies, so a page cannot link where its reader may not go. `roles` is stripped from every model write unless you pass `{ unsafe: true }`.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| V5 Validation and encoding | `req.permit('title', 'body')` is the only way a request bag reaches a model in the generated controllers, and it refuses `__proto__`, `constructor` and `prototype`. A controller that declares [`params`](/guides/controllers/#params-what-an-action-accepts) has the shape of every field it named checked at the boundary -- the type, the bounds, the pattern, the enum -- before the action runs, and what does not match answers `422` with one message per field rather than reaching a model. Queries go through Sequelize, Mongoose or Drizzle, which parameterize. React, Inertia and Handlebars escape what they interpolate. Bodies are bounded by `bodyLimit` (1mb).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| V7 Errors and logging      | Every answer carries `X-Request-Id`, generated or taken from the client, and every log line of that request quotes it. `filterParameters` (`password`, `token`, `secret`, `authorization`, matched as substrings) are masked in everything `henri.pen` prints, query strings included, and anything named `encryption` is masked whatever that list says. A `500` in production answers the reason phrase and nothing else; the stack is only in development and test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| V8 Data protection         | A user reaches a view or a JSON answer only as `publicUser()`: `externalId`, `email`, `roles` and whatever `user.public` names. Every record carries an `externalId` (a UUID v7) and the numeric primary key is removed from what `res.render()`, `res.resource()` and `res.collection()` send -- its own, and every foreign key it declared, which leaves as the `externalId` of the row it names rather than that row's primary key. `Model.findById()` resolves the public identifier and nothing else, so a number in a url answers the same 404 an unknown uuid answers and the rows cannot be walked one number at a time; `findByKey()` is the primary key lookup, for the server-side code that holds one. A signed-in answer carries `Cache-Control: no-store`. A field the model marked [`personal`](/guides/privacy/) is masked by name in every log line and every recorded error; one marked `personal: { expose: false }` is dropped from everything henri serializes, at every depth, unless the answer names it in `include`. `henri privacy:export` and `henri privacy:erase` are built from the same marks, and an erasure leaves a receipt holding an HMAC of the identity rather than the identity. |
| V6 Stored cryptography     | Nothing is encrypted at rest until a model asks for it, and a field that asks gets [the whole answer](/guides/encryption/): `{ encrypted: true }` on a field makes the column ciphertext (AES-256-GCM, subkeys derived per scheme with HKDF, the model and the field authenticated with the value so a ciphertext only opens where it was written) and the model hand back the string. The key is `config.encryption.keys` and never `config.secret`, it lives in the encrypted credentials, and no key ever reaches a log line, a boot report or a validation message -- only its eight character id. It is a list, so a rotation is a deploy: every key decrypts, the first one encrypts, and `henri encryption:rotate` walks every row, soft deleted ones included, without moving `updatedAt` and without ever overwriting a value it could not read first. A read that fails throws rather than answering `null`, with a different code for a key that is missing, bytes that were changed and a column still in the clear. An encrypted field is `personal` unless the model says otherwise, so it is masked in the logs, exported and erased.                                                                    |
| V12 File upload            | With [`@usehenri/uploads`](/guides/uploads/): a multipart body is bounded before the first byte is read (25mb in total, 10mb a file, 10 files, 100 fields), the type of a file is decided from its bytes and not from the `Content-Type` or the extension the client sent, the stored name is generated (`<yyyy>/<mm>/<32 hex>.<extension of the sniffed type>`) so no name a client sends ever reaches a path, files are written `0600` into a `0700` directory outside everything the application serves, `text/html` and `image/svg+xml` are stored under `.bin`, a stored file is only ever handed back by a controller with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`, and nothing is kept unless a controller calls `store()` -- a request that is refused, times out or is abandoned leaves nothing behind.                                                                                                                                                                                                                                                                                                                                                                        |
| V9 Communication           | With [`@usehenri/webhooks`](/guides/webhooks/): an outbound webhook only goes to an `https` url, and only to a public address. Every answer of the name is checked when the request is made -- not when the endpoint was registered, because DNS answers differently later -- against the loopback, the link-local range where the metadata service lives, the private ranges, carrier-grade NAT, multicast, the reserved and documentation ranges, and an IPv4 address wearing an IPv6 costume; one bad answer refuses the name. The socket then connects to the address that was checked and to no other, so the name cannot resolve to something else in between. A redirect is never followed, the answer is read up to 64kb, and every delivery carries a [Standard Webhooks](https://www.standardwebhooks.com) signature -- HMAC-SHA256 over the delivery id, a fresh timestamp and the raw body -- with the endpoint's signing secrets kept encrypted at rest under a key derived from `secret`.                                                                                                                                                                                                                 |
| V13 API                    | Rate limits (600 requests a minute per user or address), `Idempotency-Key` on every mutating route, `Accept: application/vnd.henri.vN+json` versioning, a `requestTimeout` of 30 seconds, and HAL answers whose `_links` are filtered by role. A GraphQL query is bounded before a resolver runs -- 15 aliases, 1000 fields with fragments expanded, 10 levels of nesting, 5000 tokens -- and introspection is off in production.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| V14 Configuration          | [helmet](https://helmetjs.github.io/) sets the headers, with a Content Security Policy that names its origins (no `https:` wildcard), refuses an inline event handler (`script-src-attr 'none'`) and lets the dev servers work, no HSTS outside production, and `X-Powered-By` off. [`"csp": { "nonce": true }`](#content-security-policy) gives every response a fresh nonce and takes `'unsafe-inline'` out of `script-src`. `Permissions-Policy` denies the camera, the microphone, the location and the other powerful browser features until an application names one. CORS is off unless you ask for it. A double-submit CSRF token (`henri.csrf`, `X-CSRF-Token`) guards every `POST`, `PUT`, `PATCH` and `DELETE` of a session, and the request must also come from an origin this application recognizes (`Sec-Fetch-Site`, then `Origin`), which is the half the token alone does not cover. Secrets live in `.env` or in [encrypted credentials](/configuration/#encrypted-credentials). The configuration is validated against a schema before the first module starts.                                                                                                                                     |

Two more that are not ASVS requirements but are the same kind of work: the
development introspection routes (`/_routes`, `/_controllers`, `/_mailers`,
`/_henri/runtime`) are mounted only in development _and_ only for the loopback
interface, checked on the socket rather than on a header a client can forge;
and the health endpoints (`GET /livez`, `GET /readyz`, `GET /healthz` and
`GET /_henri/health`) answer without authentication, on purpose, so a load
balancer can call them. They say the names of the stores, their adapter and
whether each answered, and a failure is `timeout` or `unreachable` — never the
driver's message, which carries the connection string it could not reach.

`/_henri/runtime` reads more than the others -- the last errors, the logs, the
database -- so it carries two guards on top of those two. It answers nothing
without `X-Henri-Runtime: 1`, a header a page cannot send cross-origin without
a preflight the endpoint never grants, and it refuses any request carrying
`Origin` or `Sec-Fetch-Site`, which every browser attaches and no command line
sends: a tab the developer happens to have open cannot reach it. What it will
run is decided before the store is touched -- a single `SELECT`, `WITH ...
SELECT`, `EXPLAIN`, `SHOW` or `DESCRIBE`, with the strings and the comments
removed first, and no word that writes, locks, waits or reads a file -- and
what comes back is redacted with `filterParameters`, `password` included
whatever the configuration says. See [Coding agents](/guides/agents/).

## Content Security Policy

The policy is helmet's, built by henri and overridable key by key through
`config.helmet.contentSecurityPolicy`. Out of the box it names its origins and
nothing else: no `https:` wildcard, `object-src 'none'`, `script-src-attr
'none'` (so an `onclick=""` attribute never runs), and `script-src 'self'` in
production. Development adds `'unsafe-inline'` and `'unsafe-eval'` to
`script-src`, plus websockets and blob workers, because that is what Vite,
Turbopack and React Refresh need to hot reload.

`"csp": { "nonce": true }` is how an application gets rid of that
`'unsafe-inline'`. Every response then draws a fresh value -- 16 bytes of the
system CSPRNG, base64url, 22 characters -- the header names it
(`script-src 'self' 'nonce-h7Qk…'`), and only the tags carrying the same value
run. henri takes `'unsafe-inline'` out of `script-src` itself when you turn
this on, rather than asking you to: a `script-src` naming a nonce makes the
browser ignore `'unsafe-inline'` anyway, so leaving it in would only make the
header claim a fallback nothing honours.

The nonce reaches your code three ways, all of them the same value:

| Where                   | What                                                                        |
| ----------------------- | --------------------------------------------------------------------------- |
| `res.locals.cspNonce`   | Anywhere in a middleware, a hook or a controller.                           |
| `req._henri.nonce`      | Next to `csrf`, `user` and `paths`. Absent when nonces are off.             |
| the `nonce` view option | What `res.render()` hands the engine, and what a Handlebars template reads. |

```hbs
<script nonce='{{nonce}}'>
  window.APP = { started: Date.now() };
</script>
```

`{{@nonce}}` is the same value, read the way the other view options are read.

### What each renderer can carry

**Inertia** carries it fully. The engine writes the nonce onto every
`<script>`, `<style>` and fetching `<link>` of the document it builds -- its
own tags, the ones your `app/views/index.html` shipped, the React Refresh
preamble and dev client Vite injects, and whatever the server bundle returned
in `head` -- and adds `<meta property="csp-nonce">`, which is the seam Vite's
own runtime reads: the `<style>` elements it injects on a hot update and the
`<link>` elements `__vitePreload` appends for a lazy chunk are written after
the document is, so the meta tag is the only way they ever get one. Vite's
`html.cspNonce` option is not used: it is a build-time placeholder its own
docs tell you to string-replace per request, and it lives in a
`vite.config.mjs` the application owns.

The nonce never reaches the Inertia page props. A visit after the first is
answered as JSON and swaps props into a document whose policy is the one it
was loaded with, so a nonce arriving there names nothing.

**React (Next.js)** carries it, and henri's part is one line. Next's pages
router reads the nonce out of the request's `Content-Security-Policy` header,
so henri writes the header it just sent back onto the request; Next's document
then stamps it on the polyfill, chunk and preload tags, on the Turbopack
inline bootstrap, on `__NEXT_DATA__` and on the `<noscript data-n-css>` its
client reads back to nonce the styles it injects on a client-side navigation.
A `Content-Security-Policy` sent by a client is always replaced, so nothing
downstream reads a nonce this server did not choose. One thing is yours: if
you write your own `app/views/pages/_document.js`, pass
`nonce={this.props.nonce}` to `<Head>` and `<NextScript>` -- Next's own
Document does it, a hand-written one has to, and henri warns at boot when it
finds one.

**Handlebars** carries it through `{{nonce}}`, above. henri rewrites nothing:
a template is the one thing that knows where its inline scripts are.

**Vue (Nuxt)** does not carry it, and the boot fails with
`HENRI_VIEW_NONCE_UNSUPPORTED` rather than sending a policy the document
cannot honour. A nonce that is generated, named by the header and then never
written into the markup is worse than none: the page reads as protected and
its scripts are refused instead. A view engine of your own opts in by writing
the nonce on every tag it emits and setting `supportsNonce = true`.

### What it costs

**62 nanoseconds a response.** henri's secure-headers middleware costs 147ns a
request with nonces off and 209ns with them on (Node 24, Apple silicon, half a
million requests through the middleware itself).

Two things stopped being computable once per protocol, and both are cached.
The random value: `crypto.randomBytes(16).toString('base64url')` costs 780ns,
so the bytes come out of a 4kb pool refilled with `crypto.randomFillSync`
instead -- the same CSPRNG output, drawn in one trip, 49ns a nonce. And the
header: helmet precomputes it at boot when every directive element is a string
(15ns a request) and re-joins the whole thing when one of them is a function
(869ns), which is what naming a per-request nonce would make it do. So henri
serializes the header once per protocol with a sentinel in the nonce's place,
cuts it in two, and a request concatenates `prefix + nonce + suffix` for 6ns.

Without either cache the same middleware costs about 1.5µs a request, 24 times
more. An application whose policy cannot be serialized once -- one that handed
helmet a directive function of its own -- falls back to helmet joining the
header per request (+735ns), and still gets this response's nonce.

### `style-src` keeps `'unsafe-inline'`

On purpose, and a nonce is never added to it. A `style=""` attribute cannot
carry a nonce -- only `style-src-attr` can allow one -- and React, Inertia and
Vite all set them. Naming a nonce in `style-src` would make the browser ignore
`'unsafe-inline'` there and break every inline style in the application.
Tightening that means naming both `style-src` and `style-src-attr` yourself,
which is a decision about your own markup.

### Left out on purpose

- **`strict-dynamic`.** It says "whatever a trusted script loads is trusted",
  which is how you drop the host allowlist entirely. It is also what makes
  `'self'` stop meaning anything, and it needs the whole bundle graph to be
  loaded by script rather than by markup. Worth doing; not worth doing
  half-way, and it is a change to what the default policy means rather than an
  addition to it.
- **Hashes instead of nonces.** A hash covers a script whose bytes never
  change, which is the opposite of what a server-rendered page emits: the
  Inertia page object, `__NEXT_DATA__` and the Turbopack bootstrap are
  different on every response. Computing a hash per response is a digest over
  the whole script where a nonce is 22 characters, and it buys the same thing.
- **Report-only mode.** A second header (`Content-Security-Policy-Report-Only`)
  that reports and never blocks is how you roll a policy out. henri's policy is
  not being rolled out -- it is on -- and the useful version of this feature is
  a policy an application can trial, which is a second set of directives to
  configure, serialize and cache. `config.helmet.contentSecurityPolicy.reportOnly`
  already turns the whole thing report-only if that is what you want.
- **A violation reporting endpoint.** `report-to` needs a route that accepts
  unauthenticated POSTs from every browser, rate-limits them, stores them
  somewhere and shows them to somebody. That is a product, and the ones that
  exist are better at it than a route henri would ship.

## What stays yours

Everything specific to your application, which is most of the interesting part:
who may read a record, what a field is allowed to contain, whether an email
address is really the person's, how long you keep the data. And these, which
henri could do and does not yet:

- **The CSRF token is not bound to the session id.** It is a random value in a
  cookie, so one minted before a sign-in is still accepted after it. The
  origin check is what covers the sibling subdomain that can write a cookie on
  your domain; the binding is what would cover the token that outlives the
  session it was issued for.
- **There is no second factor, and no check against breached passwords.** The
  policy is a length and a hash; ASVS 2.1.7 asks that a new password be looked
  up in a list of known-breached ones, which means calling a service, which is
  a decision an application makes and not a default a framework sets.
- **The GraphQL endpoint answers anyone** unless `graphql.authenticated`,
  `graphql.roles` or `graphql.loopbackOnly` says otherwise. The bounds above
  cap what one query may cost, not who may ask it, and what a resolver is
  allowed to return is your access control. `henri audit` says so when it sees
  a model exporting a schema.
- **Naming where the counters live is still yours to do.** The rate limit,
  the sign-in lockout and the idempotency keys are counted in this process
  unless [`config.shared`](/configuration/#the-shared-object) names a backend
  for all three at once (`pnpm add @usehenri/redis`), and henri cannot know
  how many processes you run. It says which it is on every boot -- `counted
in redis (fail closed)` or `counted in this process` -- and warns outright
  when the environment says there is more than one process (a cluster
  worker, a numbered pm2 instance, `WEB_CONCURRENCY`, a dyno past the first)
  and nothing shared is configured. Two processes without it mean two sets of
  counters: a rate limit that is twice what it says, a lockout an attacker
  escapes by being routed elsewhere, and an idempotency key that stops being
  idempotent.
- **A column that points at a row without saying so is a number henri
  cannot see.** A foreign key leaves as the public identifier of the row it
  names when the model _declared_ the relation: `belongsTo()` in
  `associate(models)`, `references: { model: 'Event' }` on the field, or
  `ref: 'User'` on a Mongoose path. `ownerId: { type: 'string' }` holding
  `String(user.id)` is a foreign key to you and an opaque string to henri,
  and it is serialized as it is stored. Nothing is inferred from a field
  name, and a Mongoose `refPath` -- whose target collection changes per
  document -- is left alone rather than resolved against the wrong one.
  Declaring the relation is the fix, and it is one line.
- **A record you built by hand carries no model, so its foreign keys are
  not translated.** A `.lean()` query, a row from `adapter.query()`, and the
  object a presenter returns are all plain objects: the internal ids are
  still removed from anything holding an `externalId`, but nothing
  downstream can tell a foreign key from any other number.
  `henri.model.publish()` is the seam -- publish first, present second.
- **`user.public` is copied as it is written.** A field named there reaches
  every view and every JSON answer as the model stores it, foreign key or
  not: `publicUser()` is built before the exit gate runs.
- **`filterParameters` masks the logs, and only the logs.** A model field, a
  mail body and the arguments of a background job are stored and printed as
  they are.
- **`Cross-Origin-Embedder-Policy` is not sent.** It breaks third party
  embeds, so it is a decision an application makes: add it through
  `config.helmet`.
- **The session cookie is `Secure` when `NODE_ENV` is `production`**, not when
  the request arrives over https. An https deployment under another environment
  name gets a cookie without the attribute.
- **An uploaded file is recognized, not validated.** `@usehenri/uploads`
  matches the first bytes against a signature table, which is enough to tell a
  PNG from an executable named `avatar.png` and not enough to tell a valid PNG
  from a header followed by anything. It does not open archives (a `.docx` is
  `application/zip`), it does not scan for malware, and it does not process
  images: all three are jobs to run after `store()`, not defaults a framework
  sets. See [Uploads](/guides/uploads/#out-of-scope-on-purpose).
- **A drained shutdown needs the platform to play along.** `SIGTERM` closes the
  port, finishes the requests in flight within `shutdown.drain` and then stops
  the modules, but a container killed with `SIGKILL` -- a termination grace
  period shorter than `shutdown.delay + shutdown.drain` -- drops them anyway.

## `henri audit`

```bash
henri audit [--fail-on=<severity>] [--no-deps] [--json]
henri audit --checks [--json]
```

It reads the application; it never starts it. Every finding is a statement
about a file you can open:

```text
  henri audit: 2 findings in 30 checks (1 high, 1 medium, 0 low; failing on medium)

  high    csrf.disabled              config/production.json
          A01:2021 Broken Access Control / ASVS V4.2.2 (L1)
          cross-site request forgery protection is turned off, so any site can post to this one with the visitor session
          -> Remove "csrf": false. A JSON client that sends Authorization: Bearer, or no session cookie at all, is already exempt

  medium  params.mass-assignment     app/controllers/notes.js:14
          A01:2021 Broken Access Control / ASVS V5.1.2 (L1)
          a model write takes the whole request bag, so any field a visitor sends reaches the record
          -> Name the fields: Model.create(req.permit("title", "body"))
```

Findings are `high`, `medium` or `low`. `--fail-on` decides which of them exits
with `1`: `medium` by default, `high` for a looser gate, `none` to report
without ever failing. A finding in `config/test.json` is reported one severity
lower, because the test configuration never answers a request from the
internet.

`henri doctor` runs the same static checks and warns when they find something,
without repeating them, so the habit of running `doctor` is enough to notice.
Coding agents get the audit as an MCP tool (`henri mcp`), alongside `doctor` and
the generators.

### What it checks

Run `henri audit --checks` for the catalogue with the requirement each one maps
to. In prose:

**Secrets** — `secret` written in a `config/*.json` (`secret.in-config`), a
store carrying the credentials of a remote database (`secret.store-password`; a
password for `localhost` is not a leak, it is what `compose.yaml` says), a
`.env` or a `config/credentials/*.key` that reached a commit
(`env.committed`, `credentials.key-committed`), and a `HENRI_SECRET` that is
too short or reads like a placeholder (`secret.weak`, which never prints the
value).

**Protections turned off** — `csrf: false` (`csrf.disabled`) or its origin
check alone (`csrf.origin-disabled`), `helmet: false` (`helmet.disabled`) or
one of its options set to false so a header stops being sent
(`helmet.weakened`, one finding per header), `rateLimit: false`
(`rate-limit.disabled`), `rateLimit.auth: false` (`rate-limit.auth-disabled`,
high when a user model exists), `user.lockout: false` (`lockout.disabled`), a
GraphQL bound set to false (`graphql.limits-disabled`),
`user.password.binding: false` (`password.binding-disabled`, which is what
lets a hash copied onto another row sign that row in),
`externalIds.lookup: "any"` (`externalIds.lookup-any`, which lets a primary
key resolve in a url again, so guessing a number reaches a record) and
`externalIds.references: false` (`externalIds.references-disabled`, which
sends a foreign key as the database holds it, so a record hands out the
primary key of the row it points at), `filterParameters:
false` (`log.filters-disabled`), `requestTimeout: false`
(`request-timeout.disabled`), an upload bound set to false
(`uploads.limits-disabled`) and `uploads.sniff: false`, which takes the
client's word for the type of a file (`uploads.type-check-disabled`), and, in
a configuration a production boot reads, `webhooks.allowPrivate: true`
(`webhooks.private-addresses-allowed`, which lets a url someone registered
reach the loopback, the private network or the metadata service) and
`webhooks.allowHttp: true` (`webhooks.http-allowed`, which sends the payload
and the signature that authenticates it in the clear).

**Schema changes nobody reviewed** — an `mssql` store with `"sync": true`
in `config/default.json` or `config/production.json`, which makes a
production boot run DDL of its own from whatever the models happen to say
(`schema.autosync`). henri stopped doing that by default in 1.3: a production
boot compares the database with the models and warns, and `henri db:status`
is the same comparison on demand. `mssql` is the only store the finding
reaches, because it is the only one left on Sequelize; every other SQL store
is Drizzle, which never pushes in production.

**Settings that open a door** — a `script-src` (or, without one, a
`default-src`) written by the application that allows `'unsafe-inline'` with no
nonce beside it, which lets an injected `<script>` run like the application's
own (`csp.script-unsafe-inline`); a `cors` that accepts any origin, or reflects
the caller while allowing credentials (`cors.permissive`); `trustProxy: true`
written by hand, which lets a client choose the address it is rate limited by
(`trust-proxy.permissive`); a `filterParameters` array that replaces the
defaults instead of extending them and drops one of them
(`log.filters-narrowed`); a `user.sessionMaxAge` beyond the 30 days ASVS asks a
re-authentication within (`session.long-lifetime`); a `user.public` naming a
field that looks like a credential (`session.public-fields`); an
`uploads.root` inside `app/views`, which `express.static` and the Inertia dev
server serve, so an uploaded page would be reachable on the application's own
origin (`uploads.root-served`).

**Code** — a model write that takes `req.body` or `req.query` whole
(`params.mass-assignment`), `{ unsafe: true }`, which turns off the guard
keeping `roles` out of a write (`params.unsafe`), a raw query built by
interpolating a template literal (`injection.raw-query`), a controller
answering `res.json(await Model.…)`, which sends the record as the ORM returned
it (`data.raw-record`), and a view writing a value into the page without
escaping it (`views.unescaped`).

**Access control** — an action of a `resources` or `crud` entry left without a
role while its siblings have one (`routes.unguarded`). The comparison is inside
one entry and one controller, because two entries that share a controller are
two decisions: a public `get /signup` next to a guarded `get /account` is an
application, not a hole. A controller that exports `before` hooks is left
alone, since that is where an ownership check lives when it is not in
`config/routes.js`. And a [policy](/guides/policies/) in `app/policies` that
nothing asks: no route declares it and no controller calls `req.can()` or
`req.authorize()` (`policies.unenforced`). Writing the rules and forgetting
the gate is the one mistake that looks exactly like having solved the problem.
An application that ships no policy is not reported: this audit reads what an
application said, not what it left out.

**Surface** — a model exporting a `graphql` key while the endpoint asks for no
session, no role and no loopback interface, so anyone who can reach the
application can query it (`graphql.exposed`).

**Encrypted attributes** — a `config.encryption.keys` written in a
`config/*.json` (`encryption.key-in-config`, high: that file is committed, so
the key that opens every encrypted column is in the repository), and
`encryption.readPlaintext: true` (`encryption.read-plaintext`), which is the
setting a backfill runs under and not one to keep: with it on, a row that was
never encrypted reads as if nothing were wrong. See
[Encrypted attributes](/guides/encryption/).

**Personal data** — a field that is plainly about a person and carries no
`personal` mark (`privacy.unmarked`): `lastName`, `phoneNumber`,
`dateOfBirth`, `ssn` and their like on any model, and `name`, `address`,
`phone`, `gender` and the rest on the model that _is_ a person. Without the
mark henri cannot redact the field in the logs, put it in an export or erase
it, so this is a gap with consequences rather than a matter of taste. See
[Personal data](/guides/privacy/).

**Dependencies** — the known advisories of the production dependencies
(`deps.advisories`), whether they could be checked at all
(`deps.audit-unavailable`), and a lockfile that is on disk but not committed
(`deps.lockfile-untracked`).

### What it does not check, and why

The rule is that a check must be true or false from the application's own
files. An audit that prints "make sure you use https" without looking is
theatre, and it makes the real findings easier to skip. So these are left out
on purpose:

- **Anything only the deployment knows.** Whether a proxy sits in front of the
  process, whether TLS terminates before it, what the container sets in the
  environment. `henri audit` reads files; environment variables and the
  decrypted credentials are not among them, so a `csrf: false` arriving as
  `HENRI_CONFIG__csrf=false` is invisible to it.
- **Whether `trustProxy` is wrong.** That `true` trusts every hop is in the
  file, and that is what is reported. Whether anything is in front of the
  process is not, and henri already warns about it at boot in production.
- **Whether the in-memory rate limit store matters.** It matters with more than
  one process, and how many processes run is not in the repository.
- **A field of a model that should not be selected by default.** `select:
false` is honoured by Mongoose and Drizzle; the Sequelize adapter behind an
  `mssql` store refuses unknown schema keys, so the fix a finding would name
  does not exist on every adapter. Making it portable is a change to the model
  schema, not a check.
- **Personal data in job arguments or mail bodies.** True, worth knowing, and
  not something a regular expression can tell from a variable name without
  inventing findings.
- **A floating dependency range.** Every application has them, and the lockfile
  is what pins the resolution. A check that fires on every application is a
  check people turn off.

## Dependencies

```bash
henri audit                 # included, unless --no-deps
pnpm audit --prod --audit-level high
```

The audit asks the package manager (pnpm, npm or yarn) for the advisories of
the **production** dependencies at **high and critical** only, and nothing
else. That line is deliberate: a moderate advisory in a build tool nobody ships
is not a reason to stop a release, and a gate that fires on those gets
disabled, which costs more than it ever saved. Everything below the line is
still one command away.

It is the only step that reaches the network, it has a two minute ceiling, and
when it cannot run — no lockfile, no network, a package manager that has no
audit — it says so as a `low` finding instead of failing.

In this repository, `.github/workflows/security.yml` runs
`pnpm audit --prod --audit-level high` on every push and pull request and again
every Monday, and prints the full picture without failing next to it.
Dependabot opens the update pull requests, `pnpm install --frozen-lockfile`
refuses an install that resolves anything the lockfile does not name, and
`minimumReleaseAge` in `pnpm-workspace.yaml` keeps a version that is less than
a day old out of the tree, which is the window most compromised-package
incidents are caught in.

henri itself is published from `.github/workflows/release.yml` with npm
[trusted publishing](https://docs.npmjs.com/trusted-publishers) over OIDC and
provenance attestation: there is no publish token to steal. An application can
verify what it installed with `npm audit signatures`, which checks the registry
signatures and the provenance attestations of the whole tree. `henri audit`
does not do it for you, because the answer is not in your files and pnpm has no
equivalent yet.

## The dynamic pass

Static analysis cannot tell you that the Content Security Policy survived the
renderer, that the session cookie really carries the attributes it is supposed
to, or that an error page kept its stack to itself. A running application can.

```bash
pnpm --filter @usehenri/showcase exec henri server --production &
scripts/zap-baseline.sh http://127.0.0.1:3000
```

That runs an [OWASP ZAP](https://www.zaproxy.org/) baseline scan: it crawls,
reads the answers and attacks nothing. `.github/zap/rules.tsv` decides what
fails, and the list is short on purpose — the headers and cookie attributes
henri sets for every application, so the scan is a regression test of the table
at the top of this page rather than an opinion about one application.
Everything else is a warning, because a scan that fails on a rule nobody acts
on is a scan somebody deletes.

In CI it runs weekly and on demand against the showcase, never on a pull
request: it boots a real application against a real database and pulls a large
image, which is worth an hour a week and is not worth being in the way of every
change.

## Reporting a vulnerability in henri

Privately, through the GitHub advisory form linked from
[SECURITY.md](https://github.com/usehenri/henri/blob/master/SECURITY.md). Not
in an issue.
