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
| `openapi`                     | Write the OpenAPI 3.1 description of what the application exposes.           |
| `generate <what> <name>`, `g` | Generate code, see below.                                                    |
| `destroy <what> <name>`, `d`  | Remove what a generator created.                                             |
| `build`                       | Build the production views without starting the server.                      |
| `test [files ...]`            | Run the tests with Vitest.                                                   |
| `clean`                       | Remove build artifacts and caches.                                           |
| `about`                       | Print the versions of Node, henri and the packages installed in the project. |
| `audit`                       | Check the application against the ASVS and the OWASP Top 10.                 |
| `analyze [module]`            | Boot the application and print the boot chart of its modules.                |
| `webhooks`                    | The endpoints this application sends signed webhooks to, see below.          |
| `help [command]`              | Print the help.                                                              |

`routes`, `openapi`, `analyze`, `generate`, `destroy`, `build` and `clean` refuse to run outside an application (a `package.json` with a `henri` key and an `app/views/pages` directory). `server`, `console` and `test` need an application too.

## `new` and `init`

```bash
henri new <folder> [--force | -f] [--skip-install] [--no-git] [--renderer inertia|react] [--adapter <name>] [--dialect <name>] [--pm pnpm|yarn|npm]
henri init [--force | -f] [--skip-install] [--no-git] [--renderer inertia|react] [--adapter <name>] [--dialect <name>] [--pm pnpm|yarn|npm]
```

`new` creates the folder and runs `init` in it; it refuses a non-empty folder without `--force`, and `init` refuses a directory that already has an `app` folder. The project is named after the folder. Both:

1. copy the template of the renderer (`inertia` by default, `react` for the Next.js engine; `-r` is short for `--renderer`) and merge an existing `package.json` into the generated one (dependencies, scripts and name are kept);
2. write `config/default.json` (`baseRole`, `renderer`, the store of `--adapter`, `user: "user"`), `config/test.json` when that store needs a database of its own, and `.env` with a random `HENRI_SECRET`;
3. scaffold the sample `Task` resource (model, controller, `resources tasks` route, pages and `test/tasks.test.js`) against the model API of the adapter and the pages of the renderer;
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

| Value        | Store written in `config/default.json`                                                 | Dependencies added                    |
| ------------ | -------------------------------------------------------------------------------------- | ------------------------------------- |
| `drizzle`    | `{ "adapter": "drizzle", "dialect": "sqlite", "url": "file:.henri/app.db" }` (default) | `@usehenri/drizzle`, `better-sqlite3` |
| `postgresql` | `postgres://postgres@127.0.0.1:5432/<app>`                                             | `@usehenri/postgresql`                |
| `mysql`      | `mysql://root@127.0.0.1:3306/<app>`                                                    | `@usehenri/mysql`                     |
| `mssql`      | `mssql://sa@127.0.0.1:1433/<app>`                                                      | `@usehenri/mssql`                     |
| `mongoose`   | `mongodb://127.0.0.1:27017/<app>`                                                      | `@usehenri/mongoose`                  |
| `disk`       | `{ "adapter": "disk" }`: a local MongoDB, nothing to install                           | `@usehenri/disk`                      |

Every adapter but `disk` also gets a `config/test.json` on its own database (`<app>_test`, or `:memory:` for drizzle on sqlite), because `config/<NODE_ENV>.json` replaces `config/default.json` as a whole.

`postgresql` and `mysql` are `@usehenri/drizzle` with the dialect and the driver chosen, so they add one package and no driver of their own, and the store they write has no `dialect` key. The generated controllers use the model API of the adapter: the [Drizzle](/guides/models/#drizzle) model on `drizzle`, `postgresql` and `mysql`, Mongoose on `disk` and `mongoose`, Sequelize on `mssql`. `henri generate scaffold|crud` reads the adapter back from the configuration, so later generators match too.

### `--dialect`

Only with `--adapter drizzle`, which is the default, so it works on its own: `sqlite` (the default, `better-sqlite3`, `file:.henri/app.db`), `postgres` (`pg`) or `mysql` (`mysql2`). Every drizzle store has migrations, so the README the application gets mentions `henri db:generate`, `henri db:migrate`, `henri db:push` and `henri db:status` (see [`db`](#db)). Any other value, or `--dialect` next to an adapter that fixes its own (`postgresql`, `mysql`, `mssql`, `mongoose`, `disk`), exits with `2`.

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

## `openapi`

```bash
henri openapi [--out <file>] [--summary]
```

Writes the [OpenAPI 3.1](/guides/openapi/) description of what the application exposes, built from `config/routes.js`, `app/models` and the configuration. It starts no server and opens no database. JSON on stdout by default; `--out <file>` writes it instead and prints what it covers, `--summary` prints only that.

It describes the answers henri produces itself — the HAL collection and resource of every `resources`/`crud` route, the error envelope, the paging, the versioned media type, `Idempotency-Key`, the roles and the policy of each route, and the endpoints henri mounts (`POST /login`, the account flows, the health probes). What a controller writes itself it does not describe: those operations carry the statuses henri answers, `x-henri.known: false`, and no success status at all.

```text
$ henri openapi --summary

OpenAPI 3.1.0 for lineup 1.0.0

  47 operations, 36 paths
  27 described from the routes, the models and henri's own endpoints
  20 whose answer henri cannot know

  What henri cannot know (the controller writes the body; only the failures henri answers itself are described):
    GET /  main#home
    GET /about  main#about
    POST /proposals/{id}/submit  proposals#submit
```

A booted application answers the same document at `GET /_openapi.json`, in development and from the loopback interface only, like `/_routes` and `/_controllers`.

Exits `2` on `--out` without a file name and `1` with `HENRI_API_DESCRIPTION_UNWRITABLE` when the file cannot be written.

## Generators

```bash
henri generate <what> <name> [options] [--force]
henri g <what> <name> [options] [--force]
```

| Generator                          | Writes                                                                                                                                                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model <Name> [field:type ...]`    | `app/models/<Name>.js` with the fields (timestamps are on by default).                                                                                                                                                                                     |
| `controller <name> [action ...]`   | `app/controllers/<name>.js` with one `res.boom.notImplemented()` handler per action, and a `get /<name>/<action>` route for each in `config/routes.js`.                                                                                                    |
| `job <name>`                       | `app/jobs/<name>.js` with `perform(args, context)`, a queue and a retry policy.                                                                                                                                                                            |
| `worker <name>`                    | `app/workers/<name>.js` with `start()` and `stop()`.                                                                                                                                                                                                       |
| `mailer <name> [action ...]`       | `app/mailers/<name>.js` with one action per name (`notify` when none is given), `app/views/mailers/<name>/<action>.hbs` for each, and `app/views/mailers/layouts/mailer.hbs` and `mailer.text.hbs` when they are missing. See [Mail](/guides/mail/).       |
| `policy <Name> [ownerColumn]`      | `app/policies/<name>.js` with the seven actions of a resource stubbed on an ownership check (`userId`, or the column named), a `scope`, and `test/<name>-policy.test.js` proving the refusals. See [Policies](/guides/policies/).                          |
| `test <name>`                      | `test/<name>.test.js` requesting `GET /<name>` with `@usehenri/testing`.                                                                                                                                                                                   |
| `crud <Name> [field:type ...]`     | The model, `app/controllers/<names>.js` with JSON `index`, `create`, `update` and `destroy`, and the `crud <names>` route.                                                                                                                                 |
| `scaffold <Name> [field:type ...]` | The model, `app/controllers/<names>.js` with the seven `resources` actions answering HTML or JSON, the `resources <names>` route and the pages `app/views/pages/<names>/{index,new,edit,show,_form}` (`.jsx` with the Inertia renderer, `.js` with React). |
| `authentication`                   | The account flows: turns `config.user.signup`, `passwordReset` and `confirmation` on, and writes the user model (when there is none), `app/controllers/accounts.js`, the five pages, `app/mailers/auth.js` with its views, the routes and the tests.       |
| `agents`                           | `AGENTS.md`, `CLAUDE.md` and `.mcp.json` in an existing application. See [Coding agents](/guides/agents/).                                                                                                                                                 |

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
henri g authentication
```

`authentication` and `agents` take no name. `authentication` is the one generator that edits `config/*.json`: it adds the three account blocks to `user` in every configuration file that does not have them, and reports the files it changed (`updated` in the `--json` summary). It writes nothing that reimplements a token, a hash or a session — the endpoints are the ones the user module mounts (see [Users](/guides/users/#the-account-flows)) — and its pages take the same renderer fork as the scaffolded ones.

The scaffolded controllers follow the adapter of the default store: the Drizzle model API on `drizzle`, `postgresql` and `mysql`, the Mongoose API on `disk` and `mongoose`, Sequelize on `mssql` (see [Models](/guides/models/)). What they load a record with differs; their `index` is [`Model.paginate(req.pagination())`](/guides/models/#pagination) and their 422 is [`henri.model.errors(error)`](/guides/models/#validation-errors) on all three, because both answer the same shape on every adapter. They declare no [`params`](/guides/controllers/#params-what-an-action-accepts) block, so that model refusal is the only 422 a generated action gives.

The pages follow the `renderer` of the application, read back from `config/default.json`: Inertia `.jsx` pages using `useHenri()` and `<Form>`, or Next.js `.js` pages using `withHenri` and `@usehenri/react/forms`. The renderer is also what a failed write answers a browser with: the Inertia controllers call `res.inertia.errors()` and render the form again, the React ones answer the `422` their forms read. API clients get the same `422` either way, and `henri generate test` writes the matching test (the Inertia page object plus the HAL answers, or the HAL answers alone).

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
| `policy <Name>`     | `app/policies/<name>.js` and `test/<name>-policy.test.js`                        |
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
henri db:create | db:drop [--force] | db:reset [--force]                          [--store=<name>] [--json]
henri db:seed [--file=<path>]
henri db:status | db:generate [--name=<label>] | db:migrate | db:push [--force]   [--store=<name>] [--json]
henri db:rollback [--step=<n>] [--force]                                          [--store=<name>] [--json]
henri db:schema:dump | db:schema:load [--file=<path>]                             [--store=<name>] [--json]
```

The database, its schema and its seeds, in the Rails `db:` style (`henri db seed` works too). Every command boots without the views, the router or the workers, so they run anywhere the database is reachable, and every one of them accepts `--json`. The migration commands stop at the models; `db:seed` also loads the user module, so a seed file can create users (their passwords are hashed by `henri.user.encrypt()`).

`db:seed` is Rails' `rails db:seed`: it requires `db/seeds.js` and awaits what it exports, with the models and the henri instance available (a function is called with the instance). `--file=<path>` runs another file. A missing seed file is a usage error (exit code `2`) reported before anything boots. It works on every adapter; write the seeds idempotently, `find` then `create`, because they run again on every machine. See [Seeds](/guides/models/#seeds).

`db:create` makes the database the store points at, which every other command assumes exists. It reads `config/<env>.json`, the environment, `DATABASE_URL` and the credentials the way henri does and stops there — a store cannot connect to a database that is not there yet — then talks to the server with the driver the application already installed. PostgreSQL and MySQL are created on the server's maintenance connection, a SQLite database is its file, and MongoDB makes one on its first write, which it says rather than pretending to act. Running it twice is not an error.

`db:drop` removes it, and `db:reset` is drop, create, the schema (from `db/migrations` when the application has migrations, from the models when it does not) and `db/seeds.js` when it exists. Both refuse to act when `NODE_ENV` is `production` unless `--force` is passed. The environment is `NODE_ENV`, as everywhere else, so the test database is `NODE_ENV=test henri db:create`.

The rest drive the schema of a [Drizzle](/guides/models/#drizzle) store: `status` lists the applied and pending migrations of `db/migrations`, `generate` writes a migration from the schema changes, `migrate` applies the pending ones, and `push` makes the database match the models without a migration. `push` refuses statements that lose data and exits with `1` unless `--force` is passed. `--store=<name>` picks the store; an `mssql` store, the one without migrations, exits with `1` and `HENRI_CLI_MIGRATIONS_UNSUPPORTED`, and `status` answers there too (it reads the database back and reports the drift instead).

`db:rollback` undoes the last migration, or the last `--step=<n>`, newest first. drizzle-kit writes no `down`, so henri computes the inverse from the two snapshots in `db/migrations/meta` when you ask for it -- nothing is stored that could go stale. The `.sql` and its snapshot stay on disk: `db:status` reports the migration pending again and `db:migrate` applies it again. It refuses three things, and each carries its own [error code](/reference/errors/): a migration that dropped a table or a column (`HENRI_MIGRATION_IRREVERSIBLE`, and `--force` does not help -- that is a restore from a backup), a migration whose `.sql` no longer hashes to what the database recorded (`HENRI_MIGRATION_EDITED`), and a rollback that would take rows away (`HENRI_MIGRATION_DESTRUCTIVE`). The rows are counted first, so undoing a migration nothing was written into needs no flag; the refusal exits with `1` and `--force` applies it. `--json` answers `{ ok, rolledBack, plan }`, where each entry of `plan` is `{ tag, when, statements, removes }` and `removes` is `{ kind, table, column, rows }` -- `rows: null` when henri could not count, which reads as data loss.

`db:schema:dump` writes `db/schema.sql`, read from the database rather than from the migration chain, so it can only run where one is reachable. Two runs against the same schema produce the same bytes, and the header names the migration the database was at. `--json` answers `{ at, file, statements, tables }`. `db:schema:load` creates all of it in an empty database and records the migrations through the one the dump names as applied, leaving anything newer for `db:migrate`; `--json` answers `{ at, file, statements, recorded }`. It refuses a table it would create that already exists (`HENRI_MIGRATION_DATABASE_NOT_EMPTY`, exit `1`) and has no `--force`: `db:drop` and `db:create` are how a database is emptied. `--file=<path>` moves the dump for that run. Both exit with `1` and `HENRI_CLI_MIGRATIONS_UNSUPPORTED` on an `mssql` store (no migrations to name) and on a `mongoose` one (no schema to write down). See [the schema dump](/guides/models/#the-schema-dump).

## `credentials`

```bash
henri credentials:edit [--env=<name>]
henri credentials:show [--env=<name>] [--json]
henri credentials:rotate [--env=<name>] [--json]
```

The encrypted secrets of an environment, in the Rails `credentials:` style (`henri credentials edit` works too). `--env` defaults to `NODE_ENV`, and to `dev` when it is unset, which is the environment henri reads its configuration file under; `--production` selects production like everywhere else.

`edit` decrypts `config/credentials/<env>.json.enc` into a file only you can read, opens `EDITOR` (or `VISUAL`) on it, and encrypts what comes back. The first edit of an environment writes the key, adds it to `.gitignore` and starts the file with a fresh `secret`. The plaintext never survives the command: it is removed when the editor closes, when the editor fails, and when the process is interrupted. An editor that exits non-zero, or content that is not a JSON object, leaves the credentials as they were.

`show` prints the decrypted credentials on stdout. With `--json` it prints the environment, the file and the key paths it holds — never a value, in this command and in every error message.

`rotate` re-encrypts the file under a fresh key, keeping the values. The current key has to open the file first, and the re-encrypted file is read back before the new key is stored: a rotation that cannot be verified puts the old file back and changes nothing. The new key is written to the key file, or printed once when `HENRI_CREDENTIALS_KEY` held the old one — `--json` never prints it. The old key opens nothing afterwards, so anything holding a copy needs the new one before its next boot.

All three exit with `1` when the key is missing or wrong, naming the file and `HENRI_CREDENTIALS_KEY`. See [Configuration](/configuration/#encrypted-credentials).

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

## `webhooks`

```bash
henri webhooks [--owner=<id>] [--disabled] [--json]
henri webhooks:install | webhooks:status
henri webhooks:add <url> --events '<a,b>' [--owner=<id>] [--description=<text>] [--header='X-Name: value']
henri webhooks:show <id> [--reveal]   |  henri webhooks:update <id> [--url] [--events] [--header]
henri webhooks:rotate <id> [--grace=<duration>]
henri webhooks:disable <id> [--reason=<text>]  |  henri webhooks:enable <id>  |  henri webhooks:remove <id>
henri webhooks:send <id> [event] [--data=<json>]
```

Drives the endpoints of [outbound webhooks](/guides/webhooks/) (`@usehenri/webhooks`), in the same `webhooks:` style as `jobs:`. Every command boots to runlevel 4 — no HTTP server, no views — and accepts `--json`. An application without the package exits with `1` and says what to install.

What happened to a **delivery** is not here: a delivery is a job, so `henri jobs:list --queue webhooks`, `henri jobs:dead`, `henri jobs:show <id>` and `henri jobs:retry <id>` are the answer, and `webhooks:status` prints the endpoints next to those counts rather than repeating them.

| Command             | What it does                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `list`              | The endpoints (`--owner`, `--disabled`, `--limit`). The default command.                                                            |
| `install`           | Creates `henri_webhooks` and its index. Idempotent; run it in a deploy that sets `"install": false`.                                |
| `status`            | How many endpoints there are, and what the queue holds for the webhooks queue.                                                      |
| `add <url>`         | Registers an endpoint and prints its signing secret **once**. `--events` is required.                                               |
| `show <id>`         | One endpoint. `--reveal` prints the signing secrets that still sign, for a receiver that lost one.                                  |
| `update <id>`       | Changes `--url`, `--events`, `--description` or the `--header`s.                                                                    |
| `rotate <id>`       | A new secret; `--grace=24h` keeps the old one signing that long, so a receiver can install the new one without dropping a delivery. |
| `disable <id>`      | Stops sending to it, keeping `--reason` on the endpoint.                                                                            |
| `enable <id>`       | Sends to it again.                                                                                                                  |
| `remove <id>`       | Forgets it. The deliveries already queued for it end without being sent.                                                            |
| `send <id> [event]` | Enqueues one delivery by hand (`--data '{"total":1}'`), to try a receiver. A runner still has to perform it.                        |

## `encryption`

```bash
henri encryption [--json]
henri encryption:status [--json]
henri encryption:rotate [--dry-run] [--model=<Name>] [--field=<name>] [--json]
```

The fields the models mark [`encrypted`](/guides/encryption/), the ids of the keys that open them, and the rotation that moves them. All three boot the models only (runlevel 4, like `privacy` and `db:seed`): no port is bound and no route is registered. No key is ever printed, by these or by anything else.

| Command  | What it does                                                                                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (none)   | Prints the map: which fields of which models are encrypted, whether each is randomised or deterministic, and the id and source of every key held.                                         |
| `status` | Counts what the columns hold, by key id, without opening a single value. Exits `0` whatever it finds: "not finished yet" is what it was asked.                                            |
| `rotate` | Rewrites every value that is not under the key that writes today, soft-deleted rows included, one column of one row at a time so `updatedAt` does not move. Exits `1` if anything failed. |

A backfill is a rotation: a column that held plaintext before the field was marked `encrypted` is "not under the primary key" either, so the same command encrypts it — with `config.encryption.readPlaintext` on for the length of the migration.

A value that will not open is counted, named and **left exactly as it is**: the rotation decrypts, re-encrypts and reads the new envelope back before it writes anything. `--dry-run` reports without writing; `--model` and `--field` narrow the walk.

Dropping a key while `status` still counts rows under it is how a rotation becomes a data loss — a record nobody writes again is only ever moved by this walk. That is why the status counts by key id rather than answering "done".

## `privacy`

```bash
henri privacy [--json]
henri privacy:export <who> [--out=<file>] [--json]
henri privacy:erase <who> [--dry-run] [--strategy=<name>] [--yes] [--json]
```

The [personal data](/guides/privacy/) of the application, and the two operations a person may ask for. All three boot to the user module (runlevel 4, like `db:seed`): no port is bound and no route is registered. `who` is an email address, an `externalId` or a primary key.

| Command        | What it does                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (none)         | Prints the map: which fields of which models are marked `personal`, which of them never leave the server, how each model reaches the person and what an erasure would do. |
| `export <who>` | Everything held about one person: their record and every record of every model linked to them, soft-deleted rows included. `--out` writes the document to a file.         |
| `erase <who>`  | Erases them. Asks first (`--yes` in a script, exit `4` without a terminal), refuses before writing anything when the plan cannot be carried out, and leaves a receipt.    |

`--dry-run` prints the plan and writes nothing. `--strategy` is the default for the models that do not declare one (`anonymize`, `delete`, `orphan`, `retain`); a model that decided keeps its answer. The receipt goes to `config.privacy.receipts` (`privacy/`), and holds an HMAC of the identity rather than the identity.

## `retention`

```bash
henri retention [--json]
henri retention:sweep [--only=<name>] [--yes] [--json]
```

How long the models say they keep their records, and the sweep that enforces it. See [Retention](/guides/retention/). Both boot to the user module (runlevel 4, like `db:seed`): no port is bound and no route is registered.

| Command | What it does                                                                                                                                                                        |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (none)  | Prints every rule -- what it does, what its clock is measured from, and the token that approves it -- and the line to paste into `config/<env>.json` for the ones that are pending. |
| `sweep` | Runs it. Without `--yes` it plans, counts and prints, and writes nothing. `--only=<Model>` or `--only=<Model>:<rule>` narrows it.                                                   |

A rule whose token is not in `config.retention.approved` writes nothing however the sweep was run, so a new rule cannot delete anything until a person approved it. `config.retention.batch` (`1000`) bounds one run; the rest is reported and taken by the next. The receipt goes to `config.retention.receipts` (`privacy/`).

With `@usehenri/jobs` installed and `config.retention.schedule` set, the same sweep runs as the recurring `henri/retention` job. Without the package, this command is what a cron line runs, and the boot log says so.

## `trail`

```bash
henri trail [--action=<name>] [--model=<name>] [--actor=<id>] [--since=<date>] [--until=<date>] [--limit=<n>] [--json]
henri trail:about <who> [--json]
henri trail:verify [--json]
```

The append-only record of who read or changed personal data, read back. See [The access trail](/guides/trail/). It is off until `config.trail` says otherwise.

| Command       | What it does                                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (none)        | The latest entries, newest first.                                                                                                                                    |
| `about <who>` | Everything recorded about one person. The address is not in the table -- henri digests what you asked about -- so this still answers after the erasure took it away. |
| `verify`      | Walks the hash chain and says whether a row was edited or removed, and where. Exits `1` on a break.                                                                  |

## `doctor`

```bash
henri doctor [--json] [--no-reach]
```

Checks that the application is coherent, without starting it: no boot, no views, and no database except for the one question below. Exits with `1` when it finds an error; warnings do not fail. See [Coding agents](/guides/agents/).

Every problem carries a stable `check` name to branch on, a `level` (`error` or `warning`), the `file` to open, a `hint` saying what to run next and a `code` — the [henri error code](/reference/errors/) the boot would raise, when the check is predicting a failure the framework already has a name for, and `null` when the convention is this command's own.

**The conventions.** The Node version; the syntax of every `config/*.json` and each one run through [henri's configuration schema](/configuration/#validation) (`config.invalid`, `config.adapter`, `config.unknown` for a key henri does not own); the secret and the `.env` holding it; the git ignore rules; the credentials keys (not ignored, or already in the git index); the routes and each route's controller and action; controller and model naming; the page files a `resources` route needs; the test configuration; the declared and installed dependencies; `AGENTS.md`.

**What would fail a boot.** These are the ones that only show up when something starts, which is rarely a good moment:

| Check             | What it means                                                                                                                                                                                          | Code                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `models.store`    | A model names a `store` an environment's configuration does not hold, or names none where one of them has no `default`. Every `config/*.json` is compared, because each replaces `default.json` whole. | `HENRI_MODEL_UNKNOWN_STORE`, `HENRI_MODEL_NO_STORE` |
| `config.store`    | `jobs.store`, `webhooks.store` or `trail.store` names a store that is not in the same file.                                                                                                            | one of the three `*_STORE_MISSING`                  |
| `deps.declared`   | A package the application needs is not in `package.json`. Every `config/*.json` is read, and the message names the one that asked.                                                                     | `HENRI_STORE_ADAPTER_NOT_INSTALLED`                 |
| `routes.policy`   | A route asks for a policy `app/policies` does not hold. Policies fail closed, so that route refuses every request.                                                                                     | —                                                   |
| `jobs.perform`    | A file of `app/jobs` exports no `perform(args, context)`. The queue loads every one of them at boot.                                                                                                   | `HENRI_JOB_INVALID_DEFINITION`                      |
| `jobs.recurring`  | A recurring schedule names a job that is not in `app/jobs`. Nothing fails: the work never happens.                                                                                                     | `HENRI_JOB_INVALID_SCHEDULE`                        |
| `mailers.view`    | A mailer action has no view under `app/views/mailers`, so the request that sends the mail fails.                                                                                                       | `HENRI_MAIL_VIEW_MISSING`                           |
| `modules.name`    | An `app/modules` file registers a name a core module or another module already has.                                                                                                                    | `HENRI_BOOT_DUPLICATE_MODULE`                       |
| `modules.needs`   | An `app/modules` file needs a module nothing provides.                                                                                                                                                 | `HENRI_BOOT_MISSING_DEPENDENCY`                     |
| `modules.package` | A dependency declares `"henri": { "module": … }` and the file is not there.                                                                                                                            | —                                                   |
| `deps.version`    | The henri packages installed are not all at one version (a warning): they are published together.                                                                                                      | —                                                   |

**What `AGENTS.md` and the views claim.** `agents.stale` (a warning) when `AGENTS.md` names a renderer or a store the configuration no longer names — an agent reading it would write pages and controllers this application cannot run — and `views.renderer` when a page imports the other view engine, or carries an extension the configured one does not resolve. Every file under `app/views/pages` is read, not only the ones a `resources` route names: the Inertia engine resolves a page through `import.meta.glob('./pages/**/*.jsx')`, so a `.js` file there is loaded by nothing and says so nowhere, and that is exactly the page no route points at.

**The schema of a store.** One question is asked over a connection, and `--no-reach` skips it along with the shared store: `schema.behind` when the store answers and `db/migrations` holds migrations it has not applied, and `schema.unreachable` when it did not answer — because a store that is down and a store that is behind are different problems with different fixes. The store adapter and its driver are resolved from the application, so neither fires before `node_modules` is there; `deps.installed` is what says so until then. Drift itself, what a database and the models disagree about column by column, needs the models loaded and stays with [`db:status`](#db). Two file-only checks sit next to it: `schema.migrations-ignored` (migrations next to a store whose adapter can never apply them) and `schema.migrations-pending` (a drizzle store whose production configuration does not set `"migrate": true`).

| Flag         | Effect                                                                                                                                                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--json`     | `{ ok, problems: [{ check, level, code, file, message, hint }], summary }` on stdout, one document. A failing run also prints its `{ error }` envelope on **stderr**, as every command does, so `henri doctor --json \| jq` stays valid; merging the two streams does not. |
| `--no-reach` | Skip the two checks that open a connection: the shared store of `config.shared`, and the migrations a store holds.                                                                                                                                                         |

It also runs the static checks of [`audit`](#audit) and, when they find something, adds one `security.findings` warning naming the count and the worst severity, instead of repeating them. That is the line between the two: `audit` weighs what an application chose, against the ASVS; `doctor` reports what it cannot have meant, and nothing here has a severity because there is nothing to weigh.

## `audit`

```bash
henri audit [--fail-on=<severity>] [--no-deps] [--json]
henri audit --checks [--json]
```

Checks the application against the checkable requirements of the [OWASP Application Security Verification Standard](/guides/security/) 4.0.3, without starting it. Every finding carries a severity (`high`, `medium`, `low`), a stable check name, the ASVS requirement and level it maps to, the Top 10 (2021) category, the file and, in a source file, the line.

It reports what the application says, never henri's own defaults, which are secure: a protection turned off in `config/*.json`, a secret or a credentials key that reached a commit, a model write that takes the whole request body, a resource action left without a role where its siblings have one, a raw query built by interpolation, unescaped output in a view, a record answered as the ORM returned it, and the known advisories of the production dependencies.

| Flag                   | Effect                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `--fail-on=<severity>` | Exit `1` on this severity or above: `high`, `medium` (the default), `low`, or `none` to never fail.        |
| `--no-deps`            | Skip the dependency advisories, which is the only step that reaches the network.                           |
| `--checks`             | Print the catalogue instead of running it: every check, its requirement, its level and what it determines. |
| `--json`               | `{ ok, findings: [{ severity, check, owasp, asvs, level, file, line, message, hint }], summary }`.         |

A finding in `config/test.json` is reported one severity lower. The dependency step asks the package manager about the **production** dependencies at **high and critical** only, and says so as a `low` finding rather than failing when it cannot run at all. What is checked, what is deliberately not, and the table of what henri does for every application are on the [Security](/guides/security/) page.

## `mcp`

```bash
henri mcp
```

Starts the [Model Context Protocol](https://modelcontextprotocol.io/) server for the application over stdio. It exposes the tools that read the files -- `routes`, `models`, `controllers`, `config`, `doctor`, `audit`, `generate`, `destroy`, `test`, `lint` and `guide` -- and the ones that ask the running application: `errors`, `logs`, `query`, `records`, `runtime_routes` and `request`. Those attach to the development server when one is running and start one otherwise (`HENRI_MCP_AUTOSTART=0` forbids it); they refuse a production application. Resources: `AGENTS.md`, the conventions, the routes, the running application and the help. `henri new` writes a `.mcp.json` that starts it. See [Coding agents](/guides/agents/).

## `clean`

Lists the existing ones among `.tmp`, `.henri`, `logs`, `node_modules`, `app/views/.cache` and `app/views/.next`, asks which to delete, and recreates each selected directory empty.

## `about`

Prints the versions of henri, Node, pnpm, yarn and npm, whether the current directory is a henri project, the versions of the `@usehenri/*` packages, `next`, `react` and `react-dom` installed in it, and the names of its models, pages, controllers and helpers.

## `analyze`

```bash
henri analyze [module] [--level=<n>] [--json]
```

Boots the application, prints what the boot did and stops it again: the order the modules ran in, how long each took, what it waited on and why, the chain that decided the total, and the level chart a numeric pin lands in. It is a real boot, so it opens the stores and binds a port the way `henri server` does; `--level` stops it earlier (`3` for the models, `4` for the users, `5` for the routes).

```text
 Boot: 209.5ms, 12 modules, level 6

   Module       Level  Pin       Started  Took     Waited on
   config       0      runlevel  0.1ms    1ms
   mail         1      name      1.2ms    2.3ms    config (needs)
   graphql      1      name      1.3ms    2.3ms    config (needs)
   controllers  2      name      1.4ms    2.3ms    config (needs)
   server       2      name      1.4ms    2.2ms    config (needs)
   mailers      2      name      3.7ms    47.8ms   config (needs), mail (needs)
   model        3      name      3.8ms    191.8ms  config (needs), graphql (needs)
   view         3      name      7.8ms    189ms    config (needs), server (needs)
   metrics      5      name      8.9ms    42.6ms   server (needs), config (runlevel 0)
   user         4      name      195.7ms  0.2ms    config (needs), model (needs), server (needs)
   workers      5      name      195.9ms  7.5ms    config (needs), model (needs), user (after)
   router       5      name      196.8ms  12.7ms   config (needs), controllers (needs), server (needs), user (needs), mailers (after), view (after), metrics (before)

 Critical path
   config (1ms) -> server (2.2ms) -> view (189ms) -> router (12.7ms)
```

With a module name it prints that module only: the level it landed at, whether a name or the number put it there, what it waited on, which of those actually held it up, and what was waiting on it.

```bash
henri analyze metrics
```

A boot that fails prints the same chart with the module that threw, what was still running and what never started, and exits with `1`. `--json` prints the whole analysis, which is also what [`henri.analyze()`](/reference/under-the-hood/#introspection) answers in the application.

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

With `--json` a failure prints `{ "error": { "command", "message", "hint", "code", "exitCode" } }` on stderr. The `code` is one of [henri's error codes](/reference/errors/) — `HENRI_CLI_USAGE`, `HENRI_CONFIG_INVALID`, `HENRI_STORE_URL_MISSING` — which is finer grained than the exit code and is the same name the framework raises at runtime, so a boot failure keeps it all the way to the shell. `HENRI_CONFIG_INVALID` also carries a `problems` array (`{ key, level, message, expected, received, source, hint }`). See [Coding agents](/guides/agents/).
