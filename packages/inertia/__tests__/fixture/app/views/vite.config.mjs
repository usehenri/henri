// An application imports '@usehenri/inertia/vite'; the fixture lives inside
// the package itself, so it reaches the shared configuration directly.
import { henriViteConfig } from '../../../../vite.mjs';

export default henriViteConfig({ views: import.meta.dirname });
