<a href="https://usehenri.io" target="_blank">
  <p align="center">
    <img width="100" alt="" src="https://raw.githubusercontent.com/usehenri/henri/master/henri.png">
  </p>
</a>

# henri

[![npm version](https://img.shields.io/npm/v/henri.svg?style=flat-square)](https://www.npmjs.com/package/henri)
[![npm downloads](https://img.shields.io/npm/dm/henri.svg?style=flat-square)](https://www.npmjs.com/package/henri)
[![CI](https://github.com/usehenri/henri/actions/workflows/ci.yml/badge.svg)](https://github.com/usehenri/henri/actions/workflows/ci.yml)

henri is a Rails-like framework for Node.js: server-rendered React, with
controllers and models behind it and no API layer to write. Controllers hand
their data straight to the pages, and the same route answers JSON when a
client asks for it.

Models backed by real ORMs (SQL through Drizzle, with migrations; MongoDB
through Mongoose; SQL Server through Sequelize), declarative routes with
roles and CRUD, users with sessions and roles, GraphQL, mail, background
jobs, workers, tests on Vitest and hot reload, all driven by one CLI.

## Install

henri needs Node.js 22 or newer.

```bash
pnpm add -g henri        # or: npm install -g henri
henri new my-app
cd my-app
henri server
```

A new application is a Drizzle store on sqlite (`.henri/app.db`): no database
server to start, and migrations from the first day. `henri new --adapter
postgresql|mysql|mongoose|disk|mssql` picks another one.

## Documentation

Guides, the CLI reference, models, controllers, routes, views and adapters are
documented at **[usehenri.io](https://usehenri.io)**. henri was revived in 2026
on a current toolchain: if you have an application written for 0.37, read
[usehenri.io/upgrading](https://usehenri.io/upgrading/). Release notes are on
the [GitHub releases](https://github.com/usehenri/henri/releases) page.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workspace setup, the pull
request checklist and how releases work. Security issues go through
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE), Félix-Antoine Paradis ([@reel](https://github.com/reel)).
