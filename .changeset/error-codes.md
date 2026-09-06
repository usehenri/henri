---
'@usehenri/core': minor
'@usehenri/cli': minor
'@usehenri/mcp': minor
'@usehenri/jobs': minor
'@usehenri/drizzle': minor
'@usehenri/sequelize': minor
'@usehenri/mongoose': minor
'@usehenri/inertia': minor
'@usehenri/react': minor
'@usehenri/testing': minor
---

Every failure henri raises now has a stable code.

Rust prints `E0382`, TypeScript `TS2345`, Next.js a link to a page. henri had
four names, all in the command line — `USAGE`, `FAILED`, `NOT_A_PROJECT`,
`NEEDS_TTY` — and its runtime failures had none at all: a boot that stopped, a
model that would not load, a store that refused a schema key, a view engine
that was missing, all of them a message and nothing else. A message gets
reworded; a code does not.

Ninety-one of them, in one namespace across core, the adapters, the queue, the
view engines, the command line and `henri mcp`:

```
HENRI_MODEL_UNKNOWN_TYPE
HENRI_BOOT_CIRCULAR_DEPENDENCY
HENRI_STORE_URL_MISSING
HENRI_VIEW_INERTIA_UNAVAILABLE
```

`HENRI_` makes the whole code unique enough to search the web with, the area
says which part of the framework raised it, and the reason reads without a
lookup — the shape of node's own `ERR_*` codes, and of the four names the
command line already had.

The code reaches you wherever the failure does. In the boot log:

```
view ✏  HENRI_VIEW_UNKNOWN_RENDERER => Unable to load 'reactt' renderer...
```

In the error body of the JSON API, next to what it already answered with:

```json
{
  "statusCode": 500,
  "error": "Internal Server Error",
  "code": "HENRI_STORE_NOT_STARTED",
  "message": "Internal Server Error"
}
```

In the terminal and in `--json`, where a boot failure now keeps the code of
what actually went wrong instead of collapsing into `FAILED`:

```
$ henri server
  henri server failed [HENRI_CONFIG_ENV_TYPE]: HENRI_CONFIG__port is not a number, and "port" is one in the configuration

$ henri server --json
{"error":{"code":"HENRI_CONFIG_ENV_TYPE","command":"server","exitCode":1,"hint":null,"message":"..."}}
```

And in the answers of `henri mcp`, so an agent branches on the code rather
than on the wording.

The catalogue is `packages/core/error-codes.json`: one entry per code with
what it means, what usually causes it and how to fix it, published as
[the error code reference](https://usehenri.io/reference/errors/). It is data,
and a test compares it with the source and with the page — every code raised
has an entry, every entry is raised somewhere, no two mean the same thing.

`config.errors.url` turns a code into a link. It is a template holding
`{code}` (`"https://example.com/e/{code}"`), unset by default: henri ships no
address, and nothing prints a link until you give it one.

**Breaking**: the `code` of `henri <command> --json` now names the failure
rather than the exit status. `USAGE` is `HENRI_CLI_USAGE`, `FAILED`
`HENRI_CLI_FAILED`, `NOT_A_PROJECT` `HENRI_CLI_NOT_A_PROJECT`, `NEEDS_TTY`
`HENRI_CLI_NEEDS_TTY`, `CONFIG_INVALID` `HENRI_CONFIG_INVALID`; a command may
now answer something finer still. The `exitCode`, and the exit status itself,
are unchanged: a script branching on `0`, `1`, `2`, `3` or `4` keeps working.
The codes of `@usehenri/jobs` (`UNKNOWN_JOB`, `BAD_ARGUMENTS`, `TIMEOUT`, ...)
and of `henri mcp` (`NO_SERVER`, `UNREACHABLE`, ...) moved into the same
namespace for the same reason.
