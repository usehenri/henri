<a href="https://usehenri.io" target="_blank">
  <p align="center">
    <img width="100" alt="" src="https://raw.githubusercontent.com/usehenri/henri/master/henri.png">
  </p>
</a>

# henri

[![npm version](https://img.shields.io/npm/v/henri.svg?style=flat-square)](https://www.npmjs.com/package/henri)
[![npm downloads](https://img.shields.io/npm/dm/henri.svg?style=flat-square)](https://www.npmjs.com/package/henri)
[![CI](https://github.com/usehenri/henri/actions/workflows/ci.yml/badge.svg)](https://github.com/usehenri/henri/actions/workflows/ci.yml)

henri is a Rails-like, server-side rendered JavaScript framework for Node.js:
models backed by real ORMs (MongoDB through Mongoose, MySQL, PostgreSQL and
MSSQL through Sequelize, or a zero-config local store), thin controllers,
declarative routes with roles and CRUD, React views rendered by Next.js or by
Vite with Inertia.js, GraphQL, mail, workers, tests on Vitest and hot reload,
all driven by one CLI.

## Install

henri needs Node.js 22 or newer.

```bash
pnpm add -g henri        # or: npm install -g henri
henri new my-app
cd my-app
henri server
```

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
