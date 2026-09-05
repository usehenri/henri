import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import cloneDeep from 'lodash/cloneDeep';
import get from 'lodash/get';
import set from 'lodash/set';
import Validation from './validation';
import { FormContext } from './context';
import { HenriContext } from '../withHenri';

/**
 * Apply the sanitizers registered by the fields, each rule receiving the
 * output of the previous one (`{ trim: true, escape: true }` escapes the
 * trimmed value)
 *
 * @param {object} data the form data
 * @param {object} sanitizers `{ [fieldName]: { [rule]: options } }`
 * @returns {object} a sanitized copy
 */
export function sanitize(data, sanitizers = {}) {
  const output = cloneDeep(data);

  for (const [name, rules] of Object.entries(sanitizers)) {
    const value = get(output, name);

    if (rules && typeof value !== 'undefined' && value !== null) {
      const clean = Object.entries(rules).reduce(
        (current, [rule, options]) => Validation(rule, options, current),
        value
      );

      set(output, name, clean);
    }
  }

  return output;
}

/**
 * Normalize the `action` prop: a route string, or the `{ method, route }`
 * object `pathFor()` returns
 *
 * @param {(string|object)} action the action
 * @param {?string} method an explicit method prop
 * @returns {?{ method: string, route: string }} the target
 */
function targetOf(action, method) {
  if (!action) {
    return null;
  }

  if (typeof action === 'object') {
    return {
      method: method || action.method || 'post',
      route: action.route || String(action),
    };
  }

  return { method: method || 'post', route: String(action) };
}

/**
 * A form holding its fields' data, validation and submission
 *
 * @param {object} props props
 * @param {(string|object)} [props.action] where to submit: a route or the
 * `pathFor()` result (`{ method, route }`)
 * @param {string} [props.method] the http method (wins over `action.method`)
 * @param {object} [props.data] the initial (or updated) data
 * @param {function} [props.handleSubmit] `(action, data, clear) => any`,
 * replaces the submission (the form stays disabled while a returned promise
 * is pending)
 * @param {function} [props.onSuccess] `(data, result) => void`
 * @param {function} [props.onError] `(message, error) => void`
 * @param {string} [props.onFail] message shown when the server sends none
 * @param {*} [props.error] an error to display, from the outside
 * @param {boolean} [props.debug] log submissions
 * @returns {React.Element} the form
 */
function Form({
  action = null,
  children,
  className,
  data: initialData = null,
  debug = false,
  error: externalError = null,
  handleSubmit: customSubmit = null,
  method = null,
  name,
  onError = null,
  onFail = '',
  onSuccess = null,
}) {
  const henri = React.useContext(HenriContext);
  const [data, setData] = useState(initialData || {});
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState(externalError);
  const [errors, setErrors] = useState({});
  const [modified, setModified] = useState(false);
  const sanitizers = useRef({});
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  // Follow the data prop (a page navigation, a hydrate())
  useEffect(() => {
    if (initialData) {
      setData(initialData);
      setModified(false);
    }
  }, [initialData]);

  useEffect(() => {
    setError(externalError);
  }, [externalError]);

  const addSanitizer = useCallback((fieldName, rules = {}) => {
    sanitizers.current[fieldName] = rules;

    return () => {
      delete sanitizers.current[fieldName];
    };
  }, []);

  const clear = useCallback(() => {
    if (mounted.current) {
      setData({});
      setErrors({});
      setModified(false);
    }
  }, []);

  const handleChange = useCallback((event, validation = {}) => {
    const { target } = event;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    const fieldName = target.name;
    let failed = null;

    if (value !== '') {
      for (const rule of Object.keys(validation)) {
        if (!failed && Validation(rule, validation[rule], value) === false) {
          failed = rule;
        }
      }
    }

    setError(null);
    setErrors((current) => ({ ...current, [fieldName]: failed }));
    setData((current) => {
      const next = cloneDeep(current);

      set(next, fieldName, value);

      return next;
    });
    setModified(true);
  }, []);

  const submit = useCallback(
    (target, payload) => {
      const { fetch, hydrate = null } = henri || {};

      if (typeof fetch !== 'function') {
        // eslint-disable-next-line no-console
        console.error(
          'Form used outside a page wrapped with withHenri(): unable to submit'
        );

        return Promise.resolve();
      }

      setDisabled(true);

      return fetch(target, payload)
        .then((result) => {
          // eslint-disable-next-line no-console
          debug && console.log('form post successful!', result);
          mounted.current && setError(null);
          typeof hydrate === 'function' && hydrate();
          typeof onSuccess === 'function' && onSuccess(payload, result);
          clear();
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          debug && console.log('form post error:', err);

          const fieldErrors = err && err.data && err.data.errors;
          const message = (err && err.message) || onFail || true;

          if (mounted.current) {
            if (fieldErrors && typeof fieldErrors === 'object') {
              setErrors((current) => ({ ...current, ...fieldErrors }));
            }
            setError(message);
          }
          typeof onError === 'function' && onError(message, err);
        })
        .finally(() => {
          mounted.current && setDisabled(false);
        });
    },
    [clear, debug, henri, onError, onFail, onSuccess]
  );

  const handleSubmit = useCallback(
    (event) => {
      event && event.preventDefault && event.preventDefault();

      if (disabled) {
        return undefined;
      }

      if (customSubmit && action) {
        // eslint-disable-next-line no-console
        return console.error(
          'You have "action" and "handleSubmit" defined, i am puzzled'
        );
      }

      const payload = sanitize(data, sanitizers.current);

      if (debug) {
        // eslint-disable-next-line no-console
        console.log('========= HENRI FORM DATA SUBMISSION =========');
        // eslint-disable-next-line no-console
        console.log(payload);
        // eslint-disable-next-line no-console
        console.log('+++++++++ HENRI FORM END SUBMISSION ++++++++++');
      }

      if (customSubmit) {
        setDisabled(true);

        return Promise.resolve(customSubmit(action, payload, clear)).finally(
          () => mounted.current && setDisabled(false)
        );
      }

      const target = targetOf(action, method);

      if (target) {
        return submit(target, payload);
      }

      // eslint-disable-next-line no-console
      return console.error(
        'No handleSubmit() or action props supplied, i am off...'
      );
    },
    [action, clear, customSubmit, data, debug, disabled, method, submit]
  );

  const value = useMemo(
    () => ({
      _henriForm: true,
      addSanitizer,
      clear,
      data,
      disabled,
      error,
      errors,
      handleChange,
      handleSubmit,
      modified,
    }),
    [
      addSanitizer,
      clear,
      data,
      disabled,
      error,
      errors,
      handleChange,
      handleSubmit,
      modified,
    ]
  );

  return (
    <FormContext.Provider value={value}>
      <form className={className} onSubmit={handleSubmit} id={name}>
        {children}
      </form>
    </FormContext.Provider>
  );
}

Form.displayName = 'henri(Form)';

export default Form;
