---
title: Personal data
description: Mark a field as personal in the model, and let henri redact it, keep it off the wire, export it and erase it.
---

An application knows which of its columns are about a person. Nothing else
does: not the logger, not the serializer, not the person who has to answer
an access request three years from now. henri already filters parameters by
name in the logs (`config.filterParameters`); this is the same idea moved to
where it belongs, the schema.

```js
// app/models/User.js
module.exports = {
  schema: {
    name: { personal: true, type: 'string' },
    bio: { personal: true, type: 'text' },
    phone: { personal: { expose: false }, type: 'string' },
  },
};
```

That is the whole mark. Four things follow from it:

| What        | Where                                                                    |
| ----------- | ------------------------------------------------------------------------ |
| Redaction   | Every log line and every recorded error masks the field, by name         |
| What leaves | `expose: false` drops it from every answer henri builds                  |
| Export      | `henri privacy:export <who>` hands the person everything held about them |
| Erasure     | `henri privacy:erase <who>` removes them, and leaves a receipt           |

`henri privacy` prints the map, the way `henri routes` prints the routes:

```
The person is User

Proposal (speakerId -> User)
  (records)            onErase: anonymize

Review (reviewerId -> User)
  comment              erase: anonymize
  (records)            onErase: anonymize

User (the person)
  bio                  erase: clear
  email                erase: anonymize
  name                 erase: anonymize
  password             erase: anonymize, never leaves the server, not exported
  phone                erase: clear, never leaves the server

Masked in the logs: bio, comment, email, name, password, phone
Never in an answer: password, phone
```

## The mark

`personal: true` is the short form. The object form says more about one
field:

| Key      | Default                                                   | What it does                                             |
| -------- | --------------------------------------------------------- | -------------------------------------------------------- |
| `expose` | `config.privacy.expose` (`true`)                          | `false` keeps the field out of every answer henri builds |
| `export` | `true`                                                    | `false` leaves it out of the export                      |
| `erase`  | `clear`, or `anonymize` where the column cannot hold null | What an erasure writes over the value                    |

`erase` is one of:

- `clear` — the value becomes `null`. Refused, before anything is written,
  on a column that is `required` or `unique`.
- `anonymize` — a meaningless value of the right shape: an email stays an
  email (`erased-<token>@erased.invalid`), a unique column stays unique, and
  a `minLength`, a `maxLength` and a `match` are all honoured, because an
  erasure a model's own validation refuses is an erasure that did not happen.
- `retain` — the value stays. For the field a law requires you to keep; it is
  named in the receipt, so the omission is a decision and not a leak.

The user model is marked for you: `email` is personal and exposed (it is what
`publicUser()` sends), `password` is personal, never exported and never
exposed.

## What the mark does to the logs

Every personal field name is masked in what `pen` prints, in the recorded log
of `henri mcp`, and in the request bodies of the recorded errors:

```
user ✏ signing in => { email: '[FILTERED]', ip: '127.0.0.1' }
```

The filters of `config.filterParameters` are substrings (`password` catches
`password_confirmation`, like Rails); a personal field is matched **exactly**,
because a `name` column marked personal has no business filtering `filename`
or `modelName`.

The mark is a name, and a name is global: mark `title` personal on one model
and every `title` is masked everywhere, in every log line of every model.
Mark the field that is personal, not the column name half your models share.

## What the mark does to what leaves the server

**Marking a field personal does not change what your application sends.**
`email` is personal and every page greets people by it; dropping it by
default would break every application there is. The rule is one sentence:

> A personal field leaves the server as it always did, unless it says
> `expose: false`, and then it never leaves at all.

`expose: false` is absolute and it applies by name, everywhere: `res.render()`,
`res.resource()`, `res.collection()`, the public user of every page, at every
depth of the payload, whether the value came from a model instance, a `.lean()`
query or an object a presenter built. The one way back is to ask for it:

```js
// app/controllers/accounts.js -- the person's own page, and only this one
return res.render('/account', {
  data: { account: { name: req.user.name, phone: req.user.phone } },
  include: ['phone'],
});
```

`res.resource(record, { include: ['phone'] })` and
`res.collection(records, { include: ['phone'] })` take the same option.

`config.privacy.expose: false` flips the default the other way: every personal
field is then private unless it says `personal: { expose: true }`. It is one
line, and it is the strict reading of the same rule.

## Which model is a person

The user model (`config.user.model`). henri's notion of a person is the one it
already authenticates, and `henri privacy:export ada@example.com` finds them by
email address, by `externalId` or by primary key.

Every other model reaches the person through a column, which henri infers from
what the model already declares:

- `references: { model: 'User' }` on the SQL adapters,
- `ref: 'User'` on Mongoose,
- a `belongsTo(models.User, { foreignKey })` association.

When there is nothing to infer from, the model says it:

```js
options: {
  personal: {
    // The column that points at the person
    subject: 'ownerId',
    // ... or a column matched against a field of the person
    // subject: { field: 'email', matches: 'email' },
    // ... or nothing: these records are about nobody in particular
    // subject: false,
  },
},
```

The link is one hop. A review of a proposal is the _reviewer's_ record, not
the speaker's: erasing the speaker anonymizes the proposal, and the reviews
of that proposal are left alone, because they are about a talk and about
another person.

A model that holds no personal field but points at the person is still in the
map: a proposal with nothing marked is still the speaker's, and it belongs in
their export. `options: { personal: { export: false } }` leaves a model out.

## Export

```bash
henri privacy:export ada@example.com                 # readable, on stdout
henri privacy:export ada@example.com --json          # the document
henri privacy:export ada@example.com --out ada.json  # and to a file
```

The document holds the person's own record and every record of every model
linked to them, soft-deleted rows included, with the fields marked
`personal: { export: false }` and the password left out. The primary key
stays on the server; the `externalId` is what identifies a record.

An application that wants a page rather than a command calls the same thing:

```js
const document = await henri.privacy.export(req.user);
```

## Erasure

```bash
henri privacy:erase ada@example.com --dry-run   # the plan, and nothing else
henri privacy:erase ada@example.com             # asks first
henri privacy:erase ada@example.com --yes       # in a script
```

Three questions have to be answered before an erasure means anything, and
henri answers them the same way every time.

### A soft-deleted row is erased, and a soft delete is never an erasure

`options: { paranoid: true }` keeps a row _so that it can be brought back_.
`deletedAt` is a hidden row, not a removed one, and a restore would bring the
personal data back with it. So the walk reaches the stamped rows too, and
where the strategy is `delete` the row is deleted for real.

### The records that reference the person survive; the person is anonymized

The default is `anonymize`: the person's row stays, every personal field on
it is erased, and every record pointing at it keeps pointing at it — at a row
that no longer describes anybody.

The alternative would be to delete the person's row, and then every reference
has to go somewhere: cascade (the conference loses the programme it ran, which
is its own record and not only the speaker's), null the key (impossible where
the column is `required`, which is most of them), or leave a dangling key (a
database that lies). Anonymizing keeps every foreign key valid and every count
true, and removes exactly what the erasure was about.

A model says otherwise for its own records:

```js
options: { personal: { onErase: 'delete' } },
```

| Strategy    | What happens to those records                                           |
| ----------- | ----------------------------------------------------------------------- |
| `anonymize` | The rows stay, their personal fields are erased (the default)           |
| `delete`    | The rows are deleted, soft-delete stamp or not                          |
| `orphan`    | The link to the person is set to `null`, the personal fields are erased |
| `retain`    | The rows are left alone, and the receipt says so                        |

`config.privacy.onErase` changes the default for the models that do not say,
and so does `--strategy` for one run. A model that decided keeps its answer.

The plan is checked before the first write: a `clear` on a column that cannot
hold null, an `orphan` on a `required` link, or a `delete` of a person whose
records another model keeps are all refused
(`HENRI_PRIVACY_ERASE_REFUSED`), with nothing written.

An erasure is not one transaction, and the order is deliberate: the records
that point at the person go first, the person goes last. A failure therefore
leaves the person findable, and the command can be run again.

### The receipt is what proves it happened

Every erasure writes one:

```json
{
  "version": 1,
  "id": "7144c18b-66be-45b0-98ff-e807afd39988",
  "at": "2026-02-11T09:14:22.104Z",
  "application": "lineup",
  "digest": "hmac-sha256",
  "subject": {
    "model": "User",
    "externalId": "0961260a-e1f1-4aed-9e6b-d2854628dbfb",
    "digest": "f5a0cf490628512d3b3dd1edc2ac78c0..."
  },
  "records": [
    {
      "model": "Review",
      "action": "anonymize",
      "count": 17,
      "written": 17,
      "fields": ["comment"],
      "ids": ["..."]
    },
    {
      "model": "User",
      "action": "anonymize",
      "count": 1,
      "written": 1,
      "fields": ["bio", "email", "name", "password", "phone"],
      "ids": ["..."]
    }
  ],
  "unlinked": []
}
```

It cannot hold the address that was erased — that is the thing being removed
— so it holds an HMAC-SHA256 of it, keyed with `config.secret`. Whoever has
to answer "was this person erased" recomputes the digest from the address
they were asked about and looks for it; the receipts alone give nobody their
address back.

They are written to `config.privacy.receipts` (`privacy/` by default),
one file per erasure. `false` writes none and leaves you with what the
command printed.

The account that was anonymized cannot be signed into again: its password
becomes 32 bytes nobody holds, and `passwordChangedAt` is stamped, which is
what refuses the sessions that were open at the time.

## Configuration

```json
{
  "privacy": {
    "expose": true,
    "onErase": "anonymize",
    "receipts": "privacy"
  }
}
```

| Key        | Default       | What it does                                                       |
| ---------- | ------------- | ------------------------------------------------------------------ |
| `expose`   | `true`        | `false` keeps every personal field out of the answers henri builds |
| `onErase`  | `"anonymize"` | The strategy for the models that do not declare one                |
| `receipts` | `"privacy"`   | Where an erasure writes its proof; `false` writes none             |

## From the application

`henri.privacy` is the same thing the command line drives, so a "download my
data" button and a "delete my account" button are a few lines:

```js
// app/controllers/accounts.js
module.exports = {
  data: async (req, res) => res.json(await henri.privacy.export(req.user)),

  destroy: async (req, res) => {
    const receipt = await henri.privacy.erase(req.user);

    req.logout(() => res.redirect('/'));

    return receipt;
  },
};
```

It also answers what the map holds: `henri.privacy.keys` (every personal field
name), `henri.privacy.private` (the ones that never leave), `henri.privacy.fields('User')`,
`henri.privacy.describe()` and `henri.privacy.plan(who)`.

## What henri audit says about it

`privacy.unmarked` (ASVS V8.3.4) reports a field that is plainly about a
person and carries no mark: `lastName`, `phoneNumber`, `dateOfBirth`, `ssn`
and their like on any model, and `name`, `address`, `phone`, `gender` and the
rest on the model that _is_ a person. It reads the model files, so a field
built at runtime is not looked at.

## What follows from the mark

Two features are built on the same map and have guides of their own:

- **[Retention](/guides/retention/)** -- how long a model keeps its records,
  and the sweep that deletes, hides or anonymizes them when the time is up.
  It is the erasure nobody asked for, on a schedule.
- **[The access trail](/guides/trail/)** -- the append-only, hash-chained
  record of who read or changed personal data. It is what answers "prove the
  erasure happened" three years from now.

## What this is not

- It is not encryption. The values are stored the way they always were; a
  `personal` field is not encrypted at rest.
- It is not a legal opinion. The strategies are the choices a framework can
  make; which of them your obligations allow is yours.
- It marks columns, not the values inside them. A JSON column that holds a
  person's address is one field to mark, and it is erased whole.
- The link between a model and a person is one hop, and it is a column. A
  record that reaches a person through two joins is not in their export
  unless the model says which column to follow.
