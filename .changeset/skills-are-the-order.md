---
'@usehenri/cli': minor
---

`henri skills`: the procedures a coding agent follows here, written down

An application already told an agent three things and none of them was the
order. `.mcp.json` and `henri mcp` are what it can _ask_; `AGENTS.md` is what
is always true _here_; `henri docs` is what henri _is_. An agent holding all
three still had to work out on its own that adding a tenanted model means a
mark, a migration, a policy, a `params` block and a test, in that order, with
the commands that particular store has.

`henri generate skills` writes five of those sequences into
`.claude/skills/<name>/SKILL.md`, and `henri new` writes them alongside
`AGENTS.md` (`--no-skills` opts out): add a model, add a resource end to end,
before you commit, diagnose a failure, and drive the running application.

Three layers, each doing what it is good at. The procedure is generic and
ships in the package, versioned with the code it describes. The facts are
derived from the application by the same reader `AGENTS.md` uses, so a
Drizzle store is told to run `henri db:generate` and read what it wrote, a
Mongoose store is told there is no migration and what that costs instead, and
an mssql store is told it has no migrations at all and that
`henri db:status --sql` is what reports the drift; `config.tenancy` adds the
question of whose rows a new model holds. The judgement stays the agent's: a
skill says _ask `schema` before you write SQL_ rather than baking this
application's tables into a file that would rot. No skill restates a guide --
it says the order and names the page -- and both the description and the body
are budgeted, because a procedure that has grown into a manual has stopped
being a procedure.

Nothing asks a model for anything. The input is the directory and the output
is bytes, the rule `henri types` already follows, with a fixture application
and its generated skills committed next to it to keep it true.

The frontmatter of a `SKILL.md` has to open the first line of the file, so the
generated region starts below it -- which puts the `description`, the line
that decides when a skill loads, permanently outside what henri rewrites.
Everything below the closing marker is yours too, and the region follows the
same digests and the same `--force` as `AGENTS.md`. `henri doctor` gained
`skills.stale`, `skills.edited`, `skills.foreign` and `skills.missing`; an
application with no skills at all is not reported, because unlike `AGENTS.md`
a skill nobody has costs nothing.

`AGENTS.md` gained a pointer to them, and reads `config.tenancy` and the
`tenant`/`versioned` marks of a model now, which is what bumped its region
format to 2.
