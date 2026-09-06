/**
 * What core says when an application asks for the queue without having it.
 *
 * The queue is a module of `@usehenri/jobs`, which the application installs
 * itself; core carries none of it. What reaches for it goes through here, so
 * nothing that was promised to happen later quietly happens now -- or never.
 */

/** The package that carries the queue */
const PACKAGE = '@usehenri/jobs';

/**
 * `henri.jobs`, or a readable error
 *
 * @param {object} henri the henri instance
 * @param {string} asked what asked for it, named in the error
 * @returns {object} the jobs module
 * @throws when the application does not have `@usehenri/jobs`
 */
const queue = (henri, asked) => {
  if (henri.jobs && henri.jobs.enabled) {
    return henri.jobs;
  }

  throw henri.pen.fatal(
    'jobs',
    `
      ${asked}, but ${PACKAGE} is not installed.
      Add it with: npm install ${PACKAGE}`,
    null,
    null,
    'HENRI_JOB_QUEUE_UNAVAILABLE'
  );
};

module.exports = { PACKAGE, queue };
