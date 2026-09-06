/**
 * Who connected, and how sure henri is about it.
 *
 * The call log records the address of the client that made a request. The
 * hard part is not reading a header: every one of `X-Forwarded-For`,
 * `CF-Connecting-IP`, `True-Client-IP` and `X-Real-IP` is text a client
 * typed, and whether any of it can be believed depends entirely on whether
 * the request really arrived through the proxy that sets it.
 *
 * So this file answers one question -- *what does henri believe, and how
 * sure is it* -- and writes the answer down rather than guessing. A row
 * carries three things:
 *
 * - `client`, the address henri believes the request came from, or **null**
 *   when it cannot tell;
 * - `peer`, the address that actually opened the socket, which is never a
 *   guess and is worth having even when `client` is known: it is the
 *   difference between "the client says it is 1.2.3.4" and "1.2.3.4 reached
 *   us through 172.16.0.9";
 * - `source`, how `client` was decided, so nobody has to reconstruct it
 *   from the configuration six months later.
 *
 * ## What henri believes, and when
 *
 * There are two mechanisms, they answer to two different settings, and
 * neither of them is a default:
 *
 * 1. **`X-Forwarded-For` is `config.trustProxy`'s business.** It is
 *    express' `trust proxy` and express already applies it: `req.ip` is the
 *    leftmost address the setting says to believe. henri does not
 *    re-implement that walk and does not second-guess it -- with one
 *    exception, below.
 * 2. **A named header is `calls.address`'s business.** `CF-Connecting-IP`
 *    is not an `X-Forwarded-For` and express will never read it. Believing
 *    one takes two statements from the application, and henri requires
 *    *both*: `calls.address.header` names it, and `calls.address.from`
 *    lists the proxies allowed to set it. A header named without `from` is
 *    a configuration that would have henri believe forgeable text, so it
 *    fails the boot (`HENRI_CALLS_ADDRESS_UNVERIFIABLE`) rather than
 *    quietly working.
 *
 * The exception in the first mechanism is the one that matters, and it is
 * the reason this file exists. **`trustProxy: true` is not an answer.** It
 * is express' "believe the leftmost entry, whoever sent it", it is henri's
 * default, and the boot already warns that it lets anyone forge the address
 * an ip-based rate limit counts. A rate limit that can be escaped is a
 * degraded rate limit; an *address column* filled from the same header is
 * worse than degraded, because it looks like an answer. So: with
 * `trustProxy: true` and a forwarding header on the request, henri records
 * no client address at all and says `unverified`.
 *
 * That is the whole decision table:
 *
 * | trustProxy          | request carries a forwarding header | client          | source        |
 * | ------------------- | ----------------------------------- | --------------- | ------------- |
 * | anything            | a named header, from a listed proxy | the header      | `header`      |
 * | `false`             | either way                          | the peer        | `socket`      |
 * | a hop count, a list | no                                  | the peer        | `socket`      |
 * | a hop count, a list | yes                                 | `req.ip`        | `proxy`       |
 * | `true`              | no                                  | the peer        | `socket`      |
 * | `true`              | yes                                 | **null**        | `unverified`  |
 *
 * `socket` and `proxy` are the same rule read twice: the client is
 * `req.ip`, and the source says whether that turned out to be the peer or
 * something a proxy henri was told about vouched for. A request that
 * carried a forged `X-Forwarded-For` to an application with nothing in
 * front of it (`trustProxy: false`) is `socket` and the peer, which is
 * correct rather than lenient -- the operator said nothing is in front.
 *
 * ## Why null rather than something plausible
 *
 * An operator reading a call log is usually answering "who did this". An
 * address that is a guess is worse than an empty column there, because the
 * empty column asks a question and the guess answers one. `unverified` is a
 * row saying, in the row, that the configuration could not support an
 * answer -- and the peer is still in it, which is often enough to find the
 * hop that can answer.
 *
 * ## An address is personal data
 *
 * In most of the jurisdictions `guides/privacy.md` is written for it is,
 * so it gets the care the rest of that table gets rather than an exception:
 * it lives in columns of its own (never inside the header blob, which is
 * how it would slip past the `personal` marks), `calls.address.anonymize`
 * truncates it, the forwarding headers are masked in the stored headers,
 * and a person's rows answer to `henri privacy:export` and
 * `henri privacy:erase`.
 *
 * The anonymisation is the standard one -- the last octet of an IPv4, the
 * last 80 bits of an IPv6 -- and henri keeps the prefix length in the
 * value (`203.0.113.0/24`), because `203.0.113.0` and `203.0.113.0/24` are
 * different claims and a column that cannot tell them apart is a column
 * that lies once a year.
 *
 * **It is off by default, and that is a decision.** The column exists to
 * answer "who did this"; a /24 answers "somebody in this city". A default
 * that quietly answers a different question than the one asked is the same
 * failure as recording a guess. What makes the whole address safe to hold
 * is not truncation but the rules the table already has -- off unless
 * configured, swept at `calls.keep`, masked in the logs, and erasable --
 * and an application whose retention or whose jurisdiction says otherwise
 * turns it on in one line.
 *
 * @module base/address
 */

const net = require('node:net');

const { fail } = require('./errors');

/** How `client` was decided */
const SOURCES = Object.freeze([
  'header',
  'proxy',
  'socket',
  'unverified',
  null,
]);

/**
 * The headers that carry a forwarded address.
 *
 * Their presence is what turns `trustProxy: true` from "nothing is in
 * front of me" into "something might be, and I cannot tell": a request
 * without any of them was not forwarded by anybody, so the peer is the
 * client and henri is sure of it.
 *
 * They are also masked in a stored row's headers, whatever
 * `filterParameters` says, so the address cannot reach the table through
 * the one blob the erasure does not reach into.
 */
const FORWARDING = Object.freeze([
  'cf-connecting-ip',
  'fastly-client-ip',
  'forwarded',
  'true-client-ip',
  'x-client-ip',
  'x-forwarded-for',
  'x-real-ip',
]);

/** How many bits of an address survive `anonymize` */
const KEEP = Object.freeze({ ipv4: 24, ipv6: 48 });

/** The longest a stored address can be: a full IPv6 and its prefix */
const MAX = 45;

/**
 * An address as henri stores it: no IPv4-in-IPv6 wrapper, no zone.
 *
 * `req.socket.remoteAddress` answers `::ffff:203.0.113.9` for an IPv4
 * client on a dual-stack listener and `fe80::1%lo0` for a link-local one.
 * Neither spelling is wrong and both make a column impossible to group by,
 * so they are normalized on the way in.
 *
 * @param {*} value an address, or anything
 * @returns {?string} the address, or null when it is not one
 */
function normalize(value) {
  if (typeof value !== 'string' || value === '') {
    return null;
  }

  const text = value.trim().replace(/%.*$/u, '');
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(text);
  const address = mapped ? mapped[1] : text;

  return net.isIP(address) === 0 ? null : address;
}

/**
 * The eight groups of an IPv6 address, expanded
 *
 * @param {string} address an IPv6 address
 * @returns {?Array<number>} the groups, or null when it will not parse
 */
function groupsOf(address) {
  const halves = address.split('::');

  if (halves.length > 2) {
    return null;
  }

  const parse = (half) =>
    half === '' ? [] : half.split(':').map((part) => parseInt(part, 16));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - tail.length;

  if (missing < 0 || (halves.length === 1 && missing !== 0)) {
    return null;
  }

  const groups = [...head, ...new Array(Math.max(missing, 0)).fill(0), ...tail];

  return groups.every((group) => Number.isInteger(group) && group >= 0)
    ? groups
    : null;
}

/**
 * An address with the host part dropped, carrying its prefix length.
 *
 * The last octet of an IPv4 and the last 80 bits of an IPv6, which is the
 * truncation every analytics tool and every data protection authority
 * means by "anonymized ip". The `/24` and the `/48` are part of the value
 * on purpose: without them a truncated address is indistinguishable from a
 * network address somebody really connected from.
 *
 * @param {?string} address a normalized address
 * @returns {?string} the truncated address, or null
 */
function anonymize(address) {
  if (!address) {
    return null;
  }

  if (net.isIPv4(address)) {
    const octets = address.split('.');

    return `${octets[0]}.${octets[1]}.${octets[2]}.0/${KEEP.ipv4}`;
  }

  const groups = groupsOf(address);

  if (!groups) {
    return null;
  }

  const kept = groups.slice(0, 3);

  // `::1` truncated is `::/48`, not `0:0:0::/48`: the whole point of the
  // value is that a person can read it back
  return kept.every((group) => group === 0)
    ? `::/${KEEP.ipv6}`
    : `${kept.map((group) => group.toString(16)).join(':')}::/${KEEP.ipv6}`;
}

/**
 * The list of proxies allowed to set a named header.
 *
 * A `net.BlockList`, which is the same thing `@usehenri/webhooks` checks
 * an outbound address against: the ranges are the standard ones and the
 * matching is the kernel's idea of a subnet rather than a string compare.
 *
 * @param {Array<string>} entries `calls.address.from`
 * @returns {?object} `{ check, entries }`, or null when the list is empty
 * @throws HENRI_CONFIG_INVALID on an entry that is not an address or a
 *   range
 */
function trustedProxies(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  const list = new net.BlockList();

  for (const entry of entries) {
    const [address, prefix] = String(entry).trim().split('/');
    const family = net.isIPv4(address) ? 'ipv4' : 'ipv6';
    const bits = prefix === undefined ? null : Number(prefix);
    const widest = family === 'ipv4' ? 32 : 128;

    if (
      net.isIP(address) === 0 ||
      (bits !== null && (!Number.isInteger(bits) || bits < 0 || bits > widest))
    ) {
      throw fail(
        'HENRI_CONFIG_INVALID',
        `calls.address.from: "${entry}" is neither an address nor a range (10.0.0.0/8, 2400:cb00::/32)`
      );
    }

    if (bits === null) {
      list.addAddress(address, family);
    } else {
      list.addSubnet(address, bits, family);
    }
  }

  return {
    check: (address) =>
      Boolean(address) &&
      list.check(address, net.isIPv4(address) ? 'ipv4' : 'ipv6'),
    entries: entries.map((entry) => String(entry)),
  };
}

/**
 * `config.calls.address`, normalized.
 *
 * @param {*} raw what the configuration said
 * @returns {?object} `{ anonymize, header, from }`, or null for "record no
 *   address"
 * @throws HENRI_CALLS_ADDRESS_UNVERIFIABLE when a header is named with no
 *   proxies to believe it from
 * @throws HENRI_CONFIG_INVALID on a range henri cannot read
 */
function addressConfig(raw) {
  if (raw === false) {
    return null;
  }

  const settings = raw && typeof raw === 'object' ? raw : {};
  const header =
    typeof settings.header === 'string' && settings.header !== ''
      ? settings.header.toLowerCase()
      : null;
  const from = trustedProxies(settings.from);

  if (header && !from) {
    const error = fail(
      'HENRI_CALLS_ADDRESS_UNVERIFIABLE',
      `calls.address.header names "${header}", and calls.address.from names nobody allowed to set it`
    );

    error.hint = `Any client can send ${header}. List the addresses or ranges of the proxies in front of henri: { "calls": { "address": { "header": "${header}", "from": ["10.0.0.0/8"] } } }`;

    throw error;
  }

  return { anonymize: settings.anonymize === true, from, header };
}

/**
 * Does this request carry an address somebody forwarded?
 *
 * @param {object} headers the request headers
 * @param {?string} named `calls.address.header`
 * @returns {boolean} whether one of them is there
 */
function forwarded(headers, named) {
  if (!headers || typeof headers !== 'object') {
    return false;
  }

  return [...FORWARDING, named].some(
    (name) => name && typeof headers[name] === 'string' && headers[name] !== ''
  );
}

/**
 * The address a named header claims: the first entry, and only when it is
 * an address
 *
 * @param {object} headers the request headers
 * @param {string} name the header
 * @returns {?string} the address, or null
 */
function claimed(headers, name) {
  const value = headers && headers[name];

  if (typeof value !== 'string') {
    return null;
  }

  return normalize(value.split(',')[0]);
}

/**
 * What express was told to trust, as this file cares about it.
 *
 * Only one distinction matters here: a blanket `true` believes whoever
 * sent the header and everything else -- `false`, a hop count, a list of
 * addresses, express' own `'loopback'` shorthands, a function -- is a
 * statement about a topology somebody thought about.
 *
 * @param {object} req the request
 * @returns {*} what `app.set('trust proxy', ...)` was given
 */
function trustOf(req) {
  return req && req.app && typeof req.app.get === 'function'
    ? req.app.get('trust proxy')
    : undefined;
}

/**
 * Who made this request, and how sure henri is.
 *
 * The table in the header of this file, as code. Never throws and never
 * reads a body: it is called once per recorded request, after the answer
 * has gone out.
 *
 * @param {object} req the request
 * @param {?object} settings the normalized `calls.address`
 * @returns {{client: ?string, peer: ?string, source: ?string}} the answer
 */
function addressOf(req, settings) {
  if (!settings || !req) {
    return { client: null, peer: null, source: null };
  }

  const headers = req.headers || {};
  const peer = normalize(req.socket && req.socket.remoteAddress);
  const { from, header } = settings;
  const dress = (answer) => ({
    client: settings.anonymize ? anonymize(answer.client) : answer.client,
    peer: settings.anonymize ? anonymize(peer) : peer,
    source: answer.source,
  });

  // A named header, from a peer the application listed: the one case where
  // henri reads a header express will not, and it takes both statements
  if (header && from && from.check(peer)) {
    const address = claimed(headers, header);

    // The peer is a proxy, so it is not the client -- answering with it
    // would be the guess this whole file exists to refuse
    return dress({
      client: address,
      source: address ? 'header' : 'unverified',
    });
  }

  if (trustOf(req) === true && forwarded(headers, header)) {
    return dress({ client: null, source: 'unverified' });
  }

  const client = normalize(req.ip) || peer;

  return dress({ client, source: client === peer ? 'socket' : 'proxy' });
}

/**
 * What the boot line says about where an address comes from
 *
 * @param {?object} settings the normalized `calls.address`
 * @param {*} trust `config.trustProxy`
 * @returns {string} one line
 */
function describeAddress(settings, trust) {
  if (!settings) {
    return 'no addresses';
  }

  const shortened = settings.anonymize ? 'truncated addresses' : 'addresses';

  if (settings.header) {
    return `${shortened} from ${settings.header}, and only from a listed proxy`;
  }

  if (trust === true) {
    return `${shortened} from the socket; a forwarded one is unverified while trustProxy is true`;
  }

  if (trust === false) {
    return `${shortened} from the socket`;
  }

  return `${shortened} from the socket, or from X-Forwarded-For as trustProxy allows`;
}

module.exports = {
  FORWARDING,
  KEEP,
  MAX,
  SOURCES,
  addressConfig,
  addressOf,
  anonymize,
  claimed,
  describeAddress,
  forwarded,
  groupsOf,
  normalize,
  trustOf,
  trustedProxies,
};
