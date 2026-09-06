# {{name}}: conventions for coding agents

A [henri](https://usehenri.io) application: Rails-like MVC for Node.js, CommonJS
on the server, renderer `{{renderer}}`, store `{{adapter}}`. Follow these rules instead of
guessing; `henri doctor` checks most of them, the `henri` MCP server answers the rest. Types
ship with every package and `jsconfig.json` points at them, so keep the `/** @type ... */` line
the generators write above `module.exports` (`req`, `res` and `henri` complete; models are `any`).

## Layout and naming

| Path                         | What goes there                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `app/models/Task.js`         | One model per file, singular PascalCase; loaded on boot and exposed as the global `Task`                                 |
| `app/controllers/tasks.js`   | Plain objects of `async (req, res)` actions; lowercase, plural for resources (`tasks#index`)                             |
| `config/routes.js`           | The routes: `'get /': 'main#home'`, `'resources tasks': 'tasks'`                                                         |
| `app/views/pages/tasks/`     | {{engine}} pages (`.{{ext}}`): `index`, `new`, `show`, `edit`, `_form`; `pages/tasks/index.{{ext}}` is `/tasks`          |
| `app/views/components/`      | Shared components (`import Nav from 'components/nav'`); `assets/` and `public/` next to it                               |
| `app/views/styles/index.css` | The Tailwind CSS v4 entry point, and the only stylesheet of the application                                              |
| `app/jobs/welcome.js`        | `{ queue, maxAttempts, timeout, perform(args, context) }`, run by `henri jobs` (needs `@usehenri/jobs`)                  |
| `app/workers/cleanup.js`     | `{ name, start(henri), stop(henri) }`, started with the server (`--skip-workers` to skip)                                |
| `config/default.json`        | Committed configuration: `stores`, `renderer`, `user`, `baseRole`, `port`, `graphql` (needs `@usehenri/graphql`), `mail` |
| `config/<NODE_ENV>.json`     | `dev.json`, `production.json` or `test.json` replaces `default.json` as a whole (keys are not merged)                    |
| `.env`                       | `HENRI_SECRET` and machine secrets, loaded on boot; never committed                                                      |
| `test/tasks.test.js`         | Vitest tests run by `henri test`                                                                                         |

## Generate, do not hand-write

```bash
henri generate scaffold Post title:string! body:text  # model + controller + routes + pages
henri generate model Post title:string! body:text     # app/models/Post.js only
henri generate controller locations index gps         # controller + one GET route per action
henri generate crud Item name:string                  # model + JSON controller + crud routes
henri generate job welcome | worker cleanup | test posts | agents
henri destroy scaffold Post                           # undo (model, controller, route, view, worker, test, crud too)
```

Types: `string, text, number, integer, float, boolean, date, json, uuid`; a
trailing `!` makes the field required. `Post` gives `posts` (`Category` ->
`categories`, `Person` -> `people`). Existing files are skipped unless `--force`
is given; `--json` prints the files written or removed. Generators rewrite
`config/routes.js` through prettier: comments in that file are lost.

## Models

```js
/** @type {import('@usehenri/core').ModelFile} */
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

Field keys: `type`, `required`, `default`, `enum`, `unique`, `index`; any other
key is handed to the adapter as is. Every store adds `createdAt`/`updatedAt`,
`Model.paginate({ page, perPage })` -> `{ records, page, perPage, total, pages }`,
`henri.model.errors(error)` -> `{ field: message }` (`null` otherwise) and `db/seeds.js`, run by `henri db:seed`.
Every model also carries `externalId`, a uuid that is unique and not null in the
database and the only identifier that leaves the server: routes, links and payloads
carry it, the numeric id stays internal, `Model.findById()` takes either of the two, and `options: { externalId: false }` opts a model out.
The global is the model of the `{{adapter}}` store, and what the generators write: {{#if mongoose}}Mongoose (`find`, `findById`, `create`, then `doc.set()`, `doc.save()` and `doc.deleteOne()`), documents carry `_id`.{{/if}}{{#if drizzle}}the drizzle model (`where`, `order`, `include`, `findById`, `create`, then `row.update()` and `row.destroy()`), rows carry `id`. Migrations live in `db/migrations`: `henri db:generate|migrate|push|status`, generate and commit one after a model change.{{/if}}{{#if sequelize}}Sequelize (`findAll`, `findByPk`, `create`, then `row.update()` and `row.destroy()`), rows carry `id`. There are no migrations: the boot runs `sequelize.sync()` and creates or extends the tables from the models.{{/if}}

## Controllers

- `before: { all: [...], 'show,edit,update,destroy': loadPost }` runs hooks
  ahead of those actions (rails' `before_action`; `[fn, { only, except, run }]`
  works too), and one that answers ends the request.
- An action that returns without answering renders its own page with what it returned: `show: async (req) => ({ post: req.post })` renders `/posts/show`, `index` renders `/posts`.
- `req.permit('title', 'body')` picks the allowed fields from query, body and
  params (later wins). Never pass `req.body` to a model.
- `res.negotiate({ html: () => res.render('/posts/show', { data: { post } }),
json: () => res.resource(post) })`: the page for browsers, HAL for API
  clients. An index is one query, `Post.paginate(req.pagination())`, then
  `res.collection(posts, { page, perPage, total })`; `{ status: 201 }` sets
  Location, 204 on destroy. Mutations honour `Idempotency-Key`; rate limits apply outside dev.
- `res.boom.notFound(message, data)`, `badData` (422), `badRequest`,
  `unauthorized`, `forbidden`, `conflict`, `tooManyRequests` answer JSON.
- `req.flash('notice', 'Saved')` before a redirect: the next page rendered gets it in `flash.notice`, once (needs a user model, so a session).
- `req.user` is the logged-in user or undefined; log with `henri.pen.info|warn|error('scope', ...)`, not `console.log`. `app/controllers/tasks.js` (scaffolded) is the reference implementation.

## Routes

```js
/** @type {import('@usehenri/core').RoutesFile} */
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

## Views ({{renderer}})

{{#if react}}Pages are next.js pages (pages router; the app router is not supported) exported through `withHenri` from `@usehenri/react`. They receive `data`, `user`, `paths`, `errors`, `flash`, `csrf`, `getRoute`, `pathFor`, `fetch`, `hydrate` and `router`; nested components read the same values with `useHenri()`. Forms come from `@usehenri/react/forms` and show the `422` a controller answers with, field by field. `app/views/next.config.js` is generated: extend next.js from `config/next.js` (`module.exports = { next: (config) => config }`).{{/if}}{{#if inertia}}Pages are `.jsx` components bundled by Vite and swapped by Inertia without a document reload: `res.render('/tasks')` resolves `pages/tasks/index.jsx`, `res.render('/tasks/show')` resolves `pages/tasks/show.jsx`. `useHenri()` from `@usehenri/inertia` gives `data`, `user`, `paths`, `errors`, `flash`, `csrf`, `getRoute`, `pathFor`, `fetch` and `hydrate`; `Form` (POST by default, the CSRF field injected, children as a render prop receiving `{ errors, processing }`), `Link`, `Head`, `router`, `usePage` and `useForm` come from the same package. A form submits, the controller redirects and the client renders the page it lands on; to refuse a write, `res.inertia.errors({ field: 'msg' })` then render the page again, and `res.inertia.location(url)` redirects outside the app.{{/if}}

## Styling: Tailwind CSS v4

`app/views/styles/index.css` is the whole stylesheet of the application.
{{#if react}}`app/views/pages/_app.js` imports it once, `app/views/postcss.config.mjs` compiles it.{{/if}}{{#if inertia}}`app/views/main.jsx` imports it once, the `@tailwindcss/vite` plugin of `app/views/vite.config.mjs` compiles it.{{/if}}

Utility classes in the pages: no CSS modules, no second stylesheet, no `tailwind.config.js` (v4 has none; the theme is `@theme` in that file). Dark mode is the `dark:` variant and follows the system, so a colour class wants its counterpart.
Tailwind reads only the `@source` globs of `index.css` (`pages/`, `components/`): add one before writing classes elsewhere. A class list long enough to hide the markup goes in a `const` at the top of the page.

## Jobs

Work that must not block a request goes in `app/jobs`, never in a worker: `henri.jobs.perform('welcome', { userId })` (`performIn('5m', ...)`, `performAt(date, ...)`) writes one row and returns; a `henri jobs` process performs it, retries it with a backoff and, out of attempts, keeps it in the dead letter queue (`henri jobs:dead`, `jobs:retry`, `jobs:status`). Arguments must survive JSON: pass ids, never a model instance or a `Buffer`. The queue is at-least-once, so a job must be idempotent. Recurring work is `jobs.recurring` in `config/default.json` (`{ "job": "cleanup", "cron": "0 3 * * *" }`, read in UTC), never a `setInterval` in a worker: `app/workers` is for long-lived processes only.

## Users and secrets

Set `"user": "user"` in `config/default.json` and add `app/models/User.js`:
the store adds `email` (unique), `password` (hashed, never selected) and
`roles` (default: `baseRole`), plus `POST /login`, `POST /logout`, sessions,
CSRF and `req.user`. `roles` cannot be mass-assigned: use `user.setRoles()`
or `User.setRoles(id, roles)`. The secret is `HENRI_SECRET` in `.env`.

## Tests

`henri test` runs Vitest (`vitest.config.js`, `test/**/*.test.js`) with henri
booted under `NODE_ENV=test`: `henri` and the models are globals, and
`request()` from `@usehenri/testing` is a supertest bound to the server
(`agent()` keeps cookies). `henri generate test posts` writes the skeleton.

## Commands, exit codes, MCP

| Command                              | Result                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `henri doctor [--json]`              | Conventions check; run it after every change                           |
| `henri audit [--json]`               | Security check against the ASVS; `--checks` says what it looks for     |
| `henri routes --json`                | The routes table                                                       |
| `henri generate\|destroy ... --json` | Files written or removed, routes added or removed                      |
| `henri test [files]`                 | The tests (exits with vitest's code)                                   |
| `pnpm lint`                          | `eslint .` (the model globals are declared)                            |
| `henri jobs [--once] [--queue=]`     | Perform the background jobs (`jobs:status`, `jobs:dead`, `jobs:retry`) |
| `henri server`, `build`, `console`   | Dev server with hot reload, production views, REPL                     |

Exit codes: 0 ok, 1 failed (or problems found), 2 usage error, 3 not a henri
app (run from the root), 4 needs a terminal (pass the flag: `henri clean
--all`). With `--json`, errors are
`{ "error": { command, message, hint, code, exitCode } }` on stderr.

`.mcp.json` starts `henri mcp` for Claude Code; Cursor: `.cursor/mcp.json` with
`{ "mcpServers": { "henri": { "command": "henri", "args": ["mcp"] } } }`
(`node_modules/.bin/henri-mcp` when `henri` is not on the PATH). Tools:
`routes`, `models`, `controllers`, `config`, `generate`, `destroy`, `test`,
`lint`, `doctor`, `audit`; resources: `henri://agents.md`, `henri://routes`,
`henri://conventions`.

## Do not

- Do not use `mongoose`, `sequelize`, `mongodb` or `pg` directly, and do not `require` a model or `henri`: they are globals.
- Do not put `secret` or passwords in `config/*.json`; do not commit `.env`, `.henri/` or `.backup/`.
- Do not set `roles` from request data; do not mass-assign `req.body`.
- Do not add `tailwind.config.js`, a CSS module or a second stylesheet: the theme lives in `app/views/styles/index.css`.
- {{#if react}}Do not edit `app/views/next.config.js`{{/if}}{{#if inertia}}Keep the `resolvePage` resolver and `import.meta.glob('./pages/**/*.jsx')` in `app/views/main.jsx` and `ssr.jsx` (global styles and Inertia options go in `main.jsx`){{/if}}; do not rename generated files by hand (regenerate with `--force`, or `destroy` first).
- Do not leave `henri server` running in a non-interactive session; verify with `henri test`, `henri doctor` and `henri audit`. Do not add a protection henri already applies (helmet headers, the CSRF token, the session cookie flags, password hashing, the rate limits): `henri audit --checks` and usehenri.io/guides/security say what is there.
