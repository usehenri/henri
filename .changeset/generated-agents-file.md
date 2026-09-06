---
'@usehenri/cli': minor
'@usehenri/mcp': patch
---

`AGENTS.md` is generated from the application, not templated.

The file a coding agent reads before it writes anything used to be a Handlebars template with a renderer conditional and a store conditional, which had two problems that got worse with every release. A template cannot leave out what an application does not use, so a Drizzle application carried Mongoose sentences and an application with no queue carried the queue's — and the file was at its size budget, with every new feature fighting for lines in it. And it described the application `henri new` made rather than the one in front of the agent, so it went stale the first time somebody swapped a store, changed renderer or installed a package. That is why `agents.stale` had to exist at all.

`henri generate agents` now reads the application and writes what is true of it:

```bash
henri generate agents          # write or refresh AGENTS.md, CLAUDE.md and .mcp.json
henri generate agents --json   # { created, updated, skipped } like any generator
```

The renderer and its page extension, the stores and their adapters, the models and the marks they carry (`personal`, `encrypted`, `paranoid`, a `retention` rule), the routes as the router really expands them, the controllers, the policies, the jobs, the mailers, the workers, the modules and which henri packages are installed. Nothing is booted: the readers are the ones `henri doctor` already had (`exportsOf`, `listModules`, `storeOf`, `mailerActions`) plus `base/routes.js`'s own expansion, so there is no second opinion about what an application is. An application without `@usehenri/jobs` gets no paragraph about the queue and no `henri jobs` row in its command table; a Drizzle application gets the Drizzle model API and the migration commands and no sentence about Mongoose; a model marked `personal` is what puts `henri privacy:export` in the table. The last line of the "Do not" section names the packages the application does _not_ have, which is the line that stops an agent reaching for an API that is not installed.

**Regenerating cannot lose what you wrote.** Everything henri writes sits between two markers, and the rest of the file is copied through byte for byte:

```markdown
<!-- henri:agents 1 app=045d7a7b2a0f gen=42e21bae9532 -->

# app: conventions for coding agents

...

<!-- /henri:agents -->

## House rules

Always run `make check` before a commit.
```

The opening marker carries two short digests, each doing one job: `app` is what the application was when the file was written, and `gen` is what henri wrote in the region. So the command can tell its own text from a hand edit, and in three of the four cases it writes nothing you did not ask for — a missing file is written whole, an untouched region is rewritten in place, a region somebody edited by hand is left alone with the reason, and a file carrying no region at all is somebody's own `AGENTS.md` and is left alone too. `--force` is the only way past either refusal, which makes the failure mode "your text is kept" rather than "your text was kept unless".

**`henri new` writes the file through the same call**, after the configuration, the models, the routes and the sample resource are on disk, and the directory is the only argument either path takes — so a scaffolded `AGENTS.md` and a regenerated one are the same bytes, and a test says so.

**Size is the constraint that makes it good.** The generated region is budgeted at 150 lines and a fresh application lands around a hundred, down from a template that was pressing 170 with every tranche fighting for room. A line earns its place by being a convention that changes what an agent writes here, a fact about this application it cannot get from the documentation, or a command that will actually run here. What went out was manual: the MCP tool inventory (the server advertises its own tools), the exit-code table, the full `res.boom` list, the Tailwind explanation and the setup instructions for features an application does not have yet. That is the division of labour between the three pieces — `AGENTS.md` is the always-loaded part, `henri mcp` is the part fetched on demand (`guide` serves henri's documentation at the version installed, `routes`, `models` and `config` answer for the application), and `henri doctor` checks the claims.

`agents.stale` got sharper with it: a file henri wrote is compared on that `app` digest, so a model added or a package installed is drift too, not only a switched renderer or store. A file written by hand is still compared on the renderer and the store its own sentence names.

The guide is [Coding agents](https://usehenri.io/guides/agents/#agentsmd-is-generated).
