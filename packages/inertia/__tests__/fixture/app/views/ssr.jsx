import { createInertiaApp } from '@inertiajs/react';
import { resolvePage } from '@usehenri/inertia';
import { renderToString } from 'react-dom/server';

const pages = import.meta.glob('./pages/**/*.jsx');

export function render(page) {
  return createInertiaApp({
    page,
    render: renderToString,
    resolve: (name) => resolvePage(pages, name),
    setup: ({ App, props }) => <App {...props} />,
  });
}
