---
title: Types
description: The TypeScript declarations henri ships, what an editor needs to pick them up, and the JSDoc annotations that type a controller, a routes file, a model and the configuration.
sidebar:
  order: 3
---

henri is JavaScript and stays JavaScript: there is no build step, no `.ts` file
in an application and no compiler between you and the framework. It does ship
hand-written type declarations, so an editor — and a coding agent reading the
same signatures — knows what `res.render()` takes, what `req.pagination()`
answers and which keys `config/default.json` accepts.

| Package             | Declares                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `@usehenri/core`    | The `henri` global, the request and response helpers, the controller, model and routes files, the whole configuration.         |
| `@usehenri/react`   | `withHenri`, `useHenri`, `request`, `RequestError`, the form components and the engine's `build()`.                            |
| `@usehenri/inertia` | `useHenri`, `Form`, `pathFor`, `getRoute`, `request`, `resolvePage`, `henriViteConfig()`. `Link` and `Head` come from Inertia. |
| `@usehenri/testing` | `setup`, `teardown`, `request`, `agent`, `henri`.                                                                              |

## What an editor needs

Nothing, in an application scaffolded by `henri new`: the `jsconfig.json` it
writes at the root of the project already says where to look.

```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": false,
    "module": "node16",
    "moduleResolution": "node16",
    "skipLibCheck": true,
    "target": "es2023",
    "types": ["@usehenri/core"]
  },
  "exclude": ["node_modules", "app/views", ".henri"]
}
```

`types: ["@usehenri/core"]` is the load-bearing line. It is what makes the
`henri` global known everywhere without requiring anything, and it is all an
older application needs to add to catch up. `app/views` is excluded because the
pages have a `jsconfig.json` of their own (Next.js and Vite each want theirs).

`checkJs` is off, so an editor offers completion and documentation without
turning a file red. Turn it on when you want the annotations below actually
checked; the models are globals whose names henri only knows at runtime, so
declare the ones you use in a `.d.ts` of your own when you do:

```ts
// globals.d.ts
declare const Task: any;
declare const User: any;
```

## Annotating a file

A controller, a routes file and a model file are plain objects: nothing tells
an editor what they are. One JSDoc line does, and `henri new` and
`henri generate` write it for you.

```js
// app/controllers/tasks.js
/** @type {import('@usehenri/core').Controller} */
module.exports = {
  before: { 'show,edit': loadTask },

  index: async (req, res) => {
    const { page, perPage, skip, limit } = req.pagination();
    const tasks = await Task.find().skip(skip).limit(limit);

    return res.collection(tasks, {
      page,
      perPage,
      total: await Task.countDocuments(),
    });
  },
};
```

`req` and `res` are typed from that annotation alone: `req.permit()`,
`req.flash()`, `req.id`, `res.render()`, `res.boom.*`, `res.resource()`,
`res.collection()`, `res.negotiate()` and everything Express already had.

```js
// config/routes.js
/** @type {import('@usehenri/core').RoutesFile} */
module.exports = {
  root: 'main#home',
  'resources tasks': {
    only: ['index', 'show'],
    member: { 'post archive': 'archive' },
  },
};
```

The keys are checked as far as a type can check them: `root`, a path, a verb
and a path, `resources`, `crud` and `namespace`. `'gett /tasks'` is a type
error, and so is `only: ['list']`.

```js
// app/models/Task.js
/** @type {import('@usehenri/core').ModelFile} */
module.exports = {
  options: { timestamps: true },
  schema: {
    title: { type: 'string', required: true },
    status: { type: 'string', enum: ['todo', 'done'], default: 'todo' },
  },
  store: 'default',
};
```

The nine field types are checked; every other key of a field is passed to the
adapter, so the shape stays open (see [Models](/guides/models/)).

```js
// app/jobs/welcome.js
/** @type {import('@usehenri/core').JobDefinition} */
module.exports = {
  queue: 'mailers',
  maxAttempts: 5,
  timeout: '30s',

  perform: async (args, { henri, job, signal }) => {
    henri.pen.info('welcome', job.id, job.attempt);
  },
};
```

`context` is typed from that annotation, and so is what `henri.jobs` answers:
`perform()`, `performIn()` and `performAt()` resolve with a `Job`, `stats()`
with a `JobStats`, and `henri.jobs.dead` with the same. See
[Jobs](/guides/jobs/).

`Configuration` is the shape of `config/default.json`, and is worth an
annotation when a helper builds part of it:

```js
/** @type {import('@usehenri/core').Configuration} */
const config = { renderer: 'react', stores: { default: { adapter: 'disk' } } };
```

## What is not typed

- **The models.** `Task` is a Mongoose `Model`, a Sequelize `ModelStatic` or a
  Drizzle model class depending on the store, and its fields come from your
  schema. henri does not pretend otherwise: the globals are `any` unless you
  declare them. What every adapter adds is documented on
  [`Page`](/guides/models/#pagination) — `paginate()` answers the same
  `{ records, page, perPage, total, pages }` everywhere.
- **`req.user`.** A model instance, same reason. `henri.user.publicUser(user)`
  answers a typed `PublicUser`.
- **`henri.config.get(key)`.** The value is whatever the JSON holds; pass the
  type you expect (`henri.config.get<string>('secret')`).
- **The adapters and the view engines** are typed as contracts
  (`StoreAdapter`, `ViewEngine`), not as the ORMs behind them.

## In TypeScript

Nothing stops an application from being written in TypeScript — henri never
loads a `.ts` file itself, so it has to be compiled to CommonJS first, and the
declarations are the same ones. The framework is not tested that way; a
JavaScript application with `checkJs` is the supported path.

## Checking them

The declarations live next to the code they describe
(`packages/core/index.d.ts` and one file per package) and are checked in CI by
`pnpm test:types`, which verifies that every declaration is shipped by npm and
then runs `tsc --noEmit` over `types/` in the repository. Those fixtures call
the API both correctly and — on the lines marked `@ts-expect-error` —
incorrectly, so a declaration that stops catching a mistake fails the build.
