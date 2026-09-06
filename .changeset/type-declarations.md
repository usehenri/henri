---
'@usehenri/core': minor
'@usehenri/cli': minor
'@usehenri/inertia': minor
'@usehenri/react': minor
'@usehenri/testing': minor
---

Type declarations for the API an application touches.

Every published package now ships hand-written `.d.ts` files, pointed at by
`types` and included in `files`. henri stays JavaScript: there is no build step,
no `.ts` file in an application and nothing to install.

- **`@usehenri/core`** declares the `henri` global (`config`, `pen`, `model`,
  `user`, `router`, `server`, `mail`, `graphql`, `validator`, `addMiddleware`,
  ...), the request and response additions (`req.permit()`, `req.pagination()`,
  `req.flash()`, `req.id`, `req.apiVersion`, `req._henri`, `res.render()`,
  `res.hbs()`, `res.boom.*`, `res.resource()`, `res.collection()`,
  `res.negotiate()`), and the shape of the three files an application writes:
  `Controller`, `RoutesFile`, `ModelFile`, plus `Configuration` for
  `config/default.json`. The routes keys are checked as far as a type can check
  them, so `'gett /tasks'` and `only: ['list']` are type errors.
- **`@usehenri/react`** declares `withHenri`, `useHenri`, `request`,
  `RequestError` and the form components with their props;
  **`@usehenri/inertia`** `useHenri`, `Form`, `pathFor`, `getRoute`, `request`,
  `resolvePage` and `henriViteConfig()` (`Link`, `Head`, `router`, `usePage` and
  `useForm` re-export Inertia's own types); **`@usehenri/testing`** `setup`,
  `teardown`, `request`, `agent` and `henri`. Neither view package depends on
  `@types/react`.
- **`henri new` writes a `jsconfig.json`** with `types: ["@usehenri/core"]`, so
  an editor knows the `henri` global and completes everything above with no
  setup. The generators write the one JSDoc line that binds a file to its shape
  (`/** @type {import('@usehenri/core').Controller} */`), on controllers, model
  files and `config/routes.js`.

The models themselves stay untyped: `Task` is a Mongoose, Sequelize or Drizzle
model whose fields come from your schema, and henri does not pretend to know
it. See the new [Types](https://usehenri.io/reference/types/) page.
