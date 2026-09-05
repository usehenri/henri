---
'henri': patch
'@usehenri/cli': patch
'@usehenri/core': patch
'@usehenri/disk': patch
'@usehenri/mongoose': patch
'@usehenri/sequelize': patch
'@usehenri/mysql': patch
'@usehenri/postgresql': patch
'@usehenri/mssql': patch
'@usehenri/react': patch
---

The published packages declare their `files`: the tarballs no longer ship the
test suites and every package carries the LICENSE, a README and its changelog.
`@usehenri/websocket` is no longer published (it was never wired into core).
