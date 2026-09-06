---
title: Encrypted attributes
description: A field that is ciphertext in the database and a plain string in the model, with a key that is not the session secret and a rotation that ships with it.
---

A field says it in the schema, next to its type:

```js
// app/models/Person.js
module.exports = {
  schema: {
    name: { personal: true, type: 'string' },
    // Ciphertext in the database, a string in the model
    ssn: { encrypted: true, type: 'string' },
  },
};
```

Nothing else in the application changes. `person.ssn` is the string it
always was, `Person.create({ ssn })` takes a string, `res.resource(person)`
sends the string, and the column holds this:

```
henri:v1:r:9f3a1c07:6dQG2thVFFs1ls6NRbQ1DbFbywrkHG_u5CVE0qtYSJxWEPvpUBX5
```

It works on the three adapters -- `@usehenri/drizzle` (and the postgresql,
mysql and mariadb packages), `@usehenri/mongoose` (and disk) and
`@usehenri/sequelize` (which is the mssql store).

This is the one feature of henri that changes stored data, so read
[the migration](#turning-it-on-over-a-table-that-is-already-full) before
turning it on over a table that has rows in it.

## The key is not `config.secret`

`config.secret` signs sessions and tokens. Rotating it signs everybody out,
which is a Tuesday; it must never be the thing that makes a column
unreadable. So encryption has its own key:

```bash
openssl rand -hex 32
```

and its home is the file henri already has for a secret an application must
carry, the encrypted credentials of the environment:

```bash
henri credentials:edit
```

```json
{
  "secret": "...",
  "encryption": {
    "keys": ["a2f1... 64 hexadecimal characters"]
  }
}
```

The credentials file is committed; the key that opens it
(`HENRI_CREDENTIALS_KEY`, or `config/credentials/<env>.key` on a
development machine) is not. A deployment that would rather pass the key
directly can set `HENRI_ENCRYPTION_KEYS` instead -- comma separated, the one
that writes first.

**Never `config/*.json`.** That file is committed, and a key in it means
every encrypted column is readable by anyone who can read the repository.
`henri audit` reports it (`encryption.key-in-config`), at `high`.

Nothing henri prints ever holds a key: the boot report, the validation
messages, the `henri encryption` output and every error message name the key
by its **id** -- eight hexadecimal characters of a digest -- and never by its
value. A key with a typo in it is still a key, so even the "this is not a
key" message says only that a string arrived.

That holds for what _you_ print too. A name containing `encryption` is
masked in everything `henri.pen` writes, whatever
[`filterParameters`](/guides/logs/#masking-is-not-optional) says and even
when it is `false`, so `henri.pen.info('boot', henri.config.get())` writes
`"encryption": "[FILTERED]"` rather than the key. There is no setting that
turns that off. It works by name, so a value handed over without one --
`pen.info(config.get('encryption').keys[0])` -- is yours to keep out of the
line; log `henri.encryption.keys` instead, which is the ids.

## Randomised or deterministic

This is the choice, and henri makes the consequence of getting it wrong a
failure rather than a surprise.

```js
schema: {
  // randomised: different bytes every time
  ssn: { encrypted: true, type: 'string' },
  // deterministic: the same string is the same bytes, in this field
  badge: { encrypted: { deterministic: true }, type: 'string', unique: true },
}
```

**Randomised** is the default and the one to want. Writing the same string
twice produces two envelopes that share nothing, so a dump gives away
nothing at all -- not even which rows match. The cost is that nothing can
query it: a `where` against it would compare a string to an envelope and
match nothing, quietly, which is the worst failure a database layer can
have. So henri refuses instead:

```js
await Person.findOne({ ssn: '123-45-6789' });
// HENRI_ENCRYPTION_NOT_QUERYABLE
// Person.ssn is encrypted and cannot be looked up by value
```

`unique` and `index` on a randomised field are refused at boot for the same
reason: an index over noise indexes nothing, and a unique constraint that
never fires is worse than none.

**Deterministic** keeps the equality and the index. The initialization
vector is derived from the plaintext with an HMAC under a key of its own, so
the same string in the same field is byte for byte the same envelope --
`Person.findOne({ badge })` works, and so does `unique`. What it costs is
what deterministic encryption always costs: whoever holds the dump can see
which rows share a value. Use it for the fields the application looks
records up by, and nothing else.

Neither can be compared with anything but an equality. A `like`, a range, an
`ORDER BY`: all refused, on both schemes, because the database is looking at
bytes that carry no order and no prefix.

```js
await Person.find({ badge: { like: 'B-%' } }); // HENRI_ENCRYPTION_NOT_QUERYABLE
await Person.order('badge'); // HENRI_ENCRYPTION_NOT_QUERYABLE
```

If a column has to be searched, keep a separate column for what is searched
and encrypt the rest.

### What henri will not let you encrypt

- **`email`, `password` and `roles` on the user model.** henri looks a
  person up by address on every sign-in, and a unique index over a
  ciphertext stops being unique the moment a second key is live (see
  [rotation](#rotation)). Marking one of them is a boot failure that says so.
- **anything that is not `string` or `text`.** A ciphertext is a string.
  Encrypting a date would silently change what every comparison on that
  column means.
- **a field with a `default`.** A default is written by the database, which
  has no key: the column would hold that one value in the clear.

## What the ciphertext looks like

```
henri:v1:r:9f3a1c07:AbCd...
\___/ \/ \/ \______/ \_____/
  |    |  |     |       |
  |    |  |     |       iv | tag | ciphertext, base64url
  |    |  |     the first 8 hex of the key id
  |    |  the scheme: r randomised, d deterministic
  |    the envelope version
  henri
```

AES-256-GCM, from node's own crypto. The configured key is never used as an
AES key directly: three subkeys come out of it through HKDF-SHA256, one for
each scheme and one for deriving a deterministic iv, so none of them tells
you anything about the others.

The tag covers `henri:v1:<scheme>:<Model>.<field>`, which means **a
ciphertext only opens in the field it was written for**. Moving `User.ssn`
into `User.notes`, or into `Invoice.ssn`, fails. That is not theoretical: a
restore that maps the wrong column, or a controller that copies one field
onto another, is exactly how a value ends up somewhere it does not belong.

What is _not_ covered is the row: a ciphertext copied from one row onto
another still opens. That is deliberate, and it is the difference between
this and [`config.user.password.binding`](/guides/users/#bound-password-hashes):
a password hash is a credential, so moving it moves the ability to sign in,
and it names its row. A ciphertext is not a credential; the threat this
answers is a stolen dump, a backup or a read replica, and whoever can
_write_ rows already has the application.

## The column, and what it does to a schema that exists

Ciphertext is longer than plaintext and it is not text in any useful sense,
so the column changes:

| The field says                           | The column becomes | Indexable         |
| ---------------------------------------- | ------------------ | ----------------- |
| `{ encrypted: true, type: 'string' }`    | `text`             | no                |
| `{ encrypted: true, type: 'text' }`      | `text`             | no                |
| `{ encrypted: { deterministic: true } }` | `varchar(700)`     | yes, `unique` too |

`varchar(700)` and not something rounder because the smallest index key
among the dialects henri speaks is MySQL's 3072 bytes on `utf8mb4`, which is
768 characters. That leaves **480 bytes of plaintext** for a deterministic
field -- enough for an address, a telephone number or a national identifier,
and a `HENRI_ENCRYPTION_TOO_LONG` failure rather than a truncated write when
it is not. A randomised field has no ceiling.

A `maxLength`, a `minLength` and a `match` on the field still measure the
**plaintext**: validation runs before the value is encrypted. `trim` and
`lowercase` are dropped, because there is nothing left to trim.

On an existing table this is a schema change. On Drizzle it is a generated
migration (`henri db:generate`, `henri db:migrate`); on an mssql store,
`henri db:status` reports the drift and writes the DDL with `--sql`.

## Turning it on over a table that is already full

Marking a column `encrypted` does not encrypt what is in it. The rows that
are already there are plaintext, and henri refuses to read them:

```
HENRI_ENCRYPTION_PLAINTEXT
Person.ssn is declared encrypted and the stored value is not encrypted
```

That refusal is the point -- a column that is supposed to be protected and
answers with the clear is a state to notice, not a state to live in. The
migration is four steps and it can be done without downtime:

1. **Widen the column.** `henri db:generate` and `henri db:migrate`
   (Drizzle), or the DDL `henri db:status --sql` writes (mssql).
2. **Deploy the mark, with the permissive read on** for the length of the
   migration:

   ```json
   { "encryption": { "readPlaintext": true } }
   ```

   New writes are encrypted from this deploy on; old rows still read.

3. **Backfill**, which is the same command as a rotation:

   ```bash
   henri encryption:status         # how much is still in the clear
   henri encryption:rotate         # encrypt it
   henri encryption:status         # until "clear" is 0
   ```

4. **Take `readPlaintext` out** and deploy again. `henri audit` reports it
   (`encryption.read-plaintext`, `medium`) until you do, because a
   permissive read left on means a row that was never backfilled reads as if
   nothing were wrong.

## Rotation

A key you cannot rotate is a key you cannot lose, so this ships with the
feature rather than after it.

`config.encryption.keys` is a list. **Every key decrypts; the first one
encrypts.** So a rotation is a deploy, not a migration:

```json
{ "encryption": { "keys": ["<the new key>", "<the old key>"] } }
```

```bash
henri encryption:rotate --dry-run   # what it would rewrite
henri encryption:rotate             # rewrite it
henri encryption:status             # until nothing is under the old id
```

Then, and only then, drop the old key.

```
  Writing under 4c1f9ab2

    field                                rows  current    older    clear
    Person.badge                         4210     4210        0        0
    Person.ssn                           4210     4210        0        0

  Everything is under 4c1f9ab2. Any other key may be dropped from
  config.encryption.keys, and readPlaintext with it.
```

Four things about the rotation are worth knowing, because each one is a
decision:

- **It walks soft-deleted rows.** A row hidden by `deletedAt` holds the same
  ciphertext a live one does, and it can be restored. A rotation that
  skipped it would leave a row nobody can read the day someone restores it.
- **It does not touch `updatedAt`.** It writes one column of one row at a
  time, underneath the model. A table full of rows all modified at 3am
  because the key changed is a lie told to every "recently changed" list in
  the application.
- **It never overwrites a value it could not read.** Each row is decrypted,
  re-encrypted, and the new envelope is decrypted again before the write. A
  row that will not open is counted, named and left exactly as it is: the
  one operation that could turn a missing key into a destroyed value.
- **A record nobody touches again is the record this is for.** It will never
  be rewritten by the application, so the walk is the only thing that moves
  it and `encryption:status` is the only thing that says it moved. That is
  why the status counts by key id rather than answering "done", and it is
  why dropping a key before the count is zero is the way to lose data.

### While two keys are live

A deterministic lookup asks for every envelope the value could be stored as
-- one per configured key -- so `Person.findOne({ badge })` keeps working
throughout. The cost is that a `unique` deterministic column is unique _per
key_ while the rotation is in flight: the same value written under two
different keys is two different ciphertexts, and the database will accept
both. Finish the rotation.

## When a value will not decrypt

Three different problems, three different codes, because they want three
different answers:

| Code                           | What happened                                             | What to do                                                       |
| ------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------- |
| `HENRI_ENCRYPTION_KEY_UNKNOWN` | the envelope names a key this application does not hold   | put that key back; `encryption:status` says how many rows use it |
| `HENRI_ENCRYPTION_UNREADABLE`  | the key is here and the tag does not verify               | the bytes changed, or the value belongs to another field         |
| `HENRI_ENCRYPTION_PLAINTEXT`   | the column holds something that is not an envelope at all | the backfill has not run; see the migration above                |

A read that fails **throws**. It does not answer `null`, and there is no
setting that makes it. A page that renders empty because a key is missing is
one "save" away from writing that emptiness over the ciphertext, and then
the value is gone for good.

The one way past it is explicit, in code:

```js
const { failures, value } = await henri.encryption.tolerate(() =>
  Person.findAll()
);
```

Inside `tolerate()` an unreadable value reads as `null` and the failures are
collected, so whoever asked for the leniency can say what it cost. It is an
async context, not a flag: two requests in flight never borrow each other's.

## Personal data, the export and the erasure

A field marked `encrypted` is [personal](/guides/privacy/) unless the model
says `personal: false`. Whoever decided a column was worth encrypting has
already answered that question, and a value that is ciphertext in the
database and in the clear in a log line is encryption for show.

So, without writing anything else:

- the field name is **masked in the logs**, matched exactly;
- it is in **`henri privacy:export`**, as the plaintext -- that is what the
  person is asking for;
- **`henri privacy:erase`** writes over it, and what it writes goes through
  the same setter and lands encrypted.

`personal: false` opts out (an application's API key is not somebody's
data), and an explicit `personal` always wins:
`{ encrypted: true, personal: { expose: false } }` reads as written.

Both `privacy:export` and `privacy:erase` run inside `tolerate()`: a person
asking for their data is entitled to an answer, and "one of the keys is
gone" is an answer where a stack trace is not. The document and the erasure
receipt carry an `unreadable` list naming the fields, the codes and the key
ids. An erasure that could not read what it was writing over still happens
-- refusing would be the worst possible reading of the word -- and it is
written down.

## `henri encryption`

```bash
henri encryption          # what is encrypted, and the key ids held
henri encryption:status   # what the columns hold, counted by key id
henri encryption:rotate   # rewrite everything under the key that writes
```

All three boot the models and nothing above them: no port is bound and no
route is registered. `--json` on any of them prints the report for a script;
`--dry-run`, `--model` and `--field` narrow the rotation. The work itself is
`henri.encryption`, so an application can run the same walk from a job.

`encryption:status` opens nothing -- the key id is in the clear inside every
envelope -- so it answers even from a process that holds no key, and it
never says anything about the values.

## What this is not

Deliberately out of scope, with the reason:

- **Encrypting the whole database.** That is the storage layer's job, and
  every managed database does it. It protects against a stolen disk and
  against nothing else: the database itself reads every row. This protects
  against a dump, a backup and a read replica, which is where the copies
  actually go.
- **A KMS.** AWS KMS, Vault and the rest are the right answer for an
  organisation that has one, and the wrong dependency for a framework: they
  bring a network call into every read, an availability requirement, and a
  vendor. henri reads its key from the configuration; an application that
  has a KMS puts the key there from it at boot.
- **Searchable encryption beyond the deterministic option.** Blind indexes
  over a token or an n-gram would let you search inside a ciphertext, and
  they leak considerably more than an equality does. Deterministic
  encryption is the one point on that curve whose leak can be stated in one
  sentence, which is why it is the only one here.
- **Encrypting file uploads.** `@usehenri/uploads` writes bytes to a
  storage backend, and a storage backend has its own answer for encryption
  at rest. The _metadata_ an upload leaves in a model column -- the original
  filename -- is a normal column and can be marked `encrypted` like any
  other.
- **Binding a ciphertext to its row.** See
  [what the ciphertext looks like](#what-the-ciphertext-looks-like).

## Reference

| Key                        | Default | What it is                                                                           |
| -------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `encryption.keys`          |         | The key, or the keys with the one that writes first. 64 hexadecimal characters each. |
| `encryption.readPlaintext` | `false` | Whether a column declared encrypted may answer with a value that is not encrypted.   |

| On a field                           | What it does                                                         |
| ------------------------------------ | -------------------------------------------------------------------- |
| `encrypted: true`                    | Randomised. Not queryable, not indexable, no length ceiling.         |
| `encrypted: { deterministic: true }` | Equality and `unique` work; equal plaintexts have equal ciphertexts. |

| Method                             | What it answers                                    |
| ---------------------------------- | -------------------------------------------------- |
| `henri.encryption.keys`            | The key ids, primary first                         |
| `henri.encryption.describe()`      | The encrypted fields and the keys, as data         |
| `henri.encryption.status()`        | What the columns hold, by key id                   |
| `henri.encryption.rotate(options)` | Rewrites everything under the key that writes      |
| `henri.encryption.tolerate(fn)`    | Runs `fn` with unreadable values reading as `null` |
