---
'@usehenri/core': patch
'@usehenri/react': patch
---

Remove dependencies flagged by npm audit: `express-boom` (pulled in an unpatched `hoek`) is replaced by a small built-in `res.boom` helper with the same response shape, `node-notifier` is dropped (`pen.notify()` now prints to the console in development), and the React forms use `lodash/get` and `lodash/set` instead of the unpatched `lodash.set` package.
