---
title: Users
description: The user model, registration, login, the password reset, the email confirmation, sessions, CSRF, roles and what a browser may see.
sidebar:
  order: 5
---

Add a model named after the `user` configuration key (`user` by default, so `app/models/User.js`) and henri turns authentication on: the [model](/guides/models/#the-user-model) gets `email`, `password`, `roles`, `confirmedAt` and `passwordChangedAt`, the server gets a session, `POST /login`, `POST /logout` and a CSRF token. None of this loads without a user model; with one, the configuration must provide a `secret` (`HENRI_SECRET` in `.env`).

```js
// app/models/User.js
module.exports = {
  options: { timestamps: true },
  schema: {
    name: { type: 'string' },
  },
};
```

Registration, the password reset and the address confirmation are three more endpoints, mounted when `config.user` asks for them. The fastest way to all of it:

```bash
henri generate authentication
```

That writes the user model (when there is none), the pages, the controller rendering them, an overridable copy of the mail templates and a test suite, and turns the three blocks below on. The rest of this page is what it wired.

## The account flows

```json
{
  "user": {
    "model": "user",
    "signup": { "fields": ["name"] },
    "passwordReset": true,
    "confirmation": { "required": true }
  }
}
```

Each block is `true` for the defaults, `false` (or absent) to leave the endpoints unmounted, or an object of settings. The endpoints they mount:

| Endpoint                     | Block           | What it does                                         |
| ---------------------------- | --------------- | ---------------------------------------------------- |
| `POST /signup`               | `signup`        | Creates an account and opens a session               |
| `POST /password/forgot`      | `passwordReset` | Mails a reset link; says nothing about the address   |
| `GET /password/reset/:token` | `passwordReset` | Checks the link and moves the token into the session |
| `POST /password/reset`       | `passwordReset` | Changes the password and retires the other sessions  |
| `GET /confirm/:token`        | `confirmation`  | Confirms an address, or applies an address change    |
| `POST /confirm`              | `confirmation`  | Mails the confirmation again; says nothing either    |
| `POST /account/email`        | `confirmation`  | Asks to change the address of the signed-in account  |

Each one answers JSON to API clients and redirects browsers, the way `POST /login` does. They run ahead of your routes, so nothing in `config/routes.js` has to declare them; the pages the forms live on are yours.

Everything they do is also a method on `henri.accounts`, so a controller that wants to own the answers can call the same code instead of reimplementing it:

```js
const created = await henri.accounts.register(
  req.permit('email', 'password', 'name')
);

if (!created.ok) {
  return res.boom.badData('the account could not be created', {
    errors: created.errors,
  });
}
```

## Registration

`POST /signup` takes `email`, `password` and the attributes `config.user.signup.fields` lists. Nothing else is read: `roles`, `confirmedAt` and `passwordChangedAt` are never assignable, whatever a form sends, and the store hashes the password on the way in.

- API clients get `201` and `{ user }`, the public user.
- Browsers are redirected to `signup.after` (`/` by default), signed in.
- A refused signup answers `422` with `{ data: { errors } }`, or redirects a browser back to `signup.path` with the messages in the flash. They reach the next page as `errors`, keyed by field, and what was typed (minus the password) as `flash.values[0]`.

```json
{
  "signup": {
    "path": "/signup",
    "fields": ["name"],
    "after": "/",
    "login": true
  }
}
```

The password goes through the [policy](#passwords), the same one a reset applies. Read its minimum from `henri.accounts.policy().minLength` (or `henri.user.passwordPolicy`) rather than hard-coding a number, so a page and its tests follow the configuration.

Registration is the one flow that says whether an address is registered, because a signup form has to. The other two never do.

## The password reset

Three endpoints, and two pages of yours: the one asking for an address, and the one asking for a new password.

1. `POST /password/forgot` takes `email` and answers `202` with the same sentence whether or not the address has an account. henri writes that answer **before** it looks anything up: the lookup, the token and the mail happen afterwards, so nothing a client can time says whether the account exists either. Only a syntactically invalid address is refused, with `422`.
2. The mail carries `GET /password/reset/:token`. Following it checks the link, puts the token in the session and redirects to `<path>/reset` — so the token leaves the url on the first hop and cannot leak through a `Referer` or the browser history. The response carries `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. An expired or spent link redirects to `<path>/forgot` with a flash, or answers `400` to an API client.
3. `POST /password/reset` takes the new password (and the token, when the caller is not a browser holding the session). It changes the password, signs the account in, and **every other session of that account stops working** — which matters, because the usual reason someone resets a password is believing that somebody else has it.

```json
{
  "passwordReset": {
    "path": "/password",
    "expiresIn": "1h",
    "after": "/",
    "login": true
  }
}
```

## Email confirmation

`confirmation` gives a new account a link to prove it can read its address, and gives an existing one a way to change that address.

- Registering mails `GET /confirm/:token`; following it stamps `confirmedAt`. `POST /confirm` mails it again, with the same indistinguishable answer as a reset request.
- `POST /account/email` asks for a change: it takes the new address and, unless `requirePassword` is `false`, the current password. **Nothing is written.** A link goes to the new address, and the account keeps the address it has until that link is followed — an address nobody proved they can read never becomes the address of an account.
- `required: true` keeps an unconfirmed account out of a session: `POST /login` answers `403` with `{ data: { reason: 'unconfirmed' } }`, or redirects a browser to `<loginPath>?error=unconfirmed`.

```json
{
  "confirmation": {
    "path": "/confirm",
    "emailPath": "/account/email",
    "expiresIn": "3d",
    "after": "/",
    "required": false,
    "requirePassword": true
  }
}
```

Turning `required` on in an application that already has users locks them out until they confirm: `confirmedAt` is null on every row written before the column existed. Backfill it (`UPDATE users SET confirmed_at = now()`) before flipping the switch.

## The tokens

Nothing token-shaped is stored. A link carries a signed token holding three things, all covered by one HMAC over the application `secret`:

- its **purpose**, so a confirmation link can never be replayed as a password reset;
- its **expiry**, so an old link stops working on its own and nothing has to expire it;
- a **seed**, the fingerprint of the state the action is about to change: the password hash for a reset, the address and its confirmation date for a confirmation. Performing the action moves the seed, and every token minted against the old one stops verifying.

That is what makes a link single use, and what makes a successful reset invalidate the links that were still in flight. A database leak hands over no working link, because forging one needs the secret, which is in the environment or in the [encrypted credentials](/configuration/#credentials) rather than in the database.

The other side of that coin: **rotating `secret` invalidates every outstanding link**. Anyone who asked for a reset before the rotation has to ask again. Sessions go with it (they are signed with the same secret), so it is rarely a surprise, but it is worth knowing before rotating one in production.

## The mails

They come from the `auth` mailer, which ships with henri, so a fresh application can reset a password before anyone has written a template. Override as little or as much as you like:

- write `app/views/mailers/auth/reset.hbs` (and `reset.text.hbs`) to change one view;
- write `app/mailers/auth.js` to change the subjects, the sender or the data — an action you leave out keeps henri's;
- `henri generate authentication` writes both, which is the usual way in.

Each action receives the public user and the absolute url of the link. That url is built from `config.url` when there is one and from the running server's own address otherwise, which is right in development and wrong behind a proxy: production applications set `url`. The messages are previewable on `/_mailers` in development like any other mailer, and delivery goes through [`deliverLater()`](/guides/mail/), so the [job queue](/guides/jobs/) takes them when the application has one and an SMTP timeout never blocks a request.

## Passwords

New passwords are hashed with **argon2id** when `@node-rs/argon2` resolves (an optional dependency of `@usehenri/core`, installed with prebuilt binaries on every platform Node runs on) and with **bcrypt at cost 12** otherwise. Both are always accepted on the way in, so an application that has been storing bcrypt hashes keeps working, and a hash below the current parameters is written again the next time its owner signs in — the way an application leaves an old algorithm behind without a migration and without asking anyone to reset anything.

`henri.user.encrypt()` refuses a password the policy does not accept, and the error surfaces as a rejected `create()`. The policy governs _setting_ a password; signing in never applies it, so raising the minimum never locks out the people already there.

`henri.user.validatePassword()` is the same rule without the hashing, for a form that has to say what is wrong:

```js
const { valid, errors } = henri.user.validatePassword(data.password);

if (!valid) {
  // [{ code: 'too_short', message: 'must be at least 12 characters', minLength: 12 }]
  return res.status(422).json({ errors: { password: errors[0].message } });
}
```

`code` is stable: `missing`, `too_short` or `too_long`. `henri.user.passwordPolicy` is `{ minLength, maxBytes, algorithm, ... }`, so a page can show the rule before anyone submits.

### The policy

| Key            | Default |                                                                                                             |
| -------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `minLength`    | `12`    | Shortest password accepted. Never below `8`, whatever the configuration says.                               |
| `maxBytes`     | `72`    | Longest, in bytes. bcrypt silently ignores everything past 72 bytes, so henri refuses the password instead. |
| `algorithm`    | `auto`  | `auto` (argon2id when available, bcrypt otherwise), `argon2id` (fails the boot when it is not) or `bcrypt`. |
| `bcryptRounds` | `12`    | bcrypt work factor. Never below `10`.                                                                       |
| `memoryCost`   | `19456` | argon2id memory, in kibibytes (19 MiB), the OWASP first recommendation.                                     |
| `timeCost`     | `2`     | argon2id iterations.                                                                                        |
| `parallelism`  | `1`     | argon2id lanes.                                                                                             |

```json
{
  "user": {
    "model": "user",
    "password": { "minLength": 16 }
  }
}
```

### The pepper

A pepper is a key mixed into every hash that lives outside the database, so a stolen table cannot be cracked offline and a hash cannot be forged for a password of the attacker's choosing. It is off by default. Turn it on with `HENRI_PASSWORD_PEPPER` in `.env`, or `config.user.password.pepper`:

```json
{
  "user": {
    "password": {
      "pepper": {
        "current": "...",
        "previous": ["the key it replaced"],
        "allowUnpeppered": true
      }
    }
  }
}
```

Three things to understand before turning it on:

- **It is its own key, never `config.secret`.** Rotating the session secret invalidates sessions and signed links, which applications do; it must never make a password unverifiable.
- **Losing it loses every peppered password.** There is no recovery: the only way back is a password reset for everyone. Store it the way you store a database credential, and keep it out of the repository.
- **It arrives gradually.** Hashes written before it existed keep verifying and are rewritten under the key as their owners sign in. `previous` does the same for a rotation. Once no unpeppered hashes are left, set `allowUnpeppered: false` — until then, someone who can write to the table can still plant an unpeppered hash of a password they know.

What a pepper does not do: the key is global, not per row, so someone who can write to the table can still copy a valid hash from one account onto another and sign in with the password they already knew. Binding a hash to the row it belongs to is a different defence, and henri does not have it yet.

### Sign-in lockout

Nothing caps how many attempts one _account_ receives: the [rate limit](/guides/api/#rate-limiting) counts per address, so an attempt spread across many addresses against one account is unbounded. After `config.user.lockout.max` failures (10) inside `windowMs` (15 minutes) the account refuses sign-in attempts for the rest of the window, whoever is asking and whatever password they send — the check runs before the password is hashed, so a locked account costs nothing.

Failures are counted for whatever email was submitted, real or not, so `429 Too many failed sign-in attempts` is not an account-enumeration oracle: an address nobody owns answers the same way. Browsers are sent to `<loginPath>?error=locked`. A successful sign-in clears the count.

```json
{
  "user": {
    "lockout": { "max": 10, "windowMs": 900000 }
  }
}
```

`"lockout": false` turns it off. The counter is in memory, so it is per process and clears on restart, like the rate limiter. It uses whatever `config.rateLimit.store` uses, so an application that already plugged a shared store (Redis, for instance) gets a lockout that holds across processes without saying so twice; `lockout.store` names a different one.

## Login and logout

`POST /login` takes `email` and `password`, as JSON or as a form. The email is trimmed and lowercased before the lookup.

- API clients (anything accepting JSON or `*/*`) get `{ user }` back, the public user. On failure: `401` with `{ statusCode, error, message }`, or `400` when a field is missing.
- Browsers asking for HTML are redirected to `config.user.afterLogin` (`/` by default); on failure to `<loginPath>?error=invalid` (`/login?error=invalid` by default).

With `config.user.confirmation.required`, an account whose address is not confirmed is refused here even with the right password: `403` and `{ data: { reason: 'unconfirmed' } }`, or a redirect to `<loginPath>?error=unconfirmed`. The lockout counter is cleared first, so trying a correct password while unconfirmed cannot lock an account out.

`POST /logout` destroys the session and answers `{ ok: true }`, or redirects browsers to `/`. `GET /logout` is deprecated and answers `405`.

Both are mounted before your routes, on every renderer. henri ships no login page: write one at `loginPath` (`app/views/pages/login.js` with the React renderer) that posts to `/login`, or let `henri generate authentication` write it. A plain HTML form works because a browser that has no session yet needs no CSRF token; from React, `fetch({ route: '/login', method: 'post' }, { email, password })` followed by `hydrate()` does the same without leaving the page.

In a controller, `req.user` is the user instance (without its password) and `req.isAuthenticated()` tells whether someone is logged in. Views get the public user, see below.

## Sessions

The session cookie, `henri.sid`, is `httpOnly`, `SameSite=Lax`, `Secure` in production, lives 30 days (`config.user.sessionMaxAge`, in milliseconds) and is only written once something is stored in it. Sessions are kept in the database of the user model's store and survive model reloads.

The session remembers when it was opened. A password reset stamps `passwordChangedAt` on the account, and every session older than that stamp stops resolving to a user on its next request — that is how a reset signs the other devices out, with no scan of the session store and no extra read per request. An application that changes a password itself should do the same:

```js
await user.update({ password, passwordChangedAt: new Date() });
```

## CSRF

Once a user model exists, every response carries a `henri.csrf` cookie (readable by scripts, `SameSite=Lax`). `POST`, `PUT`, `PATCH` and `DELETE` requests that send the session cookie must send that token back in the `X-CSRF-Token` header (`X-XSRF-TOKEN` is accepted as an alias) or a `_csrf` field, otherwise they get a `403` (`Invalid CSRF token`). Requests without a session cookie and requests authenticated with a bearer token are exempt.

The token reaches the views as `csrf`: the React `fetch()` and `hydrate()` helpers and the Inertia `fetch()` helper add the header for you, the Inertia `Form` adds the `_csrf` field, and Inertia's own visits echo the `XSRF-TOKEN` cookie its engine sets; add `<input type="hidden" name="_csrf" value="{{@csrf}}">` to a Handlebars form. Set `"csrf": false` in the configuration to turn the check off.

### Where the request came from

The token alone does not survive everything: a sibling subdomain, or anything else that can write a cookie on the parent domain, can plant a token it knows and submit it. So the same requests — unsafe method, session cookie, no bearer token — must also come from somewhere the application recognizes, which browsers state in `Sec-Fetch-Site` and `Origin`:

- `Sec-Fetch-Site: same-origin`, or `none` (typed, bookmarked, launched): allowed.
- `same-site` or `cross-site`: the `Origin` must be this application's own origin or one you listed. `evil.example.com` posting to `app.example.com` is refused with `403 Cross-origin request refused`, valid token or not.
- No fetch metadata at all (an older browser, a script): an `Origin` that does not match is refused; no `Origin` falls through to the token, which is what it always did.

The origin compared against is what the browser saw: behind a reverse proxy it comes from `X-Forwarded-Host` and `X-Forwarded-Proto` when `config.trustProxy` allows it, not from the internal `Host` the proxy rewrote.

Nothing here applies to a request that sends no session cookie, so a cross-origin API client keeps working untouched. A client that _does_ send credentials cross-origin needs its origin trusted; whatever `config.cors.origin` already allows is trusted for you:

```json
{
  "csrf": {
    "origin": true,
    "trustedOrigins": ["https://admin.example.com"]
  }
}
```

`"csrf": { "origin": false }` keeps the token check without this one.

## Roles

Give a route an array of `roles` and only logged-in users owning every one of them reach it; see [Routes](/guides/routes/#roles). A new user gets `config.baseRole`; change roles with `user.setRoles()` or `User.setRoles(id, roles)`, never through a form (mass assignment drops `roles`).

The `paths` sent to the views are filtered by the roles of the current user, so a page can show a link only when the user may follow it:

```jsx
const { paths, pathFor } = useHenri();

{
  paths.admin_users_path && (
    <Link href={pathFor('admin_users_path')}>Admin</Link>
  );
}
```

## What leaves the server

Only the public representation of a user reaches views, `req._henri.user` and JSON answers: `{ externalId, email, roles }` plus the fields listed in `config.user.public`. `henri.user.publicUser(user)` builds that object; use it whenever you send a user to a browser yourself. The identifier is the user's public one; the primary key stays on the server, like every record's (see [Identifiers](/guides/models/#identifiers)). A user model that opted out of it answers with `id` instead.

```json
{
  "user": {
    "model": "user",
    "public": ["name", "avatar"],
    "loginPath": "/login",
    "afterLogin": "/",
    "sessionMaxAge": 2592000000
  }
}
```

## Bearer tokens

A passport `jwt` strategy is registered on `henri.passport` with the application secret (it reads `Authorization: Bearer <token>` and loads the user from the `id`, `_id` or `sub` claim), but core applies it to no route and issues no token. To accept tokens on a route, add the strategy yourself with `henri.addMiddleware()` or in the controller: `henri.passport.authenticate('jwt', { session: false })`.
