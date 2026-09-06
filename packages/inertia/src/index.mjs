/**
 * @usehenri/inertia client helpers (ESM, consumed by Vite)
 *
 *   import { useHenri, Link, Form } from '@usehenri/inertia';
 */
export { Form, normalizeAction, useForm } from './form.mjs';
export { EMPTY, henriProps, useHenri } from './henri.mjs';
export {
  NO_LOCALE,
  createTranslator,
  interpolate,
  remember,
  selectPlural,
  useTranslation,
} from './i18n.mjs';
export { getRoute, pathFor } from './paths.mjs';
export { request } from './request.mjs';
export { resolvePage } from './resolve.mjs';
export { Head, Link, router, usePage } from '@inertiajs/react';
