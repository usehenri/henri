---
'@usehenri/cli': minor
'henri': minor
---

`henri new` scaffolds an Inertia application. The default renderer is now `inertia`.

A new application gets `"renderer": "inertia"` in `config/default.json`, `.jsx` pages under `app/views/pages` and a Vite build. `henri new --renderer react` still scaffolds the Next.js application, and that engine is supported: it is frozen on the pages router rather than removed, because the contract that hands a controller's data to a page (`withHenri` reading `req._henri` on the server) has no equivalent in the app router. Both renderers now get the same sample: `henri new` scaffolds the `Task` resource with the generators on either one, so the Inertia template no longer ships a hand-written sample page of its own.

`henri generate scaffold` and `henri generate crud` follow the `renderer` of the application, read back from its configuration. An Inertia application gets `.jsx` pages using `useHenri()`, `<Form>` and `router`; a React one keeps getting `.js` pages using `withHenri` and `@usehenri/react/forms`. The renderer is also what a failed write answers a browser with: the Inertia controllers call `res.inertia.errors()` and render the form page again, the React ones answer the `422` their forms read, and API clients get the same `422` from both. `henri generate test` writes the Inertia page object assertions next to the HAL ones in an Inertia application.

Nothing changes for an existing application: its `renderer` key is what the boot and the generators read, and there is no migration.
