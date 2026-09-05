import { createElement } from 'react';
import { Form as InertiaForm, useForm } from '@inertiajs/react';

/**
 * Turn a henri action (a route string or a pathFor() result) into the
 * { url, method } pair Inertia's Form expects. Defaults to POST.
 *
 * @param {(string|{ method?: string, route?: string, url?: string })} action the action
 * @param {string} [method] the http method (wins over the action's)
 * @returns {{ method: string, url: string }} the pair
 */
export function normalizeAction(action, method) {
  if (action && typeof action === 'object') {
    const url = 'url' in action ? action.url : action.route;

    return {
      method: String(method || action.method || 'post').toLowerCase(),
      url: String(url ?? ''),
    };
  }

  return {
    method: String(method || 'post').toLowerCase(),
    url: String(action ?? ''),
  };
}

/**
 * Inertia's <Form> with henri conventions: `action` accepts a pathFor()
 * result and the method defaults to POST. Submissions go through Inertia's
 * router, so a controller answering with a redirect lands on the next page
 * and `res.inertia.errors()` shows up in the render-prop `errors`.
 *
 *   <Form action={pathFor('create_tasks_path')}>
 *     {({ errors, processing }) => (...)}
 *   </Form>
 *
 * @param {object} props the props (see Inertia's Form)
 * @returns {React.ReactElement} the form
 */
export function Form({ action, method, ...props }) {
  const target = normalizeAction(action, method);

  return createElement(InertiaForm, {
    ...props,
    action: target.url,
    method: target.method,
  });
}

export { useForm };
