---
'@usehenri/cli': minor
'henri': minor
---

`henri new` scaffolds a styled application: Tailwind CSS v4, out of the box, on both renderers.

The nine-line Sass stylesheet is gone. `app/views/styles/index.css` is now the whole stylesheet of a new application: `@import 'tailwindcss' source(none)` with the `@source` globs of `pages/` and `components/`, a `color-scheme: light dark` root and a body rule. The React template compiles it with `@tailwindcss/postcss` through a new `app/views/postcss.config.mjs` (next.js reads its PostCSS configuration from `app/views`); the Inertia template merges the `@tailwindcss/vite` plugin into `app/views/vite.config.mjs`. Both work in development and in production, Inertia's server-side rendering included, and every `henri new --adapter` combination gets the same wiring.

The sample pages are written with it. The welcome page, the Inertia tasks page and the five view templates behind `henri generate scaffold` (index, show, new, edit, `_form`) render a designed page instead of unstyled text, with a dark mode that follows the operating system through Tailwind's `dark:` variant. The class lists long enough to hide the markup sit in a `const` at the top of the page, so `useHenri()`, `withHenri` and the form handling stay in plain sight.

The generated `AGENTS.md` has a `## Styling` section stating the convention (one stylesheet, utility classes in the pages, no `tailwind.config.js`, `dark:` on every colour), and the generated `README.md` says how to drop Tailwind: nothing in henri depends on it, the classes are plain strings in the pages.
