# Contributing to henri

Thanks for helping. This repository is a pnpm workspace (Node.js 22 or newer)
holding the `henri` CLI, `@usehenri/core`, the store adapters, the React view
engine and the usehenri.io website. Bug reports and pull requests are welcome;
for anything larger than a fix, open an issue first so the design can be
discussed before the code.

## Setup

Tool versions are pinned in `mise.toml`, so with [mise](https://mise.jdx.dev)
installed:

```bash
mise install                          # node + pnpm from mise.toml
pnpm install                          # whole workspace; builds @usehenri/react
pnpm test                             # whole monorepo
pnpm test packages/core               # one package
pnpm test:sql                         # the SQL adapters (sqlite, or a live server)
pnpm lint                             # eslint (flat config)
pnpm format                           # prettier
pnpm build                            # builds @usehenri/react
pnpm --filter @usehenri/website dev   # docs site
scripts/smoke.sh                      # scaffold an app from the workspace and boot it
```

The first test run downloads a MongoDB binary for the disk adapter
(`mongodb-memory-server`) into `~/.cache/mongodb-binaries`.

### The SQL adapters on a live database

`@usehenri/sequelize`, its dialect packages and `@usehenri/drizzle` run their
suites on sqlite, so `pnpm test` needs no server and no network. Point
`HENRI_TEST_POSTGRES_URL` or `HENRI_TEST_MYSQL_URL` at a server and the same
suites run against it, each store in a `henri_test_*` database of its own,
dropped when the file is done (`HENRI_TEST_SQL_DIALECT` picks one when both
variables are set). The account needs the right to create databases:

```bash
docker run -d --name henri-pg -e POSTGRES_USER=henri -e POSTGRES_PASSWORD=henri \
  -e POSTGRES_DB=henri_test -p 5432:5432 postgres:17
docker run -d --name henri-mysql -e MYSQL_ROOT_PASSWORD=henri \
  -e MYSQL_DATABASE=henri_test -p 3306:3306 mysql:8

HENRI_TEST_POSTGRES_URL=postgres://henri:henri@127.0.0.1:5432/henri_test pnpm test:sql
HENRI_TEST_MYSQL_URL=mysql://root:henri@127.0.0.1:3306/henri_test pnpm test:sql
```

## Pull requests

- Branch from `master`. `master` only takes pull requests whose `Node 22` and
  `Node 24` checks pass (no force-push, linear history), so keep your branch
  rebased on it.
- CI runs `prettier --check`, `eslint --max-warnings 0`, the test suite on
  Node 22 and 24, the website build and a scaffold smoke test
  (`scripts/smoke.sh`). Run `pnpm lint` and `pnpm test` before pushing. The
  `Live PostgreSQL` and `Live MySQL` jobs run the SQL suites against service
  containers; they never block a pull request, so read them when you touch an
  SQL adapter.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org)
  (`feat(core): ...`, `fix(react): ...`, `chore(ci): ...`). The husky hooks run
  lint-staged and commitlint on every commit.
- Any user-facing change to a public package needs a changeset:

  ```bash
  pnpm changeset
  ```

  Pick the packages you touched and a bump type (patch for fixes, minor for
  features, major for breaking changes), then describe the change for the
  changelog. All public packages share one version number, so the bump applies
  to every package in the release; private packages (`packages/demo`,
  `packages/websocket`, `website`) are never versioned. Documentation, CI and
  test-only changes do not need a changeset.

- Tests live in `__tests__/` or `tests/` next to the code. Snapshot tests exist
  for most core modules; regenerate them only when the diff is explained by
  your change.

## Releasing

`.github/workflows/release.yml` runs on every push to `master`:

1. With pending changesets it opens or updates a "Version Packages" pull
   request (branch `changeset-release/master`) that bumps versions and
   changelogs.
2. Merging that pull request runs the publish job: lint, tests, then
   `changeset publish` to npm with provenance (trusted publishing through the
   `npm` environment, no token), the `<package>@<version>` git tags and one
   GitHub release `v<version>` whose notes come from the packages' changelogs.

### CI on the "Version Packages" pull request

Pull requests opened with the workflow's own `GITHUB_TOKEN` never trigger other
workflows, so without extra setup the version PR has no checks and cannot be
merged under the `master` ruleset (workaround: close and reopen it, which runs
CI as you). `release.yml` uses a GitHub App token instead when the
`RELEASE_APP_ID` variable is set. To create that App once:

1. Go to the usehenri organization settings, Developer settings, GitHub Apps,
   "New GitHub App" (https://github.com/organizations/usehenri/settings/apps/new).
   - Name: `henri-release` (any unused name works), homepage:
     `https://github.com/usehenri/henri`.
   - Webhook: uncheck "Active".
   - Repository permissions: **Contents: Read and write**, **Pull requests:
     Read and write** (Metadata read-only is added automatically). No account
     or organization permissions.
   - "Where can this GitHub App be installed?": Only on this account.
2. On the App page note the **App ID**, then "Generate a private key"; a `.pem`
   file downloads.
3. "Install App" in the left menu, install it on the usehenri organization for
   **only** the `usehenri/henri` repository.
4. Store the two values on the repository:

   ```bash
   gh variable set RELEASE_APP_ID --body '<App ID>' -R usehenri/henri
   gh secret set RELEASE_APP_PRIVATE_KEY < ~/Downloads/henri-release.*.private-key.pem -R usehenri/henri
   ```

   (or Settings, Secrets and variables, Actions: a variable `RELEASE_APP_ID`
   and a secret `RELEASE_APP_PRIVATE_KEY`.)

From the next push to `master`, the version PR is opened by the App, CI runs
on it and the `Node 22` / `Node 24` checks can pass. Delete the local `.pem`
file afterwards; GitHub keeps the secret.

## Reporting bugs and security issues

Use the bug report template; it asks for the `henri`, Node.js and store
adapter versions, which are usually needed to reproduce. Security problems go
through private vulnerability reporting, see [SECURITY.md](SECURITY.md).

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
