---
title: Coding agents
description: 'What henri gives a coding agent: AGENTS.md, machine readable output, stable exit codes, henri doctor and the henri MCP server.'
sidebar:
  order: 12
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
    "code": "EXISTS",
    "exitCode": 1
  }
}
```

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

## The `henri` MCP server

`henri mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio for the application in the current directory. `henri new` writes a `.mcp.json` that starts it, so an MCP-aware editor or agent picks it up with no configuration.

Tools:

| Tool          | What it does                                                                        |
| ------------- | ----------------------------------------------------------------------------------- |
| `routes`      | The expanded routes with their verbs, paths, controllers, helpers and roles.        |
| `models`      | The models and their schemas.                                                       |
| `controllers` | The controllers and their actions.                                                  |
| `config`      | The configuration of the app, including which adapter and renderer it uses.         |
| `doctor`      | The `henri doctor` report.                                                          |
| `generate`    | Runs a generator and returns the files written, the files skipped and routes added. |
| `destroy`     | Undoes a generator.                                                                 |
| `test`        | Runs the app's tests and returns the result.                                        |
| `lint`        | Runs the linter and returns the findings.                                           |

Resources: `AGENTS.md` itself, `henri://conventions` (the framework conventions), `henri://routes` and `henri://help`.

The server acts on the application in its working directory and nothing else, and every write goes through the same generators a person would run, so what an agent produces is what `henri generate` produces.
