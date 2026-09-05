---
'@usehenri/sequelize': minor
'@usehenri/mongoose': minor
'@usehenri/disk': minor
'@usehenri/mysql': minor
'@usehenri/postgresql': minor
'@usehenri/mssql': minor
---

Store adapters share one contract and understand the henri model format.

- `findUserByEmail(email)`, `findUserById(id)`, `userId(user)` and `toPlain(user)` on every adapter, so core no longer runs Mongoose queries against SQL stores.
- `getSessionConnector(session)` is async and returns a ready store: the SQL session table is created before the first request, and the Mongoose store reuses the mongoose driver client instead of opening a second one. `express-session` is a peer dependency of `@usehenri/sequelize` and `@usehenri/mongoose`.
- `normalizeSchema()` in `@usehenri/sequelize`: string types (`string`, `text`, `number`, `integer`, `float`, `boolean`, `date`, `json`, `uuid`), `required`, `default`, `enum`, `unique` and `index` map to Sequelize attributes and throw on unknown keys; the Mongoose adapter maps the same names. `types.js` in both packages documents the map.
- User model: `email` is unique, lowercased, trimmed and validated; `password` is hashed on bulk and query updates too and is no longer selected by default (`scope('withPassword')` / `select('+password')`); `roles` is dropped from mass-assigned creates and updates unless the operation passes `{ unsafe: true }`, and `user.setRoles(roles)` / `User.setRoles(id, roles)` change it. On SQL, `roles` is a JSON column where the dialect supports it (TEXT with a JSON getter on mssql).
- Model files may export `associate(models)`, called once every model exists (before `sync()` on SQL). Adapters expose `ping()`, `transaction(fn)` and, on SQL, `query(sql, params)`.
- mysql, postgresql and mssql are thin dialect packages over `@usehenri/sequelize` (`createConnector()` hook, `stop()` then `start()` works, `mariadb://` rewrite, Sequelize `logging` defaults to `debug('henri:sequelize')`, credentials redacted from debug output). A missing `url` throws instead of leaving a broken adapter; `host`, `port`, `database`, `username`, `password` are accepted instead of `url`.
- Mongoose: `serverSelectionTimeoutMS` defaults to 10s so a bad url fails fast.
- Disk: data lives under `<cwd>/.henri/data` (`path` and `dbName` are configurable, a warning is logged in production); the `md5` dependency is gone.
