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
| `@usehenri/testing` | `setup`, `teardown`, `request`, `agent`, `henri`, `inbox`, `enqueued`, the factories.                                          |

And it generates one more, from your application rather than from the
framework: `.henri/types.d.ts` holds an interface per model and the union of
every path helper `config/routes.js` expands to. See
[The declarations henri generates](#the-declarations-henri-generates).

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
  "include": ["**/*.js", "**/*.d.ts", ".henri/types.d.ts"],
  "exclude": ["node_modules", "app/views"]
}
```

`types: ["@usehenri/core"]` is the load-bearing line. It is what makes the
`henri` global known everywhere without requiring anything, and it is all an
older application needs to add to catch up. `app/views` is excluded because the
pages have a `jsconfig.json` of their own (Next.js and Vite each want theirs).
`.henri/types.d.ts` is named in `include` on purpose: a wildcard never matches
inside a directory whose name starts with a dot, so the generated declarations
have to be asked for by name.

`checkJs` is off, so an editor offers completion and documentation without
turning a file red. Errors are opt-in, in two sizes:

```js
// @ts-check
// One file. Put it on the first line and that file is checked; the rest of
// the application is not.
```

```json
{ "compilerOptions": { "checkJs": true } }
```

Turning it on for the whole application is the setting a coding agent wants,
because it is what makes `npx tsc --noEmit -p jsconfig.json` mean something.
Nothing henri does depends on either: there is no build step, and the
declarations are read by editors and by `tsc`, never at runtime.

## The declarations henri generates

Everything above describes the framework. The two things only your application
knows — what its models hold and what its routes are called — are generated
into `.henri/types.d.ts`, next to the `globals.json` the linter already reads:

```bash
henri types                 # writes .henri/types.d.ts, and says what it covers
henri types --stdout        # prints them instead
```

You rarely run it. The development server writes the same file on every boot
and on every hot reload, and `henri build` writes it too, so it is there
without anyone asking; `.henri/` is gitignored, so it never reaches a diff.
`henri doctor` reports one that no longer describes the application
(`types.stale`) or that cannot be rewritten (`types.unwritable`).

What it holds, from `app/models/Task.js` and `config/routes.js`:

```ts
interface TaskRecord extends HenriDrizzleRecord {
  body: string | null;
  createdAt: Date;
  /** The soft delete stamp (`options.paranoid`). */
  deletedAt: Date | null;
  /** The public identifier: the only one that leaves the server. */
  externalId: string;
  status: 'draft' | 'in_review' | 'live';
  title: string;
  /** `status === "draft"` */
  isDraft(): boolean;
}

interface TaskModel extends HenriModelStatics<TaskRecord> {
  enums: { status: readonly ('draft' | 'in_review' | 'live')[] };
  draft(where?: Record<string, any>): Record<string, any>;
}

declare const Task: TaskModel;

interface HenriPaths {
  /** `GET /tasks` -> tasks#index */
  index_tasks_path: true;
  /** `GET /tasks/:id` -> tasks#show */
  show_tasks_path: true;
}
```

- **The columns of the model file**, plus the ones henri adds: `externalId`
  unless the model opted out, `createdAt`/`updatedAt` unless `timestamps` is
  off, `slug` when the model declares one, `deletedAt` on a `paranoid` model,
  and `email`, `password`, `roles`, `confirmedAt` and `passwordChangedAt` on
  the user model. A column the model does not require is `| null`.
- **`decimal` and `bigint` are `string`**, which is what they are in
  JavaScript on every adapter (see [Models](/guides/models/)). A `json` column
  is `any`.
- **An `enum` is the union of its values**, so `task.status = 'published'` is
  an error, and so is the predicate of a value that is not there.
- **A column marked `personal: { expose: false }` is on the record.** The mark
  governs the answers henri builds, not what the row holds.
- **The path helpers**, one key per helper, so `pathFor('taks_path')` and
  `getRoute('index_task_path')` are compile errors in both view packages.

### What it deliberately leaves open

A record is closed; a model is not. `findById`, `findByKey`,
`findByExternalId`, `findBySlug`, `paginate`, `enums` and the enum scopes are
typed, and every other static is `any` — because `Model.find()` answers a
chainable Mongoose `Query`, a Sequelize promise and a Drizzle `Relation`, and
`Model.update()` takes its arguments in one order on Sequelize and the other
on Drizzle. Declaring one of the three as the truth would turn code that runs
into an error on the other two. An honest `any` is the same answer
[`henri openapi`](/guides/openapi/) gives when it cannot know what an action
answers.

The consequence is worth stating plainly: a **wrong column, a wrong enum value
and a wrong path helper are caught**; a wrong _static_ is not.

### When henri cannot read something

The file is written from what henri understood and says what it skipped rather
than emitting something that will not parse — a file that does not compile
turns every other declaration in the project off. A model whose name is not a
TypeScript identifier, a model file that is not an object, a column name that
cannot be a property: each is left out and named in the summary, in
`henri types --json` and by `henri doctor`. A routes file that will not expand
leaves the helper registry empty, and an empty registry means `pathFor()`
takes any string again — exactly where an application without the file
already was.

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
`req.flash()`, `req.id`, `req.can()`, `req.authorize()`, `req.scope()`,
`res.render()`, `res.boom.*`, `res.resource()`, `res.collection()`,
`res.negotiate()` and everything Express already had.

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

The eleven field types are checked; every other key of a field is passed to the
adapter, so the shape stays open (see [Models](/guides/models/)).

```js
// app/policies/task.js
/** @type {import('@usehenri/core').Policy} */
module.exports = {
  index: (user) => Boolean(user),
  show: (user, task) => String(task.userId) === String(user.id),
  scope: (user) => ({ userId: user && user.id }),
};
```

The seven actions of a resource are declared, so `user`, the record and the
context are typed inside them, and any other action of the controller takes
the same shape. `req.can()`, `req.authorize()` and `req.scope()` come with
the `Controller` annotation above; `authorize()` resolves with the record it
was given, so it keeps its type. See [Policies](/guides/policies/).

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
const config = {
  renderer: 'inertia',
  stores: {
    default: {
      adapter: 'drizzle',
      dialect: 'sqlite',
      url: 'file:.henri/app.db',
    },
  },
};
```

It cannot drift from what henri actually accepts: the declarations and the
[schema the boot runs](/configuration/#validation) are compared key by key by
`@usehenri/core`'s own suite, along with the table of the
[configuration page](/configuration/#keys). Adding a key means adding it in
all three.

## What is not typed

- **The ORM behind a model.** The columns of every model are generated (above),
  and so are the statics henri owns; what the ORM itself puts on a model —
  `findAll` on Sequelize, `where` and `pluck` on Drizzle, `aggregate` on
  Mongoose — is `any`, and an application with no `.henri/types.d.ts` has
  `any` for the whole global.
- **`req.user`.** A model instance, and the request does not know which model
  it is. Annotate it when you want the generated interface
  (`/** @type {UserRecord} */`), or use `henri.user.publicUser(user)`, which
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

The generated declarations are checked by the same run, and they are a
different thing for a different consumer: `types/generated.d.ts` is the real
output of `henri types` over a fixture application, kept byte identical by the
CLI's own suite, and `types/generated.test-d.ts` next to it asserts that a
wrong column, a wrong enum value and a misspelled path helper are all errors.
The two do not compete — the hand-written files describe henri and are
published to npm, the generated one describes an application and is never
published — and the generated file is built out of the hand-written ones
(`ModelStatics`, `ModelQuery`, `RecordBase` and the three adapter record
types), so a signature changes in one place.
