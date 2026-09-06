---
'@usehenri/core': minor
'@usehenri/mongoose': minor
---

Raise the security floor: argon2id hashing, a password policy, a per-account sign-in lockout, an origin check on CSRF, and bounds on the GraphQL endpoint.

**Passwords.** New hashes use argon2id when `@node-rs/argon2` resolves — a new `optionalDependency` of `@usehenri/core`, so the install picks up a prebuilt binary where one exists and skips it silently where none does — and bcrypt at cost 12 (was 10) otherwise. Both formats always verify, and a hash below the current parameters is written again the next time its owner signs in successfully, which is how an application changes algorithm without a migration. `config.user.password` configures the algorithm and its parameters, and takes an optional `pepper`: a server-side key, its own rather than `config.secret`, that makes a stolen table useless offline. Losing the pepper makes every peppered password unverifiable.

**The minimum password length moves from 6 to 12**, configurable as `config.user.password.minLength` with a floor of 8, plus a 72 byte maximum so bcrypt never silently truncates. The policy governs setting a password and is never applied when verifying one, so nobody already registered is locked out. `henri.user.validatePassword(password)` answers `{ valid, errors: [{ code, message }] }` without throwing, for a form that has to say what is wrong.

**Per-account lockout.** Ten failed sign-in attempts against one account inside fifteen minutes and it refuses attempts for the rest of the window, whoever is sending them — the rate limiter only ever counted per address. Failures are counted for unknown emails too, so the `429` is not an account-enumeration oracle. `config.user.lockout` retunes or disables it, and takes a shared express-rate-limit store.

**CSRF checks the origin too.** On top of the double-submit token, an unsafe request carrying a session cookie must come from an origin the application recognizes (`Sec-Fetch-Site`, then `Origin`), which is what closes the sibling-subdomain and cookie-injection cases the token alone does not. Requests without a session cookie, and bearer-token requests, are untouched. `config.csrf` takes `{ origin, trustedOrigins }` and inherits whatever `config.cors` already allows.

**GraphQL.** `/_henri/gql` refuses queries past a depth (10), alias (15), complexity (1000 fields, fragments expanded) or token (5000) limit, before a resolver runs, and stops resolving when the client disconnects or the request times out. `config.graphql` is now an object as well as a path, adding `authenticated`, `roles`, `loopbackOnly` and `introspection`: the endpoint had no guard of its own.

`@usehenri/mongoose` gains `save({ passwordsHashed: true })`, which writes a hash straight through the way the sequelize and drizzle adapters already did; core uses it to upgrade a stored hash after a successful sign-in.
