---
title: CLI
description: Every henri command and flag.
sidebar:
  order: 1
---

```text
henri <command> [options]
```

`henri` alone prints the help, `henri <command> --help` (or `henri help <command>`) the help of one command without running it, and `henri --version` the installed version. An unknown command prints the help and exits with `1`; a command that fails prints `henri <command> failed: <message>` and exits with `1` (`--debug=henri:*` adds the stack).

| Command                       | Description                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `new <folder>`                | Create an application in `folder`.                                           |
| `init`                        | Add the henri structure to the current directory.                            |
| `server`, `s`                 | Start the application (development mode with hot reload by default).         |
| `console`                     | Boot the application and open a Node.js REPL.                                |
| `routes`                      | Print the routes table of `config/routes.js`.                                |
| `generate <what> <name>`, `g` | Generate code, see below.                                                    |
| `destroy <what> <name>`, `d`  | Remove what a generator created.                                             |
| `build`                       | Build the production views without starting the server.                      |
| `test [files ...]`            | Run the tests with Vitest.                                                   |
| `clean`                       | Remove build artifacts and caches.                                           |
| `about`                       | Print the versions of Node, henri and the packages installed in the project. |
| `help [command]`              | Print the help.                                                              |

`routes`, `generate`, `destroy`, `build` and `clean` refuse to run outside an application (a `package.json` with a `henri` key and an `app/views/pages` directory). `server`, `console` and `test` need an application too.

## `new` and `init`

```bash
henri new <folder> [--force | -f] [--skip-install] [--no-git] [--renderer react|inertia] [--adapter <name>] [--dialect <name>] [--pm pnpm|yarn|npm]
henri init [--force | -f] [--skip-install] [--no-git] [--renderer react|inertia] [--adapter <name>] [--dialect <name>] [--pm pnpm|yarn|npm]
```

`new` creates the folder and runs `init` in it; it refuses a non-empty folder without `--force`, and `init` refuses a directory that already has an `app` folder. The project is named after the folder. Both:

1. copy the template of the renderer (`react` by default, `-r` is short for `--renderer`) and merge an existing `package.json` into the generated one (dependencies, scripts and name are kept);
2. write `config/default.json` (`baseRole`, `renderer`, the store of `--adapter`, `user: "user"`), `config/test.json` when that store needs a database of its own, and `.env` with a random `HENRI_SECRET`;
3. with the React renderer, scaffold the sample `Task` resource (model, controller, `resources tasks` route, pages and `test/tasks.test.js`) against the model API of the adapter;
4. write `db/seeds.js` (empty, with the idempotent example commented out) and a README (an existing one is renamed `README.old.md`);
5. run `git init` unless `--no-git` is given, the folder is already inside a repository, or git is missing;
6. install the dependencies with the package manager of `--pm`, or the detected one, unless `--skip-install` is given.

### `--pm`

`pnpm`, `yarn` or `npm`. Without it, the manager is, in order: the `packageManager` field of an existing `package.json`, its lockfile, `npm_config_user_agent` (the manager that ran the command, set by `pnpm dlx`, `npx`, `yarn dlx` and every `<pm> run`), then a probe of `pnpm --version` and `yarn --version`, `npm` otherwise. The command prints the manager it picked and why, so a wrong guess is visible:

```text
 - Using pnpm (npm_config_user_agent)
```

The probe comes last on purpose: a version manager shim (mise, asdf) answers non-zero for `pnpm --version` outside a project it manages, which used to make `henri new` fall back to yarn on a pnpm machine. `pnpm-workspace.yaml`, which allow-lists the dependency build scripts pnpm 11 refuses to run silently, is written whatever the manager is: npm and yarn ignore the file.

### `--adapter`

| Value        | Store written in `config/default.json`                                       | Dependencies added                    |
| ------------ | ---------------------------------------------------------------------------- | ------------------------------------- |
| `disk`       | `{ "adapter": "disk" }` (default): a local MongoDB, nothing to install       | `@usehenri/disk`                      |
| `drizzle`    | `{ "adapter": "drizzle", "dialect": "sqlite", "url": "file:.henri/app.db" }` | `@usehenri/drizzle`, `better-sqlite3` |
| `mongoose`   | `mongodb://127.0.0.1:27017/<app>`                                            | `@usehenri/mongoose`                  |
| `mysql`      | `mysql://root@127.0.0.1:3306/<app>`                                          | `@usehenri/mysql`                     |
| `postgresql` | `postgres://postgres@127.0.0.1:5432/<app>`                                   | `@usehenri/postgresql`                |
| `mssql`      | `mssql://sa@127.0.0.1:1433/<app>`                                            | `@usehenri/mssql`                     |

Every adapter but `disk` also gets a `config/test.json` on its own database (`<app>_test`, or `:memory:` for drizzle on sqlite), because `config/<NODE_ENV>.json` replaces `config/default.json` as a whole. The generated controllers use the model API of the adapter: Mongoose on `disk` and `mongoose`, Sequelize on `mysql`, `postgresql` and `mssql`, the [Drizzle](/guides/models/#drizzle) model on `drizzle`. `henri generate scaffold|crud` reads the adapter back from the configuration, so later generators match too.

### `--dialect`

Only with `--adapter drizzle`: `sqlite` (the default, `better-sqlite3`, `file:.henri/app.db`), `postgres` (`pg`) or `mysql` (`mysql2`). A drizzle application has migrations, so the README it gets mentions `henri db:generate`, `henri db:migrate`, `henri db:push` and `henri db:status` (see [`db`](#db)). Any other value, or `--dialect` without `--adapter drizzle`, exits with `2`.

See [Getting started](/getting-started/) for the resulting tree.

## `server`

```bash
henri server [--production] [--skip-workers] [--force-build] [--host=<ip>]
```

Boots the application, listens and watches the files in development. The server binds to `127.0.0.1` in development and `0.0.0.0` in production unless `--host`, `HENRI_HOST` or `config.host` says otherwise. See the [global flags](#global-flags).

## `console`

```bash
henri console [--production]
```

Boots the application without the view engine and without listening, then opens a REPL named after the project where `henri` and the models are globals:

```text
my-app> await Task.countDocuments()
```

## `routes`

```bash
henri routes [--json]
```

Expands `config/routes.js` (`resources`, `crud`, `scope`, `omit`) and prints one line per route with its verb, path, controller, path helper and roles, without booting the server. `--json` prints the same as JSON.

```text
Verb    Path             Controller     Helper
GET     /                main#home      home_main_path
GET     /tasks           tasks#index    index_tasks_path
POST    /tasks           tasks#create   create_tasks_path
PATCH   /tasks/:id       tasks#update   update_tasks_path
PUT     /tasks/:id       tasks#update   update_tasks_path
DELETE  /tasks/:id       tasks#destroy  destroy_tasks_path
GET     /tasks/:id/edit  tasks#edit     edit_tasks_path
GET     /tasks/new       tasks#new      new_tasks_path
GET     /tasks/:id       tasks#show     show_tasks_path

9 routes
```

## Generators

```bash
henri generate <what> <name> [options] [--force]
henri g <what> <name> [options] [--force]
```

| Generator                          | Writes                                                                                                                                                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model <Name> [field:type ...]`    | `app/models/<Name>.js` with the fields (timestamps are on by default).                                                                                                                                                                               |
| `controller <name> [action ...]`   | `app/controllers/<name>.js` with one `res.boom.notImplemented()` handler per action, and a `get /<name>/<action>` route for each in `config/routes.js`.                                                                                              |
| `job <name>`                       | `app/jobs/<name>.js` with `perform(args, context)`, a queue and a retry policy.                                                                                                                                                                      |
| `worker <name>`                    | `app/workers/<name>.js` with `start()` and `stop()`.                                                                                                                                                                                                 |
| `mailer <name> [action ...]`       | `app/mailers/<name>.js` with one action per name (`notify` when none is given), `app/views/mailers/<name>/<action>.hbs` for each, and `app/views/mailers/layouts/mailer.hbs` and `mailer.text.hbs` when they are missing. See [Mail](/guides/mail/). |
| `test <name>`                      | `test/<name>.test.js` requesting `GET /<name>` with `@usehenri/testing`.                                                                                                                                                                             |
| `crud <Name> [field:type ...]`     | The model, `app/controllers/<names>.js` with JSON `index`, `create`, `update` and `destroy`, and the `crud <names>` route.                                                                                                                           |
| `scaffold <Name> [field:type ...]` | The model, `app/controllers/<names>.js` with the seven `resources` actions answering HTML or JSON, the `resources <names>` route and the React pages `app/views/pages/<names>/{index,new,edit,show,_form}.js`.                                       |

Model and resource names are given in the singular with a capital: `Post` gives the model `Post`, the controller `posts.js`, the route `resources posts` and the pages under `posts/` (`category` gives `categories`, `person` `people`). Existing files are skipped and reported; `--force` overwrites them. Routes are added to `config/routes.js`, which is rewritten (formatted with prettier) with the new keys.

Fields are `name:type`, `string` when the type is omitted; a trailing `!` (`name:string!` or `name!:string`) makes the field required. Types: `string`, `text`, `number`, `integer`, `float`, `boolean`, `date`, `json`, `uuid`, mapped by each adapter (see [Models](/guides/models/#the-schema-format)); anything else is refused.

```bash
henri generate model User name:string! birthday:date
henri generate controller locations index show
henri g scaffold HighScore game:string! score:integer
henri g job welcome
henri g worker cleanup
henri g mailer welcome confirm reset
henri g test highscores
```

The scaffolded controllers follow the adapter of the default store: the Mongoose API on `disk` and `mongoose`, Sequelize on `mysql`, `postgresql` and `mssql`, the Drizzle model API on `drizzle` (see [Models](/guides/models/)). What they load a record with differs; their `index` is [`Model.paginate(req.pagination())`](/guides/models/#pagination) and their 422 is [`henri.model.errors(error)`](/guides/models/#validation-errors) on all three, because both answer the same shape on every adapter. The scaffolded pages target the React renderer.

## `destroy`

```bash
henri destroy <what> <name>
henri d <what> <name>
```

| Target              | Removes                                                                          |
| ------------------- | -------------------------------------------------------------------------------- |
| `model <Name>`      | `app/models/<Name>.js`                                                           |
| `controller <name>` | `app/controllers/<name>.js` and every route pointing to it                       |
| `route <key>`       | one key of `config/routes.js`: `henri destroy route "get /about"`                |
| `view <folder>`     | `app/views/pages/<folder>`                                                       |
| `job <name>`        | `app/jobs/<name>.js`                                                             |
| `worker <name>`     | `app/workers/<name>.js`                                                          |
| `mailer <name>`     | `app/mailers/<name>.js` and `app/views/mailers/<name>` (the shared layout stays) |
| `test <name>`       | `test/<name>.test.js`                                                            |
| `crud <Name>`       | what `generate crud` wrote (model, controller, routes)                           |
| `scaffold <Name>`   | what `generate scaffold` wrote (model, controller, routes, pages)                |

Inside a git repository the files are deleted; elsewhere they are moved to `.backup/<timestamp>/` in the project.

## `build`

```bash
henri build
```

Builds the production views without booting henri, so it needs no database: `next build` for the React renderer, the client and server Vite bundles for the Inertia renderer. The `template` renderer needs no build. It reads `config/production.json` (falling back to `default.json`) and sets `NODE_ENV=production` and `FORCE_BUILD`. Use it in a Docker build stage or in CI; `henri server --production` builds on first boot when no build exists.

## `test`

```bash
henri test [files ...] [vitest options]
```

Runs the Vitest installed in the project (`vitest run`, or `vitest` in watch mode with `--watch`/`-w`) with `NODE_ENV=test` and exits with its code. Everything after `test` is passed to Vitest, except henri's own flags. Without `vitest` in the project it prints the install command (`pnpm add -D vitest @usehenri/testing`) and exits with `1`. See [Testing](/guides/testing/).

## `db`

```bash
henri db:seed [--file=<path>]
henri db:status | db:generate [--name=<label>] | db:migrate | db:push [--force]   [--store=<name>] [--json]
```

Seeds and migrations, in the Rails `db:` style (`henri db seed` works too). Every command boots without the views, the router or the workers, so they run anywhere the database is reachable, and every one of them accepts `--json`. The migration commands stop at the models; `db:seed` also loads the user module, so a seed file can create users (their passwords are hashed by `henri.user.encrypt()`).

`db:seed` is Rails' `rails db:seed`: it requires `db/seeds.js` and awaits what it exports, with the models and the henri instance available (a function is called with the instance). `--file=<path>` runs another file. A missing seed file is a usage error (exit code `2`) reported before anything boots. It works on every adapter; write the seeds idempotently, `find` then `create`, because they run again on every machine. See [Seeds](/guides/models/#seeds).

The other four drive the migrations of a [Drizzle](/guides/models/#drizzle) store: `status` lists the applied and pending migrations of `db/migrations`, `generate` writes a migration from the schema changes, `migrate` applies the pending ones, and `push` makes the database match the models without a migration. `push` refuses statements that lose data and exits with `1` unless `--force` is passed. `--store=<name>` picks the store; stores on another adapter exit with `1`.

## `credentials`

```bash
henri credentials:edit [--env=<name>]
henri credentials:show [--env=<name>] [--json]
```

The encrypted secrets of an environment, in the Rails `credentials:` style (`henri credentials edit` works too). `--env` defaults to `NODE_ENV`, and to `dev` when it is unset, which is the environment henri reads its configuration file under; `--production` selects production like everywhere else.

`edit` decrypts `config/credentials/<env>.json.enc` into a file only you can read, opens `EDITOR` (or `VISUAL`) on it, and encrypts what comes back. The first edit of an environment writes the key, adds it to `.gitignore` and starts the file with a fresh `secret`. The plaintext never survives the command: it is removed when the editor closes, when the editor fails, and when the process is interrupted. An editor that exits non-zero, or content that is not a JSON object, leaves the credentials as they were.

`show` prints the decrypted credentials on stdout. With `--json` it prints the environment, the file and the key paths it holds — never a value, in this command and in every error message.

Both exit with `1` when the key is missing or wrong, naming the file and `HENRI_CREDENTIALS_KEY`. See [Configuration](/configuration/#encrypted-credentials).

## `jobs`

```bash
henri jobs [--queue=<a,b>] [--concurrency=<n>] [--once] [--no-recurring]
henri jobs:install | jobs:status | jobs:list | jobs:dead | jobs:show <id>
henri jobs:perform <name> [json] [--in=<duration>] [--at=<date>] [--queue=<name>] [--now]
henri jobs:retry <id> | --all      |  henri jobs:discard <id> | --all      [--json]
```

Runs and drives the [job queue](/guides/jobs/) of `@usehenri/jobs`, in the same `jobs:` style as `db:` (`henri jobs status` works too). Every command boots to the models (runlevel 4): no HTTP server, no views, no `app/workers`, so several runners live on one machine. An application without the package, or without `app/jobs` and a `jobs` configuration, exits with `1` and says what to install. Every command accepts `--json`.

Without a command, `henri jobs` runs a worker: it claims jobs, performs up to `--concurrency` of them at once (`jobs.concurrency`, five by default), honours the recurring schedules, puts back the jobs of runners that died and stops on `SIGINT`, `SIGTERM` or `SIGQUIT` after finishing what it had claimed. `--queue=mailers,reports` limits it to some queues; `--once` performs what is due and exits instead of looping, which is what a cron entry wants; `--no-recurring` leaves the schedules alone.

| Command                 | What it does                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `install`               | Creates `henri_jobs` and `henri_jobs_schedules` and their indexes. Idempotent; run it in a deploy that sets `"install": false`. |
| `status`                | Counts by queue and state, the timings of the finished jobs, how long the oldest due job has waited, the schedules.             |
| `list`                  | The jobs, newest change first (`--state`, `--queue`, `--name`, `--limit`).                                                      |
| `dead`                  | The dead letter queue.                                                                                                          |
| `show <id>`             | One job with its arguments, its error, its stack and the history of every attempt.                                              |
| `perform <name> [json]` | Enqueues a job by hand; `--in=<duration>` or `--at=<date>` for later, `--now` to run it inline instead.                         |
| `retry <id>`            | Puts a dead job back in its queue, attempts reset. `--all` (with `--queue`/`--name`) for every matching one.                    |
| `discard <id>`          | Deletes a dead job for good. `--all` (with `--queue`/`--name`) for every matching one.                                          |

`--wait` is a global flag (it belongs to `--inspect`), which is why the delay of an enqueue is `--in`.

## `doctor`

```bash
henri doctor [--json]
```

Checks the application against the conventions without starting it: no database, no views, nothing booted. Reports the Node version, the configuration and its syntax, the secret and the `.env` holding it, the git ignore rules, the credentials keys (not ignored, or already in the git index), the store adapter, the routes and each route's controller and action, controller and model naming, the page files a `resources` route needs, the test configuration, the declared and installed dependencies, and `AGENTS.md`. Exits with `1` when it finds an error. See [Coding agents](/guides/agents/).

## `mcp`

```bash
henri mcp
```

Starts the [Model Context Protocol](https://modelcontextprotocol.io/) server for the application over stdio, exposing the tools `routes`, `models`, `controllers`, `config`, `doctor`, `generate`, `destroy`, `test` and `lint`, plus the `AGENTS.md`, conventions, routes and help resources. `henri new` writes a `.mcp.json` that starts it. See [Coding agents](/guides/agents/).

## `clean`

Lists the existing ones among `.tmp`, `.henri`, `logs`, `node_modules`, `app/views/.cache` and `app/views/.next`, asks which to delete, and recreates each selected directory empty.

## `about`

Prints the versions of henri, Node, pnpm, yarn and npm, whether the current directory is a henri project, the versions of the `@usehenri/*` packages, `next`, `react` and `react-dom` installed in it, and the names of its models, pages, controllers and helpers.

## Global flags

| Flag               | Effect                                                            |
| ------------------ | ----------------------------------------------------------------- |
| `--production`     | same as `NODE_ENV=production`                                     |
| `--debug[=ns]`     | same as `DEBUG=*` or `DEBUG=<ns>`, e.g. `--debug=henri:*`         |
| `--inspect[=port]` | start the Node.js inspector on `127.0.0.1` (port 9229 by default) |
| `--wait`           | with `--inspect`, wait for a debugger to attach                   |
| `--force-build`    | force a production rebuild of the views                           |
| `--skip-workers`   | do not start `app/workers`                                        |
| `--host=<ip>`      | bind the server to this address (same as `HENRI_HOST`)            |
| `--version`, `-v`  | print the henri version                                           |
| `--help`, `-h`     | print the help of a command                                       |
| `--json`           | machine readable output; errors become one JSON object on stderr  |

## Exit codes

| Code | Name            | Meaning                                                                      |
| ---- | --------------- | ---------------------------------------------------------------------------- |
| `0`  | `OK`            | Success.                                                                     |
| `1`  | `FAILED`        | The command failed; `henri doctor` found problems; the tests failed.         |
| `2`  | `USAGE`         | Unknown command, missing or invalid argument.                                |
| `3`  | `NOT_A_PROJECT` | Not a henri application: run the command from the root of the app.           |
| `4`  | `NEEDS_TTY`     | An interactive prompt was needed but stdin is not a terminal: pass the flag. |

With `--json` a failure prints `{ "error": { "command", "message", "hint", "code", "exitCode" } }` on stderr. See [Coding agents](/guides/agents/).
