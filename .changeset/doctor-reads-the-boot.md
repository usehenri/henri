---
'@usehenri/cli': minor
'@usehenri/mcp': minor
---

`henri doctor` reads what would fail a boot. It checked the conventions and
stopped short of the failures that only show up when something starts, which
is rarely a good moment — and is exactly what a coding agent cannot see.

Eleven checks more, all of them from the files. An environment file replaces
`config/default.json` whole rather than merging into it, so every one of them
is now read and compared: a model naming a store one of them does not hold
(`models.store`) and a store adapter one of them configures and nothing
installs (`deps.declared`, which names the file that asked) are the two that
used to wait for the deploy. Then `jobs.store`, `webhooks.store` or
`trail.store` naming a store that is not next to it (`config.store`); a route asking for a policy
`app/policies` does not hold, which the policies refuse rather than allow
(`routes.policy`); a file of `app/jobs` with no `perform` (`jobs.perform`); a
recurring schedule naming a job that is not there, which fails nothing and
simply never runs (`jobs.recurring`); a mailer action with no view
(`mailers.view`); an `app/modules` file whose name a core module already has,
whose `needs` nothing provides, or a dependency whose `"henri": { "module" }`
points at a file that is gone (`modules.name`, `modules.needs`,
`modules.package`); and the henri packages installed at two versions, which
are published together (`deps.version`).

Two more keep the application's own description honest: `agents.stale` when
`AGENTS.md` names a renderer or a store the configuration no longer names —
an agent that trusts it writes code this application cannot run — and
`views.renderer` when a page imports the other view engine or carries an
extension the configured one does not resolve. Every file under
`app/views/pages` is read for the second one, not only the pages a
`resources` route names: the Inertia engine resolves through
`import.meta.glob('./pages/**/*.jsx')`, so a `.js` file there is loaded by
nothing and says so nowhere — and the page no route points at is exactly
where that hides.

The schema of a store is the one question asked over a connection, next to
the shared store and behind the same `--no-reach`: `schema.behind` when a
store answers and `db/migrations` holds migrations it has not applied, and
`schema.unreachable` when it did not answer. A store that is down and a store
that is behind are different problems with different fixes, and doctor never
reports one as the other; drift against the models stays with
`henri db:status`, which boots the application to compare them.

Every problem gains a `code`: the henri error code the boot would raise, and
`null` where the convention is doctor's own. The rest of the `--json` shape,
the check names and the exit codes are unchanged.

Two older behaviours are corrected on the way. `schema.migrations-pending`
reported itself against `config/production.json` whether or not that file
existed, and told the reader to put `"migrate": true` in it — an environment
file replaces `config/default.json` whole rather than merging into it, so
someone who created it for the flag alone would lose the store block and get
the boot failure `models.store` is there to catch. It now names the file only
when there is one to open, and says the deploy first. And the comment
stripper the file readers share blanked from a `//` inside a string literal,
so a model or a mailer carrying a url could silently stop being read past
that line; it knows strings now.
