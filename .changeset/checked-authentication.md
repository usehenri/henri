---
'@usehenri/core': minor
---

The user module and the account flows check what they are called with.

They were the two interfaces the previous pass left out of `base/arguments.js` on purpose, because everything they do sits on an authentication path, where a refusal that says too much becomes an account-enumeration oracle. Both come off that list now, and the line is drawn by **whose mistake it is**: a value the caller chose is a coded refusal, a value a visitor sent keeps the answer it always had.

**`henri.user.compare()` never resolves `false`, and its failures are told apart by their code and by nothing else** — the message a mismatch carries is the one word it always was, so handing it to a client says exactly what it said before:

- `HENRI_USER_PASSWORD_MISMATCH` is a wrong password **and** no account at all (`null`), which cost the same: an address nobody has is now checked against a hash bound to a uuid no row has, the way `POST /login` already checks an unknown address, so your own sign-in endpoint cannot be timed to find out which addresses are registered.
- `HENRI_USER_PASSWORD_UNVERIFIABLE` is a record carrying no hash to check against. `findById()`, `req.user` and a deserialized session all deselect the password column, so passing one of those answered "invalid credentials" to the right password, for ever.
- `HENRI_ARGUMENT_INVALID` is a second argument that is not a user.

**Eight more were answering something plausible rather than refusing**, and each of these is what somebody eventually debugs:

- `henri.user.publicUser(42)` answered a user-shaped object carrying an identifier that named no row — and that object goes to a view and to a JSON body.
- `henri.user.encrypt(password, { identiy: user })` hashed happily and wrote an **unbound** hash: the whole of `config.user.password.binding` gone, with nothing said anywhere. The near miss is now named.
- `henri.accounts.urlFor(42)` built `https://example.com42` and mailed it.
- `henri.accounts.tokenFor(user, 'reset')` — the _key_ of `PURPOSE`, not its value — minted a link that was given the confirmation seed and that nothing henri mounts could ever spend: a link generated successfully that will always fail.
- `henri.accounts.register(null)` threw a `TypeError` one frame down.
- `henri.accounts.sendReset(42)`, `sendConfirmation(42)` and `requestPasswordReset(42)` each did nothing at all, quietly, and answered as if they had.
- `henri.accounts.requestEmailChange(42, address)` answered `{ email: 'could not be changed' }`, blaming the address for a wrong user.
- `henri.accounts.allowed(undefined)` — a gate — answered **yes** about nobody, because the branch that says "confirmation is off" answers before it looks at the record.

**A user with no identifier is nobody, not the string `"undefined"`.** The three adapters answer `userId()` with `String(user._id || user.id)`, so a record carrying no key came back as a truthy nine-letter string that every guard written against it let through: `serializeUser()`'s `if (!id)`, `accounts.identify()`'s `null`, and the `id` of the public user. It then named a session, the subject of a signed token and the user a view was handed. The adapter facade reads it back as nobody now, whichever half answered.

**What a visitor sent is not checked, and that is the point.** `resetPassword(token, password)` and `confirm(token)` take whatever followed the link and answer `reason: 'malformed'` or `reason: 'password'`, which is what an expired, a spent and a forged link all answer; `requestEmailChange`'s address answers `{ errors: { email } }`, because it has a form to put the message on; `validatePassword()` stays a verdict and never a throw; and `findByEmail()` / `findById()` still answer the `null` an unknown address answers, for every value that names nobody. `requestPasswordReset(email)` and `requestConfirmation(email)` are the pair in between — they answer `Promise<void>`, so they have nowhere to say "that is not an address" and refuse anything that is not a string, behind an endpoint that already answers `422` for one, with the same loose test the store validates the column with and never a stricter one.

The reasoning is per method, in the headers of `4.user.js`, `base/accounts.js` and `base/arguments.js`. `src/__tests__/arguments.spec.js` also reads a wrapped declaration properly now: it took the first line of one alone, so every signature written across several lines looked like it took no arguments and was exempt from the whole file.
