---
'@usehenri/cli': patch
'henri': patch
---

Fix `henri new` picking the wrong package manager, and two Inertia scaffold problems.

`henri new` probed `pnpm --version` then `yarn --version` and took the first that answered. A version manager shim (mise, asdf) answers non-zero outside a project it manages, so a pnpm machine got a yarn application with no `pnpm-workspace.yaml`, and the first `pnpm install` failed with `ERR_PNPM_IGNORED_BUILDS`. The manager is now, in order: `--pm pnpm|yarn|npm` (new flag on `new` and `init`), the `packageManager` field, the lockfile, `npm_config_user_agent` (the manager that ran the command), then the probe. The choice and where it came from are printed, and `pnpm-workspace.yaml` is written whatever the manager is, since npm and yarn ignore it.

A fresh Inertia application now ships `test/tasks.test.js`, so `henri test` is green from the first minute instead of exiting `1` on "No test files found", and its `eslint.config.js` declares the model globals of `app/models`, the Vitest globals and `vitest.config.js` like the React one does.

`henri doctor` no longer reports an installed ESM-only dependency as missing (`@inertiajs/react declared in package.json but not installed`): `resolvePackageJson` falls back to reading `node_modules/<name>/package.json` from disk when the package's `exports` map has no `require` and no `./package.json` condition.
