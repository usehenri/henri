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

`henri.user.encrypt()` refuses passwords shorter than 6 characters; the error surfaces as a rejected `create()`.

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
