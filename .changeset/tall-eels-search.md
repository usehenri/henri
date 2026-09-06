---
'@usehenri/graphql': minor
'@usehenri/core': minor
'@usehenri/cli': minor
---

GraphQL moves out of core into `@usehenri/graphql`

The GraphQL layer is now a package of its own. `@usehenri/core` no longer
depends on `@apollo/server`, `@as-integrations/express5`,
`@graphql-tools/merge`, `@graphql-tools/schema` or `graphql`, so an
application that never mounts a schema stops installing them.

An application that uses GraphQL adds one dependency,
`npm install @usehenri/graphql`, and nothing else changes: the package ships
the henri module itself, so depending on it is what puts `henri.graphql` in
the boot, with the same `run()`, `endpoint`, `active`, error classes and
`toApolloError()`. The endpoint is still `/_henri/gql` (still configurable
with the `graphql` key) and the schema is still built from the models'
`graphql` keys.

`@usehenri/core/module` is the base class a module package extends, and this
is the first package to use it: it is the supported path, so a module of your
own no longer reaches into `@usehenri/core/src/base/module`.

Without the package henri says so instead of going quiet: a model declaring a
`graphql` key fails the boot with the install line, `res.render(view, { graphql })`
fails the request with it, and `henri doctor` reports it as a missing
dependency. `henri.graphql` is `undefined` rather than an object that does
nothing, which the type declarations say too, and a page has no `graphql` key
among its view options.
