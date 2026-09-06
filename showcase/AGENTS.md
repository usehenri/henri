# @usehenri/showcase: conventions for coding agents

A [henri](https://usehenri.io) application: Rails-like MVC for Node.js, CommonJS
on the server, renderer `inertia`, store `drizzle`. Follow these rules instead of
guessing; `henri doctor` checks most of them, the `henri` MCP server answers the rest.

## Layout and naming

| Path                         | What goes there                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `app/models/Task.js`         | One model per file, singular PascalCase; loaded on boot and exposed as the global `Task`              |
| `app/controllers/tasks.js`   | Plain objects of `async (req, res)` actions; lowercase, plural for resources (`tasks#index`)          |
| `config/routes.js`           | The routes: `'get /': 'main#home'`, `'resources tasks': 'tasks'`                                      |
| `app/views/pages/tasks/`     | Inertia pages (`.jsx`, Vite + React)                                                                  |
| `app/views/components/`      | Shared components (`import Nav from 'components/nav'`); `assets/` and `public/` next to it            |
| `app/views/styles/index.css` | The Tailwind CSS v4 entry point, and the only stylesheet of the application                           |
| `app/policies/task.js`       | One policy per model: `{ index, show, update, ... }` taking `(user, record)`, asked by `req.can()`    |
| `app/workers/cleanup.js`     | `{ name, start(henri), stop(henri) }`, started with the server (`--skip-workers` to skip)             |
| `config/default.json`        | Committed configuration: `stores`, `renderer`, `user`, `baseRole`, `port`, `graphql`, `mail`          |
| `config/<NODE_ENV>.json`     | `dev.json`, `production.json` or `test.json` replaces `default.json` as a whole (keys are not merged) |
| `.env`                       | `HENRI_SECRET` and machine secrets, loaded on boot; never committed                                   |
| `test/tasks.test.js`         | Vitest tests run by `henri test`                                                                      |

## Generate, do not hand-write

```bash
henri generate scaffold Post title:string! body:text  # model + controller + routes + pages
henri generate model Post title:string! body:text     # app/models/Post.js only
henri generate controller locations index gps         # controller + one GET route per action
henri generate crud Item name:string                  # model + JSON controller + crud routes
henri generate policy Post authorId                    # app/policies/post.js + its test
henri generate worker cleanup | test posts | agents   # app/workers, test/, AGENTS.md
henri destroy scaffold Post                           # undo (model, controller, route, view, worker, test, crud too)
```

Types: `string, text, number, integer, float, boolean, date, json, uuid`; a
trailing `!` makes the field required. `Post` gives `posts` (`Category` ->
`categories`, `Person` -> `people`). Existing files are skipped unless `--force`
is given; `--json` prints the files written or removed. Generators rewrite
`config/routes.js` through prettier: comments in that file are lost.

## Models

```js
module.exports = {
  schema: {
    title: { type: 'string', required: true, unique: true, index: true },
    status: { type: 'string', enum: ['draft', 'live'], default: 'draft' },
  },
  options: {}, // timestamps: false opts out, paranoid: true soft deletes
  store: 'default', // a key of config.stores
  associate(models) {}, // optional, called once every model exists
};
```

Field keys: `type`, `required`, `default`, `enum`, `unique`, `index`,
`personal`; any other key is handed to the adapter as is. `personal: true`
says a field is about a person (`User.name`, `bio`, `company`): henri masks it
in the logs, exports it and erases it. `User.phone` is
`personal: { expose: false }`, so it never leaves the server unless a render
names it in `include` -- only `accounts#show` does. Run `henri privacy` for
the map. `options.retention` says how long a model keeps its records:
`Proposal` has two rules (drafts after 180 days, decided proposals into the
trash two years after `decidedAt`) and `Review` anonymizes its comments after
two years. A rule writes nothing until its token is in
`config.retention.approved`; `henri retention` prints them and
`henri retention:sweep` (`--yes` to write) runs the sweep. Every privacy
operation and every sweep is appended to the access trail, which
`henri trail` and `henri trail:verify` read back. Every store adds `createdAt`/`updatedAt`,
`personal`, `encrypted`; any other key is handed to the adapter as is.
`personal: true` says a field is about a person (`User.name`, `bio`,
`company`): henri masks it in the logs, exports it and erases it.
`User.phone` is `personal: { expose: false }`, so it never leaves the server
unless a render names it in `include` -- only `accounts#show` does. Run
`henri privacy` for the map.

`User.phone` is also `encrypted: true`, so PostgreSQL holds an envelope
(`henri:v1:r:...`) and the model hands back the number. Randomised, because
nothing looks a speaker up by telephone: an equality on it is refused rather
than silently matching nothing. The key is `HENRI_ENCRYPTION_KEYS` (see
`.env.example`), never `config.secret` and never a `config/*.json`. Run
`henri encryption` for the map, `henri encryption:status` before dropping a
key and `henri encryption:rotate` to move the rows. Nothing else here is
encrypted: `bio`, `company` and `name` are the published programme. Every store adds `createdAt`/`updatedAt`,
`Model.paginate({ page, perPage })` -> `{ records, page, perPage, total, pages }`,
`henri.model.errors(error)` -> `{ field: message }` (`null` otherwise) and `db/seeds.js`, run by `henri db:seed`.
Every model also carries `externalId`, a uuid that is unique and not null in the
database and the only identifier that leaves the server: routes, links and payloads
carry it, and so does every declared foreign key -- `speakerId` leaves as the
speaker's `externalId`, not as its primary key. `Model.findById()` takes the
public identifier and nothing else (a primary key answers `null`, which the
controller answers as its own 404); `Model.findByKey()` is the lookup for a
primary key you already hold, which is what server-side code and the tests use.
`options: { externalId: false }` opts a model out of all of it.
A controller that presents its records publishes first --
`await henri.model.publish(records)` -- because a plain object carries no model
and henri cannot see the foreign keys in it; `app/helpers/proposals.js`
(`presented()`) is the shape to copy.
The global is the model of the `drizzle` store, and what the generators write: the drizzle model (`where`, `order`, `include`, `findById`, `findByKey`, `create`, then `row.update()` and `row.destroy()`), rows carry `id`. Migrations live in `db/migrations`: `henri db:generate|migrate|push|status`, generate and commit one after a model change.

## Controllers

- `before: { all: [...], 'show,edit,update,destroy': loadPost }` runs hooks
  ahead of those actions (rails' `before_action`; `[fn, { only, except, run }]`
  works too), and one that answers ends the request.
- An action that returns without answering renders its own page with what it returned: `show: async (req) => ({ post: req.post })` renders `/posts/show`, `index` renders `/posts`.
- `req.permit('title', 'body')` picks the allowed fields from query, body and
  params (later wins). Never pass `req.body` to a model.
- `params: { index: { state: { type: 'string', enum: [...] } }, 'create,update':
{ title: { type: 'string', maxLength: 120 } } }` says what each action
  accepts: checked and coerced ahead of the action on every verb, 422 with one
  message per field otherwise, and `henri openapi` writes the operation's
  parameters and request body from it. `app/controllers/proposals.js` is the
  one that declares them. What may arrive over HTTP goes here; what makes a
  record (a title of at least eight characters) stays in the model, so the
  form gets that message next to the field.
- `res.negotiate({ html: () => res.render('/posts/show', { data: { post } }),
json: () => res.resource(post) })`: the page for browsers, HAL for API
  clients. An index is one query, `Post.paginate(req.pagination())`, then
  `res.collection(posts, { page, perPage, total })`; `{ status: 201 }` sets
  Location, 204 on destroy. Mutations honour `Idempotency-Key`; rate limits apply outside dev.
- `res.boom.notFound(message, data)`, `badData` (422), `badRequest`,
  `unauthorized`, `forbidden`, `conflict`, `tooManyRequests` answer JSON.
- `req.flash('notice', 'Saved')` before a redirect: the next page rendered gets it in `flash.notice`, once (needs a user model, so a session).
- `req.user` is the logged-in user or undefined. Log with
  `henri.pen.info|warn|error('scope', ...)`, not `console.log`.
- `app/controllers/tasks.js` (scaffolded) is the reference implementation.

## Routes

```js
module.exports = {
  root: 'main#home', // GET /, like 'get /': 'main#home'
  'resources posts': { only: ['index', 'show'], member: ['post archive'] },
  'crud items': { scope: 'api', except: ['destroy'] }, // JSON: index, create, update
  'namespace admin': { 'resources posts': { roles: ['admin'] } }, // admin/posts
};
```

Keys are `'<verb> /path'` (verb defaults to `get`, `:id` params), `root`, `resources|crud <name>` or `namespace <name>` (a routes object; its controllers live in `app/controllers/admin/`).
Values are `'controller#action'` or `{ controller, roles, scope, only, except, member, collection, nested }`: `member`/`collection` add `/posts/:id/x` and `/posts/x`, `nested` expands a routes object under `/posts/:post_id/`, `omit` is the old name of `except`.
`roles` requires a logged-in user owning every role (401/403 as JSON, redirect to `/login` for browsers). `henri routes --json` prints the expanded table with the helper names (`show_posts_path`); views use them with `getRoute()` and `pathFor()`.

## Views (inertia)

Pages are `.jsx` files rendered by Inertia (Vite + React); `res.render('/tasks')`
resolves `pages/tasks/index.jsx`. `useHenri()` from `@usehenri/inertia` gives
`data`, `user`, `paths`, `errors`, `csrf`, `getRoute`, `pathFor`, `fetch`, `hydrate`;
`Form` (POST by default, CSRF field injected), `Link`, `Head`, `router`, `usePage`
and `useForm` come from the same package. `res.inertia.errors({ field: 'msg' })`
before rendering again hands validation errors to the page; `res.inertia.location(url)` redirects outside the app.

## Styling: Tailwind CSS v4

`app/views/styles/index.css` is the whole stylesheet of the application.
`app/views/main.jsx` imports it once, the `@tailwindcss/vite` plugin of `app/views/vite.config.mjs` compiles it.

Write utility classes in the pages: no CSS modules, no second stylesheet and
no `tailwind.config.js` (v4 has none, the theme is `@theme { --color-brand: ... }`
in that file). Dark mode is the `dark:` variant and follows the operating
system, so a colour class wants its `dark:` counterpart. Tailwind reads only
the `@source` globs of `index.css` (`pages/`, `components/`): add one before
writing classes anywhere else. A class list long enough to hide the markup
goes in a `const` at the top of the page, like the scaffolded pages do.

## Users and secrets

Set `"user": "user"` in `config/default.json` and add `app/models/User.js`:
the store adds `email` (unique), `password` (hashed, never selected) and
`roles` (default: `baseRole`), plus `POST /login` (`email`, `password`),
`POST /logout`, sessions, CSRF and `req.user`. `roles` cannot be
mass-assigned: use `user.setRoles([...])` or `User.setRoles(id, roles)`. The
session secret is `HENRI_SECRET` in `.env` (written by `henri new`).

## Policies

`roles` says who may reach an endpoint; `app/policies/<model>.js` says who may
act on one record. This application has two: `proposal` (a draft belongs to
its speaker and to the committee; only its speaker writes it) and `review`.
Ask with `req.can('update', proposal)` or `await req.authorize(...)`, and the
routes declare `policy: true` so henri asks too. It fails closed: no policy,
no rule for the action and a rule that threw all mean no, and only the boolean
`true` allows. A rule taking a record is never asked without one, so
`index`/`new`/`create` are answered at the route. `paths` and `_links` lose
what the policy refuses, and a controller that presents its records names what
the rules should read with `res.resource(await presented(x), { subject: x })`.

`config.user.signup`, `passwordReset` and `confirmation` mount the rest of
the story: `POST /signup`, `POST /password/forgot`,
`GET /password/reset/:token`, `POST /password/reset`, `GET /confirm/:token`,
`POST /confirm` and `POST /account/email`. This application writes none of
that -- `app/controllers/accounts.js` only renders the pages those forms live
on, and `config.user.signup.fields` says which attributes a signup form may
set. Never hand-roll a token, a reset or a confirmation here: call
`henri.accounts.*` if you need one from your own controller.

## Tests

`henri test` runs Vitest (`vitest.config.js`, `test/**/*.test.js`) with henri
booted under `NODE_ENV=test`: `henri` and the models are globals, and
`request()` from `@usehenri/testing` is a supertest bound to the running
server (`agent()` keeps cookies). `henri generate test posts` writes the
skeleton. Vitest only, no jest.

## Commands, exit codes, MCP

| Command                              | Result                                             |
| ------------------------------------ | -------------------------------------------------- |
| `henri doctor [--json]`              | Conventions check; run it after every change       |
| `henri routes --json`                | The routes table                                   |
| `henri generate\|destroy ... --json` | Files written or removed, routes added or removed  |
| `henri test [files]`                 | The tests (exits with vitest's code)               |
| `pnpm lint`                          | `eslint .` (the model globals are declared)        |
| `henri server`, `build`, `console`   | Dev server with hot reload, production views, REPL |

Exit codes: 0 ok, 1 failed (or problems found), 2 usage error, 3 not a henri
app (run from the root), 4 needs a terminal (pass the flag: `henri clean
--all`). With `--json`, errors are
`{ "error": { command, message, hint, code, exitCode } }` on stderr.

`.mcp.json` starts `henri mcp` for Claude Code; Cursor: `.cursor/mcp.json` with
`{ "mcpServers": { "henri": { "command": "henri", "args": ["mcp"] } } }`
(`node_modules/.bin/henri-mcp` when `henri` is not on the PATH). Tools:
`routes`, `models`, `controllers`, `config`, `generate`, `destroy`, `test`,
`lint`, `doctor`; resources: `henri://agents.md`, `henri://routes`,
`henri://conventions`.

## Do not

- Do not use `mongoose`, `sequelize`, `mongodb` or `pg` directly: go through the model globals.
- Do not `require` a model or `henri`: they are globals.
- Do not put `secret` or passwords in `config/*.json`; do not commit `.env`, `.henri/` or `.backup/`.
- Do not set `roles` from request data; do not mass-assign `req.body`.
- Do not write an ownership `if` in a controller: the rule goes in `app/policies` and `req.can()` / `req.authorize()` ask it, so the views and the links get the same answer.
- Do not add `tailwind.config.js`, a CSS module or a second stylesheet: the theme lives in `app/views/styles/index.css`.
- Keep the `resolvePage` resolver and `import.meta.glob('./pages/**/*.jsx')` in `app/views/main.jsx` and `ssr.jsx` (global styles and Inertia options go in `main.jsx`); do not rename generated files by hand (regenerate with `--force`, or `destroy` first).
- Do not leave `henri server` running in a non-interactive session; verify with `henri test` and `henri doctor`.
