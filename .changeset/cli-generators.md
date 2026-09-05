---
'@usehenri/cli': minor
'henri': minor
---

CLI: `henri routes` prints the routes table from `config/routes.js` without starting the server, `henri --version` prints the version, `henri <command> --help` prints the help of every command without running it, and a failing command prints its error instead of the generic help.

Generators: `generate scaffold|crud` write controllers on the Mongoose 9 API (`findById`, `findByIdAndUpdate` with `runValidators`, `findByIdAndDelete`), answer validation errors with a 422, missing documents with a 404, pick the attributes with `req.permit()` and answer HTML or JSON through `res.format`. Resources are plural and unscoped (`Post` gives `app/controllers/posts.js`, `resources posts`, `app/views/pages/posts/`). `generate model` validates the attribute types (`string|text|number|integer|float|boolean|date|json|uuid`, `!` for required). `generate controller` adds one route per action and `destroy controller` removes them. New `generate worker` and `generate test` (with the matching `destroy` targets). Existing files are skipped unless `--force` is given.

`henri build` builds the React views through `@usehenri/react/engine` without booting the stores.

`henri new`: `git init` (skipped inside a repository or with `--no-git`), a README, `config/default.json` without the secret (committed) and the secret in `.env` (`HENRI_SECRET`, ignored), a `Task` scaffold with a controller, pages and a `test/tasks.test.js` using `@usehenri/testing`. `init` names the project after the folder, `pnpm-workspace.yaml` is only written for pnpm and exit codes are positive.
