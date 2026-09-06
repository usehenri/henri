---
'@usehenri/core': minor
'@usehenri/cli': minor
'@usehenri/mcp': minor
---

`henri openapi`: a machine-readable description of what an application exposes, generated from its routes rather than hand-written.

```bash
henri openapi                      # the OpenAPI 3.1 document, on stdout
henri openapi --out openapi.json   # written to a file the application commits
henri openapi --summary            # what it covers, and what henri cannot know
```

Most frameworks cannot generate a good one, because they know nothing about their own answers, and the description ends up a second copy of the application that drifts. henri knows the routes (`config/routes.js`, expanded the way the router expands it), the models (its own schema format, plus the columns the adapters add), the answers (HAL with `_links`, the boom error envelope with its code, the paging, `Idempotency-Key`, the versioned media type), who may call what (`roles` on a route, a policy per record) and what leaves (a field marked `personal: { expose: false }` is dropped; a declared foreign key travels as the related row's `externalId`). All of that is derived, and nothing in the document is a convention henri hopes an application follows.

The other half is what henri **cannot** know, and it is the half that makes the document worth reading. A controller can answer anything: `res.render()` is not JSON, and a hand-written route points at an action henri never wrapped. Those operations carry no success status at all — only the failures henri answers before the action runs, plus a `default` response that says, in words, that the body is the application's. Nothing in a response schema is `required` and every schema is open, because an action may present its records before sending them. A request body is the model's writable columns, all optional, and a foreign key gets no type, because `req.permit()` is the controller's decision. Every operation carries `x-henri.known`, so a reader never has to guess how much was derived. An honest `unknown` beats a wrong `object`.

The document is OpenAPI **3.1** (JSON Schema 2020-12: a published foreign key is `type: ["string", "null"]`, and "anything" is `{}` — neither is expressible in 3.0). It is validated against the specification by the test suites of core, the command line and the showcase, and the showcase suite calls the application and checks that the status, the shape and the headers of a real answer are the ones the document named.

It lives as a file the application commits, and as `GET /_openapi.json` on a booted application — development only and from the loopback interface only, like `/_routes` and `/_controllers`, because the document names every route, its roles and its policy. `henri mcp` exposes it as the `openapi` tool, which is the fastest way for a coding agent to learn an application's HTTP surface.

Out of scope on purpose: a UI, request validation from the document, client generation, and GraphQL, which has a schema of its own. The guide is `usehenri.io/guides/openapi/`.
