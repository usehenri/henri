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
henri new <folder> [--force | -f] [--skip-install] [--no-git] [--renderer react|inertia]
henri init [--force | -f] [--skip-install] [--no-git] [--renderer react|inertia]
```

`new` creates the folder and runs `init` in it; it refuses a non-empty folder without `--force`, and `init` refuses a directory that already has an `app` folder. The project is named after the folder. Both:

1. copy the template of the renderer (`react` by default, `-r` is short for `--renderer`) and merge an existing `package.json` into the generated one (dependencies, scripts and name are kept);
2. write `config/default.json` (`baseRole`, `renderer`, a `disk` default store, `user: "user"`) and `.env` with a random `HENRI_SECRET`;
3. with the React renderer, scaffold the sample `Task` resource (model, controller, `resources tasks` route, pages and `test/tasks.test.js`);
4. write a README (an existing one is renamed `README.old.md`);
5. run `git init` unless `--no-git` is given, the folder is already inside a repository, or git is missing;
6. install the dependencies with the detected package manager (the `packageManager` field, then pnpm, yarn, npm) unless `--skip-install` is given. `pnpm-workspace.yaml`, which allows the build scripts pnpm needs, is only written for pnpm.

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

| Generator                          | Writes                                                                                                                                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model <Name> [field:type ...]`    | `app/models/<Name>.js` with `timestamps: true` and the fields.                                                                                                                                                 |
| `controller <name> [action ...]`   | `app/controllers/<name>.js` with one `res.boom.notImplemented()` handler per action, and a `get /<name>/<action>` route for each in `config/routes.js`.                                                        |
| `worker <name>`                    | `app/workers/<name>.js` with `start()` and `stop()`.                                                                                                                                                           |
| `test <name>`                      | `test/<name>.test.js` requesting `GET /<name>` with `@usehenri/testing`.                                                                                                                                       |
| `crud <Name> [field:type ...]`     | The model, `app/controllers/<names>.js` with JSON `index`, `create`, `update` and `destroy`, and the `crud <names>` route.                                                                                     |
| `scaffold <Name> [field:type ...]` | The model, `app/controllers/<names>.js` with the seven `resources` actions answering HTML or JSON, the `resources <names>` route and the React pages `app/views/pages/<names>/{index,new,edit,show,_form}.js`. |

Model and resource names are given in the singular with a capital: `Post` gives the model `Post`, the controller `posts.js`, the route `resources posts` and the pages under `posts/` (`category` gives `categories`, `person` `people`). Existing files are skipped and reported; `--force` overwrites them. Routes are added to `config/routes.js`, which is rewritten (formatted with prettier) with the new keys.

Fields are `name:type`, `string` when the type is omitted; a trailing `!` (`name:string!` or `name!:string`) makes the field required. Types: `string`, `text`, `number`, `integer`, `float`, `boolean`, `date`, `json`, `uuid`, mapped by each adapter (see [Models](/guides/models/#the-schema-format)); anything else is refused.

```bash
henri generate model User name:string! birthday:date
henri generate controller locations index show
henri g scaffold HighScore game:string! score:integer
henri g worker cleanup
henri g test highscores
```

The scaffolded controllers are written for Mongoose (`findById`, `findByIdAndUpdate`, `findByIdAndDelete`), which the disk and mongoose adapters use; adapt them by hand for a SQL store. The scaffolded pages target the React renderer.

## `destroy`

```bash
henri destroy <what> <name>
henri d <what> <name>
```

| Target              | Removes                                                           |
| ------------------- | ----------------------------------------------------------------- |
| `model <Name>`      | `app/models/<Name>.js`                                            |
| `controller <name>` | `app/controllers/<name>.js` and every route pointing to it        |
| `route <key>`       | one key of `config/routes.js`: `henri destroy route "get /about"` |
| `view <folder>`     | `app/views/pages/<folder>`                                        |
| `worker <name>`     | `app/workers/<name>.js`                                           |
| `test <name>`       | `test/<name>.test.js`                                             |
| `crud <Name>`       | what `generate crud` wrote (model, controller, routes)            |
| `scaffold <Name>`   | what `generate scaffold` wrote (model, controller, routes, pages) |

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
