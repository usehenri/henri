---
'@usehenri/drizzle': minor
'@usehenri/cli': minor
'@usehenri/core': patch
---

`henri console --sandbox`: a transaction held open for the life of the
session and rolled back when it ends, so a destructive thing can be tried on
real data and nothing survives it.

It is offered **only where henri can honour it**. A sandbox needs a model
call to join the transaction of its async context on its own -- nobody
threads a transaction handle through what they type at a prompt -- so it is
`Drizzle#sandbox()`, the new optional method of the adapter contract, which
covers every drizzle store (`drizzle`, `postgresql`, `mysql`, on sqlite,
PostgreSQL and MySQL). `mongoose`, `disk` and `mssql` implement nothing:
a Mongoose write only joins a transaction when the call is handed the
`session` (and a MongoDB transaction needs a replica set), and Sequelize
joins by async context only under `Sequelize.useCLS()`, which henri does not
install. On those the console refuses **before it prints a prompt**, with
`HENRI_STORE_SANDBOX_UNSUPPORTED` and exit 1, rather than opening a session
whose writes quietly survive.

Every store is opened, not only the default one, and a store that cannot
open rolls back the ones that did. `henri console` without the flag is
unchanged.
