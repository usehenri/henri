---
'@usehenri/cli': minor
'@usehenri/mcp': minor
'henri': minor
---

henri is now agent-friendly: every new application gets an `AGENTS.md` stating
the conventions (layout, naming, generators, the model format, controllers,
routes, configuration, tests, commands and exit codes, a do-not list), a
`CLAUDE.md` pointing to it and a `.mcp.json` starting the new MCP server.
`henri generate agents` writes them into an existing application.

`--json` everywhere: `henri help --json` (the catalogue of commands, flags and
exit codes), `henri about --json`, `henri routes --json`, `henri generate` and
`henri destroy --json` (the files written or removed and the routes changed),
`henri doctor --json`, and every error printed as
`{ "error": { command, message, hint, code, exitCode } }` on stderr. Exit codes
are stable and documented in `henri help`: 0 ok, 1 failed, 2 usage error, 3 not
a henri application, 4 a prompt was needed without a terminal.
`henri clean` takes `--all`, `-y`/`--yes` or the folder names and fails fast
with a hint when stdin is not a terminal.

`henri doctor` checks the application against the conventions without
starting it: model files singular and PascalCase, controllers lowercase and
routed, every `resources` route backed by a controller, its actions and its
pages, `.env` present and ignored by git, no `secret` in `config/*.json`,
`AGENTS.md` and `vitest.config.js` present, dependencies declared and
installed. It exits with 1 when a problem is found.

`@usehenri/mcp` (`henri mcp`) is a stdio MCP server exposing the tools
`routes`, `models`, `controllers`, `config` (secrets redacted), `generate`,
`destroy`, `test`, `lint` and `doctor`, and the resources `henri://agents.md`,
`henri://conventions`, `henri://routes` and `henri://help`. No shell, paths
confined to the application, generators as the only write path.
