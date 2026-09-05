---
'@usehenri/cli': patch
---

`henri new` scaffolds apps that depend on the `@usehenri/*` packages at the CLI's own version instead of the 0.37 line, and the generated `pnpm-workspace.yaml` warns instead of failing when pnpm meets a transitive build script that is not allow-listed.
