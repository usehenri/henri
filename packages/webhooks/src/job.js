const { DELIVERY_JOB } = require('./webhooks');

/**
 * The job that performs one delivery.
 *
 * A delivery is a job and nothing else, which is the whole design: the
 * retries, the exponential backoff, the dead letter queue, the visibility
 * (`henri jobs:list --queue webhooks`, `henri jobs:dead`,
 * `henri jobs:show <id>`) and the recovery of a runner that died mid-flight
 * are the queue's, already written, already covered on four databases. A
 * second delivery mechanism would be a second, worse copy of it.
 *
 * The job's own timeout is the HTTP deadline plus a margin, on purpose: the
 * request's deadline should be what fires, because it says
 * "the receiver did not answer within 10000ms" and the job's timeout says
 * only that the attempt ran long. The margin is the backstop for the case
 * where something outside the request hangs.
 */

/** How much longer than the request the job itself may take */
const MARGIN = 5000;

/**
 * The definition of the delivery job, for `henri.jobs.define()`
 *
 * @param {object} webhooks A started Webhooks
 * @returns {object} `{ name, definition }`
 */
const definition = (webhooks) => ({
  definition: {
    backoff: webhooks.config.backoff,
    maxAttempts: webhooks.config.maxAttempts,

    /**
     * Delivers one webhook
     *
     * @param {object} args `{ body, endpoint, event, id }`
     * @param {object} context The job context
     * @returns {Promise<object>} What happened
     */
    perform: (args, context) => webhooks.perform(args, context),

    queue: webhooks.config.queue,
    timeout: webhooks.config.timeout + MARGIN,
  },
  name: DELIVERY_JOB,
});

module.exports = { MARGIN, definition };
