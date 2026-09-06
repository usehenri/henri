const http = require('http');
const https = require('https');
const debug = require('debug')('henri:webhooks');

const { WebhookDeliveryError, WebhookError } = require('./errors');
const { check } = require('./address');

/**
 * One HTTP request to a receiver, and what to make of the answer.
 *
 * Everything here assumes the receiver is hostile until it has proven
 * otherwise, which it never quite does:
 *
 * - the socket connects to the address `address.js` checked, and to no
 *   other: the agent is handed a `lookup` that answers that one address, so
 *   the name cannot resolve to something else between the check and the
 *   connection. TLS still validates against the *name*, not the address, so
 *   pinning costs no certificate warning;
 * - a redirect is not followed. A `3xx` is a receiver choosing the next
 *   url, after henri checked the one it was given, and following it would
 *   hand back the hole the address check just closed. Stripe treats a
 *   redirect as a failure too; henri goes one step further and does not
 *   retry it, because the fix is a registration change, not time;
 * - the answer is read up to `maxBytes` and then the socket is destroyed,
 *   so a receiver that streams forever holds a runner for the length of one
 *   timeout and not a byte more. Nothing in the answer is parsed: it is
 *   kept as a short excerpt, for the operator to read;
 * - one deadline covers the whole exchange -- resolution, connection,
 *   headers and body -- because three separate timeouts add up to a wait
 *   nobody configured.
 */

/** How much of an answer is read, and kept for the operator */
const MAX_BYTES = 65536;

/** How much of the answer is shown in the queue's error message */
const EXCERPT = 500;

/**
 * The statuses a delivery may not be retried on, with what they mean
 *
 * Everything else is retried, `4xx` included: a `401` is a token that was
 * rotated a minute ago, a `404` is a deploy that is half done, and the
 * queue's backoff is patient enough to outlive both. The two exceptions are
 * the answers where waiting cannot help:
 *
 * - `3xx`: the url is wrong. It has to be re-registered.
 * - `410 Gone`: the receiver is saying "stop". henri stops, and disables
 *   the endpoint so nothing else is queued for it.
 */
const FINAL = {
  gone: 410,
  redirect: [300, 399],
};

/**
 * Whether an answer means the delivery arrived
 *
 * @param {number} status The HTTP status
 * @returns {boolean} Whether it is a 2xx
 */
const accepted = (status) => status >= 200 && status < 300;

/**
 * A short, single-line excerpt of what a receiver answered
 *
 * @param {string} body The answer body
 * @returns {string} The excerpt
 */
const excerpt = (body) =>
  String(body || '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, EXCERPT);

/**
 * Sends one request, to one address, with one deadline
 *
 * @param {object} options Options
 * @param {URL} options.url The url
 * @param {string} options.address The address the socket connects to
 * @param {number} options.family 4 or 6
 * @param {string} options.body The body, as it was signed
 * @param {object} options.headers The headers to send
 * @param {number} options.timeout The deadline, in milliseconds
 * @param {number} [options.maxBytes=MAX_BYTES] How much answer to read
 * @returns {Promise<object>} `{ status, headers, body, duration }`
 * @throws {WebhookError} HENRI_WEBHOOK_TIMEOUT, or the socket's own error
 */
const send = ({
  address,
  body,
  family,
  headers,
  maxBytes = MAX_BYTES,
  timeout,
  url,
}) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const client = url.protocol === 'https:' ? https : http;
    const payload = Buffer.from(body, 'utf8');
    let settled = false;
    let timer = null;

    /**
     * Answers once, whichever of the deadline and the socket got there first
     *
     * @param {?Error} error What went wrong, or nothing
     * @param {object} [answer] The answer
     * @returns {void}
     */
    const done = (error, answer) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      if (error) {
        reject(error);

        return;
      }

      resolve({ ...answer, duration: Date.now() - started });
    };

    const request = client.request(
      url,
      {
        agent: false,
        headers: {
          ...headers,
          'content-length': String(payload.length),
        },
        // The name resolved once, was checked, and is not asked again: this
        // is what closes the window between the check and the connection.
        // `autoSelectFamily` (on by default since Node 20) asks with
        // `all: true` and wants a list back, so both shapes are answered
        lookup: (hostname, settings, callback) =>
          settings && settings.all
            ? callback(null, [{ address, family }])
            : callback(null, address, family),
        method: 'POST',
      },
      (response) => {
        const chunks = [];
        let size = 0;

        response.on('data', (chunk) => {
          size += chunk.length;
          chunks.push(size > maxBytes ? chunk.subarray(0, maxBytes) : chunk);

          if (size >= maxBytes) {
            response.destroy();
          }
        });

        /**
         * Hands back what was read, however the answer ended
         *
         * @returns {void}
         */
        const finish = () =>
          done(null, {
            body: Buffer.concat(chunks).toString('utf8').slice(0, maxBytes),
            headers: response.headers,
            status: response.statusCode,
          });

        response.on('end', finish);
        // A body cut short by maxBytes emits `close`, never `end`
        response.on('close', finish);
        response.on('error', (error) => done(error));
      }
    );

    timer = setTimeout(() => {
      request.destroy();
      done(
        new WebhookError(
          'HENRI_WEBHOOK_TIMEOUT',
          `the receiver did not answer within ${timeout}ms`,
          { timeout }
        )
      );
    }, timeout);

    request.on('error', (error) => done(error));
    request.end(payload);
  });

/**
 * Delivers a signed body to a url, and says what the answer means
 *
 * @param {object} options Options
 * @param {string} options.url Where to deliver
 * @param {string} options.body The body, as it was signed
 * @param {object} options.headers The headers, signature included
 * @param {number} options.timeout The deadline, in milliseconds
 * @param {boolean} [options.allowHttp] Allow a plaintext url
 * @param {boolean} [options.allowPrivate] Allow a private address
 * @param {Function} [options.lookup] A `dns.promises.lookup` stand-in
 * @param {number} [options.maxBytes] How much answer to read
 * @returns {Promise<object>} `{ status, address, duration, body }`
 * @throws {WebhookAddressError} When the address may not be reached
 * @throws {WebhookDeliveryError} When the receiver refused the delivery
 */
const deliver = async (options) => {
  const { address, family, url } = await check(options.url, options);

  debug('POST %s (%s)', url.href, address);

  const answer = await send({
    address,
    body: options.body,
    family,
    headers: options.headers,
    maxBytes: options.maxBytes,
    timeout: options.timeout,
    url,
  });
  const result = {
    address,
    body: excerpt(answer.body),
    duration: answer.duration,
    status: answer.status,
  };

  if (accepted(answer.status)) {
    return result;
  }

  const [from, to] = FINAL.redirect;
  const location = answer.headers.location;

  if (answer.status >= from && answer.status <= to) {
    throw new WebhookDeliveryError(
      `the receiver answered ${answer.status} and pointed at ${location || 'nowhere'}; a delivery does not follow a redirect`,
      {
        ...result,
        hint: 'Register the url the redirect names: henri webhooks:update <id> --url <url>',
        retryable: false,
      }
    );
  }

  if (answer.status === FINAL.gone) {
    throw new WebhookDeliveryError(
      'the receiver answered 410 Gone: it is asking not to be sent to again',
      { ...result, gone: true, retryable: false }
    );
  }

  throw new WebhookDeliveryError(
    `the receiver answered ${answer.status}${result.body ? `: ${result.body}` : ''}`,
    result
  );
};

module.exports = {
  EXCERPT,
  FINAL,
  MAX_BYTES,
  accepted,
  deliver,
  excerpt,
  send,
};
