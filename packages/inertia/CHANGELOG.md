# @usehenri/inertia

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

- [#323](https://github.com/usehenri/henri/pull/323) [`7071e76`](https://github.com/usehenri/henri/commit/7071e766f060ff28804549adcb22f73c18adff90) Thanks [@reel](https://github.com/reel)! - Both view engines warned at every boot that `sass` was missing, whether or not the application had any `.scss` to compile. Since the scaffold styles with Tailwind and writes no Sass, a new app carried the dependency only to silence that warning. The engines now look for an authored `.scss` under `app/views` first, skipping build output, and `henri new` no longer adds `sass`. An app that writes Sass keeps working and still gets the warning when the package is missing.

- [#336](https://github.com/usehenri/henri/pull/336) [`67e77eb`](https://github.com/usehenri/henri/commit/67e77eb8919d0420d17fcf995ffb224dc55756c5) Thanks [@reel](https://github.com/reel)! - Development no longer paints an unstyled page before the styles arrive.
  
  Vite hands a stylesheet to the browser as a JavaScript module that injects it once the entry has run, so a server-rendered document had no stylesheet at all in its head and the browser painted the fully laid-out markup unstyled until the module executed. The engine now links the stylesheets the browser entry imports, asking the dev server for the compiled CSS itself, so the styles are there for the first paint. The module still runs and still owns hot updates. Production was never affected: the built stylesheets have always been linked from the manifest.

## 1.1.0

### Minor Changes

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - New `@usehenri/inertia` view engine: the Inertia.js protocol on Vite with React 19 pages and server-side rendering, selected with `"renderer": "inertia"`. Pages read the controller data with `useHenri()`, navigate with `<Link>` and submit with `<Form>` through Inertia's router. `henri new <app> --renderer inertia` scaffolds an application using it; `henri build` produces the client and server bundles.
