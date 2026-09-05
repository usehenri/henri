---
'@usehenri/core': minor
---

Lifecycle, HTTP and error-handling hardening of the core.

- Errors are no longer swallowed: a misconfigured store, adapter, view or controller fails the boot with the original error (`henri.init()` rejects with an `Error` whose `cause` is the module error). `pen.fatal()` returns an `Error` to throw.
- `henri.reload()` is serialized (a call during a reload queues exactly one more run) and only evicts the application's own files from the require cache. `henri.stop()` stops every module even when one fails and resolves with the array of errors. `SIGINT`/`SIGTERM` stop the server gracefully with a 5 s hard-exit timeout; a second signal exits at once.
- HTTP: the server binds to `127.0.0.1` outside production (`config.host` or `HENRI_HOST` override it), CORS is opt-in (`config.cors`), `x-powered-by` is gone, `/_routes` and `/_controllers` are served only in development and only from loopback. Unmatched routes get a content-negotiated 404 and controller errors a logged, negotiated 500 (message and stack in development only).
- Mailer: an SMTP/transport object always creates and verifies the transport; `"test"` uses an Ethereal account; `NODE_ENV=test` uses nodemailer's JSON transport unless `henri.forceMail` is set.
- Handlebars engine: exact page resolution (`pages/<route>.{hbs,html,htm}` then `pages/<route>/index.*`), compiled-template cache invalidated on change and reload, 404 without a page, 500 with the stack logged on template errors, view options exposed as `@user`, `@paths`, `@query` data variables.
- `graphql.run(query, variables, contextValue)` forwards a context to the resolvers.
- Configuration: `.env` in the application directory is loaded on boot and `HENRI_SECRET` provides the `secret`.
- `utils.checkPackages()` never installs anything: it prints the install command for the detected package manager (pnpm, yarn or npm) and throws.
- The Vue renderer only loads with `experimental.vue: true`. `BaseModule` lost its unused `setup()`, `start()` and `info()` stubs.
- Removed dependencies: `include-all`, `callsite`, `internal-ip`, `server-timings`, `lodash`, `@inquirer/prompts`, `cross-spawn`, `compare-versions`, `jest`.
