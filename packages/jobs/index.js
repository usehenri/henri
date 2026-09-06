const config = require('./src/config');
const cron = require('./src/cron');
const definitions = require('./src/definitions');
const errors = require('./src/errors');
const serialize = require('./src/serialize');
const store = require('./src/store');

const JobsModule = require('./src/module');

const { Jobs, MAIL_JOB, STATES, toJob } = require('./src/jobs');
const { Runner } = require('./src/runner');
const { duration } = require('./src/duration');

/**
 * Background jobs for henri.
 *
 * This package ships the henri module itself (`"henri": { "module":
 * "./module.js" }` in its package.json), so an application that depends on
 * it has the queue in its boot as `henri.jobs`. Building one by hand is for
 * a runner, a test or a script that has a henri instance but no module.
 *
 * @param {object} henri A henri instance
 * @param {object} [options={}] `config` (the `jobs` block), `cwd`, `adapter`
 * @returns {Jobs} The queue
 */
const create = (henri, options = {}) => new Jobs(henri, options);

module.exports = create;
module.exports.Jobs = Jobs;
module.exports.JobsModule = JobsModule;
module.exports.MAIL_JOB = MAIL_JOB;
module.exports.Runner = Runner;
module.exports.STATES = STATES;
module.exports.config = config;
module.exports.create = create;
module.exports.cron = cron;
module.exports.definitions = definitions;
module.exports.duration = duration;
module.exports.errors = errors;
module.exports.serialize = serialize;
module.exports.store = store;
module.exports.toJob = toJob;
