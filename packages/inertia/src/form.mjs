import { createElement, Fragment } from 'react';
import { Form as InertiaForm, useForm, usePage } from '@inertiajs/react';

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
 * The hidden `_csrf` field henri's CSRF middleware reads from the body
 *
 * @param {?string} csrf the token (`props.csrf`)
 * @returns {?React.ReactElement} the input, or null without a token
 */
export function csrfField(csrf) {
  return csrf
    ? createElement('input', {
        key: '_csrf',
        name: '_csrf',
        type: 'hidden',
        value: csrf,
      })
    : null;
}

/**
 * Prepend the `_csrf` field to a form's children (nodes or render prop)
 *
 * @param {(React.ReactNode|function)} children the form children
 * @param {?string} csrf the token
 * @returns {(React.ReactNode|function)} the children with the field
 */
export function withCsrf(children, csrf) {
  const field = csrfField(csrf);

  if (!field) {
    return children;
  }

  if (typeof children === 'function') {
    return (...args) => createElement(Fragment, null, field, children(...args));
  }

  return createElement(Fragment, null, field, children);
}

/**
 * Inertia's <Form> with henri conventions: `action` accepts a pathFor()
 * result, the method defaults to POST and the CSRF token of the page
 * (`props.csrf`, when henri's CSRF protection is on) travels as a hidden
 * `_csrf` field. Submissions go through Inertia's router, so a controller
 * answering with a redirect lands on the next page and
 * `res.inertia.errors()` shows up in the render-prop `errors`.
 *
 *   <Form action={pathFor('create_tasks_path')}>
 *     {({ errors, processing }) => (...)}
 *   </Form>
 *
 * @param {object} props the props (see Inertia's Form); `csrf={false}` skips
 * the hidden field, `csrf="..."` overrides the page token
 * @returns {React.ReactElement} the form
 */
export function Form({ action, method, children, csrf, ...props }) {
  const target = normalizeAction(action, method);
  const page = usePage();
  const token =
    typeof csrf === 'undefined' ? page && page.props && page.props.csrf : csrf;

  return createElement(
    InertiaForm,
    { ...props, action: target.url, method: target.method },
    withCsrf(children, token || null)
  );
}

export { useForm };
