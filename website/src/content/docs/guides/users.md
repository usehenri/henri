---
title: Users
description: The user model, login and logout, sessions, CSRF, roles and what a browser may see.
sidebar:
  order: 5
---

Add a model named after the `user` configuration key (`user` by default, so `app/models/User.js`) and henri turns authentication on: the [model](/guides/models/#the-user-model) gets `email`, `password` and `roles`, the server gets a session, `POST /login`, `POST /logout` and a CSRF token. None of this loads without a user model; with one, the configuration must provide a `secret` (`HENRI_SECRET` in `.env`).

```js
// app/models/User.js
module.exports = {
  options: { timestamps: true },
  schema: {
    name: { type: 'string' },
  },
};
```

## Registering a user

There is no registration endpoint: create the user from a controller. `req.permit()` keeps `roles` (or anything else) out of the record, the adapter hashes the password, and `publicUser()` is what may go back to the browser.

```js
// app/controllers/users.js
module.exports = {
  create: async (req, res) => {
    const data = req.permit('email', 'password', 'name');

    if (!data.email || !data.password) {
      return res.boom.badRequest('email and password are required');
    }

    if (await henri.user.findByEmail(data.email)) {
      return res.boom.conflict('this email is already registered');
    }

    const user = await User.create(data);

    return res.status(201).json({ user: henri.user.publicUser(user) });
  },
};
```

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

A pepper is a key mixed into every hash that lives outside the database, so a stolen table cannot be cracked offline and someone who can write to it cannot forge a hash for a row. It is off by default. Turn it on with `HENRI_PASSWORD_PEPPER` in `.env`, or `config.user.password.pepper`:

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

`"lockout": false` turns it off. The counter is in memory, so it is per process and clears on restart, like the rate limiter; `store` takes any express-rate-limit store (Redis, for instance) and is what makes it hold across processes.

## Login and logout

`POST /login` takes `email` and `password`, as JSON or as a form. The email is trimmed and lowercased before the lookup.

- API clients (anything accepting JSON or `*/*`) get `{ user }` back, the public user. On failure: `401` with `{ statusCode, error, message }`, or `400` when a field is missing.
- Browsers asking for HTML are redirected to `config.user.afterLogin` (`/` by default); on failure to `<loginPath>?error=invalid` (`/login?error=invalid` by default).

`POST /logout` destroys the session and answers `{ ok: true }`, or redirects browsers to `/`. `GET /logout` is deprecated and answers `405`.

Both are mounted before your routes, on every renderer. henri ships no login page: write one at `loginPath` (`app/views/pages/login.js` with the React renderer) that posts to `/login`. A plain HTML form works because a browser that has no session yet needs no CSRF token; from React, `fetch({ route: '/login', method: 'post' }, { email, password })` followed by `hydrate()` does the same without leaving the page.

In a controller, `req.user` is the user instance (without its password) and `req.isAuthenticated()` tells whether someone is logged in. Views get the public user, see below.

## Sessions

The session cookie, `henri.sid`, is `httpOnly`, `SameSite=Lax`, `Secure` in production, lives 30 days (`config.user.sessionMaxAge`, in milliseconds) and is only written once something is stored in it. Sessions are kept in the database of the user model's store and survive model reloads.

## CSRF

Once a user model exists, every response carries a `henri.csrf` cookie (readable by scripts, `SameSite=Lax`). `POST`, `PUT`, `PATCH` and `DELETE` requests that send the session cookie must send that token back in the `X-CSRF-Token` header (`X-XSRF-TOKEN` is accepted as an alias) or a `_csrf` field, otherwise they get a `403` (`Invalid CSRF token`). Requests without a session cookie and requests authenticated with a bearer token are exempt.

The token reaches the views as `csrf`: the React `fetch()` and `hydrate()` helpers and the Inertia `fetch()` helper add the header for you, the Inertia `Form` adds the `_csrf` field, and Inertia's own visits echo the `XSRF-TOKEN` cookie its engine sets; add `<input type="hidden" name="_csrf" value="{{@csrf}}">` to a Handlebars form. Set `"csrf": false` in the configuration to turn the check off.

### Where the request came from

The token alone does not survive everything: a sibling subdomain, or anything else that can write a cookie on the parent domain, can plant a token it knows and submit it. So the same requests — unsafe method, session cookie, no bearer token — must also come from somewhere the application recognizes, which browsers state in `Sec-Fetch-Site` and `Origin`:

- `Sec-Fetch-Site: same-origin`, or `none` (typed, bookmarked, launched): allowed.
- `same-site` or `cross-site`: the `Origin` must be this application's own origin or one you listed. `evil.example.com` posting to `app.example.com` is refused with `403 Cross-origin request refused`, valid token or not.
- No fetch metadata at all (an older browser, a script): an `Origin` that does not match is refused; no `Origin` falls through to the token, which is what it always did.

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
