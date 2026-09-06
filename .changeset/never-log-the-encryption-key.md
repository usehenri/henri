---
'@usehenri/core': patch
---

Two places the logs printed what everything else masks.

`config.encryption.keys` is the key that opens every encrypted column. `0.config.js` keeps it out of the configuration report and out of every validation message, and only the eight character key id reaches a message — but that covers the paths henri prints itself. An application that logs its own configuration, which a structured `json` line now serializes faithfully, printed the key in full:

```
{ encryption: { keys: [ 'deadbeef…deadbeef' ] }, password: '[FILTERED]' }
```

because the substring filters are `password`, `token`, `secret` and `authorization`, and none of them is `keys`.

The fix is not a fifth default filter: `config.filterParameters` **replaces** the list, so an application that adds `apiKey` to it, or sets it to `false`, would take the protection away by widening it. `base/redact.js` gained an `ALWAYS_MASKED` of its own instead — the `ALWAYS_MASKED` of `0.config.js` one level down, the same name matched as a substring over any object rather than as a configuration path. Anything containing `encryption` is masked in everything `henri.pen` writes, in both formats, whatever `filterParameters` says, and there is no setting that turns it off. It is a substring so that it masks the whole `encryption` block rather than one name inside it; the cost is that a field called `encryptionStatus` is masked too, which is the collateral `password` already takes on `passwordChangedAt`. It also closes a third path: `HENRI_CONFIG_JSON__encryption='{"keys":[…]}'` arrives under the path `encryption`, which the configuration's own list — `encryption.keys` — did not cover, and the boot report printed it.

Second, `config.requestTimeout` logged `req.originalUrl` unredacted, so a request that timed out wrote to the log what the 500 path is careful not to — a `?token=…`, an address in a query. It now goes through the same masking, and so does the `DEBUG=henri:csrf` line for a refused cross-origin request. Both of those, and the error handler, take the masking from the running instance now (`urlRedactor()`), so a query parameter named by the application's own `filterParameters` or by a `personal` model field is masked in a log line too — the error handler had been using the built-in defaults only.
