// The browser entry of the Inertia view engine.
// Pages live under ./pages and are resolved from the route a controller
// passes to res.render(): '/tasks/index' -> ./pages/tasks/index.jsx
// Folders under app/views (components/, styles/, helpers/, assets/) are
// importable by name, e.g. `import Nav from 'components/nav'`.
import { createInertiaApp } from '@inertiajs/react';
import { resolvePage } from '@usehenri/inertia';
import './styles/index.css';

const pages = import.meta.glob('./pages/**/*.jsx');

createInertiaApp({
  progress: { color: '#71717b' },
  resolve: (name) => resolvePage(pages, name),
});
