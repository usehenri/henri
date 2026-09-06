/**
 * An object store that speaks enough of the S3 API to be honest about what
 * it proves.
 *
 * It is not MinIO and it does not pretend to be. What it does is the part a
 * fake can do better than a real server: it **verifies every signature it is
 * sent**, independently of the client, by pulling the signed header names out
 * of the `Authorization` header, reading those values off the wire and
 * recomputing the signature from them. So a header the client signed and did
 * not send, one it sent and did not sign, a `Content-Length` node rewrote or
 * a `Host` that is not the one the signature covers all fail here -- which is
 * exactly the class of bug a fake that only looked for the word `AWS4` would
 * miss.
 *
 * It also recomputes the sha256 of every body it receives and compares it
 * with `x-amz-content-sha256`, so a `PUT` whose payload digest is of
 * something other than the bytes that arrived is refused.
 *
 * What it does **not** prove is that the signature algorithm is right: it
 * uses the same implementation the client does. That is
 * `__tests__/signature.spec.js`'s job, against the vectors AWS publishes,
 * and `__tests__/live.spec.js`'s against a real MinIO.
 */
const crypto = require('node:crypto');
const http = require('node:http');

const {
  canonicalRequest,
  presign,
  signingKey,
  stringToSign,
} = require('../src/signature');

/** The credentials the fake accepts */
const CREDENTIALS = {
  accessKeyId: 'henri-test-key',
  secretAccessKey: 'henri-test-secret',
};

/** The region it claims to be in */
const REGION = 'us-east-1';

/** The bucket it holds */
const BUCKET = 'henri-uploads';

/**
 * An S3 error document
 *
 * @param {string} code the error code
 * @param {string} message what went wrong
 * @returns {string} the XML
 */
const error = (code, message) =>
  `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`;

/**
 * Reads a request body to the end
 *
 * @param {http.IncomingMessage} req the request
 * @returns {Promise<Buffer>} the body
 */
const read = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

/**
 * The parts of an `Authorization` header
 *
 * @param {string} value the header
 * @returns {?object} `{ accessKeyId, scope, signed, signature }`, or null
 */
function parse(value) {
  const match =
    /^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/u.exec(
      value || ''
    );

  return match
    ? {
        accessKeyId: match[1],
        scope: match[2],
        signature: match[4],
        signed: match[3].split(';'),
      }
    : null;
}

/**
 * Recomputes the signature of a request from what actually arrived
 *
 * @param {http.IncomingMessage} req the request
 * @param {object} parsed what `parse()` read from the header
 * @param {object} query the query parameters
 * @returns {string} the signature this request should have carried
 */
function recompute(req, parsed, query) {
  const headers = {};

  for (const name of parsed.signed) {
    headers[name] = req.headers[name];
  }

  const { request } = canonicalRequest({
    headers,
    method: req.method,
    path: decodeURIComponent(req.url.split('?')[0]),
    payload: req.headers['x-amz-content-sha256'],
    query,
  });

  return crypto
    .createHmac(
      'sha256',
      signingKey(
        CREDENTIALS.secretAccessKey,
        parsed.scope.split('/')[0],
        REGION
      )
    )
    .update(
      stringToSign(req.headers['x-amz-date'], parsed.scope, request),
      'utf8'
    )
    .digest('hex');
}

/**
 * A presigned url is verified by signing the same request again and
 * comparing, then by looking at the window it named
 *
 * @param {http.IncomingMessage} req the request
 * @param {URL} url the url that was asked for
 * @param {string} origin the origin it was asked of
 * @returns {?string} what is wrong with it, or null
 */
function verifyPresigned(req, url, origin) {
  const given = url.searchParams.get('X-Amz-Signature');
  const date = url.searchParams.get('X-Amz-Date');
  const expires = Number(url.searchParams.get('X-Amz-Expires'));
  const query = {};

  for (const [name, value] of url.searchParams.entries()) {
    if (name !== 'X-Amz-Signature') {
      query[name] = value;
    }
  }

  const at = new Date(
    date.replace(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u,
      '$1-$2-$3T$4:$5:$6Z'
    )
  );
  const wanted = presign({
    credentials: CREDENTIALS,
    expiresIn: expires,
    host: req.headers.host,
    now: at,
    origin,
    path: decodeURIComponent(url.pathname),
    query: Object.fromEntries(
      Object.entries(query).filter(([name]) => !name.startsWith('X-Amz-'))
    ),
    region: REGION,
  });

  if (new URL(wanted).searchParams.get('X-Amz-Signature') !== given) {
    return 'SignatureDoesNotMatch';
  }

  return Date.now() > at.getTime() + expires * 1000 ? 'AccessDenied' : null;
}

/**
 * Starts a fake object store on a port the kernel picks
 *
 * @param {object} [options={}] `{ objects }` to start with something in it
 * @returns {Promise<object>} `{ url, objects, requests, close }`
 */
async function fakeStore(options = {}) {
  const objects = options.objects || new Map();
  const requests = [];
  let origin = '';

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const key = decodeURIComponent(url.pathname).replace(/^\/+/u, '');
    const body = await read(req);

    requests.push({ headers: req.headers, key, method: req.method });

    /**
     * Answers with a status and a body
     *
     * @param {number} status the status
     * @param {(Buffer|string)} [payload=''] the body
     * @param {object} [headers={}] the headers
     * @returns {void}
     */
    const answer = (status, payload = '', headers = {}) => {
      res.writeHead(status, headers);
      res.end(req.method === 'HEAD' ? undefined : payload);
    };

    if (url.searchParams.has('X-Amz-Signature')) {
      const wrong = verifyPresigned(req, url, origin);

      if (wrong) {
        return answer(403, error(wrong, 'the presigned url is not valid'));
      }
    } else {
      const parsed = parse(req.headers.authorization);

      if (!parsed || parsed.accessKeyId !== CREDENTIALS.accessKeyId) {
        return answer(403, error('InvalidAccessKeyId', 'no such key'));
      }

      if (
        recompute(req, parsed, Object.fromEntries(url.searchParams)) !==
        parsed.signature
      ) {
        return answer(
          403,
          error('SignatureDoesNotMatch', 'the wire is not what was signed')
        );
      }

      if (
        body.length > 0 &&
        crypto.createHash('sha256').update(body).digest('hex') !==
          req.headers['x-amz-content-sha256']
      ) {
        return answer(
          400,
          error('XAmzContentSHA256Mismatch', 'the digest is of other bytes')
        );
      }
    }

    const [bucket, ...rest] = key.split('/');
    const name = rest.join('/');

    if (bucket !== BUCKET) {
      return answer(404, error('NoSuchBucket', 'no such bucket'));
    }

    if (name === '') {
      return answer(200, '', { 'content-length': '0' });
    }

    if (req.method === 'PUT') {
      objects.set(name, {
        body,
        modifiedAt: new Date(),
        name: req.headers['x-amz-meta-name'] || null,
        type: req.headers['content-type'] || null,
      });

      return answer(200, '', { etag: '"fake"' });
    }

    const found = objects.get(name);

    if (req.method === 'DELETE') {
      objects.delete(name);

      return answer(204);
    }

    if (!found) {
      return answer(404, error('NoSuchKey', 'no such key'));
    }

    if (req.method === 'HEAD') {
      return answer(200, '', {
        'content-length': String(found.body.length),
        'content-type': found.type || 'application/octet-stream',
        'last-modified': found.modifiedAt.toUTCString(),
      });
    }

    return answer(200, found.body, {
      'content-length': String(found.body.length),
      'content-type': found.type || 'application/octet-stream',
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  origin = `http://127.0.0.1:${server.address().port}`;

  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    objects,
    requests,
    url: origin,
  };
}

module.exports = { BUCKET, CREDENTIALS, REGION, fakeStore, parse };
