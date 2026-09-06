---
'@usehenri/core': minor
'@usehenri/cli': minor
---

The configuration is checked against a schema at boot, before any module starts.

JavaScript is not strongly typed and TypeScript erases at runtime, so henri checks its own inputs — exhaustively at the boundaries, and the configuration is the first one. Every key henri owns is declared in `@usehenri/core` (`src/base/config-schema.js`) as data: the type it accepts, what to say when something else arrives, and what to do about it. `0.config.js` runs it once the file has loaded and the credentials and the environment have been applied over it, so a wrong value fails on the first line of the boot rather than three modules in, where the message would have named the reader instead of the mistake.

**Every problem is reported, not the first one.** Somebody fixing a configuration file should not discover its faults one boot at a time.

**An error names the key, what was expected, what arrived, and where the value came from** — the file, the credentials, or the variable, because `port must be a number` is unhelpful when the culprit is an environment variable three deployments away:

```
config ✖ "port" must be a port number between 1 and 65535, but it is the string "eight thousand" => from config/production.json
config ✖ "stores.default.adapter" must be one of disk, drizzle, mariadb, mongoose, mssql, mysql, postgresql, but it is the string "redis" => from HENRI_CONFIG__stores__default__adapter
config ✖ "secret" must be a string, but it is a number => from the credentials (config/credentials/production.json.enc)
```

A value the `filterParameters` name, and anything the credentials provided, is printed as its type alone; the password of a connection string is always masked. The boot fails with a `ConfigurationError` whose `code` is `CONFIG_INVALID` and which carries every problem, so `henri server --json` prints them as `{ "error": { "code", "message", "hint", "problems" } }` and exits `1`.

**An unknown key is a warning, never a failure**: an application may carry keys of its own, and `henri.config.get()` is how it reads them. But a key that is a near miss of one henri owns says so and names the right one (`"renderers" is not a henri configuration key: did you mean "renderer"?`), because that is the actual mistake being made. Inside a store, where everything henri does not declare is forwarded to the driver, only a near miss is worth a word.

**`henri doctor` runs the same schema** over every `config/*.json` without booting and without a database — the checks are `config.invalid`, `config.adapter` and `config.unknown`.

Two smaller changes come with it. An environment variable now takes the type the schema declares when the configuration file has no value at that path (`HENRI_CONFIG__port=8080` is the number `8080` in an application whose file never names a port); the file still wins when it does have one, and a key henri does not own is still a string. And a boot failure reaches the command line through its error envelope — `henri server failed: ...` and the hint — instead of a raw object dump.

The schema cannot drift from the type declarations or the documentation: `@usehenri/core`'s suite compares it key by key with the `Configuration` interface of `index.d.ts` and with the table of the configuration page, and refuses a key that lives in only one of the three.
