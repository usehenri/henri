---
title: Getting started
description: Install henri, create a project and start the development server.
sidebar:
  order: 1
---

Four commands take you from an empty directory to an application answering on
`http://localhost:3000/`, with a database, a resource and its pages. Measured on
a warm package cache: eight seconds for `henri new` and six more for the first
boot. The first run on a cold cache is longer, and the difference is the
download — an application resolves about six hundred packages.

```bash
pnpm add -g henri
henri new my-app
cd my-app
henri server
```

There is no database to install. `henri new` writes a [Drizzle](/guides/models/#drizzle)
store on sqlite at `.henri/app.db`, so nothing has to be running before
`henri server` does.

## Requirements

- **Node.js 22 or newer.** Anything older stops at the first command, with the
  version it found:

  ```text
  You are using Node.js v20.20.0

  henri requires Node.js 22 or newer.
  ```

- **A package manager.** `henri new` uses the one it finds — the
  `packageManager` field of an existing `package.json`, its lockfile, then the
  manager that ran the command, then a probe — and prints its choice.
  `--pm pnpm|yarn|npm` forces it.

:::note
Releases published before 1.0 target Node 10 to 14. If you have an application
written for henri 0.37, read [Upgrading](/upgrading/).
:::

### Without a global install

`pnpm add -g henri` needs pnpm's global bin directory on your `PATH`, and on a
machine where `pnpm setup` has never run it refuses rather than installing:

```text
[ERROR] The configured global bin directory "…/Library/pnpm/bin" is not in PATH
Run "pnpm setup" to update your shell configuration.
```

You can skip the global install entirely. `pnpm dlx henri new my-app` (or
`npx henri new my-app`) scaffolds the application, and the application depends
on `henri` itself — so `npm start`, `pnpm start` and `npx henri <command>` all
work inside it with nothing installed globally:

```text
> second-app@1.0.0 start
> henri server
```

The rest of this page writes `henri` for short.

## What `henri new` writes

```text
 - Using pnpm (pnpm --version)
 - Copying new directory structure...
 - Building new package file...
 - Generating config/default.json, config/test.json and .env...
 - Listing better-sqlite3 under allowBuilds in pnpm-workspace.yaml...
 - Scaffolding the sample Task resource...
> created controller "tasks.js" @ app/controllers/tasks.js
> added route "resources tasks" @ config/routes.js
> created view "index.jsx" @ app/views/pages/tasks/index.jsx
> created view "_form.jsx" @ app/views/pages/tasks/_form.jsx
> created view "new.jsx" @ app/views/pages/tasks/new.jsx
> created view "edit.jsx" @ app/views/pages/tasks/edit.jsx
> created view "show.jsx" @ app/views/pages/tasks/show.jsx
> created test "tasks.test.js" @ test/tasks.test.js
 - Adding a Dockerfile...
 - Adding new readme file...
 - Writing AGENTS.md, CLAUDE.md and .mcp.json for coding agents...
 - Initialized a git repository
 - Installing packages using pnpm...
```

`--skip-install` and `--no-git` skip the last two steps, `-f` writes into an
existing folder, `--renderer react` picks the [Next.js](/guides/views/#react)
view engine instead of the default [Inertia](/guides/views/#inertia) one, and
`--adapter` picks the [store](/guides/models/#adapters). The result:

```text
├── .dockerignore
├── .env                      <- HENRI_SECRET, ignored by git
├── .gitignore
├── .mcp.json                 <- runs `henri mcp` for a coding agent
├── AGENTS.md                 <- the conventions of this app; CLAUDE.md points at it
├── CLAUDE.md
├── Dockerfile
├── app
│   ├── controllers
│   │   ├── main.js           <- main#home, the landing page
│   │   └── tasks.js          <- the resources actions of Task
│   ├── helpers
│   ├── jobs
│   ├── models
│   │   └── Task.js           <- the `Task` global
│   ├── views
│   │   ├── assets
│   │   ├── components
│   │   ├── index.html        <- the html shell Inertia renders into
│   │   ├── jsconfig.json     <- lets pages `import x from 'components/x'`
│   │   ├── main.jsx          <- the browser entry, imports the stylesheet
│   │   ├── pages
│   │   │   ├── index.jsx
│   │   │   └── tasks         <- index, new, edit, show and _form
│   │   ├── public
│   │   ├── ssr.jsx           <- the server entry
│   │   ├── styles
│   │   │   └── index.css     <- Tailwind CSS, the whole stylesheet
│   │   └── vite.config.mjs   <- @usehenri/inertia/vite + Tailwind
│   └── workers
├── config
│   ├── default.json          <- stores, renderer, user model (committed)
│   ├── routes.js             <- 'get /': 'main#home', 'resources tasks': 'tasks'
│   └── test.json             <- the same store, on :memory:
├── db
│   └── seeds.js              <- seed data, run with `henri db:seed`
├── eslint.config.js
├── jsconfig.json             <- editors: henri's types and .henri/types.d.ts
├── package.json
├── pnpm-workspace.yaml       <- allowBuilds for pnpm; npm and yarn ignore it
├── README.md
├── test
│   └── tasks.test.js         <- run with `henri test`
└── vitest.config.js
```

If you have a Ruby on Rails background, this should look familiar. The sample
resource is a regular scaffold (`henri generate scaffold Task name:string!
category:string:enum=urgent,high,medium,low done:boolean` writes the same files,
bar the default the sample `category` carries); `henri destroy scaffold Task`
removes it. Its form shows what the generator reads off the model: `name` is
required so its input is, and `category` can only hold four values so it is a
`<select>` of them.

The pages are styled: [Tailwind CSS](https://tailwindcss.com) v4 is wired for
the renderer you picked, `app/views/styles/index.css` is the whole stylesheet,
and dark mode follows the operating system. See [Views](/guides/views/#styles).

`config/default.json` is committed and holds no secret: the session secret is
generated into `.env` as `HENRI_SECRET`. `config/test.json` points the same
store at `":memory:"`, so `henri test` never touches your development data.

## The boot

`henri server` loads twenty-five modules in dependency order and prints what
each one decided. Abridged, with the timestamps trimmed:

```text
       henri ✏  1.2.0 => dev
        boot ✏  running from cli
      config ✏  from the environment => secret = [FILTERED] => HENRI_SECRET
     drizzle ✏  schema pushed: 2 statement(s) in 137ms
        user ✏  no user model defined; will not load user module
      router ✏  9 routes loaded successfully => press R to see a list
        view ✏  starting vite dev server... => vite = 8.2.2 => react = 19.2.8 => inertia = 3.7.0
        view ✏  inertia ready (vite dev server) => ssr = on
         api ✏  rate limit => 600 requests per 60s per user or ip (not enforced in development), counted in this process
      server ✏  ready for battle
      server ✏  local url => http://localhost:3000/
```

Three of those lines are worth reading twice.

**`schema pushed`** — a development boot pushes the models to the database, so
the `tasks` table exists without a migration. For production you write the
first migration and apply it (`henri db:generate --name=init`, then
`henri db:migrate`); [Models](/guides/models/#drizzle) has the rest.

**`no user model defined`** — the scaffold configures a user model but ships no
`app/models/User.js`, so sessions, passport and the CSRF middleware stay
unloaded. `henri generate authentication` writes the model, the pages, the
controller, the mailer and the tests. See [Users](/guides/users/).

**`ready for battle`** — from here the process watches your files. Saving a
controller, a model, `config/routes.js`, a worker or a configuration file
reloads the affected modules without restarting; the view engine hot reloads
the pages itself (Vite with Inertia, Turbopack with Next.js). With the React
renderer, changes to `config/next.js` or `config/webpack.js` need a restart,
and the terminal says so.

While the server runs in an interactive terminal:

| Key                | Action                                            |
| ------------------ | ------------------------------------------------- |
| `r`                | list the loaded routes                            |
| `u`                | list the routes whose controller is missing       |
| `Ctrl+R`           | reload the whole application                      |
| `Ctrl+O`, `Ctrl+N` | open the app in your browser                      |
| `Ctrl+C`           | stop the server (a second `Ctrl+C` exits at once) |

## Add a resource without stopping the server

Leave `henri server` running and, in another terminal, generate one:

```bash
henri generate scaffold Post title:string! body:text status:string:enum=draft,published
```

```text
> created model "Post.js" @ app/models/Post.js
> created controller "posts.js" @ app/controllers/posts.js
> added route "resources posts" @ config/routes.js
> created view "index.jsx" @ app/views/pages/posts/index.jsx
> created view "_form.jsx" @ app/views/pages/posts/_form.jsx
> created view "new.jsx" @ app/views/pages/posts/new.jsx
> created view "edit.jsx" @ app/views/pages/posts/edit.jsx
> created view "show.jsx" @ app/views/pages/posts/show.jsx
```

The terminal running the server answers on its own:

```text
     drizzle ✏  schema pushed: 2 statement(s) in 10ms
      router ✏  17 routes loaded successfully => press R to see a list
     modules ✏  workers => reloaded => 21/21
```

The table was created, the routes went from nine to seventeen, and
`http://localhost:3000/posts` renders — no restart. That reload is the loop you
will spend the day in.

`henri destroy scaffold Post` takes all of it back. The generator writes no
test file; `henri generate test posts` does.

## What answered

Add a task at `/tasks/new`, then post one to the same route and read what comes
back. The scaffolded controller writes none of this envelope — henri does:

```bash
curl -H 'Accept: application/json' -X POST http://localhost:3000/tasks \
  -H 'Content-Type: application/json' \
  -d '{"name":"read the getting started page","category":"high"}'
```

```json
{
  "_links": {
    "self": { "href": "/tasks/01a08374-9497-76f5-8c91-6920dd677217" },
    "collection": { "href": "/tasks" },
    "edit": { "href": "/tasks/01a08374-9497-76f5-8c91-6920dd677217/edit" },
    "update": {
      "href": "/tasks/01a08374-9497-76f5-8c91-6920dd677217",
      "method": "PATCH"
    },
    "destroy": {
      "href": "/tasks/01a08374-9497-76f5-8c91-6920dd677217",
      "method": "DELETE"
    }
  },
  "name": "read the getting started page",
  "category": "high",
  "done": false,
  "externalId": "01a08374-9497-76f5-8c91-6920dd677217",
  "createdAt": "2026-09-08T23:57:30.647Z",
  "updatedAt": "2026-09-08T23:57:30.647Z"
}
```

The identifier in every url is `externalId`, a uuid v7; the primary key never
leaves the server ([Models](/guides/models/#identifiers)). The `_links` come
from the routes file, filtered by the current user's roles and then by the
record's policy ([API](/guides/api/)).

Two different refusals are worth telling apart, because they come from two
different places. A value outside the `enum` never reaches the action:

```json
{
  "error": "Unprocessable Entity",
  "message": "the parameters are invalid",
  "statusCode": 422,
  "code": "HENRI_PARAMS_INVALID",
  "data": {
    "errors": { "category": "must be one of urgent, high, medium, low" }
  }
}
```

A missing `name` reaches the model and is refused there:

```json
{
  "error": "Unprocessable Entity",
  "message": "Task validation failed: name: is required",
  "statusCode": 422,
  "data": { "errors": { "name": "is required" } }
}
```

The first is the controller's `params` block ([Controllers](/guides/controllers/)),
the second the model's schema ([Models](/guides/models/#validations)). A browser
posting the same form gets the page back with the messages under the fields
instead of the JSON.

## When something goes wrong

**The port is busy.** henri does not fail; it takes the next free one and says
so, so check the url it printed rather than assuming `3000`:

```text
      server ✏  port 3000 is busy, using 3001 instead
      server ✏  local url => http://localhost:3001/
```

**Something in the configuration is wrong.** Every failure henri raises carries
a code and a hint, and configuration is validated before any other module
starts:

```text
  henri server failed [HENRI_CONFIG_INVALID]: invalid configuration (1 problem): port

  "port" must be a port number between 1 and 65535, but it is the string "three thousand" (from config/default.json)
    A port is a whole number: { "port": 3000 }. In development a busy one is replaced by the next free port
```

The codes are catalogued at [Errors](/reference/errors/), with what each one
means and how to fix it.

**Anything else.** `henri doctor` checks the application without booting it —
the configuration files, the routes, the models, the missing dependencies:

```text
  henri doctor: no problems found (1 model, 2 controllers, 9 routes)
```

and when there is something to say, it says where and what to do:

```text
  error    config.invalid       config/default.json
           config/default.json: "port" must be a port number between 1 and 65535, but it is the string "three thousand"
           -> A port is a whole number: { "port": 3000 }. In development a busy one is replaced by the next free port
```

## Another database

`--adapter` picks the store of the new application. The sample resource, the
dependencies and `config/default.json` follow it, and `config/test.json` is
pointed at a database of its own.

```bash
henri new my-app                                       # drizzle on sqlite, file:.henri/app.db
henri new my-app --adapter postgresql                  # drizzle on a PostgreSQL server
henri new my-app --adapter mysql                       # drizzle on MySQL or MariaDB
henri new my-app --adapter drizzle --dialect postgres  # the same, spelled the other way
henri new my-app --adapter mongoose                    # a MongoDB server
henri new my-app --adapter disk                        # a local MongoDB, nothing to install
henri new my-app --adapter mssql                       # SQL Server, on sequelize
```

`drizzle`, `postgresql` and `mysql` are all the [Drizzle
adapter](/guides/models/#drizzle) — `@usehenri/postgresql` and `@usehenri/mysql`
are it with the dialect and the driver chosen — so all three have migrations
(`henri db:generate`, `db:migrate`, `db:push`, `db:status`). `mssql` is the one
adapter on Sequelize, because Drizzle has no SQL Server dialect, and it has no
migrations. Every adapter but `disk` and sqlite expects a server running at the
url written in `config/default.json`.

## Everyday commands

```bash
henri server --production    # build the views once, then serve them
henri server --debug=henri:* # verbose logs (same as DEBUG=henri:*)
henri server --host=0.0.0.0  # listen on every interface
henri routes                 # the routes table of config/routes.js
henri console                # a REPL with henri and the models loaded
henri runner 'await Task.count()'  # one expression inside a booted app
henri db:seed                # run db/seeds.js with the models loaded
henri test                   # run test/**/*.test.js with Vitest
henri doctor                 # check the application without booting it
```

`henri test` runs the scaffolded suite as it stands:

```text
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

## Where to go next

- [Models](/guides/models/) — the schema format, the adapters, migrations
- [Controllers](/guides/controllers/) — actions, `before` hooks, `params`, `answers`
- [Routes](/guides/routes/) — `resources`, `member`, `namespace`, path helpers
- [Views](/guides/views/) — Inertia, React, the styles, server-side rendering
- [Users](/guides/users/) — `henri generate authentication`, sessions, policies
- [Testing](/guides/testing/) — `@usehenri/testing`, factories, `request()`
- [CLI reference](/reference/cli/) — every command and flag
