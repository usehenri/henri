# henri

henri is a Rails-like, server-side rendered JavaScript framework for Node.js:
models, controllers, routes and React views, with real ORMs and hot reload. This
is the monorepo for the `henri` CLI, `@usehenri/core` and its adapters, and the
usehenri.io website. It is public and open source (MIT).

## Setup and commands

Tool versions are pinned in `mise.toml` (Node 24, pnpm 11). Node 22 is the
minimum supported at runtime.

```bash
mise install                          # node + pnpm from mise.toml
pnpm install                          # whole workspace; builds @usehenri/react dist
pnpm test                             # jest 30, all packages (NODE_ENV=test)
pnpm test packages/core               # one package; flags go after `pnpm test`, not after `--`
pnpm lint                             # eslint 10 flat config
pnpm format                           # prettier 3
pnpm build                            # rollup build of @usehenri/react
pnpm --filter @usehenri/website dev   # docs site (Astro + Starlight)
pnpm changeset                        # record a version bump for changed packages
```

The first test run downloads a MongoDB binary (mongodb-memory-server) into
`~/.cache/mongodb-binaries`. Set `MONGOMS_DISABLE_POSTINSTALL=1` when
installing where that download is unwanted.

## Layout

| Path                                    | Package               | Role                                                           |
| --------------------------------------- | --------------------- | -------------------------------------------------------------- |
| `packages/henri`                        | `henri`               | The CLI binary users install; delegates to `@usehenri/cli`.    |
| `packages/cli`                          | `@usehenri/cli`       | `new`, `server`, `generate`, `console`, `build`, the template  |
| `packages/core`                         | `@usehenri/core`      | The framework: modules, server, router, models, views, users   |
| `packages/mongoose`                     | `@usehenri/mongoose`  | MongoDB adapter (Mongoose)                                     |
| `packages/disk`                         | `@usehenri/disk`      | Zero-config local MongoDB (mongodb-memory-server)              |
| `packages/sequelize`                    | `@usehenri/sequelize` | Shared SQL adapter (Sequelize)                                 |
| `packages/mysql`, `postgresql`, `mssql` | `@usehenri/*`         | Dialect packages on top of `@usehenri/sequelize`               |
| `packages/react`                        | `@usehenri/react`     | Next.js view engine, `withHenri`, form components              |
| `packages/testing`, `websocket`         | `@usehenri/*`         | Small helpers                                                  |
| `packages/demo`                         | private               | Demo app used by core's tests (`NODE_ENV=test` chdirs into it) |
| `website`                               | private               | usehenri.io, deployed by Vercel from `website/`                |

## How core works

- `Henri` (`packages/core/src/henri.js`) registers modules, each a class extending
  `base/module.js` with a unique `name`, a `runlevel` (0 config/logger, 1 graphql
  and mail, 2 controllers and Express, 3 models and views, 4 users, 5 routes and
  workers, 6 app modules, 7 tests) and `init()`. Modules on the same level start
  concurrently; reloadable ones expose `reload()` and are torn down in reverse.
  Each module is exposed as `henri.<name>`, so names must be unique.
- The `henri` instance and every model are globals in user apps
  (`global.henri`, `global.Artwork`). Tests rely on this too.
- Store adapters implement `new Adapter(name, config, henri)` with
  `addModel(model, userModelName)`, `getModels()`, `getSessionConnector()`,
  `start()`, `stop()`. Core loads them from the app cwd with
  `utils.resolveFrom('@usehenri/<adapter>')`.
- View engines implement `init()`, `prepare()`, `fallback(router)` and
  `render(req, res, route, opts)`. The React engine passes `opts` to pages
  through `req._henri`; the Handlebars engine lives in `core/src/engines/template.js`.
- App configuration is `config/<NODE_ENV>.json` falling back to `default.json`
  (`stores`, `secret`, `renderer`, `port`, `graphql`, `mail`, `user`, `baseRole`).

## Conventions

- CommonJS everywhere except `packages/react/src` (ESM compiled by rollup) and
  `website` (Astro). No TypeScript.
- pnpm links strictly: every module a package `require()`s must be in that
  package's `package.json`. Internal dependencies use `workspace:^`.
- Apps that use the React renderer must depend on `next`, `react` and `react-dom`
  themselves (Turbopack resolves `next` from the app directory).
- ESLint rules worth knowing: `sort-keys`, `prefer-template`, `id-length`,
  `no-nested-ternary`, JSDoc on functions. Prettier: single quotes, es5 commas.
  `.hbs`, the demo views and `packages/cli/scripts/generate` are excluded from
  Prettier on purpose (its Handlebars parser mangles JSX inside templates).
- Tests live in `__tests__/` or `tests/`; snapshot tests exist for most core
  modules, regenerate them only when the diff is explained by your change.
- Commits follow Conventional Commits (`feat(core): ...`, `fix(react): ...`).
  Husky runs lint-staged (prettier + eslint --fix) on commit.
- Any user-facing change to a public package needs a changeset
  (`pnpm changeset`). All public packages are versioned together (a `fixed`
  group in `.changeset/config.json`); private packages are never versioned.

## Releasing

`.github/workflows/release.yml` runs on pushes to `master`. With pending
changesets it opens or updates a "Version Packages" pull request; merging that
PR runs the publish job, which publishes to npm with provenance and creates
GitHub releases. Publishing uses npm trusted publishing (OIDC): every public
package trusts this repository's `release.yml` running in the `npm` GitHub
environment. There is no npm token to rotate; a new package needs its trusted
publisher registered on npmjs.com before its first release.

## Known gaps

- The Vue/Nuxt renderer (`core/src/engines/vue.js`) has not been exercised
  since 2020.
- The SQL adapters are tested against sqlite; live MySQL, PostgreSQL and MSSQL
  connections are not covered.
- The scaffolded app pins ESLint 9 because `eslint-plugin-react` does not
  support ESLint 10 yet.
