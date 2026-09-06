const address = require('./src/address');
const config = require('./src/config');
const errors = require('./src/errors');
const job = require('./src/job');
const secrets = require('./src/secrets');
const signature = require('./src/signature');
const store = require('./src/store');

const WebhooksModule = require('./src/module');

const { Webhooks, DELIVERY_JOB, subscribed } = require('./src/webhooks');
const { deliver } = require('./src/deliver');

/**
 * Outbound webhooks for henri.
 *
 * This package ships the henri module itself (`"henri": { "module":
 * "./module.js" }` in its package.json), so an application that depends on
 * it has `henri.webhooks` in its boot. Building one by hand is for a test
 * or a script that has a henri instance but no module.
 *
 * The one thing worth importing from here in an application is
 * `verify`: it is the exact counterpart of what henri signs with, so an
 * application that also *receives* its own webhooks (a test, a second
 * service of the same codebase) checks them with the code that wrote them.
 *
 * @param {object} henri A henri instance
 * @param {object} [options={}] `config` (the `webhooks` block), `adapter`
 * @returns {Webhooks} The endpoints
 */
const create = (henri, options = {}) => new Webhooks(henri, options);

module.exports = create;
module.exports.DELIVERY_JOB = DELIVERY_JOB;
module.exports.Webhooks = Webhooks;
module.exports.WebhooksModule = WebhooksModule;
module.exports.address = address;
module.exports.config = config;
module.exports.create = create;
module.exports.deliver = deliver;
module.exports.errors = errors;
module.exports.job = job;
module.exports.secrets = secrets;
module.exports.sign = signature.sign;
module.exports.signature = signature;
module.exports.store = store;
module.exports.subscribed = subscribed;
module.exports.verify = signature.verify;
