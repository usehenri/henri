---
'@usehenri/core': minor
'@usehenri/react': patch
---

Login, sessions and request parameters are hardened and work on every adapter.

- User lookups go through the adapter contract (`findUserByEmail`, `findUserById`, `userId`, `toPlain`, with Mongoose/Sequelize fallbacks in core), so login on SQL stores checks the right user and sessions hold the right id. `henri.user.findByEmail()`, `findById()` and `publicUser()` are exposed to apps.
- Only the public representation of a user (`{ id, email, roles }` plus `config.user.public`) reaches views, `req._henri.user` and JSON answers. `config.user` accepts an object: `{ model, public, loginPath, afterLogin, sessionMaxAge }`.
- `req.permit(...fields)` and `henri.params(req).permit()` return the permitted fields only; use them instead of `req.body` when creating or updating records.
- The session cookie is `httpOnly`, `SameSite=Lax`, `Secure` in production, lives 30 days by default (`config.user.sessionMaxAge`) and is only written once something is stored in it. `trust proxy` is enabled (`config.trustProxy`).
- `POST /login` answers `{ user }` to JSON clients and redirects browsers (`config.user.afterLogin`); failures are `401`/`400` or a redirect to `<loginPath>?error=invalid`. `POST /logout` destroys the session; `GET /logout` is deprecated and answers `405`.
- Double-submit CSRF protection: the `henri.csrf` cookie must be sent back as `X-CSRF-Token` (or `X-XSRF-TOKEN`, the axios/Inertia convention) or `_csrf` on unsafe requests carrying a session (`config.csrf: false` disables it, bearer tokens are exempt). The token is available as `req._henri.csrf` and `withHenri` adds the header to `fetch()` and `hydrate()`.
- Routes with `roles` deny with `401`/`403` JSON or a redirect to `config.user.loginPath`, and warn at boot when no user model exists instead of crashing per request.
- The session store survives model reloads: express-session talks to a proxy that follows the current adapter.
