---
title: Views
description: React (Next.js), Inertia (Vite + React), Handlebars and Vue renderers, all server-side rendered.
sidebar:
  order: 4
---

Pick a renderer in your configuration. All of them render on the server; the React and Inertia renderers also push updates to the browser while you develop. A view engine is loaded from the application, so its packages must be installed there (`henri new` does it).

```json
{ "renderer": "react" }
```

Whatever the renderer, a controller renders with `res.render(route, { data })` and the page receives `data`, `user`, `paths`, `query`, `csrf`, `localUrl`, `errors` and `graphql` (see [Controllers](/guides/controllers/#resrenderroute-options)). Static files go in `app/views/public`, served at the root.

## Styles

`henri new` scaffolds a styled application: [Tailwind CSS](https://tailwindcss.com) v4 is wired for the renderer you picked and the sample pages are written with it. `app/views/styles/index.css` is the whole stylesheet.

```css
/* app/views/styles/index.css */
@import 'tailwindcss' source(none);

@source '../pages/**/*.{js,jsx}';
@source '../components/**/*.{js,jsx}';

@layer base {
  :root {
    color-scheme: light dark;
  }

  body {
    @apply bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-50;
  }
}
```

Tailwind v4 has no `tailwind.config.js`: the theme is CSS. Add `@theme { --color-brand: oklch(0.6 0.2 250); }` to that file and `bg-brand`, `text-brand` and `border-brand` exist. `source(none)` turns automatic file detection off, so Tailwind reads exactly the `@source` globs above and never walks `.next/` or `dist/`; add a line before writing classes somewhere else (`@source '../index.html';`, `@source '../../helpers/**/*.js';`).

Dark mode follows the operating system, with no toggle and no class to set: `dark:` is Tailwind's default `prefers-color-scheme: dark` variant, and `color-scheme: light dark` hands the same preference to the native form controls, the scrollbars and the focus rings. Add `@custom-variant dark (&:where(.dark, .dark *));` if you would rather drive it from a class.

How it is compiled depends on the renderer:

| Renderer  | Plugin                 | Wiring                                                                             |
| --------- | ---------------------- | ---------------------------------------------------------------------------------- |
| `react`   | `@tailwindcss/postcss` | `app/views/postcss.config.mjs`; the stylesheet is imported by `pages/_app.js`      |
| `inertia` | `@tailwindcss/vite`    | a plugin merged into `app/views/vite.config.mjs`; imported by `app/views/main.jsx` |

Both work the same in development and in production: `henri server` compiles the stylesheet on the fly, `henri build` writes it next to the bundle and the html links it, server-side rendered markup included.

### Adding Tailwind to an existing application

With the React renderer:

```bash
pnpm add tailwindcss @tailwindcss/postcss
```

```js
// app/views/postcss.config.mjs
export default { plugins: { '@tailwindcss/postcss': {} } };
```

Then `import '../styles/index.css';` from `app/views/pages/_app.js`.

With the Inertia renderer:

```bash
pnpm add tailwindcss @tailwindcss/vite
```

```js
// app/views/vite.config.mjs
import tailwindcss from '@tailwindcss/vite';
import { henriViteConfig } from '@usehenri/inertia/vite';
import { mergeConfig } from 'vite';

export default mergeConfig(henriViteConfig({ views: import.meta.dirname }), {
  plugins: [tailwindcss()],
});
```

Then `import './styles/index.css';` from `app/views/main.jsx`.

### Opting out

Nothing in henri depends on Tailwind; the classes are plain strings in the pages. Write your own CSS in `app/views/styles/index.css` (keep the import, it is the only stylesheet the pages load), then remove `tailwindcss` and, depending on the renderer, `@tailwindcss/postcss` with `app/views/postcss.config.mjs`, or `@tailwindcss/vite` with the plugin it adds to `app/views/vite.config.mjs`.

The scaffolded pages, and everything `henri generate scaffold` writes afterwards, keep carrying Tailwind class names. Without Tailwind they are inert: rewrite the markup, or define the handful of classes you keep in your own stylesheet. `sass` stays installed, so renaming the file to `index.scss` (and the import with it) gets you Sass instead, and `*.module.scss` files next to a page keep working.

## React

[Next.js](https://nextjs.org/) (16, pages router, Turbopack) renders the pages in `app/views/pages` and injects the data sent by your controllers. If none of your routes match a `GET` request but a page does, the page is rendered directly. The App Router is not supported: a page under `app/views/app` would bypass `withHenri` and the controllers, and the engine warns when that directory exists.

Install the peer dependencies in your project (`henri new` already does):

```bash
pnpm add @usehenri/react next react react-dom tailwindcss @tailwindcss/postcss sass
```

Two small files live next to your pages. `henri new` ships them and the engine creates them on first boot when they (or their `.mjs`/`.ts` alternatives) are missing:

```js
// app/views/next.config.js
module.exports = require('@usehenri/react/engine/conf');
```

```json
// app/views/jsconfig.json
{ "compilerOptions": { "baseUrl": "." } }
```

### Pages

```jsx
// app/views/pages/tasks/index.js
import Link from 'next/link';
import withHenri from '@usehenri/react';

const Tasks = ({ data: { tasks = [] }, getRoute }) => (
  <ul>
    {tasks.map((task) => (
      <li key={task.externalId}>
        <Link href={getRoute('show_tasks_path', task.externalId)}>
          {task.name}
        </Link>
      </li>
    ))}
  </ul>
);

export default withHenri(Tasks);
```

`withHenri` wraps a page component. On the server it reads what henri attached to the request (`req._henri`, never the url); on client-side navigation it fetches the same url as JSON. The page receives these props, and nested components read the same values from `useHenri()`:

| Prop       | Description                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `data`     | What the controller passed to `res.render()`, or the GraphQL result. Follows navigation, and `hydrate()` overrides it until the next navigation. |
| `user`     | The logged-in user (`id`, `email`, `roles`, the `config.user.public` fields) or `null`                                                           |
| `paths`    | The routes this user may call, keyed like `index_tasks_path`                                                                                     |
| `csrf`     | The CSRF token, or `null` without a user model                                                                                                   |
| `errors`   | GraphQL errors of the render, or `null`                                                                                                          |
| `flash`    | The [flash messages](/guides/controllers/#flash-messages) of this render, by type (`{ notice: ['Saved'] }`)                                      |
| `graphql`  | `{ endpoint, query }` of the render                                                                                                              |
| `localUrl` | The url the server listens on                                                                                                                    |
| `error`    | The error of the last `hydrate()` or client-side fetch, or `null`                                                                                |
| `pathFor`  | `pathFor('show_tasks_path', id)` builds a url from a route name (see below)                                                                      |
| `getRoute` | `getRoute('show_tasks_path', id)` returns the url as a string, or `'route-not-found'`                                                            |
| `fetch`    | `fetch(target, body)` calls a route and resolves with the parsed answer (see below)                                                              |
| `hydrate`  | Fetches the current url as JSON again and updates `data`; keeps the current data when the answer is not a henri page                             |
| `router`   | The Next.js router (`withRouter`)                                                                                                                |

`pathFor(name)` returns the route entry, `{ method, route, roles }`; `pathFor(name, '42')` returns the route as a string with `:id` filled; `pathFor(name, { id: '42' })` returns `{ method, route }` with every parameter filled (the object stringifies to its route). An unknown name returns `undefined` and logs a warning. Parameters are replaced whole, so `:id` never touches `:identifier`.

`fetch(target, body)` takes a url or a `pathFor()` result (its `method` is used) and goes through the native `fetch` with `Accept: application/json`, a JSON body, the same-origin cookies and the `X-CSRF-Token` header when there is a token. It resolves with the parsed body (JSON when the server sends JSON, text otherwise, `null` for a 204). A non-2xx answer rejects with a `RequestError`: `message`, `statusCode`, `error` and `data` from the boom body, `status`, `body` and `response` from the answer.

```jsx
const destroy = async (id) => {
  await fetch(pathFor('destroy_tasks_path', { id })); // DELETE /tasks/:id
  await hydrate();
};
```

```jsx
// app/views/components/nav.js
import Link from 'next/link';
import { useHenri } from '@usehenri/react';

export default function Nav() {
  const { user, getRoute } = useHenri();

  return (
    <Link href={getRoute('index_tasks_path')}>
      {user ? user.email : 'Tasks'}
    </Link>
  );
}
```

Any folder under `app/views` is importable by name (`import Nav from 'components/nav'`, `import styles from 'styles/tasks.module.scss'`), thanks to `jsconfig.json`. Global stylesheets are imported from `app/views/pages/_app.js` (a Next.js rule), which is where the [Tailwind stylesheet](#styles) is imported; `sass` resolves imports from `app/views/styles`, `app/views` and `node_modules`.

### Forms

`@usehenri/react/forms` exports `Form`, `Input`, `Select`, `Radio`, `Editor`, `Button`, `FormError`, the `useForm()` hook and `FormContext`. A form keeps its fields' data, validates on change with [validator.js](https://github.com/validatorjs/validator.js) rules, sanitizes on submit and posts through `fetch()`.

```jsx
// app/views/pages/tasks/new.js
import withHenri from '@usehenri/react';
import { Button, Form, FormError, Input, Select } from '@usehenri/react/forms';

const NewTask = ({ pathFor, router }) => (
  <Form
    action={pathFor('create_tasks_path')}
    onSuccess={() => router.push('/tasks')}
  >
    <FormError />
    <Input
      name="name"
      placeholder="Name"
      required
      validation={{ isLength: { min: 1 } }}
      errorMsg={{ isLength: 'Minimum 1 char' }}
      sanitation={{ trim: true }}
    />
    <Select
      name="category"
      placeholder="Category"
      choices={['low', 'medium', 'high', 'urgent']}
    />
    <Button>Create Task</Button>
  </Form>
);

export default withHenri(NewTask);
```

- `Form` props: `action` (a route string or a `pathFor()` result, `POST` by default), `method`, `data` (initial values, followed when the prop changes), `onSuccess(data, result)`, `onError(message, error)`, `onFail` (message when the server sends none), `error` (a message to display), `handleSubmit(action, data, clear)` (replaces the request; not with `action`), `name`, `className`, `debug`. After a successful submission the form calls `hydrate()`, then `onSuccess`, then clears itself; it stays disabled until the request settles.
- Field props: `name` (nested names like `address.street` work), `validation` (`{ isEmail: true, isLength: { min: 3 } }`, any validator.js function), `sanitation` (`{ trim: true, escape: true }`, applied in order), `errorMsg` (`{ rule: message }`), `required`, `disabled`, `placeholder`, `className`, plus anything the underlying element accepts. `Select` takes `choices` (strings, or objects read through `displayProp`, `name` by default, valued by `externalId`, `_id`, `id` or `value`) and renders `placeholder` as a real first option. `Radio` takes `group` (the data key) and `name` (the value it sets). `Editor` is a [Quill](https://quilljs.com/) rich text field loaded in the browser only, controlled by the form data; import `react-quill-new/dist/quill.snow.css` from the page that uses it.
- A `422` answer whose `data.errors` maps field names to messages (what the scaffolded controllers send) shows each message under its field; any other error goes to `FormError`.
- `useForm()` gives a custom field `data`, `errors`, `error`, `disabled`, `modified`, `handleChange(event, validation)`, `handleSubmit()`, `clear()` and `addSanitizer(name, rules)`.

### Extending Next.js

Export a `next` function (or a plain object) from `config/next.js` to change the Next.js configuration under either bundler:

```js
// config/next.js
module.exports = {
  next: (config) => ({ ...config, images: { unoptimized: true } }),
};
```

If you need webpack-specific hooks, export a `webpack` function from `config/webpack.js`. Its presence switches the engine from Turbopack to webpack. The function must be synchronous and return the configuration it received (a missing `module.rules` or `resolve` fails the build with an explanation):

```js
// config/webpack.js
module.exports = {
  webpack: (config, { dev }, webpack) => {
    config.plugins.push(
      new webpack.ProvidePlugin({ $: 'jquery', jQuery: 'jquery' })
    );

    return config;
  },
};
```

Both files are read once, at boot and by `next build`. Saving them triggers a reload that changes nothing; the terminal asks for a restart.

### Production

`henri server --production` (or `NODE_ENV=production`) builds the pages once, when `app/views/.next/BUILD_ID` (or the `distDir` of your `config/next.js`) is missing, and serves the optimized build. `--force-build` rebuilds even if a build exists. `henri build` runs `next build` on its own without booting henri, so it needs neither a database nor the stores: use it in a Docker build stage (the repository's `docker/Dockerfile` does).

## Inertia

:::caution
New in 1.1 and experimental: the engine, the scaffold and the helpers work end to end, but they have had far less use than the React renderer and their options may change.
:::

The `inertia` renderer speaks the [Inertia.js](https://inertiajs.com/) protocol: your controllers keep rendering routes with `res.render()`, the page is a React 19 component bundled by [Vite](https://vite.dev/), and navigation between pages happens without a full page load. The first visit is server-side rendered; the Inertia client then asks for page objects (JSON) and swaps the component.

```json
{ "renderer": "inertia" }
```

```bash
henri new my-app --renderer inertia
# or, in an existing application
pnpm add @usehenri/inertia @inertiajs/react react react-dom vite @vitejs/plugin-react tailwindcss @tailwindcss/vite sass
```

The engine reads four files from `app/views`. `henri new --renderer inertia` ships them and the engine creates the missing ones on first boot:

| File              | Role                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `index.html`      | The html shell. `<!--head-->` and `<!--body-->` receive the rendered page.                                          |
| `main.jsx`        | The browser entry: `createInertiaApp` resolving `pages/**/*.jsx` with `resolvePage()`.                              |
| `ssr.jsx`         | The server entry: `render(page)` resolves to `{ head, body }`.                                                      |
| `vite.config.mjs` | The shared configuration (`@usehenri/inertia/vite`: React plugin, aliases, builds) merged with the Tailwind plugin. |

`res.render('/tasks/index', { data })` renders `app/views/pages/tasks/index.jsx` (`res.render('/tasks')` finds it too). The page reads what the controller sent through `useHenri()`:

```jsx
// app/views/pages/tasks/index.jsx
import { Form, Link, useHenri } from '@usehenri/inertia';

export default function Tasks() {
  const { data, pathFor, getRoute } = useHenri();

  return (
    <div>
      <Form action={pathFor('create_tasks_path')} resetOnSuccess>
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
          <li key={task.externalId}>{task.name}</li>
        ))}
      </ul>
      <Link href={getRoute('home_main_path')}>home</Link>
    </div>
  );
}
```

`useHenri()` returns the same keys as the React renderer's `withHenri` (`data`, `user`, `paths`, `csrf`, `localUrl`, `flash`, `errors`, `graphql`, `pathFor`, `getRoute`, `fetch`, `hydrate`) plus `query`. They are the props of the Inertia page object, so `usePage().props` from `@inertiajs/react` holds the raw values. `hydrate()` is an Inertia partial reload of `data`; `fetch(target, payload)` is a JSON request outside the Inertia lifecycle (`GET` data goes in the query string) that sends the CSRF header and rejects with an error carrying `status` and `response`.

Forms submit through Inertia's router: a controller answers with a redirect (`res.redirect('/tasks')`; the engine turns it into a `303` after `PUT`, `PATCH` and `DELETE`) and the client lands on the next page. To show validation errors, render the page again after `res.inertia.errors({ name: 'required' })`: they arrive in `errors`. `res.inertia.location(url)` redirects to an external url.

`Form` wraps Inertia's form component: `action` accepts a `pathFor()` result, the method defaults to `POST`, and a hidden `_csrf` field carrying the page's token is added to its children (`csrf={false}` skips it, `csrf="..."` overrides it), so submissions pass henri's [CSRF check](/guides/users/#csrf) in an application with a user model; `fetch()` sends the `X-CSRF-Token` header, and the engine sets an `XSRF-TOKEN` cookie that Inertia's client echoes as `X-XSRF-TOKEN` (an alias henri accepts), so visits made directly with `router.post()` or `useForm().post()` pass as well. `Link`, `Head`, `router`, `usePage` and `useForm` are re-exported from `@inertiajs/react`. `assets`, `components`, `helpers` and `styles` resolve to the matching folders under `app/views`; global stylesheets are imported from `main.jsx`, which is where the [Tailwind stylesheet](#styles) is imported.

Options go under the `inertia` key of your configuration: `ssr: false` renders everything in the browser (the page object is still embedded in the html), `id` changes the root element id (`app`), `entry`, `ssrEntry` and `template` rename the three files above. Hot module replacement in development rides on henri's http server, no second port; in development a page that fails to render on the server answers a `500` with the stack, in production it falls back to client rendering.

`henri server --production` builds the client (`app/views/dist/client`, with a manifest whose hash is the Inertia asset version) and the server bundle (`app/views/dist/ssr`) on the first boot when the manifest is missing, or when `--force-build` is given, then serves `dist/client` with immutable cache headers. `henri build` runs the two Vite builds on their own, without booting henri.

## Handlebars

The `template` renderer serves the `.hbs`, `.html` and `.htm` files under `app/views/pages` and registers everything under `app/views/partials` as partials, named by their path without extension (`{{> menu/left}}` for `partials/menu/left.hbs`). It has no build step and no client-side JavaScript of its own.

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
    <p>{{@user.email}} may go to {{@paths.index_artwork_path.route}}</p>
  </body>
</html>
```

The object passed as `data` to `res.render()` is the template context. The other view options are data variables: `{{@user.email}}`, `{{@paths.index_artwork_path.route}}`, `{{@query.page}}`, `{{@localUrl}}`, `{{@csrf}}` (put it in a hidden `_csrf` field of your forms), `{{@errors}}`, `{{@graphql.endpoint}}`.

A route resolves to exactly one file: `/artwork` is `pages/artwork.{hbs,html,htm}`, then `pages/artwork/index.{hbs,html,htm}`, and `/` is `pages/index.*`. A route without a page is a `404`; a template that fails while rendering is a `500` with the stack logged (and shown in development). Templates are compiled once, recompiled when the file changes and dropped on reload; a partial that does not compile is reported and skipped.

This engine exists in every application whatever the `renderer`: `res.hbs()` renders a Handlebars page from a React or Inertia application, and the [mail views](/guides/mail/#the-views) under `app/views/mailers` are rendered with it, with the same partials. A renderer that wants to render mail itself implements `renderMail({ view, layout, data, meta })` on its engine and answers `{ html, text }` or a string; neither the React nor the Inertia engine does today.

## Vue

The `vue` renderer drives [Nuxt](https://nuxt.com/) the same way the React renderer drives Next.js: pages under `app/views`, data injected by controllers.

```json
{ "renderer": "vue", "experimental": { "vue": true } }
```

:::caution
The Vue renderer was written for Nuxt 2 and has not been exercised since the 2026 revival. It only loads with `experimental.vue` set to `true`, and warns on boot.
:::

## Fetching data again

Every controller that renders a view also answers with JSON. Request the same url with an `Accept: application/json` header and you get `{ csrf, data, errors, graphql, localUrl, paths, query, user }`, the object the page was rendered with. This is what `hydrate()` and client-side navigation use under the hood.
