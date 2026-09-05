---
'@usehenri/core': minor
'@usehenri/cli': minor
'@usehenri/inertia': minor
'@usehenri/react': minor
---

Rails ergonomics in the router and the controllers.

- **`before` hooks.** A controller can export `before`, henri's `before_action`:
  an object keyed by action (`all`, `show`, `'create,update'`) or an array of
  functions and `{ run, only, except }` selectors. Hooks are `(req, res, next)`
  or async `(req, res)`, run once the route is allowed, in declaration order,
  and one that answers ends the request. `before` is the one export of a
  controller that is never routable.
- **Flash messages.** `req.flash('notice', 'Saved')` queues a message in the
  session and `req.flash('notice')` reads and clears it, so it survives exactly
  one redirect. Views get the whole bag as `flash` next to `data` and `paths`
  (`{{@flash.notice}}` in Handlebars, the `flash` prop or `useHenri().flash` in
  React and Inertia); a request that renders nothing leaves the messages alone.
  Without a user model, and therefore without a session, `req.flash()` is a
  no-op rather than an error.
- **Implicit render.** An action that returns without answering renders
  `/<controller>/<action>` (`/<controller>` for `index`) with what it returned
  as `data`, the way rails renders `tasks/show`. Actions that answer explicitly
  are untouched; `return false` opts out.
- **A fuller routes DSL.** `config/routes.js` gains `root` (`GET /`), `only`
  and `except` on `resources`/`crud` (`omit` still works and is deprecated),
  `member` and `collection` extra routes, `namespace <name>` and `nested`
  resources (`/posts/:post_id/comments`). Path helpers stay
  `<action>_<controller>_path`, and the expansion now lives in one place
  (`@usehenri/core/src/base/routes`), which `henri routes`, `henri doctor` and
  the generators read instead of their own copy.
- `henri generate scaffold|crud` write a `before` hook loading the record of
  `:id` once, `update`/`destroy` work on it instead of querying again, and
  `new` returns instead of rendering.
