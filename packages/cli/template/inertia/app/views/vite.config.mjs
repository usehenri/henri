// Vite configuration of the Inertia view engine (dev server and builds).
// henriViteConfig() wires the React plugin, the components/, styles/,
// helpers/ and assets/ aliases and the client + server builds; mergeConfig
// adds Tailwind CSS v4, which compiles app/views/styles/index.css.
//
// Add your own plugins and options the same way.
import tailwindcss from '@tailwindcss/vite';
import { henriViteConfig } from '@usehenri/inertia/vite';
import { mergeConfig } from 'vite';

export default mergeConfig(henriViteConfig({ views: import.meta.dirname }), {
  plugins: [tailwindcss()],
});
