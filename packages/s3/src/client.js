/**
 * The five requests this package makes, and nothing else.
 *
 * `PUT`, `GET`, `HEAD` and `DELETE` on one object, plus a presigned `GET` a
 * browser makes on its own. They go out through `node:http`/`node:https`
 * rather than `fetch`, for three reasons that are all about the upload:
 *
 * - **`Content-Length`.** S3 refuses a `PUT` without one (a chunked body
 *   needs `aws-chunked`, which is a different signature entirely), and
 *   `Content-Length` is a forbidden header name in the Fetch specification:
 *   undici sets it itself for a buffer and uses chunked encoding for a
 *   stream. `http.request` takes the header that was asked for.
 * - **Streaming, both ways.** A part is on the disk before anything decided
 *   to keep it, so an upload is a file stream and a download is a response
 *   stream; neither is ever held in memory, whatever `maxFileSize` says.
 * - **The socket.** A timeout that means "idle", not "total", is what a
 *   large upload needs, and it is `setTimeout` on the request.
 *
 * `@usehenri/webhooks` reaches for the same two modules for the same kind of
 * reason (it pins the socket to an address it checked), so this is the
 * pattern of the repository rather than an exception to it.
 */
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const debug = require('debug')('henri:s3');

const { EMPTY, presign, sha256, sign } = require('./signature');
const { coded } = require('./errors');

/** How long a socket may say nothing before the attempt is abandoned (ms) */
const TIMEOUT = 30000;

/** How many times a request that failed for a passing reason is made again */
const RETRIES = 2;

/** How long the first wait between two attempts is (ms) */
const BACKOFF = 200;

/** How much of an error body is read before the rest is thrown away */
const ERROR_BODY = 8192;

/** The statuses worth making the same request again for */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** Where an object store lives when the application named no endpoint */
const AWS = 's3.{region}.amazonaws.com';

/**
 * What a bucket may be called.
 *
 * The rules of a DNS-compatible bucket name, which is also the only kind
 * that can be put in a host: lowercase letters, digits, dots and hyphens,
 * three to sixty-three characters, starting and ending with a letter or a
 * digit. A name is refused here rather than encoded into a url, because a
 * bucket name reaching a host or a path is the one part of an S3 request an
 * application controls.
 */
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;

/**
 * Reads a response body to the end, up to a bound, and throws it away past
 * it
 *
 * @param {http.IncomingMessage} response the response
 * @param {number} [cap=ERROR_BODY] how many bytes to keep
 * @returns {Promise<string>} what was read
 */
function body(response, cap = ERROR_BODY) {
  return new Promise((resolve) => {
    const chunks = [];
    let seen = 0;

    response.on('data', (chunk) => {
      if (seen < cap) {
        chunks.push(chunk.subarray(0, cap - seen));
        seen += chunk.length;
      }
    });
    response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    response.on('error', () => resolve(Buffer.concat(chunks).toString('utf8')));
    response.resume();
  });
}

/**
 * What an S3 error document says, without parsing XML.
 *
 * The envelope is `<Error><Code>NoSuchKey</Code><Message>...</Message></Error>`
 * on every implementation of the API, and two tags are all that is wanted:
 * an XML parser to read a diagnostic would be a dependency bought for an
 * error path.
 *
 * @param {string} text the response body
 * @returns {{code: ?string, message: ?string}} what it said
 */
function reason(text) {
  const code = /<Code>([^<]{1,120})<\/Code>/u.exec(text || '');
  const message = /<Message>([^<]{1,400})<\/Message>/u.exec(text || '');

  return { code: code && code[1], message: message && message[1] };
}

/**
 * A client for one bucket
 *
 * @class S3Client
 */
class S3Client {
  /**
   * Creates an instance of S3Client.
   *
   * @param {object} [options={}] the storage block of the configuration
   * @memberof S3Client
   */
  constructor(options = {}) {
    const endpoint = this.endpointOf(options);

    this.bucket = String(options.bucket || '');
    this.region = String(options.region || 'us-east-1');
    this.protocol = endpoint.protocol;
    this.host = endpoint.host;
    this.port = endpoint.port;
    this.timeout =
      Number(options.timeout) > 0 ? Number(options.timeout) : TIMEOUT;
    this.retries = Number.isInteger(options.retries)
      ? options.retries
      : RETRIES;
    this.credentials = {
      accessKeyId: options.accessKeyId || '',
      secretAccessKey: options.secretAccessKey || '',
      sessionToken: options.sessionToken || null,
    };

    // Path style is what every S3-compatible store speaks and what AWS
    // still answers; virtual-host style is what AWS prefers and what a
    // custom domain (an R2 bucket behind one) needs. The default follows
    // the endpoint: a named one is almost always MinIO or R2, which want
    // the bucket in the path
    this.pathStyle =
      typeof options.pathStyle === 'boolean'
        ? options.pathStyle
        : Boolean(options.endpoint);

    this.publicEndpoint = options.publicEndpoint
      ? this.endpointOf({ endpoint: options.publicEndpoint })
      : null;
  }

  /**
   * The scheme, host and port an endpoint names
   *
   * @param {object} options `{ endpoint, region }`
   * @returns {object} `{ protocol, host, port }`
   * @throws when the endpoint cannot be read as a url
   * @memberof S3Client
   */
  endpointOf(options) {
    const named =
      options.endpoint || `https://${AWS.replace('{region}', options.region)}`;
    let url;

    try {
      url = new URL(/^[a-z]+:\/\//iu.test(named) ? named : `https://${named}`);
    } catch (error) {
      throw coded(
        'HENRI_UPLOAD_STORAGE_MISCONFIGURED',
        `uploads.storage.endpoint is not a url: ${JSON.stringify(named)}`,
        { cause: error }
      );
    }

    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : null,
      protocol: url.protocol,
    };
  }

  /**
   * Everything that has to be true before a request is worth making
   *
   * @returns {S3Client} this
   * @throws when the bucket or the credentials are missing or unusable
   * @memberof S3Client
   */
  check() {
    if (!BUCKET.test(this.bucket)) {
      throw coded(
        'HENRI_UPLOAD_STORAGE_MISCONFIGURED',
        this.bucket
          ? `uploads.storage.bucket is not a bucket name: ${JSON.stringify(this.bucket)}`
          : 'uploads.storage.bucket is not set'
      );
    }

    if (!this.credentials.accessKeyId || !this.credentials.secretAccessKey) {
      throw coded(
        'HENRI_UPLOAD_STORAGE_MISCONFIGURED',
        'the object store has no credentials: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or accessKeyId and secretAccessKey in uploads.storage'
      );
    }

    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/u.test(this.region)) {
      throw coded(
        'HENRI_UPLOAD_STORAGE_MISCONFIGURED',
        `uploads.storage.region is not a region: ${JSON.stringify(this.region)}`
      );
    }

    return this;
  }

  /**
   * Where one object sits: the host it is asked of, and the path
   *
   * @param {string} key the object key
   * @param {object} [endpoint=null] another endpoint than the default one
   * @returns {{host: string, origin: string, path: string}} the address
   * @memberof S3Client
   */
  addressOf(key, endpoint = null) {
    const at = endpoint || this;
    const hostname = this.pathStyle ? at.host : `${this.bucket}.${at.host}`;
    const authority = at.port ? `${hostname}:${at.port}` : hostname;

    return {
      // What the signature covers and what the `Host` header says: the
      // authority, port and all
      host: authority,
      // Where the socket goes, which is the same name -- a virtual-host
      // style bucket is a DNS name of its own, and connecting elsewhere
      // would ask TLS for a certificate nobody issued
      hostname,
      origin: `${at.protocol}//${authority}`,
      path: this.pathStyle ? `/${this.bucket}/${key}` : `/${key}`,
    };
  }

  /**
   * One attempt at one request
   *
   * @param {object} options the request
   * @param {string} options.method the method
   * @param {string} options.key the object key
   * @param {object} options.headers the headers beyond the signed ones
   * @param {string} options.payload the sha256 of the body, hex
   * @param {?string} options.file a file to stream as the body
   * @param {?number} options.length the body's length
   * @returns {Promise<http.IncomingMessage>} the response, unread
   * @memberof S3Client
   */
  attempt({ file, headers, key, length, method, payload }) {
    const { host, hostname, path } = this.addressOf(key);
    const signed = sign({
      credentials: this.credentials,
      headers: Object.assign({}, headers, {
        ...(length === null ? {} : { 'content-length': String(length) }),
      }),
      host,
      method,
      path,
      payload,
      query: {},
      region: this.region,
    });

    return new Promise((resolve, reject) => {
      const client = this.protocol === 'http:' ? http : https;
      const request = client.request(
        {
          headers: signed,
          host: hostname,
          method,
          path,
          port: this.port || (this.protocol === 'http:' ? 80 : 443),
          protocol: this.protocol,
          // A signature covers the `Host` header, so the one that was signed
          // is the one that goes out: node's own would leave the port off a
          // default one and on everything else, and a signature is of bytes
          setHost: false,
        },
        resolve
      );

      request.setTimeout(this.timeout, () => {
        request.destroy(
          coded(
            'HENRI_UPLOAD_STORAGE_FAILED',
            `the object store said nothing for ${this.timeout}ms`
          )
        );
      });
      request.on('error', reject);

      if (!file) {
        return request.end();
      }

      const stream = fs.createReadStream(file);

      stream.on('error', (error) => {
        request.destroy(error);
        reject(error);
      });

      return stream.pipe(request);
    });
  }

  /**
   * A request, made again when the reason it failed was a passing one.
   *
   * Only a network failure and the statuses a store answers when it is busy
   * are tried again. A `403` is not: a signature that was refused is refused
   * the second time too, and retrying it turns one clear failure into three
   * slow ones.
   *
   * @param {object} options see `attempt()`
   * @returns {Promise<http.IncomingMessage>} the response, unread
   * @throws {StorageError} when every attempt failed
   * @memberof S3Client
   */
  async send(options) {
    let last = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        const wait = BACKOFF * 2 ** (attempt - 1);

        await new Promise((resolve) =>
          setTimeout(resolve, wait + Math.random() * wait).unref()
        );
      }

      try {
        const response = await this.attempt(options);

        if (!RETRYABLE.has(response.statusCode)) {
          return response;
        }

        last = await this.failure(options, response);
      } catch (error) {
        last = coded(
          'HENRI_UPLOAD_STORAGE_FAILED',
          `${options.method} ${options.key}: ${error.message}`,
          { cause: error, key: options.key }
        );
      }

      debug('%s %s failed: %s', options.method, options.key, last.message);
    }

    throw last;
  }

  /**
   * The error a response that is not a success means
   *
   * @param {object} options the request that was made
   * @param {http.IncomingMessage} response the response
   * @returns {Promise<Error>} the error
   * @memberof S3Client
   */
  async failure(options, response) {
    const text = await body(response);
    const { code, message } = reason(text);
    const region = response.headers['x-amz-bucket-region'];
    const status = response.statusCode;

    if (status === 301 || status === 307) {
      return coded(
        'HENRI_UPLOAD_STORAGE_MISCONFIGURED',
        `the object store redirected ${options.method} ${options.key}${
          region ? `: the bucket is in ${region}, not ${this.region}` : ''
        }`,
        { key: options.key, status }
      );
    }

    return coded(
      'HENRI_UPLOAD_STORAGE_FAILED',
      `${options.method} ${options.key}: the object store answered ${status}${
        code ? ` ${code}` : ''
      }${message ? ` (${message})` : ''}`,
      { key: options.key, reason: code || null, status }
    );
  }

  /**
   * Writes an object from a local file
   *
   * @param {string} key the object key
   * @param {object} options `{ file, length, checksum, type, name }`
   * @returns {Promise<string>} the key
   * @memberof S3Client
   */
  async put(key, { checksum, file, length, name, type }) {
    const headers = { 'content-type': type || 'application/octet-stream' };

    if (name) {
      // The original name, kept where the object store keeps metadata rather
      // than in the key, which is generated and stays generated. Encoded,
      // because a header is latin-1 and a filename is not
      headers['x-amz-meta-name'] = encodeURIComponent(name);
    }

    const response = await this.send({
      file,
      headers,
      key,
      length,
      method: 'PUT',
      payload: checksum,
    });

    if (response.statusCode !== 200) {
      throw await this.failure({ key, method: 'PUT' }, response);
    }

    response.resume();

    return key;
  }

  /**
   * Reads an object
   *
   * @param {string} key the object key
   * @returns {Promise<http.IncomingMessage>} the body, as a stream
   * @throws {StorageError} when there is no such object
   * @memberof S3Client
   */
  async get(key) {
    const response = await this.send({
      file: null,
      headers: {},
      key,
      length: null,
      method: 'GET',
      payload: EMPTY,
    });

    if (response.statusCode !== 200) {
      throw await this.failure({ key, method: 'GET' }, response);
    }

    return response;
  }

  /**
   * What is known about an object
   *
   * @param {string} key the object key
   * @returns {Promise<?object>} `{ size, modifiedAt }`, or null when there is none
   * @memberof S3Client
   */
  async stat(key) {
    const response = await this.send({
      file: null,
      headers: {},
      key,
      length: null,
      method: 'HEAD',
      payload: EMPTY,
    });

    response.resume();

    if (response.statusCode === 404) {
      return null;
    }

    if (response.statusCode !== 200) {
      throw await this.failure({ key, method: 'HEAD' }, response);
    }

    return {
      modifiedAt: new Date(response.headers['last-modified'] || Date.now()),
      size: Number(response.headers['content-length'] || 0),
    };
  }

  /**
   * Removes an object
   *
   * @param {string} key the object key
   * @returns {Promise<boolean>} true when it was there
   * @memberof S3Client
   */
  async delete(key) {
    // S3 answers 204 whether or not the object was there, so what is
    // reported is what was found just before -- the contract asks for "true
    // when something was removed", and a store with no answer to that
    // question is asked the question that does have one
    const found = await this.stat(key);
    const response = await this.send({
      file: null,
      headers: {},
      key,
      length: null,
      method: 'DELETE',
      payload: EMPTY,
    });

    response.resume();

    if (response.statusCode !== 204 && response.statusCode !== 200) {
      throw await this.failure({ key, method: 'DELETE' }, response);
    }

    return Boolean(found);
  }

  /**
   * A url that hands the object to a client without this process reading it
   *
   * @param {string} key the object key
   * @param {object} options `{ expiresIn, query, now }`
   * @returns {string} the url
   * @memberof S3Client
   */
  url(key, { expiresIn, now = new Date(), query = {} } = {}) {
    const { host, origin, path } = this.addressOf(key, this.publicEndpoint);

    return presign({
      credentials: this.credentials,
      expiresIn,
      host,
      now,
      origin,
      path,
      query,
      region: this.region,
    });
  }
}

module.exports = {
  AWS,
  BACKOFF,
  BUCKET,
  ERROR_BODY,
  RETRIES,
  RETRYABLE,
  S3Client,
  TIMEOUT,
  body,
  reason,
  sha256,
};
