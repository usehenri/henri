---
'@usehenri/cli': minor
'@usehenri/core': patch
---

`henri doctor` checks that the documentation the packages ship is installed

The pages travel inside `@usehenri/core`, which is what makes `henri docs` and
the `guide` tool of `henri mcp` answer for the henri an application runs. When
they are not there -- an install that predates them shipping with the package,
a pruned `node_modules`, an image that dropped the markdown -- the reader does
not fail: it falls through to the copy next to the command line, so an agent
reads another version's documentation and corrects itself against it.

Two checks say so. `docs.version` (a warning) names the package the pages
would come from and the `@usehenri/core` this application runs; `docs.missing`
is the case where nothing anywhere has them, carrying `HENRI_AGENT_NO_DOCS`,
the code the next `henri docs` would raise. Both name the directory and what
was wrong with it: not there, empty, or unreadable.

A `@usehenri/core` that is not installed at all says nothing here --
`deps.declared` and `deps.installed` already do -- and a checkout of henri
itself, where the pages are read from `website/src/content/docs` on purpose,
is not a finding.
