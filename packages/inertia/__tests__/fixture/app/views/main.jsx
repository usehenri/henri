import { createInertiaApp } from '@inertiajs/react';
import { resolvePage } from '@usehenri/inertia';

const pages = import.meta.glob('./pages/**/*.jsx');

createInertiaApp({
  resolve: (name) => resolvePage(pages, name),
});
