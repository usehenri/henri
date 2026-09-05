---
title: Views
description: React (Next.js), Inertia (Vite + React), Handlebars and Vue renderers, all server-side rendered.
sidebar:
  order: 3
---

Pick a renderer in your configuration. All of them are server-side rendered; the React and Inertia renderers also push updates to the browser while you develop.

```json
{ "renderer": "react" }
```

## React

[Next.js](https://nextjs.org/) (16, pages router, Turbopack) renders the pages in `app/views/pages` and injects the data sent by your controllers. If none of your routes match a request but a page does, the page is rendered directly.

Install the peer dependencies in your project (`henri new` already does):

```bash
pnpm add @usehenri/react next react react-dom sass
```

Two small files live next to your pages. `henri new` ships them and the engine creates them on first boot if they are missing:

```js
// app/views/next.config.js
module.exports = require('@usehenri/react/engine/conf');
```

```json
// app/views/jsconfig.json
{ "compilerOptions": { "baseUrl": "." } }
```

```jsx
// app/views/pages/log.js

import Link from 'next/link';
import withHenri from '@usehenri/react';

const Log = ({ data }) => (
  <div>
    <pre>{JSON.stringify(data, null, 2)}</pre>
    <Link href="/home">Home</Link>
  </div>
);

export default withHenri(Log);
```

`withHenri` gives your page these props:

| Prop       | Description                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------ |
| `data`     | What the controller passed to `res.render()` (or the GraphQL result)                             |
| `user`     | The logged-in user (`id`, `email`, `roles`, `config.user.public` fields), or `null`              |
| `paths`    | The routes this user may call, keyed like `index_tasks_path`                                     |
| `csrf`     | The CSRF token. `fetch()` and `hydrate()` send it; add it as `X-CSRF-Token` to your own requests |
| `pathFor`  | `pathFor('show_tasks_path', id)` builds a URL from a route name                                  |
| `getRoute` | Same, returns the plain string                                                                   |
| `fetch`    | `fetch({ route, method }, body)` calls a controller and resolves its JSON                        |
| `hydrate`  | Refetches the current page's data and updates `data`                                             |

Nested components get the same helpers from the `useHenri()` hook (or the `HenriContext` it reads):

```jsx
// app/views/components/nav.js
import { useHenri } from '@usehenri/react';

export default function Nav() {
  const { user, pathFor } = useHenri();
  return (
    <a href={pathFor('index_tasks_path')}>{user ? user.email : 'Tasks'}</a>
  );
}
```

A set of form components (`Form`, `Input`, `Select`, `Radio`, `Editor`, `Button`, `FormError`) with a `useForm()` hook ships in `@usehenri/react/forms`. `Editor` wraps Quill; import `react-quill-new/dist/quill.snow.css` from the page that uses it.

`assets`, `components`, `helpers` and `styles` resolve to the matching folders under `app/views`, so `import Nav from 'components/nav'` works from any page. Global stylesheets are imported from `app/views/pages/_app.js` (a Next.js rule); component styles use CSS modules, `import styles from 'styles/tasks.module.scss'`.

### Extending Next.js

Export a `next` function (or a plain object) from `config/next.js` to change the Next.js configuration under either bundler:

```js
// config/next.js
module.exports = {
  next: (config) => ({ ...config, images: { unoptimized: true } }),
};
```

If you need webpack-specific hooks, export a `webpack` function from `config/webpack.js`. Its presence switches the engine from Turbopack to webpack:

```js
// config/webpack.js

module.exports = {
  webpack: async (config, { dev }, webpack) => {
    config.plugins.push(
      new webpack.ProvidePlugin({
        $: 'jquery',
        jQuery: 'jquery',
      })
    );
    return config;
  },
};
```

### Production

`henri server --production` (or `NODE_ENV=production`) builds the pages once and serves the optimized build. `henri build` runs the build on its own, for example in a Docker image. `--force-build` rebuilds even if a build exists.

## Inertia

The `inertia` renderer speaks the [Inertia.js](https://inertiajs.com/) protocol: your controllers keep rendering routes with `res.render()`, the page is a React 19 component bundled by [Vite](https://vite.dev/), and navigation between pages happens without a full page load. The first visit is server-side rendered; the Inertia client then asks for page objects (JSON) and swaps the component.

```json
{ "renderer": "inertia" }
```

```bash
henri new my-app --renderer inertia
# or, in an existing application
pnpm add @usehenri/inertia @inertiajs/react react react-dom vite @vitejs/plugin-react sass
```

The engine reads four files from `app/views`. `henri new --renderer inertia` ships them and the engine creates them on first boot when they are missing:

| File              | Role                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `index.html`      | The html shell. `<!--head-->` and `<!--body-->` receive the rendered page.                        |
| `main.jsx`        | The browser entry: `createInertiaApp` resolving `pages/**/*.jsx`.                                 |
| `ssr.jsx`         | The server entry: `render(page)` resolves to `{ head, body }`.                                    |
| `vite.config.mjs` | Re-exports the shared configuration (`@usehenri/inertia/vite`): React plugin, aliases and builds. |

`res.render('/tasks/index', { data })` renders `app/views/pages/tasks/index.jsx` (`res.render('/tasks')` finds it too). The page reads what the controller sent through `useHenri()`:

```jsx
// app/views/pages/tasks/index.jsx
import { Form, Link, useHenri } from '@usehenri/inertia';

export default function Tasks() {
  const { data, user, pathFor, getRoute } = useHenri();

  return (
    <div>
      <Form action={pathFor('create_tasks_path')}>
        {({ errors, processing }) => (
          <>
            <input name="name" />
            {errors.name && <p>{errors.name}</p>}
            <button disabled={processing}>add</button>
          </>
        )}
      </Form>
      <ul>
        {data.tasks.map((task) => (
          <li key={task._id}>{task.name}</li>
        ))}
      </ul>
      <Link href={getRoute('home_main_path')}>home</Link>
    </div>
  );
}
```

`useHenri()` returns the same keys as the React renderer's `withHenri` (`data`, `user`, `paths`, `pathFor`, `getRoute`, `fetch`, `hydrate`, `localUrl`) plus `errors`, `csrf` and `query`. They are the props of the Inertia page object, so `usePage().props` from `@inertiajs/react` holds the raw values.

Forms submit through Inertia's router: a controller answers with a redirect (`res.redirect('/tasks')`; the engine turns it into a 303 after PUT, PATCH and DELETE) and the client lands on the next page. To show validation errors, render the page again after `res.inertia.errors({ name: 'required' })`: they arrive in `errors`. `res.inertia.location(url)` redirects to an external URL.

`Link`, `Head`, `router`, `usePage` and `useForm` are re-exported from `@inertiajs/react`. `assets`, `components`, `helpers` and `styles` resolve to the matching folders under `app/views`; global stylesheets are imported from `main.jsx`.

Options go under the `inertia` key of your configuration: `ssr: false` renders everything in the browser (the page object is still embedded in the html), `id` changes the root element id, `entry`, `ssrEntry` and `template` rename the files above. `henri server --production` builds the client (`app/views/dist/client`, with a manifest) and the server bundle (`app/views/dist/ssr`) once; `henri build` runs the two Vite builds on their own. Hot module replacement in development rides on henri's http server, no second port.

## Handlebars

The `template` renderer serves the `.html` and `.hbs` files under `app/views/pages` and registers everything under `app/views/partials` as partials. It has no build step and no client-side JavaScript of its own.

```json
{ "renderer": "template" }
```

```handlebars
<html>
  <head>
    <title>Hello!</title>
  </head>
  <body>
    {{> somePartials }}
    <li>Some data: {{hello}}</li>
  </body>
</html>
```

The object passed as `data` to `res.render()` is the template context. The other view options are available as data variables: `{{@user.email}}`, `{{@paths.index_artwork_path.route}}`, `{{@query.page}}`.

A route resolves to exactly one file: `/artwork` is `pages/artwork.{hbs,html,htm}`, then `pages/artwork/index.{hbs,html,htm}`, and `/` is `pages/index.*`. A route without a page is a `404`; a template that fails while rendering is a `500` with the stack in the console. Templates are compiled once and recompiled when the file changes.

## Vue

The `vue` renderer drives [Nuxt](https://nuxt.com/) the same way the React renderer drives Next.js: pages under `app/views`, data injected by controllers.

```json
{ "renderer": "vue", "experimental": { "vue": true } }
```

:::caution
The Vue renderer was written for Nuxt 2 and has not been exercised since the 2026 revival. It only loads with `experimental.vue` set to `true`, and warns on boot.
:::

## Fetching data again

Every controller that renders a view also answers with JSON. Request the same URL with an `Accept: application/json` header and you get the `data`, `user`, `paths` and `graphql` keys the page was rendered with. This is what `hydrate()` and `fetch()` use under the hood.
