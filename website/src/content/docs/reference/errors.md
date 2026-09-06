---
title: Error codes
description: Every failure henri raises on its own behalf carries a code. This is what each of them means, what usually causes it and how to fix it.
---

<!-- Generated from packages/core/error-codes.json by scripts/error-codes-page.mjs. Edit the catalogue, then run it again. -->

Every failure henri raises on its own behalf carries a code:
`HENRI_MODEL_UNKNOWN_TYPE`, `HENRI_BOOT_CIRCULAR_DEPENDENCY`. It is a
stable name -- it never changes meaning between versions -- so it can be
searched for, and an agent can look it up here instead of matching a message
that may be reworded.

The shape is `HENRI_<AREA>_<REASON>`: the prefix makes the whole code unique
enough to search the web with, the area says which part of the framework
raised it, and the reason reads without a lookup, the way node's own `ERR_*`
codes do. The catalogue is `packages/core/error-codes.json` and it is data:
one entry per code, and a test that fails when the source raises a code the
catalogue does not hold, or holds one nothing raises.

## Where a code shows up

- **The boot log.** `pen.fatal()` prints the code before the message.
- **The JSON API.** The error body gains a `code` next to the
  `statusCode`, `error` and `message` it already answers with:
  `{ "statusCode": 500, "error": "Internal Server Error", "code": "HENRI_STORE_NOT_STARTED", "message": "..." }`.
- **The command line.** `henri <command> --json` prints
  `{ "error": { "command", "message", "hint", "code", "exitCode" } }`, whose
  `code` is one of these. The `exitCode` stays the coarse number a shell
  branches on (see [the CLI reference](/reference/cli/#exit-codes)).
- **`henri mcp`.** A failed tool call answers `{ "error": { "code", "message", "hint" } }`.

## Linking a code to a page

henri ships no address. Set `errors.url` to a template holding `{code}` and
every code printed by `pen` is followed by the link it resolves to:

```json
{ "errors": { "url": "https://example.com/e/{code}" } }
```

Unset -- which is the default -- nothing prints a link.

## Raising one

A code is a string, so nothing has to be imported to raise one. Inside core,
`base/errors.js` is the helper:

```js
const { fail, stamp } = require('@usehenri/core/errors');

throw fail('HENRI_JOB_UNKNOWN', `No job named "${name}"`);
throw stamp(error, 'HENRI_STORE_START_FAILED');
```

`pen.fatal(name, summary, full, obj, code)` takes the code as its last
argument and stamps it on the error it returns.

## agent

The MCP server of `henri mcp` and the running application it reads.

### `HENRI_AGENT_NOT_INSTALLED`

The application cannot be started because its dependencies are not installed.

Usually:

- node_modules is missing in the application directory

**Fix.** Install the dependencies of the application, then ask again.

### `HENRI_AGENT_NO_DOCS`

The MCP server has no documentation to serve.

Usually:

- the documentation was not shipped with this build of the server
- a partial or corrupted install

**Fix.** Reinstall @usehenri/mcp.

### `HENRI_AGENT_NO_RUNTIME`

Something henri-shaped is answering on the port and has no runtime endpoint.

Usually:

- the application answering is older than the runtime endpoints of core

**Fix.** Upgrade @usehenri/core in the application. Until then, the file-reading tools work and the running-application ones do not.

### `HENRI_AGENT_NO_SERVER`

A tool needs a running application and none answers.

Usually:

- no `henri server` is running and `HENRI_MCP_AUTOSTART=0` forbids starting one

**Fix.** Start the development server (`henri server`), or unset HENRI_MCP_AUTOSTART.

### `HENRI_AGENT_PRODUCTION`

The MCP server refuses to read a production application.

Usually:

- NODE_ENV is production
- the application answering on the port runs in production

**Fix.** Run the application in development (NODE_ENV unset or "dev"). henri mounts no runtime endpoint in production, and the MCP server will not start one to work around it.

### `HENRI_AGENT_START_FAILED`

The MCP server started the application and it never came up.

Usually:

- the boot failed
- the application did not answer within the time the server waits

**Fix.** Run `henri server` yourself to see what it says, or `henri doctor`.

### `HENRI_AGENT_TIMEOUT`

A command the MCP server ran did not finish in time.

Usually:

- a command that boots the application on a machine that is busy
- a test suite or a build that takes longer than the server waits

**Fix.** Run the command in a terminal instead: the MCP server bounds how long it waits, a terminal does not.

### `HENRI_AGENT_UNKNOWN_PAGE`

There is no documentation page by that name.

Usually:

- a typo in the page name
- a page of another henri version

**Fix.** Call the guide tool without a page to list the ones this server ships.

### `HENRI_AGENT_UNREACHABLE`

The running application did not answer.

Usually:

- the application stopped while the tool was talking to it
- it is listening somewhere else
- a request that took longer than the server waits

**Fix.** Check that the development server is still running, and read its output: a boot that failed halfway leaves the port closed.

## api

The JSON API layer: HAL answers, the health endpoint and the optional GraphQL engine.

### `HENRI_API_GRAPHQL_UNAVAILABLE`

Something asked for the GraphQL engine, which @usehenri/graphql carries, and the application does not have it.

Usually:

- a model declares `graphql` types and resolvers
- a route or a render asks for a `graphql` query
- the package was removed but the configuration or a model still reaches for it

**Fix.** Install the engine in the application (`npm install @usehenri/graphql`), or remove the `graphql` key from the model, the route or the render that asks for it.

### `HENRI_API_INVALID_COLLECTION`

res.collection() was called with something it cannot turn into a HAL collection.

Usually:

- `res.collection()` was given something that is not an array
- it was called outside a route and no `type` was passed

**Fix.** Pass an array of records, and outside a `resources` route name the type: `res.collection(records, { type: 'tasks' })`.

### `HENRI_API_INVALID_RESOURCE`

res.resource() was called with something it cannot turn into a HAL resource.

Usually:

- `res.resource()` was given an array, a scalar or nothing
- it was called outside a route and no `type` was passed

**Fix.** Pass one record (a model instance or a plain object) and use `res.collection()` for lists; outside a `resources` route name the type: `res.resource(record, { type: 'tasks' })`.

## boot

The module graph and the boot sequence: registration, ordering, dependencies.

### `HENRI_BOOT_CIRCULAR_DEPENDENCY`

The modules of the boot graph wait on each other in a circle, so nothing can start.

Usually:

- two modules of the boot graph name each other in `needs`, `after` or `before`
- a longer chain of the same, through an application module

**Fix.** The message names the cycle and the declaration behind every edge of it. Drop one of those declarations, or replace a `needs` that is only about ordering with an `after`.

### `HENRI_BOOT_DEPENDENCY_ABOVE_CEILING`

A module needs another one that this boot does not go far enough to load.

Usually:

- a module the boot ceiling leaves out is named in a `needs`
- a command that boots to a lower level (`henri jobs`, `henri console`) reached a module that needs a higher one

**Fix.** Lower the runlevel of the module that is needed, or run the command that boots the whole application. `henri analyze` prints the order and the level of every module.

### `HENRI_BOOT_DUPLICATE_IDENTITY`

Two files of an application directory answer to the same name.

Usually:

- two files in app/models, app/controllers, app/mailers or app/jobs declare the same `identity`
- a file was copied and its `identity` was not changed
- two files of different directories collide because `identity` defaults to the file name

**Fix.** Rename one of the two files, or give it an `identity` of its own. The message names the directory and the file that collided.

### `HENRI_BOOT_DUPLICATE_MODULE`

Two modules claim the same name.

Usually:

- an application module and a core module share a name
- the same module is registered twice, from config/modules.js and from a package

**Fix.** Rename one of them: a module's name is how it is reached (`henri.<name>`), so it has to be unique. The message names both files.

### `HENRI_BOOT_FAILED`

A module's init() failed, so the boot stopped.

Usually:

- a store cannot be reached, a view engine cannot start, a model is invalid
- an application module of app/modules threw in its `init()`

**Fix.** Read the error underneath, which carries its own code: this one only says the boot stopped. The diagnostics name what failed, what was still running and what never started.

### `HENRI_BOOT_INVALID_MODULE`

Something registered as a module is not shaped like one.

Usually:

- a module object with no `init()`, no `name` or no `runlevel`
- `needs`, `after` or `before` given something that is not a name or a list of them
- `reloadable` without a `reload()`, or a `release` that is not a function
- a class that does not extend the base module

**Fix.** A module extends `@usehenri/core/module`, sets a unique `name`, says where it goes (`needs`/`after`/`before` or `runlevel`) and implements `init()`. See the Modules guide.

### `HENRI_BOOT_MISSING_DEPENDENCY`

A module needs another one that nothing provides.

Usually:

- a `needs` naming a module no package and no file provides
- the module that provides it is not installed, or not registered
- a typo in the name

**Fix.** Register the module that provides the name, or fix the name. The message lists every module that did load and suggests the closest one.

### `HENRI_BOOT_MODULES_FILE_INVALID`

config/modules.js did not export an array of modules.

Usually:

- the file exports an object, a string or nothing
- a function was exported that resolves to something other than an array

**Fix.** Export an array of modules -- names, classes or instances -- or a function returning one: `module.exports = ['@acme/module', new Mine()]`.

### `HENRI_BOOT_MODULES_FILE_UNREADABLE`

config/modules.js exists but could not be loaded.

Usually:

- a syntax error in the file
- something the file requires is missing or throws

**Fix.** The message carries the loader's own error. Fix the file, or delete it: an application without one boots with the core modules alone.

### `HENRI_BOOT_MODULE_NOT_INSTALLED`

config/modules.js names a package that cannot be resolved from the application.

Usually:

- the package was never installed
- it is a devDependency and the boot runs without them
- the name is misspelled

**Fix.** Install the package in the application, or remove the entry from config/modules.js.

### `HENRI_BOOT_NOT_AN_APPLICATION`

The working directory has no package.json, so it is not a henri application.

Usually:

- the command was run from a subdirectory
- the folder was never scaffolded

**Fix.** Run henri from the root of the application, or create one with `henri new <name>`.

### `HENRI_BOOT_NO_MODULES`

The boot reached init() with no module to start.

Usually:

- the boot ceiling (`new Henri({ runlevel })`) is below every module
- `init()` was called before anything was registered

**Fix.** Register the modules before calling `init()`, or raise the ceiling. `henri analyze` prints the level of every module.

### `HENRI_BOOT_PACKAGES_MISSING`

Packages the application needs are not installed.

Usually:

- the renderer's peer dependencies were never installed
- an install was interrupted, or node_modules was pruned

**Fix.** Run the install command the message prints. Applications carry the packages of their own renderer and adapter: henri resolves them from the application, never from itself.

### `HENRI_BOOT_RUNLEVEL_OUT_OF_RANGE`

A module pinned itself to a level that does not exist.

Usually:

- a module pins itself with `runlevel: 9`
- a negative runlevel

**Fix.** The levels go from 0 to 6. Prefer naming what the module needs (`needs`, `after`, `before`) over a numeric pin.

### `HENRI_BOOT_TESTING_CORE_MISSING`

@usehenri/testing could not load @usehenri/core from the application.

Usually:

- @usehenri/core is not a dependency of the application
- the tests run from a directory that is not the application

**Fix.** Install @usehenri/core in the application, and run the tests from its root (`henri test` does).

### `HENRI_BOOT_TESTING_NOT_RUNNING`

A test helper was used before the application was booted.

Usually:

- `setup()` was never awaited
- `@usehenri/testing/setup-file` is missing from the vitest `setupFiles`
- a test ran after `teardown()`

**Fix.** `await setup()` in `beforeAll`, or add `@usehenri/testing/setup-file` to the `setupFiles` of the vitest configuration.

## cache

The cache of `henri.cache`: the keys it is given, the values it is asked to keep and the backend they go to.

### `HENRI_CACHE_KEY_INVALID`

Something that cannot become a cache key was used as one.

Usually:

- a key built out of `null`, `undefined` or a class instance
- an empty string, an empty array, or a key holding a control character

**Fix.** Key on a string, a number, a Date, an array of them (`["user", id]`) or a plain object, or give the object a `cacheKey()` method.

### `HENRI_CACHE_STORE_INCAPABLE`

The cache backend cannot do what was asked of it.

Usually:

- `config.cache.store` names a store without a `clear(prefix)` method

**Fix.** Delete the keys you know with `henri.cache.delete()`, or give the store a `clear(prefix)` method that removes every key of a prefix.

### `HENRI_CACHE_TTL_INVALID`

The lifetime given to a cache entry is not a duration.

Usually:

- a `ttl` that is not a duration
- a `ttl` of `0`, or a negative one, meant as "forever"

**Fix.** Use milliseconds or a duration: `'30s'`, `'5m'`, `'2h'`, `'1d'`. Every entry has one -- there is no forever -- and `config.cache.ttl` is the default when a call says nothing.

### `HENRI_CACHE_VALUE_UNSUPPORTED`

A value was refused because it would not come back the way it went in.

Usually:

- a model instance, or any other class instance, handed to `set()` or returned by a `fetch()` function
- `undefined`, `NaN`, `Infinity`, a Map, a Set, a Buffer, a RegExp or a circular structure inside the value

**Fix.** The cache keeps what JSON keeps, plus `Date`. Store the plain shape you want back: `record.toJSON()`, or `henri.model.stores.default.toPlain(record)`. Cache `null` where you meant "there is nothing".

## cli

The henri command line: arguments, the project it runs in, the commands themselves.

### `HENRI_CLI_CHECKS_FAILED`

A command that checks an application found something.

Usually:

- `henri doctor` found a problem
- `henri audit` found a finding at or above `--fail-on`

**Fix.** Read the report: every check names the file and what to do. `henri audit --checks` prints the whole catalogue of checks.

### `HENRI_CLI_EXISTS`

The command would write over something that already exists.

Usually:

- the target of `henri new` or a generator is already there
- the file would be overwritten

**Fix.** Pick another name, delete what is there, or pass `--force` where the command takes it.

### `HENRI_CLI_FAILED`

The command failed.

Usually:

- a command failed for a reason henri has no finer code for
- an underlying tool exited non-zero

**Fix.** Read the message. Run the command again with `--debug=henri:*` for the details, and with `--json` for the whole error object.

### `HENRI_CLI_MIGRATIONS_UNSUPPORTED`

The command needs migrations and the store's adapter has none.

Usually:

- `henri db:generate`, `db:migrate` or `db:push` on a store using a Sequelize adapter (mysql, postgresql, mssql)
- `henri db:status` on a store whose adapter keeps no schema to read back (mongoose, disk)

**Fix.** Migrations are the drizzle adapter's: set "adapter": "drizzle" on the store and install @usehenri/drizzle. The Sequelize adapters create the tables that are missing and never alter one, so `henri db:status` says what the database and the models disagree about and `henri db:status --sql` writes the DDL to review before you run it.

### `HENRI_CLI_NEEDS_TTY`

The command needed an answer and stdin is not a terminal.

Usually:

- a command that asks a question was run from a script or from CI
- stdin is a pipe

**Fix.** Pass the flag that answers the question (`--yes`, `--force`, `--renderer`, ...), which the hint names.

### `HENRI_CLI_NOT_A_PROJECT`

The directory is not a henri application.

Usually:

- the command was run from a subdirectory of the application
- the folder was never scaffolded

**Fix.** Run the command from the root of the application, or create one with `henri new <name>`.

### `HENRI_CLI_NOT_INSTALLED`

The command needs a package the application does not have.

Usually:

- the renderer, the adapter or the test runner is missing from the application
- `node_modules` is stale

**Fix.** Run the install command the message prints, then run the command again.

### `HENRI_CLI_USAGE`

The command was called wrongly.

Usually:

- an unknown command or generator
- a missing or invalid argument
- a flag given a value it does not accept

**Fix.** `henri help <command>` prints what the command takes. The hint of the error usually lists the accepted values.

## config

Config/<env>.json, the environment overrides and the credentials file.

### `HENRI_CONFIG_CREDENTIALS_INVALID`

The credentials file is not shaped like one.

Usually:

- the file is not a henri credentials file
- what it holds decrypts to something that is not a JSON object

**Fix.** Edit it with `henri credentials:edit`, which writes the envelope henri reads. Never edit the encrypted file by hand.

### `HENRI_CONFIG_CREDENTIALS_KEY_INVALID`

The credentials could not be decrypted: the key is wrong, or the file was modified.

Usually:

- the key does not match the file (a key from another environment, or from another machine)
- the encrypted file was edited, truncated or merged by hand

**Fix.** Use the key the file was written with (`HENRI_CREDENTIALS_KEY`, or config/credentials/<env>.key), or write the credentials again with `henri credentials:edit`.

### `HENRI_CONFIG_CREDENTIALS_KEY_MALFORMED`

The credentials key is not 64 hexadecimal characters.

Usually:

- a truncated key
- a key with a stray newline or quotes

**Fix.** A credentials key is 64 hexadecimal characters, which is what `henri credentials:init` writes. Copy the whole of it.

### `HENRI_CONFIG_CREDENTIALS_KEY_MISSING`

There is a credentials file for this environment and no key to open it.

Usually:

- the key file is gitignored and was never copied to this machine
- `HENRI_CREDENTIALS_KEY` is not set in the deployment

**Fix.** Set `HENRI_CREDENTIALS_KEY`, or put config/credentials/<env>.key back. The key never belongs in a commit.

### `HENRI_CONFIG_ENV_EMPTY`

An environment override is set but empty.

Usually:

- `HENRI_CONFIG__port=` with nothing after the equals sign
- a deployment that sets a variable it does not have a value for

**Fix.** Give the variable a value, or unset it: an empty override is never what was meant.

### `HENRI_CONFIG_ENV_NOT_JSON`

A HENRI_CONFIG_JSON__ override is not valid JSON.

Usually:

- a trailing comma, a single quote, or an unquoted key
- a shell that ate the quotes of the value

**Fix.** The value of a `HENRI_CONFIG_JSON__<key>` variable is parsed as JSON. Quote it whole in the shell. The value is never echoed back: it may be a secret.

### `HENRI_CONFIG_ENV_NO_KEY`

An environment override names no configuration key.

Usually:

- `HENRI_CONFIG__` or `HENRI_CONFIG_JSON__` with nothing after the separator

**Fix.** Name the key after the prefix, `__` for every level: `HENRI_CONFIG__stores__default__url`.

### `HENRI_CONFIG_ENV_TYPE`

An environment override does not fit the type of the key it overrides.

Usually:

- a number given something that is not one
- a boolean given anything but `true` or `false`
- an object given something that is not a JSON object

**Fix.** The type comes from the configuration file, and from henri's schema when the file has no value at that key. Give the variable a value of that type, or use `HENRI_CONFIG_JSON__<key>` for an object.

### `HENRI_CONFIG_INVALID`

The configuration holds a value henri refuses.

Usually:

- a value of the wrong type, or outside what the key accepts
- a key given a shape it does not take
- an environment variable or a credential overriding a key with something invalid

**Fix.** Every problem is listed at once with the key, what was expected, what arrived and where the value came from. `henri doctor` runs the same schema over every config/*.json without booting. See the Configuration reference.

### `HENRI_CONFIG_UNKNOWN_KEY`

config.get() was asked for a key the configuration does not hold.

Usually:

- a typo in the key
- a key that only exists in another environment's file
- reading a key before the module that sets it has run

**Fix.** Use `config.has(key)` first, or `config.get(key, true)`, which answers `false` instead of throwing.

### `HENRI_CONFIG_UNREADABLE`

No configuration file could be loaded.

Usually:

- no config/<NODE_ENV>.json and no config/default.json
- the file is not valid JSON
- the process cannot read it

**Fix.** The boot prints every path it tried. Create config/default.json, or fix the JSON of the file that is there.

## job

The background job queue of @usehenri/jobs.

### `HENRI_JOB_INVALID_ARGUMENTS`

The arguments of a job cannot be stored.

Usually:

- an argument that is a function, a class, a bigint or a cycle
- a model instance passed whole instead of its id

**Fix.** The arguments of a job are stored as JSON: pass ids and plain values, and look the records up inside `perform()`.

### `HENRI_JOB_INVALID_CRON`

A recurring job has a cron expression henri cannot read.

Usually:

- a step that is not a whole number
- a field outside its range, or a name the parser does not know
- an expression that has not five fields

**Fix.** Five fields, `minute hour day month weekday`, each a number, a name, a list, a range, a step or `*`. The message names the field that is wrong.

### `HENRI_JOB_INVALID_DEFINITION`

A file of app/jobs is not a job.

Usually:

- a file of app/jobs that exports nothing
- a file that exports an object without a `perform`

**Fix.** A job is `app/jobs/<name>.js` exporting `perform(args, context)`, plus the optional `queue`, `priority`, `maxAttempts`, `timeout` and `backoff`.

### `HENRI_JOB_INVALID_DURATION`

A delay or a date given to the queue could not be read.

Usually:

- a string that is not a duration (`5 minutes`, `2h`, `30s`)
- a date that is not a date
- a negative or infinite number

**Fix.** `performIn()` takes milliseconds or a duration string; `performAt()` takes a Date or something Date can parse.

### `HENRI_JOB_INVALID_SCHEDULE`

A recurring job of the configuration is not shaped like a schedule.

Usually:

- a schedule with neither `cron` nor `every`
- a job name no file in app/jobs answers to
- arguments that are not a plain object
- a cron expression that can never come round (February 30th)

**Fix.** A schedule is `{ job, cron | every, args?, queue? }` and its `job` is the name of a file in app/jobs. The message names the entry that is wrong.

### `HENRI_JOB_QUEUE_NOT_STARTED`

The job queue was used before it was started.

Usually:

- the queue was used before the boot reached it
- `jobs.start()` was never awaited outside henri

**Fix.** henri starts the queue at runlevel 4; outside henri, `await jobs.start()` first.

### `HENRI_JOB_QUEUE_UNAVAILABLE`

Something asked for the job queue and the application has none.

Usually:

- the application has neither app/jobs nor a `jobs` block in its configuration
- @usehenri/jobs is not installed
- the boot did not go far enough to start the queue

**Fix.** Install the queue (`npm install @usehenri/jobs`) and write a job with `henri generate job <name>`, or stop calling `deliverLater()`/`perform()`.

### `HENRI_JOB_RUNNING`

The job is being performed and cannot be changed.

Usually:

- a retry or a discard aimed at a job a runner is performing right now
- a runner that died holding the job and has not been recovered from yet

**Fix.** Wait for it to finish, or for `jobs.stuckAfter` to pass so the queue takes it back.

### `HENRI_JOB_STORE_MISSING`

The queue names a store the configuration does not hold.

Usually:

- a typo in `jobs.store`
- a store that only exists in another environment

**Fix.** Set `jobs.store` to one of the names of the `stores` block, or leave it out to use the default store.

### `HENRI_JOB_TIMEOUT`

An attempt ran past the job’s timeout.

Usually:

- a job whose `perform()` never returned in time

**Fix.** Raise the job’s `timeout`, or split the work: the attempt is failed and retried like any other failure.

### `HENRI_JOB_UNKNOWN`

The queue was asked to perform a job no file in app/jobs answers to.

Usually:

- the job was renamed or deleted while rows for it were still in the queue
- a typo in the name given to `perform()`

**Fix.** `henri jobs list` shows what is queued and `app/jobs` holds the names. Discard the rows of a job that is gone with `henri jobs:discard`.

### `HENRI_JOB_UNKNOWN_STATE`

The queue was asked for a state that does not exist.

Usually:

- a typo in the state given to `henri jobs list --state`

**Fix.** The message lists the states a job can be in.

### `HENRI_JOB_UNSUPPORTED_STORE`

The store the queue was given cannot back it.

Usually:

- a store whose adapter the queue has no statements for
- an adapter that reports a dialect the queue does not know

**Fix.** The queue runs on sqlite, PostgreSQL, MySQL, MSSQL and MongoDB. Point `jobs.store` at a store on one of them.

## mail

The mail transport, the mailers of app/mailers and their views.

### `HENRI_MAIL_INVALID_MESSAGE`

A mailer action did not return a message.

Usually:

- the message returned by the mailer action is not an object
- an action that returns nothing

**Fix.** A mailer action returns the message it wants sent: `return { to, subject, data }`. Everything else it holds is passed to nodemailer.

### `HENRI_MAIL_NO_TRANSPORT`

A message was sent and no transport was ever built.

Usually:

- `mail` is missing from the configuration
- the mail module never started, or its transport failed to verify

**Fix.** Set `mail` in the configuration -- nodemailer transport options, or `"test"` for an Ethereal account. See the Mail guide.

### `HENRI_MAIL_TRANSPORT_INVALID`

The mail configuration is not a nodemailer transport.

Usually:

- `mail` set to a string other than `"test"`
- `mail` set to a number, an array or `true`

**Fix.** `mail` takes the options object nodemailer's `createTransport()` takes, or the string `"test"`.

### `HENRI_MAIL_UNKNOWN_ACTION`

A mailer has no such action.

Usually:

- a typo in the action name
- a function the mailer does not export (`defaults` and `previews` are not actions)

**Fix.** Every exported function of app/mailers/<name>.js is an action. The message lists the ones this mailer has.

### `HENRI_MAIL_UNKNOWN_MAILER`

There is no such mailer in app/mailers.

Usually:

- a typo in the mailer name
- the file is not in app/mailers
- the file throws when it loads, so the mailer never registered

**Fix.** Mailers are the files of app/mailers, reached as `henri.mailers.<name>.<action>()`. The message lists the ones that loaded.

### `HENRI_MAIL_VIEW_MISSING`

A mail has no view to render.

Usually:

- the view was never written
- it sits somewhere other than app/views/mailers
- its name does not match the action

**Fix.** Write app/views/mailers/<mailer>/<action>.hbs. A `<action>.text.hbs` next to it replaces the plain text part, which is otherwise derived from the html.

## model

The model files of app/models and the schema the adapters normalize.

### `HENRI_MODEL_FIELD_INCOMPLETE`

A model field carries options but no type.

Usually:

- a field with `required`, `default` or `unique` and no `type`
- a field written as `{ required: true }` instead of `{ type: 'string', required: true }`

**Fix.** Every field of a henri schema names its type: `title: { type: 'string', required: true }`, or the short form `title: 'string'`.

### `HENRI_MODEL_INVALID_FIELD`

A model field holds something the adapter refuses.

Usually:

- `enum` given something that is not an array
- an option the adapter does not know
- a relation pointing at a model that does not exist

**Fix.** The message names the field and what it holds. See the Models guide for the keys a field takes: `type`, `required`, `default`, `enum`, `unique`, `index`.

### `HENRI_MODEL_NO_STORE`

A model has no store and there is no default one.

Usually:

- no `stores.default` in the configuration
- the model was written before the store was configured

**Fix.** Configure `stores.default`, or give the model a `store` naming one of the stores that exist.

### `HENRI_MODEL_UNKNOWN_STORE`

A model names a store the configuration does not hold.

Usually:

- a typo in the model's `store`
- a store that only exists in another environment's configuration

**Fix.** Add the store to `stores` in the configuration of this environment, or point the model at one that is there.

### `HENRI_MODEL_UNKNOWN_TYPE`

A model field asks for a type henri does not have.

Usually:

- a type of the underlying ORM rather than henri's (`STRING`, `varchar`, `ObjectId`)
- a typo in the type name

**Fix.** henri's types are `string`, `text`, `number`, `integer`, `float`, `boolean`, `date`, `json` and `uuid`. The adapter maps them to the ORM's own.

## privacy

The personal data marked in the models, the export of one person and the erasure of them.

### `HENRI_PRIVACY_ADAPTER_UNSUPPORTED`

A model holding personal data belongs to an adapter henri cannot export or erase through.

Usually:

- a store adapter that is not mongoose, sequelize or drizzle
- a model that is not the one the adapter registered

**Fix.** The export and the erasure are driven through the model API of the three adapters henri ships. An adapter of your own answers them by implementing the same statics: `find`, `update` and `destroy`.

### `HENRI_PRIVACY_ERASE_REFUSED`

An erasure was refused before it wrote anything, because the plan cannot be carried out.

Usually:

- a field marked `erase: clear` on a column that cannot hold null
- records to orphan whose link to the person is `required`
- the person is to be deleted while another model keeps its records

**Fix.** The message names every problem at once. Say what should happen to those records with `options: { personal: { onErase } }`, or mark the field `erase: 'anonymize'`. Nothing was written: the plan is checked before the first write.

### `HENRI_PRIVACY_INVALID_MARK`

A model marks a field personal in a way henri does not understand.

Usually:

- `personal` given something other than `true`, `false` or an object
- `personal.erase` given a strategy that does not exist
- `options.personal.onErase` given a strategy that does not exist

**Fix.** A field is marked `personal: true` or `personal: { expose, export, erase }`, where `erase` is `clear`, `anonymize` or `retain`. A model's `options.personal.onErase` is `anonymize`, `delete`, `orphan` or `retain`.

### `HENRI_PRIVACY_NO_SUBJECT`

An export or an erasure was asked for and the application has no model that is a person.

Usually:

- the application has no user model
- `config.user.model` names a model that is not in app/models

**Fix.** henri's notion of a person is the user model (`config.user.model`). Add one -- `henri generate authentication` writes it -- or point `config.user.model` at the model that is a person.

### `HENRI_PRIVACY_RECEIPT_UNWRITABLE`

An erasure was carried out and its receipt could not be written.

Usually:

- the directory of `config.privacy.receipts` cannot be created
- the process cannot write where the receipts go

**Fix.** The erasure happened; what failed is the proof of it, which is the half you have to keep. Make the directory writable, point `config.privacy.receipts` somewhere else, or set it to false and keep the receipt the command printed.

### `HENRI_PRIVACY_UNKNOWN_SUBJECT`

The person an export or an erasure was asked about does not exist.

Usually:

- a misspelled email address
- an external id that belongs to another model
- the person was erased already, and their address with them

**Fix.** Name the person by email address, by external id or by primary key. An erased person no longer answers to their address: look their receipt up by digest instead.

## route

Config/routes.js and the router.

### `HENRI_ROUTE_INVALID_ACTION`

A route points at something that is not an action name.

Usually:

- a stray space in the route (`'tasks #index'`)
- a character that is not a letter, a digit, a dash or an underscore
- a `/` meant as a separator rather than a directory

**Fix.** An action name is letters, digits and underscores after the `#`: `'/tasks': 'tasks#index'`.

### `HENRI_ROUTE_INVALID_CONTROLLER`

A route points at something that is not a controller name.

Usually:

- a stray space in the route (`' tasks#index'`)
- a character that is not a letter, a digit, a dash or an underscore

**Fix.** A controller name is letters, digits, dashes and underscores, with `/` for a directory: `'admin/tasks#index'`.

## store

The store adapters: loading them, starting them, talking to them.

### `HENRI_STORE_ADAPTER_NOT_INSTALLED`

The adapter a store asks for cannot be loaded.

Usually:

- the adapter package is not installed
- an install was interrupted, or node_modules is stale
- the package throws when it loads

**Fix.** Install the adapter in the application (`npm install @usehenri/<adapter>`): henri resolves it from the application, never from itself.

### `HENRI_STORE_NOT_STARTED`

A store was used before it was started, or after it was stopped.

Usually:

- the store was never started, or it was stopped
- a query that outlived `henri.stop()`
- a model used before the boot reached the models

**Fix.** Let the boot finish before querying. In tests, `await setup()` first; the helper boots the application inside the worker.

### `HENRI_STORE_SESSION_UNAVAILABLE`

No session store could be built for the user module.

Usually:

- the store's adapter has no session store
- the store is not loaded
- the adapter's session store failed to build its table

**Fix.** Point the sessions at a store whose adapter has one (mongoose, disk, or a SQL store). Without one, sessions fall back to an in-memory store that is lost on every restart.

### `HENRI_STORE_START_FAILED`

A store could not be started.

Usually:

- the server is not running, or not reachable from here
- the credentials are wrong
- the database does not exist
- the driver of the dialect is not installed

**Fix.** The adapter's own error is underneath. Check the url of the store, that the server is up (`pnpm db:up` in development) and that the driver is installed.

### `HENRI_STORE_UNKNOWN_ADAPTER`

A store names an adapter henri does not have.

Usually:

- a typo in `stores.<name>.adapter`
- an adapter name that is not one henri knows

**Fix.** The adapters are `disk`, `mongoose`, `mysql`, `mariadb`, `postgresql`, `mssql` and `drizzle`.

### `HENRI_STORE_UNUSABLE`

A store the configuration points at could not be used.

Usually:

- the store is named in `api.idempotency.store` or `rateLimit.store` and the module cannot be loaded
- the module does not export the shape the feature expects

**Fix.** A shared store is a module the application resolves, exporting `{ get, set, delete }`. Without one, the feature keeps its state in memory, which is wrong behind more than one process.

### `HENRI_STORE_URL_MISSING`

A store has nothing to connect to.

Usually:

- neither `url` nor `host` is set on the store
- DATABASE_URL is not set in this environment
- the credentials that hold the url could not be opened

**Fix.** Set `stores.<name>.url`, or the `host`, `port`, `database`, `username` and `password` the adapter assembles one from. `DATABASE_URL` sets `stores.default.url`.

## user

The user module: sessions, passwords, tokens and the CSRF protection.

### `HENRI_USER_PASSWORD_UNVERIFIABLE`

A password hash cannot be checked here.

Usually:

- a hash made with argon2id on a machine that has @node-rs/argon2, verified on one that does not
- a hash bound to its record passed to compare() on its own

**Fix.** Install @node-rs/argon2 wherever the hashes are verified, and pass the user rather than the hash (`henri.user.compare(password, user)`) when password binding is on.

### `HENRI_USER_SECRET_MISSING`

There is a user model and no secret to sign its sessions with.

Usually:

- no `secret` in the configuration and no `HENRI_SECRET` in the environment
- a deployment that never got the variable

**Fix.** Set `HENRI_SECRET`, or `secret` in the configuration, or put it in the credentials (`henri credentials:edit`). It signs the sessions and the tokens: a new one logs everybody out.

### `HENRI_USER_SERVER_MISSING`

The user module needs the express app and there is none.

Usually:

- the user module ended up in a boot that has no server
- a module ordering that puts the user module before the express app

**Fix.** Do not pin the user module below the server. A boot that stops before the server (`henri jobs`, `henri console`) does not mount sessions at all.

### `HENRI_USER_TOKEN_INVALID`

A token could not be signed.

Usually:

- a token asked for without a secret, a purpose or a subject
- the application signs its own tokens and left one of the three out

**Fix.** A henri token is signed with the configuration's `secret` and carries a purpose and a subject; all three are required.

## view

The view engines, their pages and their builds.

### `HENRI_VIEW_BUILD_FAILED`

The view engine's build did not finish.

Usually:

- the renderer's own build failed (a page that does not compile, a missing import)
- the build ran without the packages the renderer needs

**Fix.** The bundler's own output is above the error. Run `henri build` again after fixing it; the development server prints the same errors as it reloads.

### `HENRI_VIEW_INERTIA_UNAVAILABLE`

The configuration asks for the inertia renderer and the application does not have it.

Usually:

- @usehenri/inertia, @inertiajs/react, react, react-dom or vite is not installed
- the package throws when it loads

**Fix.** Install the renderer in the application: `npm install @usehenri/inertia @inertiajs/react react react-dom vite @vitejs/plugin-react`.

### `HENRI_VIEW_NONCE_UNSUPPORTED`

The configuration asks for a Content Security Policy nonce and the renderer cannot carry it.

Usually:

- `"csp": { "nonce": true }` with a renderer that does not write the nonce into the document
- a view engine of your own, or an older one, that does not declare `supportsNonce`

**Fix.** Use a renderer that carries it -- `inertia`, `react` or `template` -- or turn the nonce off (`"csp": { "nonce": false }`). A view engine of your own carries one by writing it on every script and style tag it emits and setting `supportsNonce = true`.

### `HENRI_VIEW_NO_BUILD`

The view engine has no build() to call.

Usually:

- a renderer that is not a henri view engine
- a version of the engine older than the core running it

**Fix.** `henri build` calls `build({ cwd, config })` on the engine. A view engine implements `init`, `prepare`, `fallback`, `render` and, to be buildable, `build`.

### `HENRI_VIEW_PAGES_MISSING`

The renderer has no pages directory to render or to build.

Usually:

- the application was never scaffolded, or its views were moved
- a build run from somewhere other than the root of the application

**Fix.** The renderer reads its pages from app/views/pages. Run the command from the root of the application, or scaffold one with `henri new`.

### `HENRI_VIEW_REACT_UNAVAILABLE`

The configuration asks for the react renderer and the application does not have it.

Usually:

- @usehenri/react, next, react or react-dom is not installed
- the package throws when it loads

**Fix.** Install the renderer in the application: `npm install @usehenri/react next react react-dom`. New applications get the inertia renderer instead.

### `HENRI_VIEW_SSR_FAILED`

Server-side rendering failed.

Usually:

- the server bundle was not built (`henri build` before serving with ssr on)
- the bundle does not export `render()`
- a page that throws when it renders on the server

**Fix.** Build the server bundle, or turn server-side rendering off (`inertia.ssr: false`) while the page is fixed.

### `HENRI_VIEW_UNKNOWN_RENDERER`

The configuration asks for a renderer henri does not have.

Usually:

- a typo in `renderer`
- a renderer that is experimental and not enabled

**Fix.** `renderer` takes `inertia`, `react` or `template`. An experimental one is enabled with `"experimental": { "<name>": true }`.

### `HENRI_VIEW_VUE_DISABLED`

The vue renderer is experimental and was not enabled.

Usually:

- `renderer: "vue"` without the experimental flag

**Fix.** Enable it with `"experimental": { "vue": true }`. It was written for Nuxt 2 and has not been exercised since 2020: prefer `inertia`.
