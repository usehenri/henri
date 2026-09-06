---
'@usehenri/core': minor
'@usehenri/drizzle': minor
'@usehenri/mongoose': minor
'@usehenri/sequelize': minor
---

Bind every password hash to the row it belongs to, so a hash copied onto another row stops verifying.

A hash is a value, and a value can be moved. Someone who can **write** your database but does not have the pepper cannot forge a hash, so they do the next best thing: they take a hash whose password they know — their own account's — and copy it onto somebody else's row, or onto a row they invented. The pepper never saw this coming, because the key is global: the same key recomputes the same hash wherever the bytes land. The pepper answers "you cannot make a hash"; this answers "you cannot move one".

New hashes fold the record's `externalId` (the uuid v7 every record already carries) into what is hashed, keyed by the pepper, and are stored in the same column behind a `$henri-bound$v=1$` marker. No schema change, no migration, and no extra cost per sign-in: the marker says which of the two preimages to build, so verification hashes exactly once. `@node-rs/argon2` has no `associatedData`, and its `secret` is spoken for by the pepper, so the identity goes into a keyed pre-hash — the shape the pepper already used to give bcrypt a key it does not have.

**Upgrading.** Nothing to do, and nobody is locked out. Every hash you have is unbound and keeps verifying; each is written back bound the next time its owner signs in successfully, the same way a bcrypt hash becomes argon2id. The curve of "how many are bound" is the curve of "who has signed in since the upgrade", so it never finishes on its own: an account that never signs in again stays unbound forever. `config.user.password.binding.allowUnbound: false` ends the migration by refusing whatever is left — count before you set it, `SELECT count(*) FROM users WHERE password NOT LIKE '$henri-bound$%'`.

**Set a pepper.** Without `HENRI_PASSWORD_PEPPER` the binding is unkeyed: it still stops a hash being copied, but someone who can write rows can recompute a bound one for the row they are targeting. And be clear about the residual even with a pepper: an attacker who can write anything can also write `external_id`. Freeing the value they need means damaging the row it came from, because the column is unique, so they cannot silently clone their own account — but this is a defence against relocating a hash, not against a writable database.

**Two API changes.** `henri.user.compare()` now wants the user rather than its hash (`henri.user.compare(password, user)`), because a bound hash cannot be checked without the record it belongs to; handing it a bound hash alone rejects with an error that says so instead of answering "invalid credentials" to a password that is right. And a **mass password write that matches more than one row is refused** with a validation error on `password`: one hash belongs to one record, and writing an unbound one instead would quietly reopen the door. `User.create()`, `user.save()`, `user.update()`, `User.findByIdAndUpdate()`, `User.bulkCreate()`, `insertMany()` and a `Model.update()` whose condition matches one row are all unaffected.

`config.user.password.binding` is `true` (the default), `false`, or `{ enabled, allowUnbound }`. A user model that opted out of `externalId` cannot bind, keeps writing exactly the hashes it wrote before, and henri says so at boot.

**`@usehenri/mongoose` fixes two holes this work uncovered.** `Model.insertMany()` runs no document middleware, so it was writing the password it was given **to the collection in the clear** and keeping whatever `roles` came with it — `insertMany([{ email, password, roles: ['admin'] }])` created an admin with a plaintext password. It now hashes and resets roles like every other create. `Model.bulkWrite()` runs no middleware either and would have done the same; a password written that way is now refused rather than stored in the clear.

**`@usehenri/sequelize`** now honours `passwordsHashed` in `bulkCreate` and in the mass update as it already did on `create` and `save`: `bulkCreate(rows, { passwordsHashed: true })` and `User.update({ password: hash }, { passwordsHashed: true, where })` used to hash the hashes, leaving accounts nobody could sign in to.
