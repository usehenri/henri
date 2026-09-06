/**
 * Signing in with somebody else's identity provider.
 *
 * henri already owns sessions, `POST /login`, the double-submit CSRF
 * middleware, the per-account lockout and the account flows. What was left
 * to every application was the part that is genuinely hard, and it is not
 * the protocol: it is the **table beside the user model**, the **callback
 * placed inside the machinery that already exists**, and the **rule that
 * decides what to do when a provider hands over an address that already
 * belongs to somebody here**. This file is those three things.
 *
 * ```json
 * {
 *   "user": {
 *     "identities": {
 *       "providers": {
 *         "acme": {
 *           "authorizationUrl": "https://acme.example/oauth/authorize",
 *           "tokenUrl": "https://acme.example/oauth/token",
 *           "userinfoUrl": "https://acme.example/oauth/userinfo",
 *           "clientId": "...",
 *           "clientSecret": "...",
 *           "scope": ["openid", "email"]
 *         }
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * henri ships **no provider list and no provider secrets**. There is no
 * `github` in this file and nothing to fill in for one: an application
 * names its providers, and the client secret belongs in the encrypted
 * credentials (`henri credentials:edit`) or in the environment -- which is
 * what `henri audit` reports when it finds one written in a `config/*.json`
 * instead.
 *
 * ## The merge rule, which is the whole reason this is in the framework
 *
 * A callback comes back with a verified address, and that address already
 * belongs to an account with a password. Three answers were on the table.
 *
 * **henri refuses** (`identities.merge: "refuse"`, the default). The
 * callback answers `reason: 'exists'`, no session is opened, nothing is
 * written, and the person is told to sign in the way they already do and
 * then link the provider from their account.
 *
 * The alternative applications reach for -- *link automatically when the
 * provider says the address is verified* -- is wrong, and not by a little:
 *
 * - It lets a stranger change which credentials open an account. The owner
 *   of the password account did nothing, was asked nothing and saw nothing,
 *   and afterwards a second way in exists. That is a privilege change made
 *   by somebody who is not the owner, which is the thing authentication is
 *   for.
 * - It collapses the account's security to the weakest provider it can be
 *   linked from. The application's own hashing, lockout and reset flow stop
 *   mattering the moment any provider that will assert that address is
 *   reachable, and the account owner never agreed to that trade.
 * - `email_verified` does not mean what the auto-link needs it to mean. It
 *   is the provider's belief that somebody could read that mailbox at some
 *   point, from a provider that may be self-hosted, may verify a custom
 *   domain an attacker controls, may be an enterprise tenant allowed to
 *   claim a domain, and is in any case not an authority on who owns an
 *   account in *this* database.
 * - Half the providers do not send the claim at all, and an application
 *   that reads "absent" as "verified" has built the takeover by accident.
 *   That is the most common way this goes wrong in the wild.
 *
 * The third answer -- *link only when the session already belongs to that
 * user* -- is right, and it is not a value of the setting because it is the
 * **flow**: a callback started from a signed-in session is a link, always,
 * and it is the only automatic link henri makes. The session is the
 * consent, and it is consent the account owner gave with their own
 * credentials a moment ago. Everything else about the callback -- the
 * address, whether it is verified, whether it matches -- is irrelevant
 * there, because "is this the owner" was already answered.
 *
 * `merge: "verified"` exists, it does what the wrong answer does, and it is
 * gated twice: the provider must also be marked `trusted: true`, and
 * `henri audit` reports the pair as a finding. It has one honest use, the
 * single-tenant application whose provider is its own corporate identity
 * provider -- where the provider genuinely *is* the authority on who owns
 * an address. It is not the default and it never will be.
 *
 * ## An address the provider did not verify
 *
 * An unverified address decides nothing. It is not matched against any
 * account, it never creates one, and it is not written down as though it
 * meant something. Concretely:
 *
 * - the identity is keyed on `(provider, subject)`, so a person who is
 *   already linked signs in whatever the address says -- the subject is the
 *   credential and the address was never it;
 * - a callback with no identity and no verified address answers
 *   `reason: 'unverified'` **before it reads the user table**, so a refusal
 *   for an address that has an account and one for an address that has none
 *   are the same answer at the same price. That is the rule the account
 *   flows keep, and this flow does not get to be the exception;
 * - a signed-in person may still link such a provider, because the session
 *   is the proof and the address was never the point.
 *
 * A provider that never verifies says so once (`claims: { verified: false }`)
 * and every callback from it is unverified, which makes it a provider you
 * can link and cannot sign up with.
 *
 * ## Two providers claiming one address
 *
 * They are two rows, because the key is `(provider, subject)` and not the
 * address. The second one is exactly the case above: it arrives, its
 * address has an account, and it is refused -- unless the person is signed
 * in, in which case it is a link and both providers now open that account.
 * Two *different people* at two providers claiming one address end the same
 * way: whoever arrives first with a verified address gets the account (when
 * `signup` is on), and the second is refused rather than merged into it.
 *
 * A person holds at most one identity per provider (`(user_id, provider)`
 * is unique), so "unlink acme" always names one row, and an account cannot
 * quietly grow a second way in at a provider it already has.
 *
 * ## How the callback is protected
 *
 * The flow leaves the origin and comes back, which is the case a CSRF token
 * cannot cover, and OAuth already has the answer: the `state` parameter.
 * henri does not invent a second one.
 *
 * - **Leaving is a `POST`** (`POST <path>/:provider`), so it goes through
 *   the double-submit token and the origin check like every other unsafe
 *   request. `GET` answers 405 with `Allow: POST`, the way `GET /logout`
 *   does. A third-party page therefore cannot start the flow in a visitor's
 *   browser, which is what closes login CSRF -- being signed into somebody
 *   else's provider account, or having their provider account linked to
 *   yours.
 *
 *   The route asks for that token itself rather than leaving it to the
 *   middleware, and the reason is worth keeping. The middleware lets an
 *   unsafe request through when the visitor holds **no session cookie**,
 *   which everywhere else is right -- there is no session for a third-party
 *   page to ride on. Here the exemption and the attack describe the same
 *   person: a visitor about to sign in is exactly the one with no session
 *   yet. So this route checks the token and the origin whatever the cookies
 *   say, keeping the middleware's two carve-outs (CSRF turned off in the
 *   configuration, and a request authenticated by a bearer token) because
 *   neither of those has a cookie to ride on either.
 * - **The state is minted per attempt, kept in the session, single use and
 *   expiring.** It is bound to the session cookie, so a state minted in one
 *   browser cannot be spent in another; it is taken out of the session when
 *   it is read, so a callback url works exactly once; and it stops working
 *   after `stateExpiresIn`. The pending set is bounded, so a bot cannot
 *   grow a session by starting the flow a thousand times.
 * - **PKCE** (S256) is on by default. The verifier never leaves the server:
 *   it sits next to the state in the session, so an authorization code
 *   observed anywhere -- a `Referer`, a log, a shared browser -- is not
 *   enough to redeem.
 * - **The callback is a `GET`**, so the CSRF middleware lets it through by
 *   design; the state stands in its place, and that is what the state is
 *   for.
 * - **A link is checked against the session that is there now**, not only
 *   against the one the state was minted in: an attempt that says "link
 *   this to Ada" is refused unless Ada is still the person holding the
 *   session when the callback arrives.
 * - **The lockout and the rate limit are the same ones.** A locked account
 *   cannot be signed into through a provider either, or this path would be
 *   a way around the lockout of `POST /login` -- and the counter is cleared
 *   on a successful identity sign-in, because the person proved themselves.
 *   A failed callback is deliberately **not** counted as a failed attempt:
 *   there is nothing to guess at a callback (the subject comes out of a
 *   server-to-server exchange), so counting would only hand an attacker a
 *   way to lock an address out, and would count "your link expired" as a
 *   wrong password. The auth rate limit covers every request under the
 *   identity path, the callback included, because a callback makes henri
 *   dial out.
 * - **The session id is new before the person is in it**
 *   (`req.session.regenerate()` then `req.logIn()`), which is the fixation
 *   defence `POST /signup` and the password reset already take.
 * - **Nothing a provider wrote is believed about its size or its shape.**
 *   Every value that comes back is capped before it is looked at and walked
 *   rather than matched, and the provider's own `error_description` is
 *   never read, shown or logged.
 *
 * ## What henri does not do
 *
 * It never parses an `id_token`. If the token response carries one it is
 * ignored, and the profile comes from `userinfoUrl` over a request henri
 * makes itself with the access token. That is deliberate: verifying a JWT
 * means JWKS fetching, key rotation, algorithm confusion and a decade of
 * other people's mistakes, and the userinfo endpoint answers the same
 * claims over a channel that is already authenticated. Every provider that
 * matters has one.
 *
 * It also ships no OAuth **provider**. Being an authorization server is a
 * different product; this is the client.
 *
 * @module base/identities
 */
const crypto = require('node:crypto');
const debug = require('debug')('henri:identities');

const { stamp: withCode } = require('./errors');
const { check } = require('./arguments');
const { EMAIL, duration, normalizeEmail } = require('./accounts');
const { respond } = require('./auth');
const {
  csrfConfig,
  originAllowed,
  safeEqual,
  sentToken,
  trustedSet,
} = require('./csrf');
const { storeFor } = require('./identity-store');

/**
 * Where the router reaches the parts of the service an application must not
 * have: the providers with their client secrets in them. A symbol rather
 * than a name, so nothing serializes it into a page by accident.
 */
const INTERNAL = Symbol('henri.identities.internal');

/** What an identity is allowed to imply, written on the row when it is made */
const ALLOWS = Object.freeze(['signin', 'verify']);

/** What the merge rule may be told to do (the header argues both) */
const MERGES = Object.freeze(['refuse', 'verified']);

/** How the client authenticates at the token endpoint */
const CLIENT_AUTH = Object.freeze(['basic', 'post']);

/** The defaults of `config.user.identities` */
const DEFAULTS = Object.freeze({
  after: '/',
  allowHttp: false,
  enabled: false,
  merge: 'refuse',
  path: '/auth',
  signup: true,
  stateExpiresIn: 600000,
  table: 'henri_identities',
  timeout: 10000,
});

/** The defaults of one provider */
const PROVIDER_DEFAULTS = Object.freeze({
  allows: 'signin',
  auth: 'basic',
  pkce: true,
  trusted: false,
});

/** Which claims of a userinfo answer henri reads, by their OpenID names */
const CLAIMS = Object.freeze({
  email: 'email',
  subject: 'sub',
  verified: 'email_verified',
});

/** How many attempts one session may have in flight */
const MAX_PENDING = 5;

/** The longest body henri will read from a provider, in bytes */
const MAX_BODY = 262144;

/** The longest a subject may be: OpenID Connect caps a `sub` there */
const MAX_SUBJECT = 255;

/** The longest an address may be */
const MAX_EMAIL = 320;

/** The longest an access token or an authorization code may be */
const MAX_TOKEN = 8192;

/** Where the pending attempts live inside the express session */
const PENDING = 'henriIdentities';

/**
 * A plain object, or an empty one
 *
 * @param {*} value anything
 * @returns {object} a plain object
 */
const objectOf = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

/**
 * A string with something in it, capped.
 *
 * Everything a provider answers goes through here before it is looked at:
 * the cap comes first, so nothing henri does afterwards -- a comparison, a
 * pattern, a column -- is ever handed a megabyte.
 *
 * @param {*} value anything
 * @param {number} max the longest it may be
 * @returns {?string} the string, or null
 */
const bounded = (value, max) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    return null;
  }

  return value;
};

/**
 * Is every character of this string one a credential may be made of?
 *
 * Walked rather than matched: this is a value somebody else's server chose,
 * and all henri needs to know about it is that it holds no control
 * character, so it cannot smuggle a newline into a log line or a header.
 *
 * @param {string} value the string
 * @returns {boolean} printable or not
 */
const printable = (value) => {
  for (let at = 0; at < value.length; at += 1) {
    const code = value.charCodeAt(at);

    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }

  return true;
};

/**
 * The subject a provider issued, or nothing when it is not one
 *
 * @param {*} value what the claim answered
 * @returns {?string} the subject
 */
const subjectOf = (value) => {
  const found = bounded(value, MAX_SUBJECT);

  return found && printable(found) ? found : null;
};

/**
 * The address a provider asserted, normalized, or nothing
 *
 * @param {*} value what the claim answered
 * @returns {?string} the address
 */
const addressOf = (value) => {
  const found = bounded(value, MAX_EMAIL);

  if (!found || !printable(found)) {
    return null;
  }

  const normalized = normalizeEmail(found);

  return normalized && EMAIL.test(normalized) ? normalized : null;
};

/**
 * Did the provider say the address is verified?
 *
 * Only `true`, `"true"`, `1` and `"1"` count. An absent claim is **not**
 * verified, which is the whole of the mistake this feature exists to
 * refuse, and `"false"` is not a truthy string here whatever JavaScript
 * thinks of it.
 *
 * @param {*} value what the claim answered
 * @returns {boolean} verified or not
 */
const isVerified = (value) =>
  value === true || value === 1 || value === 'true' || value === '1';

/**
 * A local path a browser may be sent back to.
 *
 * Walked, and deliberately narrow: it must begin with one slash, and the
 * character after it must not be another slash or a backslash --
 * `//evil.example` and `/\evil.example` are both open redirects a browser
 * reads as an origin.
 *
 * @param {*} value what the form sent
 * @returns {?string} the path, or null
 */
const localPath = (value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    return null;
  }

  if (value.charCodeAt(0) !== 0x2f) {
    return null;
  }

  const second = value.charCodeAt(1);

  if (second === 0x2f || second === 0x5c) {
    return null;
  }

  return printable(value) ? value : null;
};

/**
 * The name of a provider as it arrived in a url.
 *
 * Capped and walked before it is used to look anything up, and it is looked
 * up with `hasOwnProperty` rather than by indexing, so `constructor` and
 * `__proto__` name no provider.
 *
 * @param {*} value the path parameter
 * @returns {?string} the name, or null
 */
const providerName = (value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    return null;
  }

  for (let at = 0; at < value.length; at += 1) {
    const code = value.charCodeAt(at);
    const ok =
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x30 && code <= 0x39) ||
      code === 0x2d ||
      code === 0x5f;

    if (!ok) {
      return null;
    }
  }

  return value;
};

/**
 * What a provider says it verifies: the claim name, or `false` for one that
 * never does
 *
 * @param {*} value what the configuration holds
 * @returns {(string|boolean)} the claim name, or false
 */
const verifiedClaim = (value) => {
  if (value === false) {
    return false;
  }

  return typeof value === 'string' ? value : CLAIMS.verified;
};

/**
 * The scopes of a provider, as a list
 *
 * @param {*} value a list, a space separated string, or nothing
 * @returns {Array<string>} the scopes
 */
const scopesOf = (value) => {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === 'string');
  }

  if (typeof value !== 'string') {
    return [];
  }

  return value.split(' ').filter(Boolean);
};

/**
 * One provider, normalized
 *
 * @param {string} name what the application calls it
 * @param {*} raw what the configuration holds
 * @returns {object} the provider
 */
const providerConfig = (name, raw) => {
  const given = objectOf(raw);
  const claims = objectOf(given.claims);

  return {
    ...PROVIDER_DEFAULTS,
    ...given,
    allows: ALLOWS.includes(given.allows) ? given.allows : 'signin',
    auth: CLIENT_AUTH.includes(given.auth) ? given.auth : 'basic',
    claims: {
      email: typeof claims.email === 'string' ? claims.email : CLAIMS.email,
      subject:
        typeof claims.subject === 'string' ? claims.subject : CLAIMS.subject,
      verified: verifiedClaim(claims.verified),
    },
    label: typeof given.label === 'string' ? given.label : name,
    name,
    params: objectOf(given.params),
    pkce: given.pkce !== false,
    scope: scopesOf(given.scope),
    trusted: given.trusted === true,
  };
};

/**
 * The identity settings of an application (`config.user.identities`)
 *
 * @param {object} config henri's config module (anything with get/has)
 * @returns {object} the settings
 */
function identitiesConfig(config) {
  const raw =
    config && typeof config.has === 'function' && config.has('user')
      ? config.get('user')
      : null;
  const user = objectOf(raw);
  const given = objectOf(user.identities);
  const providers = {};

  for (const name of Object.keys(objectOf(given.providers))) {
    providers[name] = providerConfig(name, given.providers[name]);
  }

  const names = Object.keys(providers);

  return {
    ...DEFAULTS,
    after: typeof given.after === 'string' ? given.after : DEFAULTS.after,
    allowHttp: given.allowHttp === true,
    // A block with providers in it means to be on; `false` is how it stays
    // written down and turned off
    enabled: given.enabled === false ? false : names.length > 0,
    merge: MERGES.includes(given.merge) ? given.merge : DEFAULTS.merge,
    path: typeof given.path === 'string' ? given.path : DEFAULTS.path,
    providers,
    signup: given.signup !== false,
    stateExpiresIn: duration(given.stateExpiresIn, DEFAULTS.stateExpiresIn),
    table: typeof given.table === 'string' ? given.table : DEFAULTS.table,
    timeout: duration(given.timeout, DEFAULTS.timeout),
  };
}

/**
 * What is wrong with one provider, so a misconfiguration is a boot failure
 * rather than a broken button somebody finds in production
 *
 * @param {object} provider a normalized provider
 * @param {object} settings the identity settings
 * @returns {Array<string>} the problems
 */
const problemsWith = (provider, settings) => {
  const found = [];

  for (const key of ['clientId', 'clientSecret']) {
    if (typeof provider[key] !== 'string' || provider[key].length === 0) {
      found.push(`${key} is missing`);
    }
  }

  for (const key of ['authorizationUrl', 'tokenUrl', 'userinfoUrl']) {
    const value = provider[key];

    if (typeof value !== 'string' || value.length === 0) {
      found.push(`${key} is missing`);
      continue;
    }

    let url;

    try {
      url = new URL(value);
    } catch (error) {
      found.push(`${key} is not a url`);
      continue;
    }

    if (url.username || url.password) {
      found.push(`${key} carries credentials in the url`);
    }

    if (url.protocol === 'https:') {
      continue;
    }

    if (url.protocol === 'http:' && settings.allowHttp) {
      continue;
    }

    found.push(`${key} is not https (user.identities.allowHttp lifts this)`);
  }

  if (settings.merge === 'verified' && !provider.trusted) {
    found.push(
      'user.identities.merge is "verified" and this provider is not marked "trusted": true, so it would be asked to decide who owns an account it knows nothing about'
    );
  }

  return found;
};

/**
 * The client credentials of a provider, for `client_secret_basic`.
 *
 * RFC 6749 2.3.1: the two halves are form-encoded before they are joined
 * and encoded, which matters the moment a secret holds a character a form
 * would escape.
 *
 * @param {object} provider a provider
 * @returns {string} the header value
 */
const basicAuth = (provider) =>
  Buffer.from(
    `${encodeURIComponent(provider.clientId)}:${encodeURIComponent(provider.clientSecret)}`,
    'utf8'
  ).toString('base64');

/**
 * Reads a response body, and stops reading past a cap.
 *
 * A provider is somebody else's server: it may answer with a gigabyte, or
 * with a stream that never ends. Neither is allowed to be henri's problem.
 *
 * @param {Response} response a fetch response
 * @param {number} [max=MAX_BODY] the cap, in bytes
 * @returns {Promise<string>} the body, truncated at the cap
 */
const readCapped = async (response, max = MAX_BODY) => {
  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      size += value.length;
      chunks.push(value);

      if (size > max) {
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => false);
  }

  return Buffer.concat(chunks).subarray(0, max).toString('utf8');
};

/**
 * What a provider answered, as an object.
 *
 * JSON first, because that is what henri asks for; a form-encoded body is
 * the one other thing an OAuth token endpoint is allowed to send back.
 *
 * @param {string} body the body
 * @param {string} type the content type it claimed
 * @returns {object} the payload, empty when it is neither
 */
const payloadOf = (body, type) => {
  if (typeof type === 'string' && type.includes('form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(body));
  }

  try {
    return objectOf(JSON.parse(body));
  } catch (error) {
    return {};
  }
};

/**
 * The password an account henri opens from a callback is given.
 *
 * Nobody is told it and nobody can guess it: it exists because the three
 * adapters make the column `NOT NULL`, and because a row with an empty
 * hash is a row `compare()` would have to have an opinion about. The
 * person sets a real one through `POST /password/forgot` whenever they
 * want one, and until they do, the identity is the only way in -- which is
 * what `unlink()` refuses to take away.
 *
 * @returns {string} 32 characters of randomness
 */
const unknowablePassword = () => crypto.randomBytes(24).toString('base64url');

/**
 * The identity services of an application, as `henri.identities`
 *
 * @param {Henri} henri the henri instance
 * @returns {object} the service
 */
function identities(henri) {
  /** The backend, built on the first call and rebuilt after a reload */
  let backend = null;
  /** The table the backend was built for */
  let built = null;
  /** The store adapter it was built on, which a reload replaces */
  let owner = null;

  /**
   * The settings, read again on every call so a reload is picked up
   *
   * @returns {object} see identitiesConfig()
   */
  const settings = () => identitiesConfig(henri.config);

  /**
   * The backend, built once per table name.
   *
   * The identities live in the store the user model lives in, so a person
   * and their credentials are in one database.
   *
   * @returns {object} see base/identity-store.js
   */
  const table = () => {
    const { table: name } = settings();
    const found = henri.user && henri.user.userStore();
    const store = found ? found.store : null;

    // The model module builds its adapters again on a reload, so the store
    // is part of what the backend was built for: keeping one that names a
    // connection nobody holds any more would fail every call after it
    if (!backend || built !== name || owner !== store) {
      backend = storeFor(store, name);
      built = name;
      owner = store;
    }

    return backend;
  };

  /**
   * One provider by name, with its secrets. Private: the router reaches it
   * through `INTERNAL` and nothing else does.
   *
   * @param {*} name what a url or a caller said
   * @returns {?object} the provider
   */
  const resolve = (name) => {
    const wanted = providerName(name);
    const { providers: all } = settings();

    if (!wanted || !Object.prototype.hasOwnProperty.call(all, wanted)) {
      return null;
    }

    return all[wanted];
  };

  /**
   * What of a provider may be rendered: never the client secret
   *
   * @param {object} provider a provider
   * @returns {object} the public provider
   */
  const publicProvider = (provider) => ({
    allows: provider.allows,
    label: provider.label,
    name: provider.name,
    trusted: provider.trusted,
  });

  /**
   * The providers this application configured, sorted by name, without
   * their secrets: this is what a page renders its buttons from
   *
   * @returns {Array<{allows: string, label: string, name: string, trusted: boolean}>} the providers
   */
  const providers = () => {
    const { providers: all } = settings();

    return Object.keys(all)
      .sort()
      .map((name) => publicProvider(all[name]));
  };

  /**
   * One provider by name, without its secrets
   *
   * @param {*} name what a caller said
   * @returns {?object} the public provider, or null
   */
  const providerOf = (name) => {
    const found = resolve(name);

    return found ? publicProvider(found) : null;
  };

  /**
   * The absolute url a provider sends the browser back to.
   *
   * It is the one an application registers at the provider, and it is
   * stable: `config.url` decides it, never the request, so a `Host` header
   * a client chose cannot move it.
   *
   * @param {string} name the provider
   * @returns {string} the absolute url
   */
  const redirectUri = (name) => {
    check('henri.identities.redirectUri', [name]);

    return henri.accounts.urlFor(`${settings().path}/${name}/callback`);
  };

  /**
   * Creates the table and its indexes; idempotent
   *
   * @returns {Promise<Array<string>>} what ran
   */
  const install = () => table().install();

  /**
   * What is wrong with the configured providers, all of them at once
   * rather than one boot at a time
   *
   * @returns {Array<string>} the problems, empty when there are none
   */
  const problems = () => {
    const config = settings();

    return Object.keys(config.providers)
      .sort()
      .flatMap((name) =>
        problemsWith(config.providers[name], config).map(
          (problem) => `user.identities.providers.${name}: ${problem}`
        )
      );
  };

  /**
   * The pending attempts of a session, oldest first
   *
   * @param {Express.Request} req the request
   * @returns {Array<object>} the attempts
   */
  const pendingOf = (req) => {
    const held = req.session && req.session[PENDING];

    return Array.isArray(held) ? held : [];
  };

  /**
   * Records one attempt in the session, dropping the oldest past the bound
   *
   * @param {Express.Request} req the request
   * @param {object} attempt the attempt
   * @returns {void} nothing
   */
  const remember = (req, attempt) => {
    const now = Date.now();
    const kept = pendingOf(req)
      .filter((entry) => entry.at + entry.expiresIn > now)
      .slice(-(MAX_PENDING - 1));

    kept.push(attempt);

    if (req.session) {
      req.session[PENDING] = kept;
    }
  };

  /**
   * Takes one attempt back out of the session, whatever happens next.
   *
   * Single use: the entry is gone once it has been read, so a callback url
   * works exactly once even when the person reloads it.
   *
   * @param {Express.Request} req the request
   * @param {*} state what the callback carried
   * @returns {?object} the attempt, or null
   */
  const claim = (req, state) => {
    const kept = pendingOf(req);
    const now = Date.now();
    const found = kept.find((entry) => safeEqual(state, entry.state)) || null;

    if (req.session) {
      req.session[PENDING] = kept.filter(
        (entry) => entry !== found && entry.at + entry.expiresIn > now
      );
    }

    if (!found || found.at + found.expiresIn <= now) {
      return null;
    }

    return found;
  };

  /**
   * The url a browser is sent to, and the attempt that goes with it
   *
   * @param {Express.Request} req the request
   * @param {object} provider a provider (as `resolve()` answers)
   * @param {object} [options] `link` (who is being linked) and `returnTo`
   * @returns {{attempt: object, url: string}} where to send them
   */
  const begin = (req, provider, { link = null, returnTo = null } = {}) => {
    const config = settings();
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = provider.pkce
      ? crypto.randomBytes(32).toString('base64url')
      : null;
    const attempt = {
      at: Date.now(),
      expiresIn: config.stateExpiresIn,
      link,
      provider: provider.name,
      returnTo,
      state,
      verifier,
    };
    const url = new URL(provider.authorizationUrl);

    for (const [key, value] of Object.entries(provider.params)) {
      if (typeof value === 'string') {
        url.searchParams.set(key, value);
      }
    }

    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', provider.clientId);
    url.searchParams.set('redirect_uri', redirectUri(provider.name));
    url.searchParams.set('state', state);

    if (provider.scope.length > 0) {
      url.searchParams.set('scope', provider.scope.join(' '));
    }

    if (verifier) {
      url.searchParams.set(
        'code_challenge',
        crypto.createHash('sha256').update(verifier).digest('base64url')
      );
      url.searchParams.set('code_challenge_method', 'S256');
    }

    remember(req, attempt);

    return { attempt, url: url.toString() };
  };

  /**
   * Exchanges an authorization code for an access token
   *
   * @param {object} provider the provider
   * @param {object} options `code` and `verifier`
   * @returns {Promise<?string>} the access token, or null
   */
  const exchange = async (provider, { code, verifier }) => {
    const config = settings();
    const body = new URLSearchParams({
      client_id: provider.clientId,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(provider.name),
    });
    const headers = {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    };

    if (verifier) {
      body.set('code_verifier', verifier);
    }

    if (provider.auth === 'basic') {
      headers.authorization = `Basic ${basicAuth(provider)}`;
    } else {
      body.set('client_secret', provider.clientSecret);
    }

    const response = await fetch(provider.tokenUrl, {
      body: body.toString(),
      headers,
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(config.timeout),
    });
    const payload = payloadOf(
      await readCapped(response),
      response.headers.get('content-type') || ''
    );

    if (!response.ok) {
      debug('%s refused the code: %d', provider.name, response.status);

      return null;
    }

    const token = bounded(payload.access_token, MAX_TOKEN);

    return token && printable(token) ? token : null;
  };

  /**
   * Reads the profile a provider holds for an access token
   *
   * @param {object} provider the provider
   * @param {string} token the access token
   * @returns {Promise<?{email: ?string, subject: string, verified: boolean}>}
   *   the profile, or null when there is no usable subject in it
   */
  const profile = async (provider, token) => {
    const config = settings();
    const response = await fetch(provider.userinfoUrl, {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(config.timeout),
    });

    if (!response.ok) {
      debug('%s refused the profile: %d', provider.name, response.status);

      return null;
    }

    const payload = payloadOf(
      await readCapped(response),
      response.headers.get('content-type') || ''
    );
    const subject = subjectOf(payload[provider.claims.subject]);

    if (!subject) {
      return null;
    }

    const email = addressOf(payload[provider.claims.email]);
    const verified =
      provider.claims.verified === false
        ? false
        : isVerified(payload[provider.claims.verified]);

    return { email, subject, verified: Boolean(email) && verified };
  };

  /**
   * The identifier the identities are written with: the person's public one
   *
   * @param {object} user a user record
   * @returns {?string} the identifier
   */
  const identify = (user) => henri.accounts.identify(user);

  /**
   * Every identity of one person, oldest link first
   *
   * @param {object} user a user record
   * @returns {Promise<Array<object>>} the identities
   */
  const forUser = async (user) => {
    check('henri.identities.forUser', [user]);

    const who = identify(user);

    return who ? table().forUser(who) : [];
  };

  /**
   * Every identity of one person, by the identifier an export holds
   *
   * @param {string} who the person's public identifier
   * @returns {Promise<Array<object>>} the identities
   */
  const forPerson = (who) => {
    check('henri.identities.forPerson', [who]);

    return table().forUser(who);
  };

  /**
   * Takes every identity of a person away, for an erasure.
   *
   * They are deleted rather than anonymized, and that is not a choice
   * between two readings of the word: an identity is a credential, and an
   * anonymized credential still opens the account.
   *
   * @param {string} who the person's public identifier
   * @returns {Promise<number>} how many went
   */
  const forget = (who) => {
    check('henri.identities.forget', [who]);

    return table().forget(who);
  };

  /**
   * Writes one identity
   *
   * @param {object} options the row
   * @returns {Promise<?object>} the identity, or null when it was refused
   */
  const write = ({
    allows,
    email,
    origin,
    provider,
    subject,
    user,
    verified,
  }) =>
    table().add({
      allows,
      email,
      id: crypto.randomUUID(),
      last_used_at: null,
      linked_at: Date.now(),
      origin,
      provider,
      subject,
      user_id: user,
      verified: verified ? 1 : 0,
    });

  /**
   * Stamps the moment an identity signed somebody in. Never fails a
   * request: it is a column nobody authenticates with.
   *
   * @param {object} identity the identity
   * @returns {Promise<boolean>} whether it was written
   */
  const touch = async (identity) => {
    try {
      return await table().touch(identity.id, Date.now());
    } catch (error) {
      debug('unable to stamp an identity: %s', error.message);

      return false;
    }
  };

  /**
   * Removes one identity of one person.
   *
   * It refuses to take away the last way into an account. An account henri
   * opened from a callback holds a password nobody knows
   * (`unknowablePassword()`), so its only credential is the identity, and
   * a person who unlinked it would be locked out by their own click. Once
   * they have set a password of their own -- which stamps
   * `passwordChangedAt`, the way a reset does -- the refusal lifts.
   *
   * @param {object} user the signed in user
   * @param {string} name the provider
   * @returns {Promise<{ok: boolean, reason: ?string}>} the answer
   */
  const unlink = async (user, name) => {
    check('henri.identities.unlink', [user, name]);

    const who = identify(user);
    const provider = providerName(name);

    if (!who || !provider) {
      return { ok: false, reason: 'unknown' };
    }

    const held = await table().forUser(who);
    const mine = held.find((entry) => entry.provider === provider);

    if (!mine) {
      return { ok: false, reason: 'unknown' };
    }

    const plain = henri.user.adapter().toPlain(user) || {};
    const knows = Boolean(plain.passwordChangedAt);
    const opened = held.some((entry) => entry.origin === 'signup');

    if (held.length <= 1 && opened && !knows) {
      return { ok: false, reason: 'last-credential' };
    }

    const removed = await table().remove(who, provider);

    return { ok: removed, reason: removed ? null : 'unknown' };
  };

  /**
   * The refusal shape every branch of `complete()` answers with
   *
   * @param {string} reason why
   * @returns {object} the answer
   */
  const refused = (reason) => ({
    action: null,
    identity: null,
    ok: false,
    reason,
    user: null,
  });

  /**
   * Links a provider to the person a session already belongs to.
   *
   * This is the only automatic link henri makes, and the session is what
   * makes it safe: the account owner proved who they were with their own
   * credentials a moment ago, so nothing the provider claims about
   * ownership has to be believed -- the address is not even looked at.
   *
   * @param {object} attempt the attempt the state named
   * @param {object} provider the provider
   * @param {object} found the profile
   * @param {object} user the person holding the session right now
   * @returns {Promise<object>} the answer
   */
  const linkFor = async (attempt, provider, found, user) => {
    const existing = await table().find(provider.name, found.subject);

    if (existing && existing.userId !== attempt.link) {
      return refused('linked-elsewhere');
    }

    if (existing) {
      return {
        action: 'link',
        identity: existing,
        ok: true,
        reason: null,
        user,
      };
    }

    const identity = await write({
      allows: provider.allows,
      email: found.email,
      origin: 'session',
      provider: provider.name,
      subject: found.subject,
      user: attempt.link,
      verified: found.verified,
    });

    if (!identity) {
      // A unique index refused it: this person already holds an identity
      // at this provider, or another request won the race
      return refused('already-linked');
    }

    return { action: 'link', identity, ok: true, reason: null, user };
  };

  /**
   * Opens an account from a callback, when the address belongs to nobody
   *
   * @param {object} provider the provider
   * @param {object} found the profile
   * @returns {Promise<object>} the answer
   */
  const signUpFor = async (provider, found) => {
    let created;

    try {
      created = await henri._user.create({
        // The provider verified the address, and that is what confirmation
        // is: a person who can read the mailbox
        confirmedAt: new Date(),
        email: found.email,
        password: unknowablePassword(),
      });
    } catch (error) {
      // The unique index on the address: somebody registered between the
      // lookup above and this write, so the merge rule applies after all
      if (!henri.model.errors(error)) {
        throw error;
      }

      return refused('exists');
    }

    const identity = await write({
      allows: provider.allows,
      email: found.email,
      origin: 'signup',
      provider: provider.name,
      subject: found.subject,
      user: identify(created),
      verified: found.verified,
    });

    if (!identity) {
      return refused('exists');
    }

    return {
      action: 'signup',
      identity,
      ok: true,
      reason: null,
      user: created,
    };
  };

  /**
   * Signs a person in from a callback, or refuses to.
   *
   * The order of the branches is the merge rule of the header, and this is
   * the only place any of it is decided.
   *
   * @param {object} provider the provider
   * @param {object} found the profile
   * @returns {Promise<object>} the answer
   */
  const signInFor = async (provider, found) => {
    const config = settings();
    const existing = await table().find(provider.name, found.subject);

    if (existing) {
      const user = await henri.user.findById(existing.userId);

      if (!user) {
        return refused('unknown');
      }

      if (existing.allows !== 'signin') {
        return refused('not-a-sign-in');
      }

      return {
        action: 'signin',
        identity: existing,
        ok: true,
        reason: null,
        user,
      };
    }

    // Nothing is linked yet, so the address is the only thing left to go
    // on -- and an address the provider did not verify is nothing to go
    // on. This answers before it reads the user table, so an address that
    // has an account and one that has none are one answer at one price
    if (!found.verified) {
      return refused('unverified');
    }

    const taken = await henri.user.findByEmail(found.email);

    if (!taken) {
      return config.signup
        ? signUpFor(provider, found)
        : refused('signup-disabled');
    }

    // The merge rule. Refusing is the answer, and the argument is in the
    // header: the alternative lets whoever can make a provider assert an
    // address take the account behind it
    if (config.merge !== 'verified' || !provider.trusted) {
      return refused('exists');
    }

    const identity = await write({
      allows: provider.allows,
      email: found.email,
      origin: 'verified',
      provider: provider.name,
      subject: found.subject,
      user: identify(taken),
      verified: found.verified,
    });

    if (!identity) {
      return refused('already-linked');
    }

    return {
      action: 'signin',
      identity,
      ok: true,
      reason: null,
      user: taken,
    };
  };

  /**
   * Completes a callback: the state, the exchange, the profile, the rule.
   *
   * Answers rather than throws, because every refusal here is something a
   * page has to show and none of them is a mistake of the application's.
   *
   * @param {Express.Request} req the request
   * @param {object} [query] what the provider sent back (`code`, `state`)
   * @returns {Promise<{ok: boolean, action: ?string, reason: ?string, user: ?object, identity: ?object, attempt: ?object}>}
   *   the answer
   */
  const complete = async (req, query = {}) => {
    const attempt = claim(req, query.state);

    if (!attempt) {
      return { ...refused('state'), attempt: null };
    }

    const provider = resolve(attempt.provider);

    if (!provider) {
      return { ...refused('unknown-provider'), attempt };
    }

    // A link is checked against the session that is here now, not only
    // against the one the state was minted in: whoever holds the session
    // when the callback lands is the only person it may be linked to
    const holder = req.user ? identify(req.user) : null;

    if (attempt.link && attempt.link !== holder) {
      return { ...refused('state'), attempt };
    }

    // The provider said no, or sent something that is not a code. Its
    // `error_description` is a string somebody else wrote, and it is never
    // read, shown or logged
    const code = bounded(query.code, MAX_TOKEN);

    if (!code || !printable(code) || typeof query.error !== 'undefined') {
      return { ...refused('denied'), attempt };
    }

    // A provider that times out, refuses the connection, answers with a
    // redirect (`redirect: 'error'`) or hangs up mid-body throws out of
    // `fetch`. None of that is a failure of this application's, and a stack
    // trace is not what the person who clicked a button should be shown
    let token = null;

    try {
      token = await exchange(provider, { code, verifier: attempt.verifier });
    } catch (error) {
      debug('%s could not be reached: %s', provider.name, error.message);
    }

    if (!token) {
      return { ...refused('exchange'), attempt };
    }

    let found = null;

    try {
      found = await profile(provider, token);
    } catch (error) {
      debug('%s answered no profile: %s', provider.name, error.message);
    }

    if (!found) {
      return { ...refused('profile'), attempt };
    }

    if (attempt.link) {
      return {
        ...(await linkFor(attempt, provider, found, req.user)),
        attempt,
      };
    }

    if (provider.allows !== 'signin') {
      return { ...refused('not-a-sign-in'), attempt };
    }

    return { ...(await signInFor(provider, found)), attempt };
  };

  const service = {
    ALLOWS,
    MERGES,
    complete,
    get enabled() {
      return settings().enabled;
    },
    forPerson,
    forUser,
    forget,
    install,
    problems,
    providerOf,
    providers,
    redirectUri,
    get settings() {
      return settings();
    },
    unlink,
  };

  // What the router needs and an application must not have: the providers
  // with their client secrets in them, and the two writes around a session
  Object.defineProperty(service, INTERNAL, {
    enumerable: false,
    value: { begin, resolve, touch },
  });

  return service;
}

/** What a browser is told, per reason. Never who has an account. */
const MESSAGES = Object.freeze({
  'already-linked': 'this account is already linked to that provider',
  denied: 'that sign-in was not completed',
  exchange: 'that provider could not be reached',
  exists:
    'an account already exists for that address; sign in, then link this provider from your account',
  forbidden: 'that sign-in did not come from this application',
  'last-credential':
    'that is the only way into this account; set a password first',
  'linked-elsewhere':
    'that provider account is already linked to another account',
  locked: 'too many failed sign-in attempts, retry later',
  'not-a-sign-in': 'that provider cannot open a session on its own',
  profile: 'that provider answered with no account henri could read',
  'signup-disabled': 'this application does not open accounts that way',
  state: 'that sign-in link is no longer valid',
  unconfirmed: 'confirm your email address to sign in',
  unknown: 'that sign-in was not completed',
  'unknown-provider': 'that sign-in was not completed',
  unverified:
    'that provider did not confirm the address, so it cannot open a session; sign in, then link it from your account',
});

/**
 * The answer a JSON client gets for each refusal, as the name of the
 * `res.boom` helper that writes it. Everything else is a 400.
 */
const STATUSES = Object.freeze({
  'already-linked': 'conflict',
  exists: 'conflict',
  forbidden: 'forbidden',
  'last-credential': 'conflict',
  'linked-elsewhere': 'conflict',
  locked: 'tooManyRequests',
  unconfirmed: 'forbidden',
});

/**
 * What of an identity may leave the server.
 *
 * The subject never does: it is the credential, and a page has no use for
 * it.
 *
 * @param {object} identity an identity
 * @returns {{allows: string, linkedAt: ?string, provider: string}} the public identity
 */
const publicIdentity = (identity) => ({
  allows: identity.allows,
  linkedAt: identity.linkedAt
    ? new Date(identity.linkedAt).toISOString()
    : null,
  provider: identity.provider,
});

/**
 * The endpoints of the identity flows.
 *
 * They answer JSON to API clients and redirect browsers, the way
 * `POST /login` and the account flows do.
 *
 * @param {Henri} henri the henri instance
 * @returns {Express.Router} the router
 */
function router(henri) {
  const routes = henri.server.express.Router();
  const service = henri.identities;
  const { begin, resolve, touch } = service[INTERNAL];
  const base = service.settings.path;

  /**
   * The settings of the flows
   *
   * @returns {object} see identitiesConfig()
   */
  const settings = () => service.settings;

  /**
   * Opens a session for a user, with a fresh session id.
   *
   * The same two steps `base/accounts.js` takes, for the same reason: a
   * session identifier a visitor already held must not become the one that
   * names them once they are signed in.
   *
   * @param {Express.Request} req the request
   * @param {object} user the user
   * @returns {Promise<void>} resolves once the session holds the user
   */
  const signIn = (req, user) =>
    new Promise((resolve_, reject) => {
      /**
       * Hands the user to passport once the session is new
       *
       * @returns {void} nothing
       */
      const login = () =>
        req.logIn(user, (error) => (error ? reject(error) : resolve_()));

      if (req.session && typeof req.session.regenerate === 'function') {
        return req.session.regenerate((error) =>
          error ? reject(error) : login()
        );
      }

      return login();
    });

  /**
   * The two gates `POST /login` puts in front of a session, asked in the
   * same order: the lockout of the account, then the confirmation
   *
   * @param {object} user the account about to be signed into
   * @returns {Promise<?string>} the reason to refuse, or null
   */
  const gate = async (user) => {
    const { lockout } = henri.user;
    const account = (henri.user.adapter().toPlain(user) || {}).email;

    if (lockout && account) {
      const locked = await lockout
        .check(account)
        .catch(() => ({ locked: false }));

      if (locked.locked) {
        return 'locked';
      }
    }

    if (henri.accounts && !henri.accounts.allowed(user)) {
      return 'unconfirmed';
    }

    // The person proved themselves, so the failed attempts counted against
    // this address are spent
    if (lockout && account) {
      await lockout.succeed(account).catch(() => false);
    }

    return null;
  };

  /**
   * Answers a refusal: a redirect carrying `?error=<reason>` for a
   * browser, a boom envelope for everybody else
   *
   * @param {Express.Response} res the response
   * @param {string} reason why
   * @param {string} [back] where to send a browser
   * @returns {*} the answer
   */
  const refuse = (res, reason, back = null) => {
    const where = back || henri.user.settings.loginPath;
    const message = MESSAGES[reason] || MESSAGES.unknown;
    const answer = STATUSES[reason] || 'badRequest';

    return respond(res, {
      html: () => res.redirect(303, `${where}?error=${reason}`),
      json: () => res.boom[answer](message, { reason }),
    });
  };

  routes.get(`${base}/:provider`, (req, res) => {
    // Leaving has to be a POST: a GET is something a third-party page can
    // make a browser do, and this one starts an authentication
    res.set('Allow', 'POST');

    return res.boom.methodNotAllowed(
      'start a provider sign-in with POST, not GET'
    );
  });

  /**
   * Whether this request may start a sign-in.
   *
   * The CSRF middleware lets an unsafe request through when the visitor
   * holds no session cookie, and everywhere else that is right: there is no
   * session for a third-party page to ride on. Here it is not. Starting a
   * sign-in is precisely the request an attacker's page wants to make in a
   * *signed-out* visitor's browser, and a visitor about to sign in is the
   * one who has no session yet -- so the exemption and the attack describe
   * the same person. The token is therefore required here whatever the
   * cookies say, which costs a real browser nothing: the middleware sets
   * `henri.csrf` on the response before any page can hold a form.
   *
   * The two carve-outs the middleware makes are kept, for the same reasons
   * it makes them: an application that turned CSRF off has no token to
   * present, and a request authenticated by a bearer token carries no
   * cookie an attacker could ride.
   *
   * @param {Express.Request} req the request
   * @returns {boolean} true when the request may proceed
   */
  const allowedToStart = (req) => {
    if (typeof req.csrfToken !== 'string' || !req.csrfToken) {
      return true;
    }

    if (/^bearer\s+\S/iu.test(req.get('authorization') || '')) {
      return true;
    }

    const { checkOrigin, trustedOrigins } = csrfConfig(henri.config);

    if (
      checkOrigin &&
      originAllowed(req, trustedSet(trustedOrigins)) === false
    ) {
      return false;
    }

    return safeEqual(sentToken(req), req.csrfToken);
  };

  routes.post(`${base}/:provider`, (req, res, next) => {
    try {
      if (!allowedToStart(req)) {
        return refuse(res, 'forbidden');
      }

      const provider = resolve(req.params.provider);

      if (!provider) {
        return refuse(res, 'unknown-provider');
      }

      const params = henri.params(req).all();
      const link = req.user ? henri.accounts.identify(req.user) : null;

      if (!link && provider.allows !== 'signin') {
        return refuse(res, 'not-a-sign-in');
      }

      const { url } = begin(req, provider, {
        link,
        returnTo: localPath(params.returnTo),
      });

      return respond(res, {
        html: () => res.redirect(303, url),
        json: () => res.json({ ok: true, url }),
      });
    } catch (error) {
      return next(error);
    }
  });

  routes.get(`${base}/:provider/callback`, async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.set('Referrer-Policy', 'no-referrer');

      const done = await service.complete(req, req.query || {});

      if (!done.ok) {
        return refuse(res, done.reason);
      }

      const { after } = settings();
      const back =
        (done.attempt && done.attempt.returnTo) ||
        (done.action === 'link' ? after : henri.user.settings.afterLogin);

      if (done.action === 'link') {
        await touch(done.identity);

        return respond(res, {
          html: () => {
            req.flash('notice', `${done.identity.provider} is linked.`);

            return res.redirect(303, back);
          },
          json: () =>
            res.json({ identity: publicIdentity(done.identity), ok: true }),
        });
      }

      const refusal = await gate(done.user);

      if (refusal) {
        return refuse(res, refusal);
      }

      await signIn(req, done.user);
      await touch(done.identity);

      const me = henri.user.publicUser(done.user);

      henri.pen.info(
        'identities',
        done.action === 'signup' ? 'signed up' : 'signed in',
        `${done.identity.provider} ${(me && (me.externalId || me.id)) || ''}`.trim()
      );

      return respond(res, {
        html: () => res.redirect(303, back),
        json: () =>
          res.json({
            identity: publicIdentity(done.identity),
            ok: true,
            user: me,
          }),
      });
    } catch (error) {
      return next(error);
    }
  });

  routes.post(`${base}/:provider/unlink`, async (req, res, next) => {
    try {
      if (!req.user) {
        return respond(res, {
          html: () => res.redirect(303, henri.user.settings.loginPath),
          json: () => res.boom.unauthorized('Authentication required'),
        });
      }

      const provider = resolve(req.params.provider);

      if (!provider) {
        return refuse(res, 'unknown-provider', settings().after);
      }

      const done = await service.unlink(req.user, provider.name);

      if (!done.ok) {
        return refuse(res, done.reason, settings().after);
      }

      return respond(res, {
        html: () => {
          req.flash('notice', `${provider.name} is no longer linked.`);

          return res.redirect(303, settings().after);
        },
        json: () => res.json({ ok: true }),
      });
    } catch (error) {
      return next(error);
    }
  });

  return routes;
}

/**
 * The failure a misconfigured provider raises at boot. Returns it rather
 * than throwing, the way `pen.fatal()` does, so the call site reads as the
 * throw it is.
 *
 * @param {Array<string>} found what `problems()` answered
 * @returns {Error} the error to throw
 */
const invalid = (found) =>
  withCode(
    new Error(
      `the identity providers cannot be used as configured:\n  ${found.join('\n  ')}`
    ),
    'HENRI_IDENTITY_PROVIDER_INVALID'
  );

module.exports = identities;
module.exports.ALLOWS = ALLOWS;
module.exports.CLAIMS = CLAIMS;
module.exports.DEFAULTS = DEFAULTS;
module.exports.INTERNAL = INTERNAL;
module.exports.MERGES = MERGES;
module.exports.MESSAGES = MESSAGES;
module.exports.PENDING = PENDING;
module.exports.STATUSES = STATUSES;
module.exports.addressOf = addressOf;
module.exports.identitiesConfig = identitiesConfig;
module.exports.invalid = invalid;
module.exports.isVerified = isVerified;
module.exports.localPath = localPath;
module.exports.printable = printable;
module.exports.providerName = providerName;
module.exports.publicIdentity = publicIdentity;
module.exports.router = router;
module.exports.subjectOf = subjectOf;
