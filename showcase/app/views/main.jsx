// The browser entry of the Inertia view engine.
// Pages live under ./pages and are resolved from the route a controller
// passes to res.render(): '/proposals/index' -> ./pages/proposals/index.jsx
import { createInertiaApp } from '@inertiajs/react';
import { resolvePage } from '@usehenri/inertia';
import './styles/index.css';

const pages = import.meta.glob('./pages/**/*.jsx');

createInertiaApp({
  progress: { color: '#4f46e5' },
  resolve: (name) => resolvePage(pages, name),
});
