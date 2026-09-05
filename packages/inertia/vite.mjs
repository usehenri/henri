/**
 * Vite configuration shared by the henri Inertia view engine and the
 * application's `app/views/vite.config.mjs` (which re-exports it).
 *
 * It is used three times: by the engine's dev server (middleware mode), by
 * the client production build (`dist/client`, with a manifest) and by the
 * server-side rendering build (`dist/ssr`). Every path is derived from the
 * `views` directory so the same file works from `henri server`, `henri build`
 * and a bare `vite build` run from app/views.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { searchForWorkspaceRoot } from 'vite';

const packageDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Folders under app/views importable by name (`import Nav from 'components/nav'`)
 */
export const ALIASES = ['assets', 'components', 'helpers', 'styles'];

/**
 * Build the Vite configuration for an henri application
 *
 * @param {object} [options] options
 * @param {string} [options.views] absolute path of app/views
 * @param {string} [options.entry='main.jsx'] client entry (relative to views)
 * @param {object} [options.react] options forwarded to @vitejs/plugin-react
 * @returns {import('vite').UserConfig} the configuration
 */
export function henriViteConfig({
  views = path.resolve(process.cwd(), 'app/views'),
  entry = 'main.jsx',
  react: reactOptions = {},
} = {}) {
  const workspace = searchForWorkspaceRoot(views);

  return {
    appType: 'custom',
    build: {
      emptyOutDir: true,
      manifest: true,
      outDir: 'dist/client',
      rollupOptions: {
        input: path.join(views, entry),
      },
    },
    clearScreen: false,
    css: {
      preprocessorOptions: {
        scss: {
          loadPaths: [path.join(views, 'styles'), views],
        },
      },
    },
    plugins: [react(reactOptions)],
    // Static files: henri serves app/views/public itself
    publicDir: false,
    resolve: {
      alias: [
        ...ALIASES.map((name) => ({
          find: new RegExp(`^${name}/`),
          replacement: `${path.join(views, name)}/`,
        })),
        // The client helpers always come from the package running the engine,
        // even when @usehenri/inertia is linked from outside the application.
        {
          find: /^@usehenri\/inertia$/,
          replacement: path.join(packageDir, 'src', 'index.mjs'),
        },
      ],
      // A linked @usehenri/inertia must not pull a second copy of react
      dedupe: ['react', 'react-dom', '@inertiajs/react', '@inertiajs/core'],
    },
    root: views,
    server: {
      fs: {
        allow: [workspace, views, packageDir],
      },
    },
    ssr: {
      noExternal: ['@usehenri/inertia'],
    },
  };
}

export default henriViteConfig();
