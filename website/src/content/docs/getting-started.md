---
title: Getting started
description: Install henri, create a project and start the development server.
sidebar:
  order: 1
---

## Requirements

- Node.js 22 or newer
- A package manager: pnpm, npm or yarn. `henri new` uses the one it finds (the `packageManager` field of an existing `package.json`, its lockfile, then the manager that ran the command, then a probe) and prints its choice; `--pm pnpm|yarn|npm` forces it.

:::note
henri was revived in 2026 on a modern toolchain (Node 22+, Express 5, Next.js 16, React 19, Drizzle ORM, Mongoose 9). Releases published before 1.0 still target Node 10 to 14. If you have an application written for henri 0.37, read [Upgrading](/upgrading/).
:::

## Install

```bash
pnpm add -g henri
# or: npm install -g henri
```

`henri --version` prints the installed version.

## Create a project

```bash
henri new my-app
cd my-app
henri server
```

`henri new` copies the application skeleton, writes the configuration, scaffolds a sample `Task` resource, writes a README, runs `git init` (unless the folder is already inside a repository) and installs the dependencies. `--skip-install` and `--no-git` skip those two steps; `--renderer react` picks the [Next.js](/guides/views/#react) view engine instead of the default [Inertia](/guides/views/#inertia) one, and `--adapter postgresql|mysql|mssql|mongoose|disk` the [store](/guides/models/#adapters) instead of the default `drizzle` one. The result:

```text
├── .env                      <- HENRI_SECRET, ignored by git
├── .gitignore
├── app
│   ├── controllers
│   │   ├── main.js           <- main#home, the landing page
│   │   └── tasks.js          <- the resources actions of Task
│   ├── helpers
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
│   ├── jobs
│   └── workers
├── config
│   ├── default.json          <- stores, renderer, user model (committed)
│   └── routes.js             <- 'get /': 'main#home', 'resources tasks': 'tasks'
├── db
│   └── seeds.js              <- seed data, run with `henri db:seed`
├── eslint.config.js
├── package.json
├── pnpm-workspace.yaml       <- allowBuilds for pnpm; npm and yarn ignore it
├── README.md
├── test
│   └── tasks.test.js         <- run with `henri test`
└── vitest.config.js
```

If you have a Ruby on Rails background, this should look familiar. The sample resource is a regular scaffold (`henri generate scaffold Task name:string! category:string done:boolean` writes the same files); `henri destroy scaffold Task` removes it.

The pages are styled: [Tailwind CSS](https://tailwindcss.com) v4 is wired for the renderer you picked, `app/views/styles/index.css` is the whole stylesheet, and dark mode follows the operating system. Everything the generators write from now on is styled the same way. See [Views](/guides/views/#styles) for the theme, the `@source` globs and how to opt out.

`config/default.json` is committed and holds no secret: the session secret is generated into `.env` as `HENRI_SECRET`, which henri reads on boot. The default store is [Drizzle](/guides/models/#drizzle) on sqlite, in `.henri/app.db` (ignored too): there is no server to start, `henri test` runs on `:memory:`, and it is a database you can deploy rather than one you have to leave behind.

### Another database

`--adapter` picks the store of the new application. The sample resource, the dependencies and `config/default.json` follow it, and a `config/test.json` is written so `henri test` runs on its own database.

```bash
henri new my-app                                       # drizzle on sqlite, file:.henri/app.db
henri new my-app --adapter postgresql                  # drizzle on a PostgreSQL server
henri new my-app --adapter mysql                       # drizzle on MySQL or MariaDB
henri new my-app --adapter drizzle --dialect postgres  # the same, spelled the other way
henri new my-app --adapter mongoose                    # a MongoDB server
henri new my-app --adapter disk                        # a local MongoDB, nothing to install
henri new my-app --adapter mssql                       # SQL Server, on sequelize
```

`drizzle`, `postgresql` and `mysql` are all the [Drizzle adapter](/guides/models/#drizzle) — `@usehenri/postgresql` and `@usehenri/mysql` are it with the dialect and the driver chosen — so all three have migrations (`henri db:generate`, `db:migrate`, `db:push`, `db:status`). `mssql` is the one adapter on Sequelize, because Drizzle has no SQL Server dialect, and it has no migrations. Every adapter but `disk` and sqlite expects a server running at the url written in `config/default.json`.

## Start coding

`henri server` boots the modules in order (configuration, mail and GraphQL, controllers and the Express app, models and the view engine, users, routes and workers), prints the URL it listens on (`http://localhost:3000/`; development binds to `127.0.0.1`) and watches your files. Saving a controller, a model, `config/routes.js`, a worker or a configuration file reloads the affected modules without restarting the process; the view engine hot reloads the pages itself (Vite with Inertia, Turbopack with Next.js). With the React renderer, changes to `config/next.js` or `config/webpack.js` need a restart, and the terminal says so.

Open the page, add a task at `/tasks/new`, then read `app/controllers/tasks.js` and `app/views/pages/tasks/index.jsx` to see the data flow: the controller calls `res.render('/tasks', { data })` and the page reads `data` with `useHenri()` (`withHenri` with the React renderer).

While the server runs in an interactive terminal:

| Key      | Action                                            |
| -------- | ------------------------------------------------- |
| `r`      | list the loaded routes                            |
| `u`      | list the routes whose controller is missing       |
| `Ctrl+R` | reload the whole application                      |
| `Ctrl+O` | open the app in your browser                      |
| `Ctrl+C` | stop the server (a second `Ctrl+C` exits at once) |

## Everyday commands

```bash
henri server --production    # build the views once, then serve them
henri server --debug=henri:* # verbose logs (same as DEBUG=henri:*)
henri server --inspect       # start the Node.js inspector
henri server --skip-workers  # do not start app/workers
henri server --host=0.0.0.0  # listen on every interface
henri routes                 # the routes table of config/routes.js
henri console                # a REPL with henri and the models loaded
henri db:seed                # run db/seeds.js with the models loaded
henri test                   # run test/**/*.test.js with Vitest
henri generate scaffold Post title:string! body:text
```

See the [CLI reference](/reference/cli/) for every command and flag.
