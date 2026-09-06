const dns = require('dns');
const net = require('net');

const { WebhookAddressError } = require('./errors');

/**
 * What a delivery is allowed to open.
 *
 * A webhook url is a string an application was handed by someone else, and
 * the process that opens it sits inside the network the receiver would like
 * to reach. That is server-side request forgery with a registration form in
 * front of it: `http://169.254.169.254/latest/meta-data/` is the cloud
 * instance's credentials, `http://localhost:6379/` is the Redis that holds
 * the sessions, `http://10.0.0.5:8080/` is whatever else runs in the
 * cluster.
 *
 * Three rules, and the third is the one that is usually missing:
 *
 * 1. **the scheme**: `https` only, unless the application says otherwise.
 *    `http` leaks the payload and the signature to anyone on the path;
 *    `file:`, `gopher:`, `ftp:` and the rest are refused outright, and so
 *    is a url carrying credentials (`https://user:pass@host/`), which is
 *    how a redirect-following client is talked into authenticating.
 * 2. **the address**: every address the name resolves to is checked against
 *    the ranges below. One bad answer is enough to refuse: a name with an
 *    A record on a public address and an AAAA record on `::1` is a real
 *    attack, not a mistake.
 * 3. **at request time, and pinned**. Checking at registration proves
 *    nothing, because DNS answers differently later -- a name that resolved
 *    publicly when it was registered resolves to `169.254.169.254` when the
 *    delivery goes out. Checking at request time and then letting the HTTP
 *    client resolve the name again re-opens the same hole through the back
 *    door, half a millisecond wide (DNS rebinding). So the address that was
 *    checked is the address the socket connects to: `deliver()` hands the
 *    agent a `lookup` that answers this one and never asks a resolver.
 *
 * What this does not do: it does not follow a redirect (see `deliver.js`),
 * and it does not pretend an allow list is unnecessary. An application that
 * knows the hosts it sends to should say so at its egress; this is the
 * floor, not the ceiling.
 */

/**
 * The ranges a delivery is refused, and what each one is
 *
 * IPv4 first, then IPv6. `2002::/16` (6to4) and `2001::/32` (Teredo) carry
 * an IPv4 address inside them and are refused whole rather than unwrapped,
 * and `64:ff9b::/96` (NAT64) with them.
 */
const RANGES = [
  ['0.0.0.0/8', 'this network', 4],
  ['10.0.0.0/8', 'a private network', 4],
  ['100.64.0.0/10', 'a carrier-grade NAT network', 4],
  ['127.0.0.0/8', 'the loopback', 4],
  ['169.254.0.0/16', 'the link-local range, where the metadata service is', 4],
  ['172.16.0.0/12', 'a private network', 4],
  ['192.0.0.0/24', 'the IETF protocol assignments range', 4],
  ['192.0.2.0/24', 'a documentation range', 4],
  ['192.168.0.0/16', 'a private network', 4],
  ['198.18.0.0/15', 'a benchmarking range', 4],
  ['198.51.100.0/24', 'a documentation range', 4],
  ['203.0.113.0/24', 'a documentation range', 4],
  ['224.0.0.0/4', 'a multicast range', 4],
  ['240.0.0.0/4', 'a reserved range', 4],
  ['::/128', 'the unspecified address', 6],
  ['::1/128', 'the loopback', 6],
  ['64:ff9b::/96', 'a NAT64 range, which carries an IPv4 address', 6],
  ['100::/64', 'the discard range', 6],
  ['2001::/32', 'the Teredo range, which carries an IPv4 address', 6],
  ['2001:db8::/32', 'a documentation range', 6],
  ['2002::/16', 'the 6to4 range, which carries an IPv4 address', 6],
  ['fc00::/7', 'a unique local range', 6],
  ['fe80::/10', 'the link-local range', 6],
  ['ff00::/8', 'a multicast range', 6],
];

/**
 * One `net.BlockList` per range, so the refusal can name the range
 *
 * @returns {Array<object>} `{ list, cidr, what, family }` entries
 */
const lists = RANGES.map(([cidr, what, family]) => {
  const [address, prefix] = cidr.split('/');
  const list = new net.BlockList();

  list.addSubnet(address, Number(prefix), family === 4 ? 'ipv4' : 'ipv6');

  return { cidr, family, list, what };
});

/** An IPv4 address written as an IPv6 one: `::ffff:127.0.0.1` */
const MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu;

/** The same, written in hexadecimal: `::ffff:7f00:1` */
const MAPPED_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/iu;

/** The schemes a delivery may open */
const SCHEMES = ['https:', 'http:'];

/**
 * An address as it will be checked: an IPv4-mapped IPv6 address is an IPv4
 * address, however it was written, and checking the wrapper is how
 * `::ffff:127.0.0.1` reaches the loopback
 *
 * @param {string} address An IP address
 * @returns {string} The address, unwrapped
 */
const unwrap = (address) => {
  const dotted = MAPPED.exec(address);

  if (dotted) {
    return dotted[1];
  }

  const hex = MAPPED_HEX.exec(address);

  if (!hex) {
    return address;
  }

  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);

  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
};

/**
 * Why an address must not be reached, or nothing
 *
 * @param {string} value An IP address
 * @returns {?string} What the range is, or null when it is fine
 */
const refusal = (value) => {
  const address = unwrap(String(value));
  const family = net.isIP(address);

  if (family === 0) {
    return 'not an IP address';
  }

  const type = family === 4 ? 'ipv4' : 'ipv6';

  for (const range of lists) {
    if (range.family === family && range.list.check(address, type)) {
      return `${range.what} (${range.cidr})`;
    }
  }

  return null;
};

/**
 * Reads a webhook url, refusing what a delivery must never open
 *
 * @param {string} value The url
 * @param {object} [options={}] `allowHttp`
 * @returns {URL} The url
 * @throws {WebhookAddressError} When the url may not be opened
 */
const parse = (value, options = {}) => {
  let url;

  try {
    url = new URL(String(value));
  } catch (error) {
    throw new WebhookAddressError(`"${value}" is not a url`, {
      cause: error,
      url: String(value),
    });
  }

  if (!SCHEMES.includes(url.protocol)) {
    throw new WebhookAddressError(
      `the ${url.protocol.replace(':', '')} scheme is not delivered to: a webhook url is http or https`,
      { url: url.href }
    );
  }

  if (url.protocol === 'http:' && !options.allowHttp) {
    throw new WebhookAddressError(
      'this url is plaintext http, which sends the payload and its signature in the clear',
      {
        hint: 'Register an https url, or set webhooks.allowHttp in a development configuration',
        url: url.href,
      }
    );
  }

  if (url.username || url.password) {
    throw new WebhookAddressError(
      'this url carries credentials, which a delivery never sends',
      { url: `${url.protocol}//${url.host}${url.pathname}` }
    );
  }

  if (!url.hostname) {
    throw new WebhookAddressError('this url names no host', { url: url.href });
  }

  return url;
};

/**
 * Every address a name answers with
 *
 * @param {string} hostname The host
 * @param {object} [options={}] `lookup`, a `dns.promises.lookup` stand-in
 * @returns {Promise<Array<object>>} `{ address, family }` entries
 * @throws {WebhookAddressError} When the name does not resolve
 */
const resolve = async (hostname, options = {}) => {
  const lookup = options.lookup || dns.promises.lookup;

  try {
    const found = await lookup(hostname, { all: true, verbatim: true });

    return Array.isArray(found) ? found : [found];
  } catch (error) {
    // A name that does not resolve may resolve later (a receiver that has
    // just been deployed, a resolver that blinked), so this one is retried
    throw new WebhookAddressError(`${hostname} does not resolve`, {
      cause: error,
      hostname,
      retryable: true,
    });
  }
};

/**
 * The address a delivery to this url is allowed to connect to
 *
 * Every answer is checked, and one refusal refuses the url: a name with a
 * public A record and a loopback AAAA record is an attack.
 *
 * @param {string} value The url
 * @param {object} [options={}] `allowHttp`, `allowPrivate`, `lookup`
 * @returns {Promise<object>} `{ url, address, family, addresses }`
 * @throws {WebhookAddressError} When the url or an address is refused
 */
const check = async (value, options = {}) => {
  const url = parse(value, options);
  const hostname = url.hostname.replace(/^\[|\]$/gu, '');
  const addresses = await resolve(hostname, options);

  if (addresses.length === 0) {
    throw new WebhookAddressError(`${hostname} does not resolve`, {
      hostname,
      retryable: true,
    });
  }

  if (!options.allowPrivate) {
    for (const answer of addresses) {
      const why = refusal(answer.address);

      if (why) {
        throw new WebhookAddressError(
          `${hostname} resolves to ${answer.address}, which is ${why}`,
          {
            address: answer.address,
            hint: 'A delivery only reaches a public address. webhooks.allowPrivate lifts this, for a development configuration',
            hostname,
            url: url.href,
          }
        );
      }
    }
  }

  const [first] = addresses;

  return {
    address: first.address,
    addresses: addresses.map((answer) => answer.address),
    family: first.family || net.isIP(first.address),
    url,
  };
};

module.exports = { RANGES, SCHEMES, check, parse, refusal, resolve, unwrap };
