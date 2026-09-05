/**
 * Controller hooks (`before`) and implicit rendering.
 *
 * A controller may export a `before` block, henri's `before_action`:
 *
 * ```js
 * module.exports = {
 *   before: {
 *     all: [authenticate],                  // every action
 *     'show,edit,update,destroy': loadTask, // a few of them
 *   },
 *
 *   // or, with the rails selectors:
 *   // before: [authenticate, { only: ['show'], run: loadTask }],
 *
 *   show: async (req, res) => ({ task: req.task }),
 * };
 * ```
 *
 * A hook is `(req, res, next)` or an async `(req, res)`; one that answers
 * ends the request and the action never runs.
 *
 * An action that returns without answering renders `/<controller>/<action>`
 * (`/<controller>` for `index`) with what it returned as `data`, the way
 * rails renders `tasks/show` when the action falls through.
 */

/** The exports of a controller that are never actions */
const RESERVED = new Set(['before']);

/**
 * Response methods that answer the request. Wrapping them tells an action
 * that answered from one that returned without answering, even when the
 * answer is still being written (`res.render()` resolves later).
 */
const ANSWERING = [
  'collection',
  'download',
  'end',
  'format',
  'hbs',
  'json',
  'jsonp',
  'negotiate',
  'redirect',
  'render',
  'resource',
  'send',
  'sendFile',
  'sendStatus',
  'write',
  'writeHead',
];

/**
 * A string, an array or nothing, as an array of strings
 *
 * @param {*} value the value
 * @returns {?Array<string>} the strings or null
 */
function names(value) {
  if (typeof value === 'undefined' || value === null) {
    return null;
  }

  return []
    .concat(value)
    .filter((entry) => typeof entry === 'string' && entry.length > 0)
    .map((entry) => entry.trim());
}

/**
 * The functions of a hook value: a function, a name of another export of the
 * controller, or an array of both
 *
 * @param {*} value the hook value
 * @param {object} [controller={}] the controller module (for names)
 * @returns {Array<function>} the functions
 */
function functions(value, controller = {}) {
  return []
    .concat(typeof value === 'undefined' || value === null ? [] : value)
    .map((entry) => (typeof entry === 'string' ? controller[entry] : entry))
    .filter((entry) => typeof entry === 'function');
}

/**
 * Normalizes a `before` export into selectors
 *
 * @param {*} before the `before` export
 * @param {object} [controller={}] the controller module (for hooks by name)
 * @returns {Array<{run: Array<function>, only: ?Array<string>, except: ?Array<string>}>} selectors
 */
function normalize(before, controller = {}) {
  if (!before) {
    return [];
  }

  if (typeof before === 'function' || typeof before === 'string') {
    const run = functions(before, controller);

    return run.length > 0 ? [{ except: null, only: null, run }] : [];
  }

  if (Array.isArray(before)) {
    return before.flatMap((entry) => normalize(entry, controller));
  }

  if (typeof before !== 'object') {
    return [];
  }

  if (typeof before.run !== 'undefined' || typeof before.use !== 'undefined') {
    const run = functions(
      typeof before.run === 'undefined' ? before.use : before.run,
      controller
    );

    return run.length > 0
      ? [{ except: names(before.except), only: names(before.only), run }]
      : [];
  }

  return Object.entries(before).flatMap(([key, value]) => {
    const run = functions(value, controller);

    if (run.length === 0) {
      return [];
    }

    const only = String(key)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (only.length === 1 && (only[0] === 'all' || only[0] === '*')) {
      return [{ except: null, only: null, run }];
    }

    return [{ except: null, only, run }];
  });
}

/**
 * The hooks of one action, in declaration order
 *
 * @param {*} before the `before` export
 * @param {string} action the action name
 * @param {object} [controller={}] the controller module (for hooks by name)
 * @returns {Array<function>} the hooks
 */
function hooksFor(before, action, controller = {}) {
  return normalize(before, controller)
    .filter(
      (entry) =>
        (entry.only === null || entry.only.includes(action)) &&
        (entry.except === null || !entry.except.includes(action))
    )
    .flatMap((entry) => entry.run);
}

/**
 * Wraps the answering methods of a response so `res._answered` tells whether
 * the request was answered (or is being answered)
 *
 * @param {Express.Response} res the response
 * @returns {Express.Response} the response
 */
function track(res) {
  if (res._answered !== undefined) {
    return res;
  }

  res._answered = false;

  for (const name of ANSWERING) {
    const original = res[name];

    if (typeof original !== 'function') {
      continue;
    }

    res[name] = function answering(...args) {
      res._answered = true;

      return original.apply(this, args);
    };
  }

  return res;
}

/**
 * Did the response answer, or start answering?
 *
 * @param {Express.Response} res the response
 * @returns {boolean} answered or not
 */
function answered(res) {
  return Boolean(res._answered || res.headersSent || res.writableEnded);
}

/**
 * Turns one hook into an express middleware: `(req, res, next)` hooks drive
 * `next()` themselves, `(req, res)` hooks continue when they resolve without
 * answering. A hook that answers (a redirect, `res.boom.*`, anything) ends
 * the request and the action never runs.
 *
 * @param {function} hook the hook
 * @returns {function} express middleware
 */
function step(hook) {
  const expectsNext = hook.length >= 3;

  return (req, res, next) => {
    let called = false;
    const done = (error) => {
      if (!called) {
        called = true;
        next(error);
      }
    };
    const settle = () => {
      if (expectsNext || answered(res)) {
        return undefined;
      }

      return done();
    };
    let out;

    try {
      out = expectsNext ? hook(req, res, done) : hook(req, res);
    } catch (error) {
      return done(error);
    }

    if (out && typeof out.then === 'function') {
      return out.then(settle, done);
    }

    return settle(out);
  };
}

/**
 * The middlewares running the hooks of an action
 *
 * @param {Array<function>} hooks the hooks
 * @returns {Array<function>} express middlewares
 */
function chain(hooks) {
  return hooks.map(step);
}

/**
 * The page an action renders when it returns without answering
 *
 * @param {string} controller the controller name (`tasks`, `admin/users`)
 * @param {string} action the action name
 * @returns {string} the route (`/tasks` for index, `/tasks/show` otherwise)
 */
function pageFor(controller, action) {
  return action === 'index' ? `/${controller}` : `/${controller}/${action}`;
}

/**
 * Wraps an action so that returning without answering renders its page
 *
 * @param {function} action the controller action
 * @param {string} controller the controller name
 * @param {string} name the action name
 * @returns {function} express middleware
 */
function implicit(action, controller, name) {
  const page = pageFor(controller, name);

  return async (req, res, next) => {
    let nexted = false;
    const done = (error) => {
      nexted = true;

      return next(error);
    };

    try {
      const result = await action(req, res, done);

      if (nexted || answered(res) || result === false) {
        return undefined;
      }

      const data =
        result && typeof result === 'object' && !Array.isArray(result)
          ? result
          : {};

      return await res.render(page, { data });
    } catch (error) {
      return nexted ? undefined : next(error);
    }
  };
}

module.exports = {
  ANSWERING,
  RESERVED,
  answered,
  chain,
  hooksFor,
  implicit,
  normalize,
  pageFor,
  step,
  track,
};
