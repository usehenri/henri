/**
 * AWS Signature Version 4, the two forms an object store needs.
 *
 * ---------------------------------------------------------------------------
 * Why this is written here rather than installed
 * ---------------------------------------------------------------------------
 *
 * `@aws-sdk/client-s3` is a hundred packages, a credential provider chain, a
 * middleware stack and a retry policy, and it exists to speak all of S3 --
 * multipart uploads, inventories, lifecycle rules, replication. This package
 * needs five verbs (`PUT`, `GET`, `HEAD`, `DELETE` and a presigned `GET`) on
 * one bucket, against whichever endpoint the application named. What stands
 * between those five verbs and the network is one signature, and it is the
 * same shape `@usehenri/webhooks` already writes by hand for Standard
 * Webhooks: a canonical string, an HMAC chain and a header.
 *
 * So it is written out, under two hundred lines, with `node:crypto` and
 * nothing else -- and checked against the vectors AWS publishes
 * (`__tests__/signature.spec.js`), which is a stronger statement about
 * correctness than "the SDK was imported".
 *
 * ---------------------------------------------------------------------------
 * The two forms
 * ---------------------------------------------------------------------------
 *
 * **Header signing** (`sign()`) is what a request the application makes
 * carries: the signature goes in `Authorization`, and it covers the method,
 * the path, the query, a named list of headers -- including
 * `x-amz-content-sha256`, the digest of the body -- and the moment. The body
 * is therefore signed: a proxy that changed one byte of an upload invalidates
 * it.
 *
 * **Query signing** (`presign()`) is what a browser is handed: the same
 * canonical request, with the parameters in the query string instead of in
 * headers and `UNSIGNED-PAYLOAD` where the body digest would be, because
 * there is no body to a `GET`. `X-Amz-Expires` is inside the signed string,
 * so the window is not editable, and so is the path, so the url of one
 * object is not the url of another.
 */
const crypto = require('node:crypto');

/** The algorithm, as it appears in every string this file builds */
const ALGORITHM = 'AWS4-HMAC-SHA256';

/** The terminator of a credential scope */
const TERMINATOR = 'aws4_request';

/** The service every signature here is for */
const SERVICE = 's3';

/** What a payload hash says when there is nothing to hash */
const UNSIGNED = 'UNSIGNED-PAYLOAD';

/** The sha256 of zero bytes, which is what an empty body hashes to */
const EMPTY =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * The longest window a presigned url may be given.
 *
 * Seven days is not a policy of henri's, it is the number S3 refuses past:
 * a signing key's scope is a date, and the provider will not honour one
 * older than that. Asking for more is a mistake worth naming rather than a
 * url that stops working next week for no visible reason.
 */
const MAX_EXPIRES = 7 * 24 * 60 * 60;

/**
 * RFC 3986 percent encoding, which is not `encodeURIComponent`.
 *
 * `encodeURIComponent` leaves `!`, `'`, `(`, `)` and `*` alone; AWS's
 * canonical form does not, and a key holding one of them would sign one
 * string and be requested as another. The unreserved set is exactly
 * `A-Za-z0-9-_.~`, plus `/` when a path is being encoded rather than a
 * value.
 *
 * @param {string} value what to encode
 * @param {boolean} [slashes=false] true to leave `/` alone (a path)
 * @returns {string} the encoded value
 */
function encode(value, slashes = false) {
  const encoded = encodeURIComponent(String(value)).replace(
    /[!'()*]/gu,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );

  return slashes ? encoded.replace(/%2F/gu, '/') : encoded;
}

/**
 * The two timestamps a signature is built from: `20130524T000000Z` and the
 * `20130524` its scope is dated with
 *
 * @param {Date} [now=new Date()] the moment
 * @returns {{date: string, stamp: string}} the two forms
 */
function moment(now = new Date()) {
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/gu, '');

  return { date: stamp, stamp: stamp.slice(0, 8) };
}

/**
 * An HMAC-SHA256, as bytes
 *
 * @param {(Buffer|string)} key the key
 * @param {string} value what to sign
 * @returns {Buffer} the digest
 */
const hmac = (key, value) =>
  crypto.createHmac('sha256', key).update(value, 'utf8').digest();

/**
 * A sha256, as lowercase hexadecimal
 *
 * @param {(Buffer|string)} value what to hash
 * @returns {string} the digest
 */
const sha256 = (value) =>
  crypto.createHash('sha256').update(value).digest('hex');

/**
 * The key a request of this day, region and service is signed with.
 *
 * Four HMACs, each one keyed by the last: the date, then the region, then
 * the service, then the terminator. The result is what the signature is
 * computed with, and it is why a signature made for one day cannot be
 * replayed against another -- the key itself is dated.
 *
 * @param {string} secret the secret access key
 * @param {string} stamp the date, as `20130524`
 * @param {string} region the region
 * @returns {Buffer} the signing key
 */
const signingKey = (secret, stamp, region) =>
  hmac(hmac(hmac(hmac(`AWS4${secret}`, stamp), region), SERVICE), TERMINATOR);

/**
 * Sorts two `[name, value]` pairs by name, and by value when the names are
 * equal.
 *
 * By code unit, not by `localeCompare`: the canonical form is defined in
 * bytes, and a locale-aware comparison puts `response-content-disposition`
 * before `X-Amz-Algorithm` because it ignores case. That is a signature of a
 * different request, and the only place it shows is a provider answering
 * `SignatureDoesNotMatch` for a url that looks perfectly reasonable.
 *
 * @param {Array<string>} one the first pair
 * @param {Array<string>} two the second
 * @returns {number} the order
 */
function byteOrder(one, two) {
  if (one[0] !== two[0]) {
    return one[0] < two[0] ? -1 : 1;
  }

  if (one[1] === two[1]) {
    return 0;
  }

  return one[1] < two[1] ? -1 : 1;
}

/**
 * The canonical query string: every parameter encoded and sorted by name.
 *
 * Sorted by the *encoded* name and, for a repeated name, by the encoded
 * value, because that is the order the other side sorts them in -- and the
 * two have to agree byte for byte or the signature is of a different
 * request.
 *
 * @param {object} query the parameters
 * @returns {string} the canonical query string
 */
function canonicalQuery(query) {
  const pairs = [];

  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }

    for (const item of Array.isArray(value) ? value : [value]) {
      pairs.push([encode(name), encode(item)]);
    }
  }

  pairs.sort(byteOrder);

  return pairs.map(([name, value]) => `${name}=${value}`).join('&');
}

/**
 * The canonical headers and the list of their names
 *
 * @param {object} headers the headers
 * @returns {{canonical: string, signed: string}} the two halves
 */
function canonicalHeaders(headers) {
  const entries = Object.entries(headers)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => [
      name.toLowerCase(),
      String(value).trim().replace(/\s+/gu, ' '),
    ])
    .sort(byteOrder);

  return {
    canonical: entries.map(([name, value]) => `${name}:${value}\n`).join(''),
    signed: entries.map(([name]) => name).join(';'),
  };
}

/**
 * The canonical request: the five lines and the payload digest that every
 * signature here is ultimately of
 *
 * @param {object} options the request
 * @param {string} options.method the method
 * @param {string} options.path the path, already `/`-separated
 * @param {object} options.query the query parameters
 * @param {object} options.headers the headers to sign
 * @param {string} options.payload the payload digest, or `UNSIGNED-PAYLOAD`
 * @returns {{request: string, signed: string}} the canonical request and the
 *   list of header names it covers
 */
function canonicalRequest({ headers, method, path, payload, query }) {
  const { canonical, signed } = canonicalHeaders(headers);

  return {
    request: [
      method.toUpperCase(),
      encode(path, true),
      canonicalQuery(query),
      canonical,
      signed,
      payload,
    ].join('\n'),
    signed,
  };
}

/**
 * The string a signature is of: the algorithm, the moment, the scope and the
 * digest of the canonical request
 *
 * @param {string} date the timestamp, as `20130524T000000Z`
 * @param {string} scope the credential scope
 * @param {string} request the canonical request
 * @returns {string} the string to sign
 */
const stringToSign = (date, scope, request) =>
  [ALGORITHM, date, scope, sha256(request)].join('\n');

/**
 * Signs a request by adding an `Authorization` header to it.
 *
 * The body digest is signed too, which is why `payload` is required rather
 * than defaulted to `UNSIGNED-PAYLOAD`: an upload whose bytes are not
 * covered by the signature is an upload a proxy can rewrite.
 *
 * @param {object} options the request
 * @param {object} options.credentials `{ accessKeyId, secretAccessKey, sessionToken }`
 * @param {string} options.region the region
 * @param {string} options.method the method
 * @param {string} options.host the host header
 * @param {string} options.path the path
 * @param {object} [options.query={}] the query parameters
 * @param {object} [options.headers={}] the headers to sign, beyond host and date
 * @param {string} options.payload the sha256 of the body, hex, or `UNSIGNED-PAYLOAD`
 * @param {Date} [options.now=new Date()] the moment
 * @returns {object} every header the request must carry, `Authorization` included
 */
function sign({
  credentials,
  headers = {},
  host,
  method,
  now = new Date(),
  path,
  payload,
  query = {},
  region,
}) {
  const { date, stamp } = moment(now);
  const scope = `${stamp}/${region}/${SERVICE}/${TERMINATOR}`;
  const full = Object.assign({}, headers, {
    host,
    'x-amz-content-sha256': payload,
    'x-amz-date': date,
  });

  if (credentials.sessionToken) {
    full['x-amz-security-token'] = credentials.sessionToken;
  }

  const { request, signed } = canonicalRequest({
    headers: full,
    method,
    path,
    payload,
    query,
  });
  const signature = hmac(
    signingKey(credentials.secretAccessKey, stamp, region),
    stringToSign(date, scope, request)
  ).toString('hex');

  full.authorization = `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;

  return full;
}

/**
 * A presigned url: the same canonical request with the credentials in the
 * query string.
 *
 * What the signature covers, and therefore what cannot be changed after the
 * fact: the method (`GET`), the host, the path -- so a url for one key is
 * not a url for another -- every query parameter, `X-Amz-Date` and
 * `X-Amz-Expires` -- so the window cannot be widened or moved -- and the
 * credential scope, which is dated. Editing any of them changes the
 * canonical request, and the provider computes the signature of what it
 * received rather than trusting what it was told.
 *
 * @param {object} options the request
 * @param {object} options.credentials `{ accessKeyId, secretAccessKey, sessionToken }`
 * @param {string} options.region the region
 * @param {string} [options.method='GET'] the method
 * @param {string} options.origin the scheme and host (`https://bucket.s3.amazonaws.com`)
 * @param {string} options.host the host header, which is what is signed
 * @param {string} options.path the path
 * @param {object} [options.query={}] the query parameters to sign as well
 * @param {number} options.expiresIn how many seconds the url is good for
 * @param {Date} [options.now=new Date()] the moment
 * @returns {string} the url
 * @throws {RangeError} when the window is longer than the provider honours
 */
function presign({
  credentials,
  expiresIn,
  host,
  method = 'GET',
  now = new Date(),
  origin,
  path,
  query = {},
  region,
}) {
  const seconds = Math.floor(Number(expiresIn));

  if (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_EXPIRES) {
    throw new RangeError(
      `a presigned url lasts between 1 and ${MAX_EXPIRES} seconds, not ${expiresIn}`
    );
  }

  const { date, stamp } = moment(now);
  const scope = `${stamp}/${region}/${SERVICE}/${TERMINATOR}`;
  const parameters = Object.assign({}, query, {
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${credentials.accessKeyId}/${scope}`,
    'X-Amz-Date': date,
    'X-Amz-Expires': String(seconds),
    'X-Amz-SignedHeaders': 'host',
  });

  if (credentials.sessionToken) {
    parameters['X-Amz-Security-Token'] = credentials.sessionToken;
  }

  const { request } = canonicalRequest({
    headers: { host },
    method,
    path,
    payload: UNSIGNED,
    query: parameters,
  });
  const signature = hmac(
    signingKey(credentials.secretAccessKey, stamp, region),
    stringToSign(date, scope, request)
  ).toString('hex');

  return `${origin}${encode(path, true)}?${canonicalQuery(
    parameters
  )}&X-Amz-Signature=${signature}`;
}

module.exports = {
  ALGORITHM,
  EMPTY,
  MAX_EXPIRES,
  SERVICE,
  TERMINATOR,
  UNSIGNED,
  byteOrder,
  canonicalHeaders,
  canonicalQuery,
  canonicalRequest,
  encode,
  moment,
  presign,
  sha256,
  sign,
  signingKey,
  stringToSign,
};
