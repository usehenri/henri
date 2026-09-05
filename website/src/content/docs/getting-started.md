---
title: Getting started
description: Install henri, create a project and start the development server.
sidebar:
  order: 1
---

## Requirements

- Node.js 22 or newer
- A package manager: pnpm, npm or yarn all work

:::note
henri was revived in 2026 on a modern toolchain (Node 22+, Express 5, Next.js 16, React 19, Mongoose 9, Sequelize 6). Releases published to npm before that revival still target Node 10 to 14; make sure you install a current version.
:::

## Install

```bash
pnpm add -g henri
# or
npm install -g henri
```

## Create a new project

```bash
henri new <folder name>
```

The command creates a directory structure similar to this:

```text
├── app
│   ├── controllers
│   ├── helpers
│   ├── models
│   ├── workers
│   └── views
│       ├── assets
│       ├── components
│       ├── pages
│       ├── public
│       └── styles
├── config
│   ├── default.json
│   ├── production.json
│   ├── routes.js
│   └── webpack.js            <- extend the Next.js webpack settings
├── test
│   ├── controllers
│   ├── helpers
│   ├── models
│   └── views
└── package.json
```

If you have a Ruby on Rails background, this should look familiar.

## Start coding

```bash
cd <folder name>
henri server
```

henri boots its modules in order (configuration, mail, GraphQL, controllers, server, models, views, users, routes, workers, tests), prints the URL it is listening on and watches your files. Saving a controller, a model, a route file, a worker or a configuration file reloads the affected modules without restarting the process.

While the server runs, the terminal accepts a few shortcuts:

| Key          | Action                                      |
| ------------ | ------------------------------------------- |
| `R`          | list the loaded routes                      |
| `U`          | list the routes whose controller is missing |
| `Cmd/Ctrl+R` | reload the whole application                |
| `Cmd/Ctrl+O` | open the app in your browser                |
| `Cmd/Ctrl+C` | quit                                        |

## Useful flags

```bash
henri server --production    # same as NODE_ENV=production
henri server --debug=henri:* # same as DEBUG=henri:*
henri server --inspect       # start the Node.js inspector
henri server --skip-workers  # do not start app/workers
henri server --force-build   # force a production rebuild of the views
```

See the [CLI reference](/reference/cli/) for every command.
