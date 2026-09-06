---
'@usehenri/sequelize': minor
'@usehenri/mongoose': minor
'@usehenri/drizzle': minor
'@usehenri/core': minor
'@usehenri/cli': minor
---

Encrypted attributes: a field that is ciphertext in the database and a plain
string in the model.

```js
schema: {
  ssn: { encrypted: true, type: 'string' },
  badge: { encrypted: { deterministic: true }, type: 'string', unique: true },
}
```

The three adapters honour it. `person.ssn` is the string it always was; the
column holds `henri:v1:r:<key id>:<base64url>` — AES-256-GCM, with the model,
the field and the scheme authenticated with the value, so a ciphertext only
opens where it was written.

The key is `config.encryption.keys`, never `config.secret`. Its home is the
encrypted credentials of the environment (`henri credentials:edit`) or
`HENRI_ENCRYPTION_KEYS`; `henri audit` reports a key found in a `config/*.json`
and nothing henri prints ever holds key material — only the eight character key
id.

`encrypted: true` is randomised, so nothing can query it and henri refuses
rather than matching nothing; `{ deterministic: true }` keeps an equality and a
`unique`, and gives away which rows share a value. Only `string` and `text` may
be encrypted, a `string` column becomes `text` (randomised) or `varchar(700)`
(deterministic), and the fields henri itself queries — `email`, `password`,
`roles` on the user model — cannot be marked.

Rotation ships with it. `keys` is a list: every key decrypts, the first one
encrypts, so adding one in front is a deploy. `henri encryption:status` counts
what the columns hold by key id without opening a value, and
`henri encryption:rotate` rewrites everything under the key that writes —
soft-deleted rows included, `updatedAt` untouched, and never overwriting a value
it could not read back. A backfill of a table that is already full is the same
command, with `config.encryption.readPlaintext` on for the length of the
migration.

A value that will not decrypt throws, with a different code for a key that is
missing, bytes that were changed and a column still in the clear;
`henri.encryption.tolerate(fn)` is the one way past it, and it is what
`henri privacy:export` and `henri privacy:erase` run inside so that a lost key
costs a `null` and a line in the document rather than the whole request. A field
marked `encrypted` is `personal` unless the model says otherwise, so it is
masked in the logs, exported and erased.

See the guide: https://usehenri.io/guides/encryption/
