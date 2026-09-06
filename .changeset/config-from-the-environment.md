---
'@usehenri/core': minor
---

The environment configures an application: `DATABASE_URL` and any configuration key.

`DATABASE_URL` sets `stores.default.url`, the way Rails has read it forever and the way every hosting provider hands you a database. It carries no `HENRI_` prefix on purpose — a prefixed alias would mean writing `HENRI_DATABASE_URL=$DATABASE_URL` in every deployment — and it applies only when the configuration already declares a `stores.default`, since a url does not say which adapter to load; when it does not, the boot says so and moves on.

Every other key is `HENRI_CONFIG__<key>`, `__` between the path segments and the segments verbatim: `HENRI_CONFIG__port=8080`, `HENRI_CONFIG__stores__reporting__url=...`, `HENRI_CONFIG__user__afterLogin=/dashboard`. **The type comes from the configuration file, henri never guesses it**: a number for `port`, `true`/`false` for a boolean, JSON for an object, and a string for a key no file declares, so a connection string that looks like a number stays a string. `HENRI_CONFIG_JSON__<key>` parses JSON in every case, which is how a nested object or an array is set. A value that does not fit its key fails the boot naming the variable and the type it expected, and so does a variable set to nothing: a missing variable is not an override and never becomes an empty string. No error message ever quotes the value.

Precedence, lowest first: the configuration file, then `HENRI_SECRET` / `HENRI_HOST` / `DATABASE_URL`, then `HENRI_CONFIG__<key>` — the same story as the two overrides that already existed. Every key the environment provided is printed at boot (`config ✏ from the environment => port = 8080 => HENRI_CONFIG__port`), with the names `config.filterParameters` covers masked, plus the password of a connection string, which no filter list would name. `henri.config.fromEnv` holds the `{ key, variable }` pairs, never the values.

A container image therefore needs no configuration file written at start time: commit `config/production.json` and pass the rest as environment variables.
