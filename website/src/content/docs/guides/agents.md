---
title: Coding agents
description: 'What henri gives a coding agent: AGENTS.md, machine readable output, stable exit codes, henri doctor and the henri MCP server.'
sidebar:
  order: 13
---

henri is built to be driven by a coding agent as well as by a person. The conventions are written down where an agent will read them, every command can answer JSON, failures carry a code instead of prose, and an MCP server exposes the parts of the framework an agent needs to see. None of it is required: a person typing commands gets the same framework.

## What `henri new` writes for an agent

| File        | Role                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md` | The conventions of the application: the layout, the model and controller contracts, the routes DSL, the generators to use. |
| `CLAUDE.md` | A pointer to `AGENTS.md`, so a tool looking for either finds the same text.                                                |
| `.mcp.json` | Starts the henri MCP server (`henri mcp`) for the project.                                                                 |

`AGENTS.md` is written for the renderer and the database the app was scaffolded with, so it describes the app in front of the agent rather than henri in general. Edit it as the app grows: it is yours, and `henri generate agents` rewrites it when you want the current version back.

## Types the agent can read

Every published package ships hand-written TypeScript declarations, and the
`jsconfig.json` of a scaffolded application already points at them. An agent
editing a controller sees the signature of `res.render()`, the twelve names on
`res.boom`, the keys `config/default.json` accepts and the actions
`resources` expands to, instead of guessing them from the docs.

The generators write the one JSDoc line that binds a file to its shape
(`/** @type {import('@usehenri/core').Controller} */`), so a generated
controller, model or routes file is typed from the moment it exists. See
[Types](/reference/types/).

## Machine readable output

Every informational command takes `--json`:

```bash
henri routes --json      # the expanded routes with their helpers and roles
henri doctor --json      # the report, with one entry per problem
henri generate scaffold Post title:string! --json
henri destroy scaffold Post --json
henri db:status --json
henri about --json
```

The output is the result only. Progress and logs go to stderr, so `henri db:status --json | jq` is safe.

## Failures carry a code

A command that fails prints one object on stderr and exits with a stable code:

```json
{
  "error": {
    "command": "generate",
    "message": "app/models/Post.js already exists",
    "hint": "Pass --force to overwrite it",
    "code": "HENRI_CLI_EXISTS",
    "exitCode": 1
  }
}
```

The `code` is one of [henri's error codes](/reference/errors/): a stable name
that never changes meaning between versions, carried by every failure the
framework raises — in the boot log, in the JSON error body of the API, in
`--json` and in the answers of `henri mcp`. Look the code up rather than
matching the message, which may be reworded.

| Exit code | Name            | Meaning                                                                      |
| --------- | --------------- | ---------------------------------------------------------------------------- |
| `0`       | `OK`            | Success.                                                                     |
| `1`       | `FAILED`        | The command failed; `henri doctor` found problems; the tests failed.         |
| `2`       | `USAGE`         | Unknown command, missing or invalid argument.                                |
| `3`       | `NOT_A_PROJECT` | Not a henri application: run the command from the root of the app.           |
| `4`       | `NEEDS_TTY`     | An interactive prompt was needed but stdin is not a terminal: pass the flag. |

An agent can branch on `exitCode` without reading the message, and `hint` says what to do next. Generators never prompt when a flag can answer the question, so they are safe to run unattended.

## `henri doctor`

`henri doctor` checks an application against the conventions without starting it: nothing is booted, no database is needed. It is the fastest way for an agent to find out whether an edit left the app coherent.

```bash
henri doctor          # a report, exit 1 when something is wrong
henri doctor --json   # the same as JSON
```

It checks the Node version, every `config/*.json` — its syntax, then the whole file against [henri's configuration schema](/configuration/#validation), so a wrong value or a misspelled key is found without booting — the secret and the `.env` that holds it, the git ignore rules, the routes file and every route's controller and action, controller naming and unused controllers, model naming and location, the page files a `resources` route needs, the test configuration, the dependencies declared in `package.json` and the ones actually installed, and the presence of `AGENTS.md`. Problems are reported as errors or warnings, each with a file and a hint.

## `henri audit`

`henri audit` answers the other half: whether the application does the things a web application is judged on. Same shape as `doctor` — files only, nothing booted, a stable check name and a stable exit code — mapped to the [ASVS](/guides/security/) requirement and the OWASP Top 10 category each finding falls under.

```bash
henri audit                # exit 1 on a medium or high finding
henri audit --json         # { ok, findings: [...], summary }
henri audit --checks       # what it can determine, and against what
```

An agent should read `--checks` before it reads the findings: it says what the audit covers, which is the difference between "nothing was found" and "nothing was looked for". The [Security](/guides/security/) page carries the other half of that answer, the table of what henri does for every application, so an agent does not spend a turn adding a protection the framework already has.

## The `henri` MCP server

`henri mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio for the application in the current directory. `henri new` writes a `.mcp.json` that starts it, so an MCP-aware editor or agent picks it up with no configuration.

Tools that read the files, without starting anything:

| Tool          | What it does                                                                        |
| ------------- | ----------------------------------------------------------------------------------- |
| `routes`      | The expanded routes with their verbs, paths, controllers, helpers and roles.        |
| `models`      | The models and their schemas.                                                       |
| `controllers` | The controllers and their actions.                                                  |
| `config`      | The configuration of the app, including which adapter and renderer it uses.         |
| `doctor`      | The `henri doctor` report.                                                          |
| `audit`       | The `henri audit` report: the security findings, with their category and level.     |
| `generate`    | Runs a generator and returns the files written, the files skipped and routes added. |
| `destroy`     | Undoes a generator.                                                                 |
| `test`        | Runs the app's tests and returns the result.                                        |
| `lint`        | Runs the linter and returns the findings.                                           |
| `guide`       | This documentation, at the version installed, with the versions next to it.         |

Resources: `AGENTS.md` itself, `henri://conventions` (the framework conventions), `henri://routes`, `henri://runtime` and `henri://help`.

The server acts on the application in its working directory and nothing else, and every write goes through the same generators a person would run, so what an agent produces is what `henri generate` produces.

## Asking the running application

Reading the files answers what the application _says_. The rest of the tools answer what it _does_, against a booted application:

| Tool             | What it answers                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `errors`         | The last errors with their stack and the request that caused each one, filterable by `X-Request-Id`.                 |
| `logs`           | The lines `henri.pen` wrote, by level, by text or by request id, with `filterParameters` still applied.              |
| `query`          | One read against a store, through its adapter. Reads only, bounded, redacted.                                        |
| `records`        | A page of a model, or one record, read through the model rather than the driver.                                     |
| `runtime_routes` | The routes the router actually mounted, including the ones whose controller is missing and the endpoints henri adds. |
| `request`        | One request against the application: status, headers, body and the request id, so a fix can be checked at once.      |

`errors` is the one to reach for first. henri stamps every request with `X-Request-Id`, every log line of that request quotes it, and the recorded error keeps it, so one failure gives an agent the stack, the parameters, the controller it reached and every line written while it was handled -- without reproducing anything. `request` closes the loop: make the call, read the id it answers with, ask `errors` and `logs` for that id.

### Where the answers come from

These tools talk to a henri development server over the loopback interface. The MCP server **attaches to the one already running** when it finds it, which is the point: the errors and the logs worth reading are the ones that happened in the process you are working in, and with the default `disk` store the database only exists inside it. When nothing answers, the MCP server **starts one itself** (loopback, on a port it picks) and stops it when the editor disconnects. Every answer says which of the two happened, and on which url:

```json
{
  "app": {
    "cwd": "/srv/app",
    "env": "dev",
    "pid": 4213,
    "stores": { "default": { "adapter": "drizzle", "queryable": true } }
  },
  "source": "attached",
  "url": "http://127.0.0.1:3000"
}
```

`HENRI_MCP_AUTOSTART=0` in the MCP server's environment forbids starting one: the tools then say `NO_SERVER` and name the command to run.

### What they refuse

The rules are enforced by the running application (`base/runtime.js` in `@usehenri/core`), not by the MCP server, so a refusal is henri's refusal:

- **Development only.** The endpoints are mounted only when `NODE_ENV` is neither `production` nor `test`, nothing is recorded in production, and there is no flag that turns either on. Pointed at a production application, the tools answer `PRODUCTION` and stop; `NODE_ENV=production` is refused before a server would be started.
- **This machine, and no browser.** The loopback check of `/_routes` and `/_mailers`, plus a required `X-Henri-Runtime: 1` header and a refusal of anything carrying `Origin` or `Sec-Fetch-Site`.
- **Reads only, proved before the store is touched.** One statement, of `SELECT`, `WITH ... SELECT`, `EXPLAIN`, `SHOW` or `DESCRIBE`, with the strings and the comments removed first so nothing hides in them. A statement carrying `INSERT`, `UPDATE`, `DELETE`, `DROP`, `SET`, `LOCK`, `PG_SLEEP` or a second statement comes back as `REFUSED` with the word that refused it and never reaches the database. Values travel as parameters. `records` refuses anything but a flat `where` of equalities, so no `$where` and no operator.
- **Redacted.** What `filterParameters` masks in the logs is masked here, in the log lines, in the recorded parameters, in the query rows and in the records; `password` is masked whatever the configuration says, and reading through the model keeps the adapter's own protections (a hash is not selected, a soft-deleted row does not come back).
- **Bounded, and it says so.** 500 log lines kept, 25 errors, 100 rows a query, 25 records a page, 2000 characters a line, 40 stack frames. Anything cut carries `truncated: true` and the limit that cut it.

`request` is the one tool that can change data, because it is the application's own endpoint doing it: a `POST` really posts, exactly as a browser would. It is never implicit -- the method is `GET` unless the agent names another one.
