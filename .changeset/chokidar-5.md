---
'@usehenri/core': patch
---

The development file watcher moves to chokidar 5

It watches the same directories and reloads the same way; the major is chokidar's own, not a change in what henri does with it. Verified against a booted application: touching the controllers still reloads every module.
