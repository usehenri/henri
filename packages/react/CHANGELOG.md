# Change Log

## 1.2.0

### Minor Changes

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

- [#409](https://github.com/usehenri/henri/pull/409) [`46d5dbc`](https://github.com/usehenri/henri/commit/46d5dbcc983c03e96ae5a87d7288c5d8a5adbc24) Thanks [@reel](https://github.com/reel)! - Internationalization, out of the box: `henri.i18n`.
  
  An application that needs a second language today writes its own lookup, its own locale detection and its own fallbacks — badly, and differently in the controllers, the views and the mails. henri now owns all three: `config/locales/<locale>.json` (or `<locale>/<namespace>.json`) is read at boot, `req.t()`/`henri.i18n.t()` is the lookup, `{{t}}` is the Handlebars helper, `useTranslation()` is the Inertia and React hook, and a mail carries its own locale.
  
  **An application with one language pays 5 µs at boot and nothing per request.** With no `config/locales` directory and no `i18n` block the module is inert: no catalogue is held, no middleware is mounted — not one that returns early, one that is not in the stack — `req.locale` and `req.t` are not set, `res.render()` carries no `i18n` key, nothing reaches the client and the boot prints no line. That is the call log's rule, and most applications have one language.
  
  **The locale of a request is decided in one order, and the decision is visible.** An explicit `req.setLocale()`, then the column `i18n.from.user` names on the signed-in user, then `?locale=`, then a cookie henri **reads and never writes**, then `Accept-Language` negotiated by q value, then the default. What answered is on the request as `req.localeSource`, on the wire as `Content-Language`, and in the view options. The path prefix is deliberately not on that list: `/fr/notes` is a routing decision, and stripping a prefix at the edge would make `notes_path()` lie to every page that prints it — the guide shows the two-line `namespace` instead.
  
  **A key nobody translated answers the key, never a sentence guessed from it.** A humanized key reads like a translation, ships like one and is invisible in a review, which is how an application ends up half translated. `i18n.missing` adds a warning (the default outside production), silence, or `HENRI_LOCALE_TRANSLATION_MISSING` — the mode a test suite sets, and the only one that fails a build. Every mode records the key in `henri.i18n.missing()`, and `henri doctor` compares the files on disk: `i18n.incomplete`, `i18n.orphan`, and `i18n.placeholders` for a key whose `{name}` values differ between locales, which is what prints a literal `{count}` on somebody's page.
  
  **A translation is never escaped and its values always are, at the boundary that renders them.** `t()` answers a plain string, because a controller putting one in a JSON body would otherwise ship `&amp;` to a client that is not a browser. The Handlebars helper escapes the values and returns a `SafeString`, which is what lets a translation carry `<strong>` while a name carries nothing; the plain part of a mail escapes nothing, because `text/plain` has no markup; and React escapes its own children, so a translation carrying markup shows as text there. That last difference is real and the guide states it rather than papering over it.
  
  **The catalogue reaches the browser once per document, not once per visit.** An Inertia visit and a client-side navigation carry `{ locale, source, url }` and no strings — the browser asking for one loaded a document to get here — and the url carries the digest of the catalogue in its file name, so a language change mid-session is one immutable, forever-cacheable request. `i18n.client` takes `always` and `false` for the other two trades.
  
  **The locale of a mail is the recipient's, and it is never the request's.** An administrator acting on somebody else's account, a nightly digest and a job retrying an hour later all produce a mail whose reader is not whoever made the request, and two of those have no request at all. A message says `locale`, or names the recipient with `for` and henri reads `i18n.from.user` off the record — which is what makes a mail from a job right. `deliverLater()` renders before it enqueues, so a worker needs no catalogue.
  
  **Dates, numbers and currency stay `Intl`'s**, and so do the plural rules: `Intl.PluralRules` knows more locales than any hand-written rule, and an exact `"=0"` form wins over its category. The two Handlebars helpers `{{number}}` and `{{date}}` exist only because a template cannot call a function with named arguments; their hash is the `Intl` options object, unchanged. Model attribute names and validation messages are not translated either — `henri.model.errors()` composes with `t(key, values, { default })` in one line, and the guide shows it.

- [#341](https://github.com/usehenri/henri/pull/341) [`a2e1ec2`](https://github.com/usehenri/henri/commit/a2e1ec29df52462f12ebaae9bfbc1ad4f427b27f) Thanks [@reel](https://github.com/reel)! - Every record gets a public uuid, and the numeric id stops leaving the server.
  
  **This is a breaking change for an existing application: urls change, JSON payloads change, and a database migration is required.** The [upgrading guide](https://usehenri.io/upgrading/) has the migration for each adapter.
  
  The primary key is unchanged — a `bigint` on SQL, an `ObjectId` on MongoDB — and it is still what the foreign keys, the joins and the indexes are made of. What changes is that it is now internal. Alongside it every model carries `externalId`: a uuid in an `external_id` column that is `NOT NULL` and `UNIQUE` in the database itself, generated on the insert when the caller brings none. It is the only identifier that leaves the server, so nothing outside can see or guess a sequential number: `/tasks/42` becomes `/tasks/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11`, a serialized record has `externalId` and no `id` (no `_id` on MongoDB), and `_links`, the `Location` header of a `201`, the path helpers, the view options and `publicUser()` all carry the uuid.
  
  The values are UUID version 7 (RFC 9562), time ordered: the column is unique, indexed and written on every insert, and a version 4 uuid would land in a different page of the b-tree every time where a version 7 appends to the right edge like the bigint it hides. `crypto.randomUUID()` only makes version 4, so the adapters generate their own; a uuid supplied by the caller is accepted whatever its version.
  
  `Model.findById()` takes either identifier, so a controller keeps handing it `req.params.id`: a uuid is 36 characters with four dashes, and neither a number nor a 24 character `ObjectId` can look like one. `findByIdAndUpdate()`, `findByIdAndDelete()` and, on the Sequelize adapters, `findByPk()` take both too, and `findById()` is new on the Sequelize adapters.
  
  Nothing about associations changes: `belongsTo`, `hasMany`, `include()` and `populate()` still work on the primary key, and a foreign key column still holds a number.
  
  `options: { externalId: false }` opts a model out, and it then behaves exactly as it did before.

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

- [#323](https://github.com/usehenri/henri/pull/323) [`7071e76`](https://github.com/usehenri/henri/commit/7071e766f060ff28804549adcb22f73c18adff90) Thanks [@reel](https://github.com/reel)! - Both view engines warned at every boot that `sass` was missing, whether or not the application had any `.scss` to compile. Since the scaffold styles with Tailwind and writes no Sass, a new app carried the dependency only to silence that warning. The engines now look for an authored `.scss` under `app/views` first, skipping build output, and `henri new` no longer adds `sass`. An app that writes Sass keeps working and still gets the warning when the package is missing.

- [#330](https://github.com/usehenri/henri/pull/330) [`8885f8f`](https://github.com/usehenri/henri/commit/8885f8ff80bda014b3e93f4798b5c1fd4fa2a0ae) Thanks [@reel](https://github.com/reel)! - The published bundle no longer carries the development JSX runtime. `@babel/preset-react` 8 turns `development` on by default, which emitted `jsxDEV()` calls into the build, and a production `next build` of an application using the package then failed with `jsxDevRuntime.jsxDEV is not a function` while prerendering. The preset is now configured explicitly.

## 1.1.0

### Minor Changes

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - React engine, `withHenri` and forms reworked against Next.js 16 and React 19.
  
  Engine
  
  - Fast Refresh works again: the engine hands henri's http server to `next()`
    (`httpServer`) instead of forwarding websocket upgrades itself, which made
    next.js handle each upgrade twice and drop the connection.
  - `require('@usehenri/react/engine').build({ cwd, config })` runs `next build`
    without booting henri (no stores, no server), for `henri build` and Docker
    build stages. The `distDir` of `config/next.js` is honoured when checking for
    an existing production build.
  - `init()` fails with a clear message when `app/views/pages` is missing and
    warns when `app/views/app` exists (pages router only). `reload()` announces
    that `config/next.js`/`config/webpack.js` changes need a restart; `close()`
    stops the next.js instance.
  - A broken `config/webpack.js` hook throws (with the explanation) instead of
    killing the build workers with `process.exit`.
  
  withHenri
  
  - Client-side navigation fetches `asPath` (the real url, query included) as
    JSON instead of the page file path.
  - Server side reads only what henri attached to the request (`req._henri`);
    `?data=` and friends in the url can no longer become page props.
  - `WithHenri` is a function component: `data` follows the props on navigation,
    `hydrate()` keeps the current data on a non-henri answer and exposes the
    error as `useHenri().error`. `errors`, `graphql`, `csrf` and `localUrl` reach
    the page and the context.
  - axios is gone: `fetch()`, `hydrate()` and navigation go through one native
    `fetch` helper (`request`) sending `Accept: application/json`, JSON bodies
    and the `X-CSRF-Token` header when a `csrf` token is present. Failed
    requests reject with a `RequestError` carrying the boom body (`message`,
    `data`, `statusCode`). `fetch()` accepts a `pathFor()` result or a string.
  - `pathFor`/`getRoute` replace whole parameter names (`:id` no longer rewrites
    `:identifier`).
  
  Forms
  
  - `Editor` loads Quill with `next/dynamic` (no hydration mismatch) and is
    controlled by the form data, so `clear()` empties it.
  - Sanitizers chain (`trim` then `escape`), are registered in an effect, and
    apply to nested names. The form stays disabled until the request settles.
  - `Select` renders a real placeholder option, honours `validation` and shows
    its error; server-side field errors (`data.errors` of a 422) are displayed
    under the fields. `Form action` accepts a `pathFor()` result.
  - `prop-types` and `shallowequal` dropped.
  
  The `henri g scaffold` React templates are regenerated for this API
  (`pathFor`/`getRoute`, `next/link`, valid table markup, guarded show/edit,
  redirects after create/update).

### Patch Changes

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - Login, sessions and request parameters are hardened and work on every adapter.
  
  - User lookups go through the adapter contract (`findUserByEmail`, `findUserById`, `userId`, `toPlain`, with Mongoose/Sequelize fallbacks in core), so login on SQL stores checks the right user and sessions hold the right id. `henri.user.findByEmail()`, `findById()` and `publicUser()` are exposed to apps.
  - Only the public representation of a user (`{ id, email, roles }` plus `config.user.public`) reaches views, `req._henri.user` and JSON answers. `config.user` accepts an object: `{ model, public, loginPath, afterLogin, sessionMaxAge }`.
  - `req.permit(...fields)` and `henri.params(req).permit()` return the permitted fields only; use them instead of `req.body` when creating or updating records.
  - The session cookie is `httpOnly`, `SameSite=Lax`, `Secure` in production, lives 30 days by default (`config.user.sessionMaxAge`) and is only written once something is stored in it. `trust proxy` is enabled (`config.trustProxy`).
  - `POST /login` answers `{ user }` to JSON clients and redirects browsers (`config.user.afterLogin`); failures are `401`/`400` or a redirect to `<loginPath>?error=invalid`. `POST /logout` destroys the session; `GET /logout` is deprecated and answers `405`.
  - Double-submit CSRF protection: the `henri.csrf` cookie must be sent back as `X-CSRF-Token` (or `X-XSRF-TOKEN`, the axios/Inertia convention) or `_csrf` on unsafe requests carrying a session (`config.csrf: false` disables it, bearer tokens are exempt). The token is available as `req._henri.csrf` and `withHenri` adds the header to `fetch()` and `hydrate()`.
  - Routes with `roles` deny with `401`/`403` JSON or a redirect to `config.user.loginPath`, and warn at boot when no user model exists instead of crashing per request.
  - The session store survives model reloads: express-session talks to a proxy that follows the current adapter.

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

**Note:** Version bump only for package @usehenri/react





## [0.37.1](https://github.com/usehenri/henri/compare/v0.37.0...v0.37.1) (2019-12-24)


### Bug Fixes

* **react:** specify display name ([420a3cd](https://github.com/usehenri/henri/commit/420a3cd))





# [0.37.0](https://github.com/usehenri/henri/compare/v0.36.5...v0.37.0) (2019-09-23)


### Features

* **react:** adding support for nested objects in forms ([12ad58c](https://github.com/usehenri/henri/commit/12ad58c))





## [0.36.5](https://github.com/usehenri/henri/compare/v0.36.4...v0.36.5) (2019-09-23)

**Note:** Version bump only for package @usehenri/react





## [0.36.4](https://github.com/usehenri/henri/compare/v0.36.3...v0.36.4) (2019-09-18)

**Note:** Version bump only for package @usehenri/react





# [0.36.0](https://github.com/usehenri/henri/compare/v0.35.2...v0.36.0) (2019-09-04)


### Bug Fixes

* **react:** pathFor was not replacing all placeholders ([1158d07](https://github.com/usehenri/henri/commit/1158d07))
* **react:** show react and nextjs version ([4920977](https://github.com/usehenri/henri/commit/4920977))





## [0.35.2](https://github.com/usehenri/henri/compare/v0.35.1...v0.35.2) (2019-07-04)

**Note:** Version bump only for package @usehenri/react





## [0.35.1](https://github.com/usehenri/henri/compare/v0.35.0...v0.35.1) (2019-06-28)

**Note:** Version bump only for package @usehenri/react





# [0.35.0](https://github.com/usehenri/henri/compare/v0.34.7...v0.35.0) (2019-06-19)

**Note:** Version bump only for package @usehenri/react





## [0.34.7](https://github.com/usehenri/henri/compare/v0.34.6...v0.34.7) (2019-06-10)

**Note:** Version bump only for package @usehenri/react





## [0.34.6](https://github.com/usehenri/henri/compare/v0.34.6-alpha.0...v0.34.6) (2019-05-28)


### Bug Fixes

* **react:** webpack config should not return a promise ([b7f29e2](https://github.com/usehenri/henri/commit/b7f29e2))





## [0.34.6-alpha.0](https://github.com/usehenri/henri/compare/v0.34.5...v0.34.6-alpha.0) (2019-04-22)

**Note:** Version bump only for package @usehenri/react





## [0.34.5](https://github.com/usehenri/henri/compare/v0.34.4...v0.34.5) (2019-04-18)

**Note:** Version bump only for package @usehenri/react





## [0.34.4](https://github.com/usehenri/henri/compare/v0.34.4-alpha.4...v0.34.4) (2019-04-12)

**Note:** Version bump only for package @usehenri/react





## [0.34.4-alpha.4](https://github.com/usehenri/henri/compare/v0.34.4-alpha.3...v0.34.4-alpha.4) (2019-03-28)

**Note:** Version bump only for package @usehenri/react





## [0.34.4-alpha.2](https://github.com/usehenri/henri/compare/v0.34.4-alpha.1...v0.34.4-alpha.2) (2019-02-15)

**Note:** Version bump only for package @usehenri/react





## [0.34.4-alpha.1](https://github.com/usehenri/henri/compare/v0.34.4-alpha.0...v0.34.4-alpha.1) (2018-12-13)

**Note:** Version bump only for package @usehenri/react





## [0.34.4-alpha.0](https://github.com/usehenri/henri/compare/v0.34.3...v0.34.4-alpha.0) (2018-12-03)

**Note:** Version bump only for package @usehenri/react





## [0.34.3](https://github.com/usehenri/henri/compare/v0.34.2...v0.34.3) (2018-11-06)

**Note:** Version bump only for package @usehenri/react





## [0.34.2](https://github.com/usehenri/henri/compare/v0.34.1...v0.34.2) (2018-10-31)


### Features

* **cli:** adding build command to CLI ([d805bca](https://github.com/usehenri/henri/commit/d805bca))





## [0.34.1](https://github.com/usehenri/henri/compare/v0.34.0...v0.34.1) (2018-10-31)


### Bug Fixes

* **react:** pathFor was requiring an object, and converting this object toString ([d3f7a14](https://github.com/usehenri/henri/commit/d3f7a14))





# [0.34.0](https://github.com/usehenri/henri/compare/v0.33.1...v0.34.0) (2018-10-30)


### Bug Fixes

* **react:** prevent error when radio buttons don't have errors... ([c103aa0](https://github.com/usehenri/henri/commit/c103aa0))
* **websocket:** disable websocket client-side until a good solution is available ([121c17d](https://github.com/usehenri/henri/commit/121c17d))





## [0.33.1](https://github.com/usehenri/henri/compare/v0.33.0...v0.33.1) (2018-10-29)


### Bug Fixes

* **react:** user should be null ([789af99](https://github.com/usehenri/henri/commit/789af99))





# [0.33.0](https://github.com/usehenri/henri/compare/v0.32.0...v0.33.0) (2018-10-26)


### Features

* **testing:** adding the package ([e2ec87b](https://github.com/usehenri/henri/commit/e2ec87b))





# [0.32.0](https://github.com/usehenri/henri/compare/v0.31.1...v0.32.0) (2018-10-23)

**Note:** Version bump only for package @usehenri/react





## [0.31.1](https://github.com/usehenri/henri/compare/v0.31.0...v0.31.1) (2018-10-17)


### Bug Fixes

* **react:** better onError message management ([8783845](https://github.com/usehenri/henri/commit/8783845))





# [0.31.0](https://github.com/usehenri/henri/compare/v0.30.3...v0.31.0) (2018-10-17)


### Bug Fixes

* **react:** better handling of onError and onSuccess in forms ([fd139da](https://github.com/usehenri/henri/commit/fd139da))





<a name="0.30.2"></a>
## [0.30.2](https://github.com/usehenri/henri/compare/v0.30.1...v0.30.2) (2018-09-26)


### Bug Fixes

* **henri:** henri should be scoped and always referred internally as this.henri (avoids leaks in testing) ([b046cc4](https://github.com/usehenri/henri/commit/b046cc4))





<a name="0.30.0"></a>
# [0.30.0](https://github.com/usehenri/henri/compare/v0.29.3...v0.30.0) (2018-09-26)

**Note:** Version bump only for package @usehenri/react





<a name="0.29.3"></a>
## [0.29.3](https://github.com/usehenri/henri/compare/v0.29.2...v0.29.3) (2018-08-29)

**Note:** Version bump only for package @usehenri/react





<a name="0.29.0"></a>
# [0.29.0](https://github.com/usehenri/henri/compare/v0.28.0...v0.29.0) (2018-08-23)


### Features

* **react:** support for webpack 4 (nextjs 6.1.1) + yalc ([3f72f38](https://github.com/usehenri/henri/commit/3f72f38))





<a name="0.28.0"></a>
# [0.28.0](https://github.com/usehenri/henri/compare/v0.27.0...v0.28.0) (2018-07-13)




**Note:** Version bump only for package @usehenri/react

<a name="0.27.0"></a>
# [0.27.0](https://github.com/usehenri/henri/compare/v0.26.1...v0.27.0) (2018-07-12)


### Bug Fixes

* **react:** new builder location was wrong for production ([bf7fe8d](https://github.com/usehenri/henri/commit/bf7fe8d))


### Features

* **react:** add --force-build for views ([271ee77](https://github.com/usehenri/henri/commit/271ee77)), closes [#53](https://github.com/usehenri/henri/issues/53)
* **react:** production build if needed only ([9f6e243](https://github.com/usehenri/henri/commit/9f6e243)), closes [#53](https://github.com/usehenri/henri/issues/53)




<a name="0.26.1"></a>
## [0.26.1](https://github.com/usehenri/henri/compare/v0.26.0...v0.26.1) (2018-06-22)


### Bug Fixes

* **react:** remove react-hot-loader ([1aa8795](https://github.com/usehenri/henri/commit/1aa8795))




<a name="0.26.0"></a>
# [0.26.0](https://github.com/usehenri/henri/compare/v0.25.0...v0.26.0) (2018-06-21)


### Features

* **react:** support for upcoming next 6.0.4 ([eca4f66](https://github.com/usehenri/henri/commit/eca4f66))




<a name="0.25.0"></a>
# [0.25.0](https://github.com/usehenri/henri/compare/v0.24.0...v0.25.0) (2018-05-22)




**Note:** Version bump only for package @usehenri/react

<a name="0.24.0"></a>
# [0.24.0](https://github.com/usehenri/henri/compare/v0.23.0...v0.24.0) (2018-05-11)


### Bug Fixes

* **react:** BYO react and packages upgrade ([ea8ba47](https://github.com/usehenri/henri/commit/ea8ba47))
* **react:** match nextjs babel tooling versions ([08bc7ed](https://github.com/usehenri/henri/commit/08bc7ed))


### Features

* **react:** add modified state to form context ([e5e3922](https://github.com/usehenri/henri/commit/e5e3922))




<a name="0.23.0"></a>
# [0.23.0](https://github.com/usehenri/henri/compare/v0.22.0...v0.23.0) (2018-04-23)




**Note:** Version bump only for package @usehenri/react

<a name="0.22.0"></a>
# [0.22.0](https://github.com/usehenri/henri/compare/v0.21.3...v0.22.0) (2018-04-17)




**Note:** Version bump only for package @usehenri/react

<a name="0.21.3"></a>
## [0.21.3](https://github.com/usehenri/henri/compare/v0.21.2...v0.21.3) (2018-04-10)




**Note:** Version bump only for package @usehenri/react

<a name="0.21.2"></a>
## [0.21.2](https://github.com/usehenri/henri/compare/v0.21.1...v0.21.2) (2018-04-10)


### Bug Fixes

* **react:** moving react engine to react package... nextjs lifting ([c90fa4c](https://github.com/usehenri/henri/commit/c90fa4c))




<a name="0.21.0"></a>
# [0.21.0](https://github.com/usehenri/henri/compare/v0.20.2...v0.21.0) (2018-04-10)


### Bug Fixes

* **react:** display initial value in editor ([a6ec701](https://github.com/usehenri/henri/commit/a6ec701))
* **react:** move files to src/ to harmonize with TypeScript integration ([683d36e](https://github.com/usehenri/henri/commit/683d36e))
* **react:** routes not working well ([a3ce9a7](https://github.com/usehenri/henri/commit/a3ce9a7))


### Features

* **react:** adding package deps and removing /_data/ calls ([c67696e](https://github.com/usehenri/henri/commit/c67696e))
* **react:** this will likely change in the future; refetch data if we use client-side router ([f49f18a](https://github.com/usehenri/henri/commit/f49f18a))
* **websocket:** add ws support with socket.io - closes [#35](https://github.com/usehenri/henri/issues/35) ([2318924](https://github.com/usehenri/henri/commit/2318924))




<a name="0.20.2"></a>
## [0.20.2](https://github.com/usehenri/henri/compare/v0.20.1...v0.20.2) (2018-01-27)


### Bug Fixes

* **cli:** helper header is a function ([33ed0b9](https://github.com/usehenri/henri/commit/33ed0b9))




<a name="0.20.0"></a>
# [0.20.0](https://github.com/usehenri/henri/compare/v0.19.0...v0.20.0) (2017-12-07)


### Features

* **react:** add a helper to render named routes (pathFor) ([952a16c](https://github.com/usehenri/henri/commit/952a16c))


### Performance Improvements

* **react:** uglify distributed libraries ([3e72b49](https://github.com/usehenri/henri/commit/3e72b49))




<a name="0.19.0"></a>
# [0.19.0](https://github.com/usehenri/henri/compare/v0.18.0...v0.19.0) (2017-11-25)


### Features

* **react:** adding custom methods to form and fetch ([df011c6](https://github.com/usehenri/henri/commit/df011c6))
* **react:** adding withHenri HOC and forms components (WIP) ([9953147](https://github.com/usehenri/henri/commit/9953147))
* **react:** change fetchData to hydrate, and add a fetch method ([b35a5c6](https://github.com/usehenri/henri/commit/b35a5c6))
* **react:** forms component ([418dc2d](https://github.com/usehenri/henri/commit/418dc2d))
* **react:** withHenri HOC to help fetch data ([1273c8d](https://github.com/usehenri/henri/commit/1273c8d))
