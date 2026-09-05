// Vite configuration of the Inertia view engine (dev server and builds).
// It wires the React plugin, the components/, styles/, helpers/ and assets/
// aliases and the client + server builds. Extend it with Vite's mergeConfig:
//
//   import { mergeConfig } from 'vite';
//   export default mergeConfig(henriViteConfig({ views: import.meta.dirname }), {});
import { henriViteConfig } from '@usehenri/inertia/vite';

export default henriViteConfig({ views: import.meta.dirname });
