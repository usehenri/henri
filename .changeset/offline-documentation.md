---
'@usehenri/core': minor
'@usehenri/cli': minor
'@usehenri/mcp': patch
---

The documentation ships with the framework, and `henri docs` reads it.

An agent recalling henri from its training data recalls a framework that was asleep for years, and the website answers for whatever version is deployed rather than the one in `node_modules`. So the pages of usehenri.io now travel inside `@usehenri/core`: `scripts/prepublish.js` copies `website/src/content/docs` into `docs/` at publish time, the way Next.js ships `node_modules/next/dist/docs`. An application therefore carries the documentation of the version it runs, and reading it costs no network at all.

```bash
henri docs                        # every page, with what it covers
henri docs guides/routes          # one page, as markdown
henri docs configuration --json   # { source, slug, title, description, url, text }
```

The pages are looked for in the application first (`@usehenri/core/docs`, the version it runs) and next to the command line after that, so `henri docs` answers outside a project too and every answer says which package and which version it came from. An unknown page exits `1` with `HENRI_AGENT_UNKNOWN_PAGE` and the near misses. There is nothing to configure and nothing to fetch.

**One copy, one version, three ways in.** `@usehenri/cli/scripts/docs` is the single reader: the command prints what it finds, the `guide` tool of `@usehenri/mcp` serves the same bytes (that package no longer carries a copy of its own, since it already depends on core through the CLI), and an agent that would rather open the files reads `node_modules/@usehenri/core/docs/<page>.md` with no tooling at all. `scripts/smoke.sh` runs the whole chain against a real install -- copied, packed, installed, read back -- so a `files` array that forgot them fails there.

It costs 351 KB packed and 1.2 MB installed for 43 pages, measured rather than estimated: the `@usehenri/core` tarball goes from 708 KB to 1,059 KB. That is a quarter of what core's own source already weighs and a fraction of the ORM sitting next to it, which is what makes the copy affordable in the package every application depends on rather than only in a development one.

**The website publishes the same corpus for agents that do have the network**: [`/llms.txt`](https://usehenri.io/llms.txt) is the index in the [llmstxt.org](https://llmstxt.org/) format -- every page with what it covers, in the order of the sidebar -- and [`/llms-full.txt`](https://usehenri.io/llms-full.txt) is all of them concatenated, in one fetch. Both are generated at build time from the same frontmatter the site renders, so a page added to the documentation is in them.

The generated `AGENTS.md` names `henri docs` in its command table, which is the line that sends an agent to the documentation of the version in front of it instead of to its memory. The guide is [Coding agents](https://usehenri.io/guides/agents/#the-documentation-offline-and-version-matched).
