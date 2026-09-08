---
'@usehenri/core': minor
'@usehenri/cli': minor
'@usehenri/inertia': minor
'@usehenri/react': minor
'@usehenri/mcp': minor
---

Types generated from what the application already declares.

henri ships hand-written declarations for the framework, so `res.render()`, `req.permit()` and `config/default.json` complete and typecheck. The two things only your application knows did not: a model global was `any`, and `pathFor()` took a string. So renaming a column or a route was a runtime discovery for a person and an invisible one for a coding agent — `article.titel` renders `undefined`, `status === 'published'` is silently false forever, and `pathFor('taks_path')` links nowhere.

`henri types` writes `.henri/types.d.ts`, from `app/models` and `config/routes.js`, without booting anything:

```ts
interface ArticleRecord extends HenriDrizzleRecord {
  body: string | null;
  /** The public identifier: the only one that leaves the server. */
  externalId: string;
  status: 'draft' | 'live' | 'archived';
  title: string;
  /** `status === "draft"` */
  isDraft(): boolean;
}

declare const Article: ArticleModel;

interface HenriPaths {
  /** `GET /articles` -> articles#index */
  index_articles_path: true;
}
```

The columns are the model file's plus the ones henri adds (`externalId`, the timestamps, `slug`, `deletedAt`, and the user model's own); a `decimal` and a `bigint` are `string`, which is what they are in JavaScript on every adapter; an `enum` is the union of its values, with its predicates and its scopes; a column marked `personal: { expose: false }` is on the record, because the mark governs answers and not storage. The path helpers become the union `pathFor()` and `getRoute()` take in `@usehenri/react` and `@usehenri/inertia`, so a helper that does not exist is a compile error.

**You do not run it.** Every development boot and every hot reload write it, next to the `globals.json` the linter already reads, and `henri build` writes it for CI. `.henri/` is gitignored, so nothing reaches a diff, and `henri doctor` reports a file that no longer describes the application (`types.stale`), one henri did not write (`types.foreign`) and one it cannot rewrite (`types.unwritable`). The scaffold's `jsconfig.json` now names the file in `include`; errors stay opt-in, with `// @ts-check` on one file or `"checkJs": true` for the application, which is what makes `npx tsc --noEmit -p jsconfig.json` mean something to an agent. `henri mcp` exposes it as the `types` tool.

**A record is closed and a model is open, on purpose.** A record carries exactly its columns, which is what makes a wrong name an error. A model carries what henri guarantees on every adapter — `findById`, `findByKey`, `findByExternalId`, `findBySlug`, `paginate`, `enums` and the enum scopes — and `any` for the rest, because `Model.find()` answers a chainable Mongoose `Query`, a Sequelize promise and a Drizzle `Relation`, and `Model.update()` takes its arguments in one order on Sequelize and the other on Drizzle. Declaring one of the three as the truth would turn code that runs into an error on the other two.

Nothing is invented when henri cannot read something: a model whose name is not a TypeScript identifier, a model file that is not an object, a column name that cannot be a property are each left out and named in the summary and in `--json`, and a routes file that will not expand leaves the registry empty — which puts `pathFor()` back to taking any string rather than emitting a file that does not parse.
