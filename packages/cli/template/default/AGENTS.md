# {{name}}: conventions for coding agents

A [henri](https://usehenri.io) application: Rails-like MVC for Node.js, CommonJS
on the server, renderer `{{renderer}}`. Follow these rules instead of guessing;
`henri doctor` checks most of them, the `henri` MCP server answers the rest.

## Layout and naming

| Path                       | What goes there                                                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/models/Task.js`       | One model per file, singular PascalCase; loaded on boot and exposed as the global `Task`                                                                                         |
| `app/controllers/tasks.js` | Plain objects of `async (req, res)` actions; lowercase, plural for resources (`tasks#index`)                                                                                     |
| `config/routes.js`         | The routes: `'get /': 'main#home'`, `'resources tasks': 'tasks'`                                                                                                                 |
| `app/views/pages/tasks/`   | {{#if react}}next.js pages (`.js`): `index`, `new`, `show`, `edit`, `_form`; `pages/tasks/index.js` is `/tasks`{{/if}}{{#if inertia}}Inertia pages (`.jsx`, Vite + React){{/if}} |
| `app/views/components/`    | Shared components (`import Nav from 'components/nav'`); `styles/`, `assets/`, `public/` next to it                                                                               |
| `app/workers/cleanup.js`   | `{ name, start(henri), stop(henri) }`, started with the server (`--skip-workers` to skip)                                                                                        |
| `config/default.json`      | Committed configuration: `stores`, `renderer`, `user`, `baseRole`, `port`, `graphql`, `mail`                                                                                     |
| `config/<NODE_ENV>.json`   | `dev.json`, `production.json` or `test.json` replaces `default.json` as a whole (keys are not merged)                                                                            |
| `.env`                     | `HENRI_SECRET` and machine secrets, loaded on boot; never committed                                                                                                              |
| `test/tasks.test.js`       | Vitest tests run by `henri test`                                                                                                                                                 |

## Generate, do not hand-write

```bash
henri generate scaffold Post title:string! body:text  # model + controller + routes + pages
henri generate model Post title:string! body:text     # app/models/Post.js only
henri generate controller locations index gps         # controller + one GET route per action
henri generate crud Item name:string                  # model + JSON controller + crud routes
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
  options: { timestamps: true },
  store: 'default', // a key of config.stores
  associate(models) {}, // optional, called once every model exists
};
```

Field keys: `type`, `required`, `default`, `enum`, `unique`, `index`; any other
key is handed to the adapter as is (Mongoose options on `disk` and `mongoose`
stores, Sequelize attribute options on `mysql`, `postgresql`, `mssql`). The
global is the ORM model: Mongoose (`find`, `findById`, `create`,
`findByIdAndUpdate`, `findByIdAndDelete`) on `disk`/`mongoose`, Sequelize
(`findAll`, `findByPk`) on SQL stores. The scaffold targets Mongoose.

## Controllers

- `req.permit('title', 'body')` picks the allowed fields from query, body and
  params (later wins). Never pass `req.body` to a model.
- `res.render('/posts/show', { data: { post } })` renders
  `app/views/pages/posts/show` (`/posts` renders `pages/posts/index`) and
  answers `{ data, user, paths, ... }` as JSON to `Accept: application/json`.
- `res.boom.notFound(message, data)`, `badData` (422), `badRequest`,
  `unauthorized`, `forbidden`, `conflict`, `notImplemented` answer
  `{ statusCode, error, message, data }`.
- `res.format({ html, json, default })`, `res.redirect`, `res.json`: Express 5.
- `req.user` is the logged-in user or undefined. Log with
  `henri.pen.info|warn|error('scope', ...)`, not `console.log`.
- `app/controllers/tasks.js` (scaffolded) is the reference implementation.

## Routes

```js
module.exports = {
  'get /': 'main#home',
  'resources posts': 'posts', // index, new, create, show, edit, update, destroy
  'crud items': { controller: 'items', scope: 'api', omit: ['destroy'] }, // JSON: index, create, update
  'get /admin': { controller: 'admin#index', roles: ['admin'] },
};
```

Keys are `'<verb> /path'` (verb defaults to `get`, `:id` params); values are
`'controller#action'` or `{ controller, roles, scope, omit }`. `roles` requires
a logged-in user owning every role (401/403 as JSON, redirect to `/login` for
browsers). `henri routes --json` prints the expanded table with the helper
names (`show_tasks_path`); views use them with `getRoute()` and `pathFor()`.

## Views ({{renderer}})

{{#if react}}
Pages are next.js pages (pages router) exported through `withHenri` from
`@usehenri/react`; they receive `data`, `user`, `paths`, `getRoute`, `pathFor`,
`fetch` and `hydrate`. Nested components call `useHenri()`. Forms come from
`@usehenri/react/forms`. `app/views/next.config.js` is generated: extend
next.js from `config/next.js` (`module.exports = { next: (config) => config }`).
{{/if}}
{{#if inertia}}
Pages are `.jsx` files rendered by Inertia (Vite + React); `res.render('/tasks')`
resolves `pages/tasks/index.jsx`. `useHenri()` from `@usehenri/inertia` gives
`data`, `user`, `paths`, `errors`, `csrf`, `getRoute`, `pathFor`, `fetch`, `hydrate`;
`Form` (POST by default, CSRF field injected), `Link`, `Head`, `router`, `usePage`
and `useForm` come from the same package. `res.inertia.errors({ field: 'msg' })`
before rendering again hands validation errors to the page; `res.inertia.location(url)` redirects outside the app.
{{/if}}

## Users and secrets

Set `"user": "user"` in `config/default.json` and add `app/models/User.js`:
the store adds `email` (unique), `password` (hashed, never selected) and
`roles` (default: `baseRole`), plus `POST /login` (`email`, `password`),
`POST /logout`, sessions, CSRF and `req.user`. `roles` cannot be
mass-assigned: use `user.setRoles([...])` or `User.setRoles(id, roles)`. The
session secret is `HENRI_SECRET` in `.env` (written by `henri new`).

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
- {{#if react}}Do not edit `app/views/next.config.js`{{/if}}{{#if inertia}}Keep the `resolvePage` resolver and `import.meta.glob('./pages/**/*.jsx')` in `app/views/main.jsx` and `ssr.jsx` (global styles and Inertia options go in `main.jsx`){{/if}}; do not rename generated files by hand (regenerate with `--force`, or `destroy` first).
- Do not leave `henri server` running in a non-interactive session; verify with `henri test` and `henri doctor`.
