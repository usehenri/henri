---
title: CLI
description: Every henri command and flag.
sidebar:
  order: 1
---

```text
henri <command> [options]
```

| Command                | Description                                                                  |
| ---------------------- | ---------------------------------------------------------------------------- |
| `new <folder>`         | Create a new project. `-f` / `--force` writes into an existing folder.       |
| `init`                 | Add the henri structure to the current directory.                            |
| `server`, `s`          | Start the development server (or production with `--production`).            |
| `console`              | Boot the application and open a Node.js REPL with models and `henri` loaded. |
| `generate <what>`, `g` | Generate code, see below.                                                    |
| `destroy <what>`, `d`  | Remove what a generator created.                                             |
| `build`                | Build the production views without starting the server.                      |
| `test`                 | Run the project's Jest tests.                                                |
| `clean`                | Remove build artifacts (`.next`, caches).                                    |
| `about`                | Print versions of Node, henri and the installed adapters.                    |
| `help`                 | Print the help.                                                              |

## Generators

```bash
henri generate model User name:string birthday:date
# creates app/models/User.js with these attributes

henri generate controller locations index show gps
# creates app/controllers/locations.js and routes to those actions

henri g scaffold HighScore game:string score:integer
# creates a model, a controller with the resources actions
# and the matching 'resources' route
```

Attribute types follow the adapter: `string`, `number`, `integer`, `boolean`, `date`, `json`. A trailing `!` marks the attribute as required.

## Flags

| Flag             | Effect                                                    |
| ---------------- | --------------------------------------------------------- |
| `--production`   | same as `NODE_ENV=production`                             |
| `--debug[=ns]`   | same as `DEBUG=*` or `DEBUG=<ns>`, e.g. `--debug=henri:*` |
| `--inspect`      | start the Node.js inspector on port 9229                  |
| `--wait`         | with `--inspect`, wait for a debugger to attach           |
| `--force-build`  | force a production rebuild of the views                   |
| `--skip-workers` | do not start `app/workers`                                |
