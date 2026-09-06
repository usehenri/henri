// Type definitions for @usehenri/inertia/vite

import type { UserConfig } from 'vite';

/** The directories aliased inside `app/views` (`components/nav`). */
export declare const ALIASES: string[];

export interface HenriViteOptions {
  /** The views directory (`<cwd>/app/views`). */
  views?: string;
  /** The client entry, relative to `views` (`main.jsx`). */
  entry?: string;
  /** Options for `@vitejs/plugin-react`. */
  react?: Record<string, unknown>;
}

/**
 * The Vite configuration of a henri application: the views as the root, the
 * `components/`, `styles/`, `assets/` and `helpers/` aliases, the manifest the
 * engine reads, and the sass load paths.
 *
 *     import { henriViteConfig } from '@usehenri/inertia/vite';
 *
 *     export default henriViteConfig({ entry: 'main.jsx' });
 */
export declare function henriViteConfig(options?: HenriViteOptions): UserConfig;

/** `henriViteConfig()` with the defaults, already evaluated. */
declare const config: UserConfig;

export default config;
