---
'@usehenri/sequelize': minor
'@usehenri/mongoose': minor
'@usehenri/drizzle': minor
'@usehenri/core': minor
'@usehenri/cli': minor
---

Personal data: mark a field in the model, and henri does the rest

A model now says which of its fields are about a person, in the schema, next
to the type: `name: { personal: true, type: 'string' }`. Four things follow
from the mark.

- **The logs.** Every personal field name is masked in what `pen` prints and
  in the errors and log lines `henri mcp` records — matched exactly, next to
  the substring filters of `config.filterParameters`. **The email address of
  the user model is personal, so it is masked from now on**, in every log line
  of every application.
- **What leaves the server.** `personal: { expose: false }` drops a field from
  every answer henri builds — `res.render()`, `res.resource()`,
  `res.collection()` and the public user — everywhere, at every depth. Nothing
  else changes: a field marked `personal: true` is sent exactly as it was
  before, because dropping `email` by default would break every application.
  `res.render(view, { data, include: ['phone'] })` is how the person's own
  page gets one back, and `config.privacy.expose: false` flips the default for
  applications that want the strict reading.
- **`henri privacy:export <who>`** hands a person everything the application
  holds about them: their own record and every record of every model linked to
  them, soft-deleted rows included.
- **`henri privacy:erase <who>`** removes them. A soft delete is never an
  erasure and a soft-deleted row is erased like any other; the records that
  reference the person survive while the person is anonymized in place
  (`options: { personal: { onErase: 'anonymize' | 'delete' | 'orphan' |
'retain' } }`); the plan is refused before anything is written when it cannot
  be carried out; and every erasure leaves a receipt naming what it touched,
  with an HMAC of the identity rather than the identity.

`henri privacy` prints the map the way `henri routes` prints the routes,
`henri.privacy` is the same thing from the application (a "download my data"
and a "delete my account" button are three lines), `henri audit` reports a
field that is plainly about a person and carries no mark
(`privacy.unmarked`, ASVS V8.3.4), and `config.privacy` holds `expose`,
`onErase` and `receipts`.

The three adapters accept the key and keep it out of the column, so a marked
model generates exactly the schema it did before.
