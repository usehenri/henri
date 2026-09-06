---
'@usehenri/inertia': patch
---

Development no longer paints an unstyled page before the styles arrive.

Vite hands a stylesheet to the browser as a JavaScript module that injects it once the entry has run, so a server-rendered document had no stylesheet at all in its head and the browser painted the fully laid-out markup unstyled until the module executed. The engine now links the stylesheets the browser entry imports, asking the dev server for the compiled CSS itself, so the styles are there for the first paint. The module still runs and still owns hot updates. Production was never affected: the built stylesheets have always been linked from the manifest.
