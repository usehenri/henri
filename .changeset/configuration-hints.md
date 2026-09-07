---
'@usehenri/core': patch
'@usehenri/cli': patch
---

A wrong configuration value says what to do about it, and the instructions are checked against the source that owns them.

The error catalogue was audited a tranche ago and its "how to fix it" reached the terminal. The configuration schema was the half that was left, and it is the failure people hit first — often before the application has ever run. 138 keys of `base/config-schema.js` gained a `hint`: the command that fixes it, the other key that decides the same thing, the package the value needs, or what the value that arrived actually does.

```
config ✖ "filterParameters[1]" must be a string, but it is the number 7 => from config/default.json
config ✖ The list replaces the defaults rather than adding to them, so name password, token, secret and authorization again next to your own; they are matched as substrings, and "encryption" is masked whatever this says
```

An **item of a list now inherits the hint of the list**, the way a branch of a union already inherited the union's: what to do about `retention.approved` is what to do about the token that is wrong inside it, and a schema that had to repeat the sentence on every item would end up not saying it at all. Two keys carry no hint on purpose, and they are named in the test: where "a path to land on once the address is confirmed" leaves nothing to add, henri says nothing rather than padding.

The durable half is a test. `packages/core/src/__tests__/instructions.js` holds the two readers `error-codes.spec.js` already used — the commands, from the `commands` of `packages/cli`'s package.json and the `COMMANDS` a group's script exports; the configuration keys, from the schema itself — and `instructions.spec.js` runs them over the schema's own `hint` and `describe` and over every `hint` the command line ships. A hint naming a command henri does not have (the first pass found the catalogue saying `henri credentials:init`, which has never existed), a key the schema does not declare, an `@usehenri/` package that is not in the workspace or a `base/*.js` that has moved now fails the suite, as does a hint that only restates its own `describe`. The command reader also learned to read a bare `henri db:status` in a sentence, not only a backticked one.

Four failures of the command line gained a hint of their own where the catalogue's was wrong for that call site: `henri build` on a missing view engine now prints the install line its code promises, `henri console --sandbox` tells apart a store that cannot hold a transaction from one where the transaction would not open, and `henri credentials:edit` says what an editor has to do and that the file was left as it was.
