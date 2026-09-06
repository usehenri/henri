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

The JSON API layer: HAL answers, the health endpoints, the OpenAPI description of what an application exposes and the optional GraphQL engine.

### `HENRI_API_DESCRIPTION_UNWRITABLE`

The OpenAPI description of the application could not be written where `henri openapi --out` was told to put it.

Usually:

- the directory of `--out` does not exist and could not be created
- the file or its directory is not writable
- the path names a directory

**Fix.** Check the path and the permissions of the directory, or print the document to stdout instead: `henri openapi > openapi.json`.

### `HENRI_API_GRAPHQL_DENIED`

A generated GraphQL mutation was refused by the policy of the model it writes.

Usually:

- the `create` rule of the model's policy answered anything but `true`
- the application has no `app/policies/<model>.js`, and a policy that is not there refuses
- the request reached the endpoint without a signed-in user

**Fix.** Write the rule the mutation asks for in `app/policies/<model>.js` (`henri generate policy <Model>`). A generated `create` mutation asks `create` without a record, so the rule takes the user alone.

### `HENRI_API_GRAPHQL_INVALID_DECLARATION`

The `graphql` key of a model says something henri cannot carry out.

Usually:

- `graphql` is neither `true` nor an object
- `graphql` holds a key henri does not know (`generate`, `name`, `queries`, `mutations`, `filters`, `except`, `types`, `resolvers`)
- `graphql.mutations` names something other than `create`, `update` or `destroy`
- the model's name is not a GraphQL type name and `graphql.name` does not give one
- `graphql` is an object that neither generates a definition nor writes one

**Fix.** `graphql: true` derives the type, the queries and the resolvers from the schema; an object takes `generate`, `name`, `queries`, `mutations`, `filters`, `except`, `types` and `resolvers`. `henri graphql` prints what a model would generate.

### `HENRI_API_GRAPHQL_SCOPE_REQUIRED`

A generated GraphQL list query has no scope to filter its records by.

Usually:

- the policy of the model declares no `scope(user)`
- its `scope(user)` answered `null` or `undefined`
- a `where` argument was passed and the scope is not a plain object henri can narrow

**Fix.** Add `scope(user)` to `app/policies/<model>.js`: it answers the condition the list is filtered by, and `scope: () => ({})` is how a policy says "everything". henri never assumes what a list is.

### `HENRI_API_GRAPHQL_UNAVAILABLE`

Something asked for the GraphQL engine, which @usehenri/graphql carries, and the application does not have it.

Usually:

- a model declares `graphql` types and resolvers
- a route or a render asks for a `graphql` query
- the package was removed but the configuration or a model still reaches for it

**Fix.** Install the engine in the application (`npm install @usehenri/graphql`), or remove the `graphql` key from the model, the route or the render that asks for it.

### `HENRI_API_GRAPHQL_UNKNOWN_REFERENCE`

A generated GraphQL mutation was given a reference that names no row.

Usually:

- the value sent for a reference is not the `externalId` of any row
- the primary key of the target row was sent instead of its `externalId`
- the row it named was deleted between the read and the write

**Fix.** Send the `externalId` of the row the reference names -- the identifier henri publishes it as. A primary key does not name a row from outside (see `base/references.js`).

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

## argument

The arguments a public method of henri was called with.

### `HENRI_ARGUMENT_INVALID`

A public method of henri was called with something it cannot honour.

Usually:

- an argument of the wrong type, or one that is missing
- null where an options object was meant, which no default fills in
- a misspelled key in an options object (`stratgy` for `strategy`)
- a value out of the bounds the method accepts

**Fix.** The message names the method, the argument, what was expected and what arrived. Fix the call; the signature of every entry point is in packages/core/src/base/arguments.js and on the API reference page.

### `HENRI_ARGUMENT_UNKNOWN_TARGET`

A call named something to work on and this application has nothing by that name.

Usually:

- a typo in `retention.plan({ only })` or `retention.sweep({ only })`
- a typo in `encryption.rotate({ model, field })`
- a model or a rule that was renamed and not renamed here

**Fix.** The hint lists what the option could have named. henri refuses rather than reporting a clean run over nothing, because an empty success is what makes somebody believe the work is done.

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

## calls

The call log of `henri.calls`: the table it owns, the store it lives in and the partitions it sweeps.

### `HENRI_CALLS_ADDRESS_UNVERIFIABLE`

The call log was asked to read the client address out of a header it has no way to verify.

Usually:

- `calls.address.header` names a header and `calls.address.from` names nobody allowed to set it

**Fix.** Any client can send a header, so henri only believes a named one from a proxy the application listed. Add the addresses or the ranges of the proxies in front of henri: `{ "calls": { "address": { "header": "cf-connecting-ip", "from": ["10.0.0.0/8"] } } }`. Remove the header to fall back to `X-Forwarded-For`, which `config.trustProxy` already governs.

### `HENRI_CALLS_DISABLED`

The call log was read back and this application keeps none.

Usually:

- `config.calls` is absent or false
- the call log could not be started

**Fix.** Turn the call log on with `"calls": {}` in `config/<env>.json`; henri creates its table on the next boot. Recording is a no-op while it is off, but reading it back says so rather than answering with nothing.

### `HENRI_CALLS_PARTITION_UNSUPPORTED`

The call log was asked to partition its table in a store that cannot.

Usually:

- `config.calls.partition` is set on a sqlite, SQL Server or MongoDB store

**Fix.** Only PostgreSQL and MySQL range-partition a table, which is what lets a sweep drop a period instead of deleting its rows. Everywhere else the sweep deletes in bounded batches: leave `calls.partition` out.

### `HENRI_CALLS_UNSUPPORTED_STORE`

The call log cannot be kept in the store it was pointed at.

Usually:

- `config.calls.store` names a store this application does not have
- the store adapter has neither `query()` nor a MongoDB connection
- the MongoDB store is not connected

**Fix.** The call log owns a table in one of the application's stores. Point `config.calls.store` at a store backed by mongoose, drizzle or sequelize, or leave `config.calls` out to keep no call log at all.

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

- `henri db:generate`, `db:migrate`, `db:rollback` or `db:push` on a store using a Sequelize adapter (mssql)
- `henri db:status` on a store whose adapter keeps no schema to read back (mongoose, disk)
- `henri db:schema:dump` or `db:schema:load` on a store whose adapter has no schema to write down (mongoose, disk)

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

## encryption

The fields marked `encrypted` in the models, the keys that open them and the rotation that moves them.

### `HENRI_ENCRYPTION_INVALID_MARK`

A model marks a field encrypted in a way henri does not understand.

Usually:

- `encrypted` given something other than `true`, `false` or an object
- `encrypted.deterministic` given something that is not a boolean
- a key of the object form henri does not know

**Fix.** A field is marked `encrypted: true` (randomised) or `encrypted: { deterministic: true }` (queryable by equality). Nothing else is accepted, because a mark henri half understands is a column that quietly stays in the clear.

### `HENRI_ENCRYPTION_KEY_MALFORMED`

An encryption key is not a key, or two of them are the same.

Usually:

- a key that is not 64 hexadecimal characters
- a key with a newline or a quote left around it
- the same key configured twice

**Fix.** An encryption key is 32 bytes as 64 hexadecimal characters, what `openssl rand -hex 32` prints. Put it in the credentials (`henri credentials:edit`) under `encryption.keys`, primary first. The value that arrived is never repeated in the message: it may be a key.

### `HENRI_ENCRYPTION_KEY_UNKNOWN`

A stored value was encrypted with a key this application does not hold.

Usually:

- an old key was dropped from config.encryption.keys before the rotation had finished
- the database was restored from a dump older than the last rotation
- the application is pointed at the database of another environment

**Fix.** The envelope names the key that wrote it, and this application does not hold it. Put that key back in `config.encryption.keys` -- it decrypts, it does not have to be the primary. `henri encryption:status` counts the rows under each key id, and it is what says when an old key may be dropped.

### `HENRI_ENCRYPTION_NOT_QUERYABLE`

An encrypted field was used in a query that cannot work on ciphertext.

Usually:

- a where clause naming a randomised encrypted field
- `unique` or `index` on a randomised encrypted field
- an order, a like or a range on an encrypted field

**Fix.** A randomised ciphertext is different every time, so an equality never matches and an index is an index over noise. Mark the field `encrypted: { deterministic: true }` if it has to be looked up by value, and accept what that leaks: equal plaintexts have equal ciphertexts. Anything other than an equality is out of reach either way.

### `HENRI_ENCRYPTION_NO_KEY`

A model has an encrypted field and this application has no encryption key.

Usually:

- a model marks a field `encrypted` and `config.encryption.keys` is unset
- the credentials file holding the key did not open
- a key was configured for another environment only

**Fix.** Generate one with `openssl rand -hex 32` and put it in the credentials of the environment: `henri credentials:edit`, then `{ "encryption": { "keys": ["..."] } }`. henri refuses to boot rather than write the column in the clear.

### `HENRI_ENCRYPTION_PLAINTEXT`

A column declared encrypted holds a value that is not encrypted.

Usually:

- the column was filled before the field was marked `encrypted`
- `henri encryption:rotate` has not run yet, or did not finish
- a row was written by something that is not this application

**Fix.** Set `{ "encryption": { "readPlaintext": true } }` for the length of the migration, run `henri encryption:rotate` until `henri encryption:status` reports no plaintext left, then take it out again. Reading the clear out of a column that is supposed to be encrypted is a state to leave, not a setting to keep.

### `HENRI_ENCRYPTION_TOO_LONG`

A deterministic encrypted value is longer than its column can hold.

Usually:

- a deterministic field given more than 480 bytes of text
- a long field marked deterministic when it never had to be queried

**Fix.** A deterministic field lives in a varchar(700) so it can carry a unique index on every dialect, which leaves 480 bytes of plaintext. Mark it `encrypted: true` instead: a randomised field is stored as `text`, has no ceiling, and is not queryable anyway.

### `HENRI_ENCRYPTION_UNREADABLE`

A stored value did not verify under the key that wrote it.

Usually:

- the stored bytes were modified
- a ciphertext copied from another model, another field or another scheme
- a column narrower than the ciphertext it was given, so the value was truncated

**Fix.** The key is here and the value did not verify, so this is not a lost key: the bytes changed. The tag covers the model, the field and the scheme, so a value moved between two columns fails here too. Restore the row, or write it again from wherever it came from. Nothing was decoded and nothing was written.

### `HENRI_ENCRYPTION_UNSUPPORTED_TYPE`

A field marked encrypted has a type henri does not encrypt.

Usually:

- `encrypted` on a number, a date, a boolean or a json field
- `encrypted` on a field with no type

**Fix.** henri encrypts `string` and `text` and nothing else: a ciphertext is a string, and a column that has to keep its type in the database keeps it. Store the value as text and encrypt that, or leave the column in the clear.

## factory

The test factories of `@usehenri/testing`: `test/factories`, the records they make and the traits they apply.

### `HENRI_FACTORY_DEPTH`

Factories nested into each other until it had to be called a cycle.

Usually:

- two factories that make each other, with nothing to end the chain
- two fields of one factory that read each other through `attrs`

**Fix.** End the chain by giving the association an id in the overrides: `create("proposal", { speakerId: someone.id })`.

### `HENRI_FACTORY_INVALID`

A factory definition cannot be used as one.

Usually:

- the file exports something other than `{ attributes }`
- `model` names a model the application does not have
- the file itself throws when it is loaded

**Fix.** A factory exports `{ attributes }`, optionally with `model`, `traits` and `after`. Name the model with `model:` when the file is not called after it.

### `HENRI_FACTORY_UNKNOWN`

A test asked for a factory nothing declares.

Usually:

- a typo in the name given to `create()` or `build()`
- the factory file is not in `test/factories`
- the tests run from a directory that is not the application

**Fix.** Add `test/factories/<name>.js`, or declare it in the test file with `defineFactory(name, definition)`. The message lists the factories that were found.

### `HENRI_FACTORY_UNKNOWN_TRAIT`

A test asked for a trait the factory does not declare.

Usually:

- a typo in a trait name
- the trait belongs to another factory
- an override object was passed as a string

**Fix.** Declare the trait in the `traits` of the factory, or pass an override object instead. The message lists the traits it does have.

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

### `HENRI_MAIL_NO_RECIPIENT`

A message was sent to nobody.

Usually:

- a mailer action that built its message without a `to`
- a `to` read from a record that turned out to be null
- a message assembled by hand and handed to henri.mail.send()

**Fix.** Give the message a `to`, a `cc` or a `bcc`. Under NODE_ENV=test the transport is nodemailer's json one, which accepts a message nobody will ever receive, so this is refused before it gets there.

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

## migration

The migrations of db/migrations and the schema dump of a drizzle store.

### `HENRI_MIGRATION_DATABASE_NOT_EMPTY`

A schema load was asked for on a database that is not empty.

Usually:

- `henri db:schema:load` into a database that already holds the application tables

**Fix.** A schema load starts from an empty database, because it creates every table the dump describes and will not decide on its own which of the existing ones to remove. Empty it first (`henri db:drop` then `henri db:create`, or `henri db:reset` for the whole cycle), or pass --force to load into what is there.

### `HENRI_MIGRATION_DESTRUCTIVE`

Rolling back would take rows away.

Usually:

- `henri db:rollback` whose inverse would drop a table holding rows, or a column holding values
- `henri db:rollback` on a table henri could not count

**Fix.** The rows are counted before anything runs, so this is data that exists rather than a statement that looks dangerous. Run it again with --force when losing them is what you meant; the same rollback on a table where nothing was written needs no flag.

### `HENRI_MIGRATION_DUMP_UNKNOWN`

There is no schema dump to load, or it does not belong to this migration folder.

Usually:

- `henri db:schema:load` with no db/schema.sql
- a dump taken at a migration that is not in db/migrations, usually from another branch

**Fix.** Write the dump with `henri db:schema:dump`, which needs a database it can reach. A dump naming a migration this checkout does not have is the wrong dump for this branch: take a new one, or check out the branch that has that migration.

### `HENRI_MIGRATION_EDITED`

A migration file is not the one the database applied.

Usually:

- the .sql of a migration was edited after it ran
- a migration file replaced by one from another branch

**Fix.** The database records the sha256 of the file it applied and it no longer matches, so henri does not know what ran and will not invert a guess. Put the file back the way it was, or roll the change forward with a new migration.

### `HENRI_MIGRATION_IRREVERSIBLE`

The migration removed something a rollback cannot put back.

Usually:

- `henri db:rollback` on a migration that dropped a table or a column

**Fix.** There is no flag for this one. The inverse would recreate the table or the column empty, which is not what was dropped, and undoing a destructive migration is a restore from a backup. Restore, or write a new migration that adds what you want back and fills it.

### `HENRI_MIGRATION_NOT_APPLIED`

There is no applied migration to roll back, or not that many.

Usually:

- `henri db:rollback` with nothing applied
- `henri db:rollback --step=<n>` with fewer than n migrations applied

**Fix.** A rollback undoes migrations the database says it applied. `henri db:status` lists them; ask for no more than that.

### `HENRI_MIGRATION_SNAPSHOT_MISSING`

The snapshot a migration left the schema at is missing from meta/.

Usually:

- meta/NNNN_snapshot.json deleted or never committed
- a db/migrations folder assembled by hand

**Fix.** The snapshots next to the migrations are what a rollback reads to compute the inverse, and drizzle-kit needs them to generate the next migration too: they belong in the repository. Restore meta/ from version control.

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

### `HENRI_MODEL_INVALID_QUERY`

A model call means something other than what it was written to mean, so henri refuses it instead of running it.

Usually:

- a call written for another ORM: `Model.update(values, { where })`, whose arguments are the other way around here
- a condition keyed by Sequelize's `Op` symbols, which this adapter cannot read
- an empty condition object under a field, which would match every row
- `instance.get({ plain: true })`, which reads as an attribute named by an object

**Fix.** The message names what the call reads as and what to write instead. `Model.update()` takes the condition first and the attributes second; the operators are the ones the Models guide lists (`like`, `in`, `gt`, ...); `toObject()` is the whole record as a plain object.

### `HENRI_MODEL_NO_STORE`

A model has no store and there is no default one.

Usually:

- no `stores.default` in the configuration
- the model was written before the store was configured

**Fix.** Configure `stores.default`, or give the model a `store` naming one of the stores that exist.

### `HENRI_MODEL_UNKNOWN_OPTION`

A model call, or the `options` of a model file, holds a key the adapter does not read.

Usually:

- an option another ORM had: `attributes`, `fields`, `raw`, `transaction`, `individualHooks`
- a model file declaring `options: { indexes }`, `scopes`, `hooks`, `tableName` or `underscored` on a drizzle store

**Fix.** The message names the option, what this call (or this adapter) does take, and what to write instead. An option henri drops is a query that does not do what it says, so it is refused rather than ignored.

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

## params

What a controller declares its actions accept, and the requests checked against it.

### `HENRI_PARAMS_DECLARATION_INVALID`

A controller declares parameters henri cannot check.

Usually:

- a rule with no `type`, or a type henri does not have
- a constraint the type does not take (`min` on a string, `of` on a number)
- an unknown key, usually a misspelling of `required`, `maxLength` or `default`
- a `default` or an `enum` value the rule itself refuses
- a selector naming an action the controller does not export

**Fix.** The message names the controller, the action and the field. A rule is `{ type, required, default, enum, min, max, minLength, maxLength, pattern, of }`, or the type itself (`year: 'integer'`). See the Controllers guide.

### `HENRI_PARAMS_INVALID`

A request does not match what the action declared it accepts.

Usually:

- a value of the wrong type (`?year=banana` where a number was declared)
- a required field nobody sent
- a value outside the bounds the action declared
- a JSON body sending a string where a number or a boolean was declared

**Fix.** The 422 answer carries one message per field in `data.errors`, the shape `henri.model.errors()` normalizes to. Send what the action declared, or change the declaration.

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

## retention

How long the models say they keep their records, and the sweep that enforces it.

### `HENRI_RETENTION_ADAPTER_UNSUPPORTED`

A retention sweep reached a model whose adapter henri cannot drive.

Usually:

- the store adapter is not mongoose, sequelize or drizzle
- the sweep was called on models that are not attached to a connection

**Fix.** The sweep goes through the model API of the three adapters henri ships. Boot the application before sweeping, and use one of them for the models that declare a rule.

### `HENRI_RETENTION_INVALID_RULE`

A model declares a retention rule henri cannot carry out.

Usually:

- `options.retention` is not an object or a list of them
- `after` cannot be read as a period, or is under a minute
- `from` names a field that is not a date on that model
- `action: 'soft-delete'` on a model that is not `paranoid`
- `action: 'anonymize'` on a model that marks no field personal
- two rules of one model share a name

**Fix.** A rule is `{ after, action, from, where, name }`, where `after` is a period (`'90d'`, `'18mo'`, `'2y'`), `action` is `delete`, `soft-delete` or `anonymize`, and `from` is a date column of the model. The boot fails rather than sweeping under a rule henri cannot carry out.

### `HENRI_RETENTION_RECEIPT_UNWRITABLE`

A retention sweep ran and its receipt could not be written.

Usually:

- `config.retention.receipts` points at a directory this process may not write
- the disk is full

**Fix.** The sweep happened; only its receipt could not be written. Make the directory writable, point `config.retention.receipts` somewhere else, or set it to `false` and keep what the command printed.

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

## telemetry

The OpenTelemetry spans and metrics of config.telemetry, and the @opentelemetry/api that carries them.

### `HENRI_TELEMETRY_UNAVAILABLE`

The configuration requires telemetry and the application does not have @opentelemetry/api.

Usually:

- `telemetry.enabled` is true and @opentelemetry/api is not installed in this application
- the package is installed somewhere the application cannot resolve it from

**Fix.** henri ships the instrumentation and never the pipeline: install the interface with `npm install @opentelemetry/api`, and an SDK and an exporter of your choosing beside it (see the telemetry guide). Leave `telemetry.enabled` out to let henri instrument only when the package is there, or set `"telemetry": false` to say this application does not want it.

## trail

The append-only record of who read or changed personal data.

### `HENRI_TRAIL_DISABLED`

The access trail was read back and this application keeps none.

Usually:

- `config.trail` is absent or false
- the trail could not be started

**Fix.** Turn the trail on with `"trail": {}` in `config/<env>.json`; henri creates its table on the next boot. Recording is a no-op while it is off, but reading it back says so rather than answering with nothing.

### `HENRI_TRAIL_INVALID_EVENT`

A trail entry was appended without saying what happened.

Usually:

- `henri.trail.record()` was called without an action
- the action is longer than 64 characters

**Fix.** An entry needs an action: what happened, as one dotted name. An application's own are prefixed `app.` (`henri.trail.record({ action: 'app.exported' })`).

### `HENRI_TRAIL_UNSUPPORTED_STORE`

The access trail cannot be kept in the store it was pointed at.

Usually:

- `config.trail.store` names a store this application does not have
- the store adapter has neither `query()` nor a MongoDB connection
- the MongoDB store is not connected

**Fix.** The trail owns a table in one of the application's stores. Point `config.trail.store` at a store backed by mongoose, sequelize or drizzle, or leave `config.trail` out to keep no trail at all.

### `HENRI_TRAIL_UNWRITABLE`

A trail entry could not be appended after every attempt to chain it.

Usually:

- another writer keeps winning the unique index on `seq`
- the unique index on `seq` is missing, so the chain cannot be numbered

**Fix.** The entry chains onto the head of the trail, so it re-reads the head when another process got there first. Check that the unique index on `seq` exists (henri creates it at boot) and that nothing else writes to the table.

### `HENRI_TRAIL_VALUE_REFUSED`

Something tried to record a value in the access trail.

Usually:

- a `meta` key is a field the models marked personal
- a `meta` key is masked by `config.filterParameters`
- a `meta` value is not a short scalar, or looks like an email address

**Fix.** The trail holds field names, counts and public identifiers, never the values behind them: a record of who read personal data must not become a second copy of it. Record the name and the count, and name a person with `subject`, which henri digests.

## upload

The files @usehenri/uploads reads from a multipart body, the storage they are kept in and the urls that hand them back.

### `HENRI_UPLOAD_NO_IMAGE_LIBRARY`

A variant was asked for and there is no image library to derive it with.

Usually:

- uploads.variants is configured and the application does not depend on sharp
- sharp is declared but was not installed for this platform

**Fix.** Install it in the application: pnpm add sharp. henri ships no image library, because a native addon does not belong in the install of everyone who accepts a file.

### `HENRI_UPLOAD_STORAGE_FAILED`

The storage could not carry out what it was asked to do.

Usually:

- the object store answered an error, or nothing at all
- the network between this process and the store
- a key that is not one henri generated

**Fix.** Read the status and the code the store answered with, which are both in the message. A request that failed for a passing reason has already been made three times.

### `HENRI_UPLOAD_STORAGE_MISCONFIGURED`

The storage the configuration names cannot be used as it is described.

Usually:

- uploads.storage names no bucket, or one that is not a bucket name
- no credentials: neither the block nor AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
- an endpoint that is not a url, or a region the bucket is not in

**Fix.** Check uploads.storage: it needs an adapter, a bucket and a region, and credentials from the environment or from the block.

### `HENRI_UPLOAD_URLS_DISABLED`

A signed url was asked for and this application cannot make one.

Usually:

- uploads.urls is false, or absent, which is the default
- the storage signs no url of its own and the application has no config.secret
- a storage of the application's own whose url() answered null

**Fix.** Turn them on with { "uploads": { "urls": { "expiresIn": 300 } } } and set HENRI_SECRET, or hand the file back from a controller with henri.uploads.send().

### `HENRI_UPLOAD_URL_EXPIRED`

A signed url henri really signed was followed after its expiry.

Usually:

- the link is older than the window it was signed for
- a clock that moved between the signing process and this one

**Fix.** Ask the application for another link. Widen uploads.urls.expiresIn if every link is expiring before it is followed.

### `HENRI_UPLOAD_URL_INVALID`

A signed url did not verify.

Usually:

- the url was edited: another key, a wider window, another disposition
- config.secret was rotated, which invalidates every outstanding link
- the object the link names is no longer in the storage

**Fix.** Ask the application for the link again rather than building one by hand: everything a signed url carries is covered by its signature.

### `HENRI_UPLOAD_VARIANT_FAILED`

A variant could not be derived from the file it was asked for.

Usually:

- the file is not the image its first bytes said it was
- it is larger than uploads.maxFileSize, or holds more pixels than a variant is derived from
- the resize produced something other than the format it was asked for

**Fix.** Read the message: it names what went wrong. Nothing is stored when a derivation fails, so asking again after fixing the source is safe.

### `HENRI_UPLOAD_VARIANT_UNKNOWN`

A variant was asked for by a name the configuration does not declare.

Usually:

- the name is not one of config.uploads.variants
- a typo, or a variant renamed in the configuration and not in the code

**Fix.** Declare it under uploads.variants. A variant name never comes from a request, so that one visitor cannot ask for ten thousand distinct sizes.

### `HENRI_UPLOAD_VARIANT_UNSUPPORTED`

A variant was asked for of something that is not an image one can be derived from.

Usually:

- the file is not an image: its bytes said pdf, zip or anything else
- it is an SVG, which is refused because it is text that carries script

**Fix.** Ask for a variant of an image henri recognized. The type comes from the bytes, so file.type is what decides, never the name or the Content-Type.

## user

The user module: sessions, passwords, tokens and the CSRF protection.

### `HENRI_USER_PASSWORD_MISMATCH`

A password did not verify against the hash it was checked against.

Usually:

- the password does not match the hash of that account
- `henri.user.compare()` called with no account (`null`), which answers exactly this

**Fix.** This is an answer rather than a failure: it is what a wrong password is. Catch it and answer the same thing an unknown address answers, which is what `POST /login` does. The code is here so a caller can tell it apart from a hash it could not check (`HENRI_USER_PASSWORD_UNVERIFIABLE`) and from a wrong call (`HENRI_ARGUMENT_INVALID`); the message never says which of the two it was.

### `HENRI_USER_PASSWORD_UNVERIFIABLE`

A password hash cannot be checked here.

Usually:

- a hash made with argon2id on a machine that has @node-rs/argon2, verified on one that does not
- a hash bound to its record passed to compare() on its own
- a user record loaded without its password hash, which `findById()` and a session deselect

**Fix.** Install @node-rs/argon2 wherever the hashes are verified, and pass the user rather than the hash (`henri.user.compare(password, user)`) when password binding is on. Load the account with `henri.user.findByEmail()`, which selects the hash: `req.user` and `findById()` do not carry one, and answering "wrong password" to a password that is right is the mystery this refuses to be.

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

## version

Model versioning: the `versioned` mark on a model, the table its history lives in, and reading a record back out of it.

### `HENRI_VERSION_DISABLED`

The versions were read back and this application keeps none.

Usually:

- no model of the application says `options: { versioned: true }`
- the versions were read back before the boot reached runlevel 4

**Fix.** Versioning is opt-in per model: add `options: { versioned: true }` to the model whose history you want and henri creates its table on the next boot. `config.versions` only says where that table lives and how long its rows are kept; it does not turn anything on.

### `HENRI_VERSION_INCOMPLETE`

A record cannot be restored exactly from the version it was asked to be restored from.

Usually:

- a field of the record is one whose values are never kept (`password`, or a `filterParameters` match)
- the record was destroyed by something that wrote no snapshot
- the versions between the one asked for and now were pruned

**Fix.** A read may be partial and a write may not: `henri.versions.reify()` answers what it could reconstruct and names the gaps in `missing`, so read it, decide what those fields should be, and write them yourself. `{ force: true }` writes everything that was kept and leaves the rest of the record as it is.

### `HENRI_VERSION_INVALID_OPTION`

A model asked to be versioned in a way henri cannot carry out.

Usually:

- `versioned` is neither `true` nor an object
- `versioned` names an option henri does not have
- `versioned` has both `only` and `except`
- `versioned.events` names something that is not create, update or destroy

**Fix.** `versioned: true` keeps every field on every event. The object form takes `only` or `except` (a list of field names, not both) and `events` (a non-empty list of create, update and destroy). Anything else fails the boot rather than versioning something other than what was written down.

### `HENRI_VERSION_MASS_WRITE`

A mass update or delete was run on a model that keeps versions.

Usually:

- `Model.update(where, attrs)` or `Model.destroy(where)` on a versioned model
- the fluent `Model.where(...).update()` and `.destroy()`, and the `updateMany`/`deleteMany` spellings

**Fix.** A mass write runs the hooks once and without instances, so henri would have no old values to record and the history would silently miss every row. Loop over the records instead -- `for (const record of await Model.find(where)) await record.update(attrs)` -- and each one is versioned. `{ versions: false }` writes the rows without a version, which is a decision rather than a silence.

### `HENRI_VERSION_NO_IDENTIFIER`

A version could not name the record it is about, which has no public identifier.

Usually:

- the model says both `versioned` and `options: { externalId: false }`

**Fix.** A version names the record it is about by its `externalId`, because that is the identifier that already leaves the server (see the models guide). Take `externalId: false` off the model, or stop versioning it.

### `HENRI_VERSION_UNKNOWN`

There is no version with that id, or the model it belongs to is gone.

Usually:

- a version id that was pruned, erased or mistyped
- the model a version belongs to is no longer loaded

**Fix.** `henri versions <Model> <record>` lists the versions of one record with their ids. A version outlives the model file that made it, so keep the model or take its versions away.

### `HENRI_VERSION_UNSUPPORTED_STORE`

The versions cannot be kept in the store they were pointed at.

Usually:

- `config.versions.store` names a store this application does not have
- the store adapter has neither `query()` nor a MongoDB connection
- the MongoDB store is not connected

**Fix.** The versions live in a table henri owns in one of the application's stores. Point `config.versions.store` at a store backed by mongoose, sequelize or drizzle, or take `versioned` off the models that asked for it.

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

## webhook

The outbound webhooks of @usehenri/webhooks: the endpoints, their signatures and their deliveries.

### `HENRI_WEBHOOK_ADDRESS_REFUSED`

A delivery would have reached an address it must not.

Usually:

- a url whose name resolves to a loopback, private, link-local or reserved address
- a url that is not http or https, or that carries credentials
- a plaintext http url without `webhooks.allowHttp`

**Fix.** A delivery only opens a public address, and the check happens when the request is made rather than when the endpoint was registered. Register a public https url, or set `webhooks.allowPrivate` in a development configuration.

### `HENRI_WEBHOOK_DELIVERY_FAILED`

A receiver refused a delivery.

Usually:

- a receiver answering anything other than a 2xx
- a receiver answering a redirect, which a delivery never follows
- a receiver answering 410 Gone, which also disables the endpoint

**Fix.** The delivery is a job: it is retried with the queue’s backoff and lands in the dead letter queue when it runs out of attempts. `henri jobs:dead --queue webhooks` shows them, `henri jobs:retry <id>` sends one again.

### `HENRI_WEBHOOK_FANOUT_TOO_LARGE`

One event would have enqueued more deliveries than the fan-out allows.

Usually:

- an event that more endpoints subscribe to than `webhooks.maxFanout` allows

**Fix.** Emit from a job rather than from a request, so the rows are written outside the response, or raise `webhooks.maxFanout`.

### `HENRI_WEBHOOK_INVALID_ENDPOINT`

An endpoint was registered with something henri refuses.

Usually:

- an event pattern that is not an event name, a family (`invoice.*`) or `*`
- a header the signature or the request owns
- more events or headers than one endpoint may carry

**Fix.** An endpoint is `{ url, events }`, plus the optional `owner`, `description` and `headers`. The message names what was refused.

### `HENRI_WEBHOOK_INVALID_EVENT`

An event name is not one henri will sign.

Usually:

- an event name with a character other than a letter, a digit, `-`, `_` or `.`

**Fix.** Name an event in dot separated segments: `invoice.paid`, `member.role.changed`.

### `HENRI_WEBHOOK_INVALID_SECRET`

A signing secret carries no usable key.

Usually:

- a secret of your own that is not `whsec_` and the base64 of at least sixteen bytes

**Fix.** Let henri generate the secret (`henri webhooks:rotate <id>`); it is thirty-two random bytes, base64, behind a `whsec_` label.

### `HENRI_WEBHOOK_NOT_STARTED`

The webhook endpoints were used before they were ready.

Usually:

- the endpoints were used before the boot reached them
- `webhooks.start()` was never awaited outside henri

**Fix.** henri starts them at runlevel 4; outside henri, `await webhooks.start()` first.

### `HENRI_WEBHOOK_NO_SECRET`

An endpoint has nothing to sign its deliveries with.

Usually:

- every secret of the endpoint has expired, and no rotation added one

**Fix.** Give the endpoint a secret with `henri webhooks:rotate <id>` and hand it to the receiver.

### `HENRI_WEBHOOK_SECRET_UNREADABLE`

An endpoint secret cannot be decrypted.

Usually:

- `HENRI_SECRET` changed after the endpoint was registered
- the secrets column was written by something other than henri

**Fix.** The endpoint secrets are sealed with a key derived from `secret`: put the old one back, or rotate the endpoint secrets (`henri webhooks:rotate <id>`) and hand the new ones to the receivers.

### `HENRI_WEBHOOK_STORE_MISSING`

The endpoints name a store the configuration does not hold.

Usually:

- a typo in `webhooks.store`
- a store that only exists in another environment

**Fix.** Set `webhooks.store` to one of the names of the `stores` block, or leave it out to use the default store.

### `HENRI_WEBHOOK_TIMEOUT`

A receiver did not answer within the delivery timeout.

Usually:

- a receiver that accepted the connection and never answered

**Fix.** Raise `webhooks.timeout`, or ask the receiver to answer before it does its work: the attempt is failed and retried like any other failure.

### `HENRI_WEBHOOK_UNKNOWN`

There is no webhook endpoint with that id.

Usually:

- an endpoint id that was removed, or a typo

**Fix.** `henri webhooks:list` shows the endpoints and their ids.

### `HENRI_WEBHOOK_UNSUPPORTED_STORE`

The store the endpoints were given cannot hold them.

Usually:

- a store whose adapter has neither `query()` nor a MongoDB connection
- an adapter that reports a dialect the endpoints have no statements for

**Fix.** The endpoints live on sqlite, PostgreSQL, MySQL, MSSQL and MongoDB. Point `webhooks.store` at a store on one of them.
