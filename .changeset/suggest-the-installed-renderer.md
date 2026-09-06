---
'@usehenri/core': patch
---

henri says when a renderer is installed and never configured

`config.renderer` defaults to handlebars, which is right for an application with no view engine and confusing for one that installed `@usehenri/inertia`, wrote pages and wonders why they are not the ones being rendered. Nothing fails, so nothing said anything.

The boot now names it once:

```text
  view ✏  @usehenri/inertia is installed but "renderer" is not set, so pages are rendered with handlebars => add "renderer": "inertia" to your configuration
```

Only when the key is absent. An explicit `"renderer": "template"` is a decision and is left alone.

Closes #40, open since 2018.
