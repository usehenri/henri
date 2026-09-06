const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { fail } = require('./errors');

/**
 * Internationalization: the catalogues, the lookup and the locale of a
 * request. `1.i18n.js` is the module around this file, and this header is
 * the document.
 *
 * ## The cost of not using it
 *
 * Most applications have one language, and they pay nothing for this:
 * without a `config.i18n` block **and** without a `config/locales`
 * directory, `enabled` is false, no catalogue is read, no middleware is
 * mounted, no property is set on a request, nothing reaches a view and
 * there is no boot line. The rule is the call log's: off unless the
 * application asked, and off means absent rather than present and quiet.
 *
 * ## Which locale, and why it is visible
 *
 * `decide()` answers in one order and says which step answered:
 *
 * 1. `explicit` -- `req.setLocale()`, or `{ locale }` on a call
 * 2. `user` -- the column `i18n.from.user` names on the signed-in user
 * 3. `query` -- `?locale=fr` (`i18n.from.query`)
 * 4. `cookie` -- the cookie `i18n.from.cookie` names. henri **reads** it and
 *    never writes it: a language switcher is an action of the application,
 *    and a framework that sets a cookie nobody asked for is a framework
 *    that broke somebody's cache
 * 5. `header` -- `Accept-Language`, negotiated by q value, with `fr-CA`
 *    matching `fr`
 * 6. `default` -- `i18n.default`
 *
 * The answer is `req.locale` and the step is `req.localeSource`, on the
 * request, where they can be read, logged and asserted. A decision nobody
 * can see is a decision nobody can debug.
 *
 * **The path is not in that list.** `/fr/notes` is a routing decision, and
 * henri's route table is the source of both the url and the helper that
 * builds it: stripping a prefix at the edge would make `notes_path()` lie
 * to every page that prints it. An application that wants a prefix writes
 * one route table for it (`namespace fr`) and calls `req.setLocale('fr')`
 * in a `before` hook -- two lines, and the helpers stay true.
 *
 * ## A key nobody translated
 *
 * A missing key is **never** guessed at. `t('nav.settings')` does not
 * become "Settings": a humanized key reads like a translation, ships like
 * one and is invisible in a review, which is how an application ends up
 * half translated in production. It answers the key itself, which is ugly
 * on purpose and greppable, and it is recorded in `henri.i18n.missing()`
 * whatever the mode.
 *
 * `i18n.missing` is what happens on top of that: `warn` says it once per
 * key, `key` says nothing, `throw` raises `HENRI_LOCALE_TRANSLATION_MISSING`
 * and `auto` (the default) is `warn` outside production and `key` in it.
 * A test suite sets `throw`, which is the only setting that makes a
 * missing key fail a build.
 *
 * A key found in a fallback locale is **not** missing -- it is answered,
 * silently, because that is what a fallback is for. What makes it findable
 * is `henri doctor`, which compares the catalogues on disk and reports
 * every key one locale has and another does not.
 *
 * ## What is escaped, and where
 *
 * A translation is written by a developer and lives in the repository; the
 * values interpolated into it come from the application, which means they
 * can come from a person. So the split is:
 *
 * - the **translation** is never escaped by henri. It is a template, and it
 *   may carry markup on purpose.
 * - the **values** are escaped by whatever renders them, and `t()` itself
 *   escapes nothing: it answers a plain string, because a controller
 *   putting one in a JSON body would otherwise ship `&amp;` to a client
 *   that is not a browser.
 *
 * The Handlebars helper is the one place henri escapes, and it escapes the
 * values only (`escape` below), returning the result as a `SafeString`:
 * that is what lets a translation carry `<strong>` while a name carries
 * nothing. React escapes its own children, so on the client `t()` is a
 * plain string and a translation carrying markup shows as text -- a real
 * difference between the engines, stated in the guide rather than papered
 * over.
 *
 * ## What this is not
 *
 * Dates, numbers and currency are `Intl`'s, and henri wraps none of it:
 * `Intl.NumberFormat(req.locale, options)` is better documented, better
 * versioned and knows more than anything henri would put in front of it.
 * Plurals are `Intl.PluralRules`, for the same reason -- it knows the
 * categories of every locale ICU knows, and a hand-written `n === 1` does
 * not know Polish.
 */

/** Where the catalogues live, under the application */
const DEFAULT_PATH = 'config/locales';

/** The locale everything falls back to when nothing says otherwise */
const DEFAULT_LOCALE = 'en';

/** What `i18n.missing` accepts */
const MISSING_MODES = ['auto', 'key', 'throw', 'warn'];

/** What `i18n.client` accepts (`false` is the fourth) */
const CLIENT_MODES = ['always', 'auto'];

/** The plural categories `Intl.PluralRules` selects, plus the exact forms */
const PLURAL_CATEGORIES = ['few', 'many', 'one', 'other', 'two', 'zero'];

/** An exact count form: `"=0"`, `"=1"` */
const EXACT = /^=(\d+)$/u;

/** A locale tag henri accepts as a catalogue name (BCP 47, the easy half) */
const TAG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu;

/** `{name}`, with `{{` and `}}` as the literal braces */
const PLACEHOLDER = /\{\{|\}\}|\{([a-z0-9_.]+)\}/giu;

/** How many missing keys are remembered before the record stops growing */
const MAX_REMEMBERED = 1000;

/** The path the client catalogues are served from */
const CLIENT_PATH = '/_henri/locales';

/** Key prefixes that never leave the server */
const DEFAULT_SERVER_ONLY = ['mailers'];

/** `Intl.PluralRules` instances, which are expensive to build */
const RULES = new Map();

/**
 * The plural rules of a locale, built once
 *
 * @param {string} locale the locale
 * @param {boolean} ordinal ordinal rather than cardinal
 * @returns {?Intl.PluralRules} the rules, or null when Intl refuses the tag
 */
const pluralRules = (locale, ordinal = false) => {
  const key = `${locale}:${ordinal ? 'ordinal' : 'cardinal'}`;

  if (RULES.has(key)) {
    return RULES.get(key);
  }

  let rules;

  try {
    rules = new Intl.PluralRules(locale, {
      type: ordinal ? 'ordinal' : 'cardinal',
    });
  } catch {
    // A tag Intl will not take is not a tag henri can pluralize with: the
    // `other` form answers, which is what a locale with one form gets too
    rules = null;
  }

  RULES.set(key, rules);

  return rules;
};

/**
 * Is this object a plural form rather than a nested namespace?
 *
 * Every key is a category `Intl.PluralRules` selects or an exact count, and
 * `other` is there -- which is the form every locale has and the one a
 * selection falls back to. `{ one: {...} }` without an `other` is a
 * namespace called "one", and reading it as a plural would lose the rest.
 *
 * @param {*} value the value
 * @returns {boolean} whether it is a plural form
 */
const isPluralForm = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);

  return (
    keys.length > 0 &&
    keys.includes('other') &&
    keys.every((key) => PLURAL_CATEGORIES.includes(key) || EXACT.test(key))
  );
};

/**
 * Flattens a catalogue into dotted keys.
 *
 * A leaf is a string or a plural form; an array becomes numbered keys
 * (`days.0`). Anything else -- a number, a boolean, null -- is refused
 * rather than coerced, because a catalogue is text and a `2` that renders
 * as "2" is a translation nobody wrote.
 *
 * @param {*} value what to flatten
 * @param {string} prefix the key so far
 * @param {object} out where the leaves go
 * @param {Array<string>} problems where the refusals go
 * @returns {object} `out`
 */
const flatten = (value, prefix, out, problems) => {
  if (typeof value === 'string' || isPluralForm(value)) {
    out[prefix] = value;

    return out;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      flatten(
        item,
        prefix ? `${prefix}.${index}` : String(index),
        out,
        problems
      )
    );

    return out;
  }

  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      flatten(nested, prefix ? `${prefix}.${key}` : key, out, problems);
    }

    return out;
  }

  problems.push(
    `${prefix || '(root)'} is ${value === null ? 'null' : typeof value}, and a translation is text`
  );

  return out;
};

/**
 * The digest of a catalogue: what makes its url immutable
 *
 * @param {object} catalogue the flattened catalogue
 * @returns {string} eight hexadecimal characters
 */
const digestOf = (catalogue) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        Object.keys(catalogue)
          .sort()
          .map((key) => [key, catalogue[key]])
      )
    )
    .digest('hex')
    .slice(0, 8);

/**
 * The locale files of an application, flattened and validated.
 *
 * `config/locales/fr.json` is one locale; `config/locales/fr/nav.json` is
 * the same locale under the `nav` prefix, which is how a catalogue stays
 * readable past a few hundred strings.
 *
 * @param {string} root the directory to read
 * @returns {{catalogues: object, problems: Array<object>}} what was found
 */
const readCatalogues = (root) => {
  const catalogues = {};
  const problems = [];

  if (!fs.existsSync(root)) {
    return { catalogues, problems };
  }

  /**
   * Reads one JSON file into a locale, under a prefix
   *
   * @param {string} file the file
   * @param {string} locale the locale it belongs to
   * @param {string} prefix the key prefix
   * @returns {boolean} whether it was read
   */
  const read = (file, locale, prefix) => {
    let parsed;

    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      problems.push({ file, locale, reason: error.message });

      return false;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      problems.push({
        file,
        locale,
        reason: 'a locale file holds an object of keys',
      });

      return false;
    }

    const refused = [];
    const flat = flatten(parsed, prefix, {}, refused);

    for (const reason of refused) {
      problems.push({ file, locale, reason });
    }

    catalogues[locale] = Object.assign(catalogues[locale] || {}, flat);

    return true;
  };

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && TAG.test(entry.name)) {
      const dir = path.join(root, entry.name);

      catalogues[entry.name] = catalogues[entry.name] || {};

      for (const file of fs.readdirSync(dir)) {
        file.endsWith('.json') &&
          read(path.join(dir, file), entry.name, path.basename(file, '.json'));
      }

      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const locale = path.basename(entry.name, '.json');

    TAG.test(locale) && read(path.join(root, entry.name), locale, '');
  }

  return { catalogues, problems };
};

/**
 * `config.i18n`, normalized.
 *
 * The catalogues on disk are part of the answer: an application that wrote
 * `config/locales/fr.json` and no configuration block meant to translate
 * something, and one that wrote neither did not.
 *
 * @param {*} config the henri configuration (or a plain object)
 * @param {string} [cwd=null] the application directory, to look for locales
 * @returns {object} the settings
 */
const i18nConfig = (config, cwd = null) => {
  const reader = config && typeof config.get === 'function';
  let raw;

  if (reader) {
    // `has()` first: `get()` on a key the schema knows but the file does not
    // is not the same question, and `false` is a value here
    raw = config.has('i18n') ? config.get('i18n') : undefined;
  } else {
    raw = config ? config.i18n : undefined;
  }

  const given = raw && typeof raw === 'object' ? raw : {};
  const dir = path.resolve(cwd || process.cwd(), given.path || DEFAULT_PATH);
  const { catalogues, problems } = readCatalogues(dir);
  const found = Object.keys(catalogues).sort();
  const asked = Array.isArray(given.locales) ? given.locales : null;
  const locales = asked || found;
  const fallback =
    typeof given.fallback === 'undefined' ? true : given.fallback;
  const from =
    (given.from && typeof given.from === 'object' && given.from) || {};
  const preferred = locales.includes(DEFAULT_LOCALE)
    ? DEFAULT_LOCALE
    : locales[0] || DEFAULT_LOCALE;
  let client = 'auto';

  typeof given.client === 'undefined' ||
    (client = CLIENT_MODES.includes(given.client) ? given.client : false);

  return {
    catalogues,
    client,
    default:
      typeof given.default === 'string' && given.default
        ? given.default
        : preferred,
    dir,
    // A block that says nothing and a directory with nothing in it are the
    // same thing: this application has one language
    enabled: raw === false ? false : locales.length > 0,
    fallback,
    from: {
      cookie: typeof from.cookie === 'undefined' ? 'henri.locale' : from.cookie,
      header: from.header !== false,
      query: typeof from.query === 'undefined' ? 'locale' : from.query,
      user: typeof from.user === 'string' ? from.user : null,
    },
    locales,
    missing: MISSING_MODES.includes(given.missing) ? given.missing : 'auto',
    problems,
    serverOnly: Array.isArray(given.serverOnly)
      ? given.serverOnly
      : DEFAULT_SERVER_ONLY,
  };
};

/**
 * The best of the locales an `Accept-Language` header asks for.
 *
 * q values decide, `fr-CA` matches a catalogue named `fr`, and `*` means
 * the first supported one. A header henri cannot parse answers null, which
 * is the default rather than a failure.
 *
 * @param {*} header the header value
 * @param {Array<string>} locales what the application has
 * @returns {?string} the locale, or null
 */
const negotiate = (header, locales) => {
  if (typeof header !== 'string' || header.length === 0 || !locales.length) {
    return null;
  }

  const lowered = new Map(locales.map((one) => [one.toLowerCase(), one]));
  const wanted = header
    .split(',')
    .map((part) => {
      const [tag, ...rest] = part.trim().split(';');
      const quality = rest
        .map((bit) => /^\s*q=([0-9.]+)\s*$/iu.exec(bit))
        .find(Boolean);

      return {
        quality: quality ? Number.parseFloat(quality[1]) : 1,
        tag: tag.trim().toLowerCase(),
      };
    })
    .filter((one) => one.tag && Number.isFinite(one.quality) && one.quality > 0)
    .sort((one, two) => two.quality - one.quality);

  for (const { tag } of wanted) {
    if (tag === '*') {
      return locales[0];
    }

    if (lowered.has(tag)) {
      return lowered.get(tag);
    }

    const base = tag.split('-')[0];

    if (lowered.has(base)) {
      return lowered.get(base);
    }

    // `fr` asked for, `fr-CA` on disk: the language matches
    const regional = locales.find(
      (one) => one.toLowerCase().split('-')[0] === base
    );

    if (regional) {
      return regional;
    }
  }

  return null;
};

/**
 * Fills `{name}` from the values, escaping each one on the way in.
 *
 * The template is never escaped and the values always are, when an escape
 * function is given: that is the whole security rule of this feature, in
 * one function. `{{` and `}}` are the literal braces.
 *
 * @param {string} template the translation
 * @param {object} values the values
 * @param {object} [options={}] `escape`, `onMissing`
 * @returns {string} the filled string
 */
const interpolate = (template, values, { escape = null, onMissing } = {}) => {
  if (template.indexOf('{') === -1) {
    return template;
  }

  return template.replace(PLACEHOLDER, (match, name) => {
    if (match === '{{') {
      return '{';
    }

    if (match === '}}') {
      return '}';
    }

    const value = values && Object.hasOwn(values, name) ? values[name] : null;

    if (value === null || typeof value === 'undefined') {
      typeof onMissing === 'function' && onMissing(name);

      // Left as written: a placeholder in the page says which value was
      // not passed, where a blank says nothing at all
      return match;
    }

    const text = typeof value === 'string' ? value : String(value);

    return escape ? escape(text) : text;
  });
};

/**
 * The form of a plural entry a count selects.
 *
 * `Intl.PluralRules` answers the category, and an exact form (`"=0"`) wins
 * over it -- "no notes" is a sentence, not a plural of "note", and no
 * plural rule in any locale will produce it.
 *
 * @param {object} forms the plural forms
 * @param {number} count the count
 * @param {string} locale the locale
 * @param {boolean} [ordinal=false] ordinal rather than cardinal
 * @returns {?string} the form, or null
 */
const selectPlural = (forms, count, locale, ordinal = false) => {
  if (!Number.isFinite(count)) {
    return null;
  }

  const exact = `=${count}`;

  if (Object.hasOwn(forms, exact)) {
    return forms[exact];
  }

  const rules = pluralRules(locale, ordinal);
  const category = rules ? rules.select(count) : 'other';

  return Object.hasOwn(forms, category) ? forms[category] : forms.other || null;
};

/**
 * The locales a lookup walks, in order.
 *
 * The locale itself, then its language when it is regional (`fr-CA` before
 * `fr`), then the fallbacks and their languages. Nothing appears twice.
 *
 * @param {string} locale the locale asked for
 * @param {object} settings the normalized settings
 * @returns {Array<string>} the chain
 */
const chainOf = (locale, settings) => {
  const chain = [];
  /**
   * Adds a locale to the chain, once, and its language after it
   *
   * @param {*} one the locale
   * @returns {boolean} whether anything was added
   */
  const add = (one) => {
    if (typeof one !== 'string' || !one || chain.includes(one)) {
      return false;
    }

    chain.push(one);

    const base = one.split('-')[0];

    base !== one && !chain.includes(base) && chain.push(base);

    return true;
  };

  add(locale);

  if (settings.fallback === false) {
    return chain;
  }

  const fallbacks =
    settings.fallback === true
      ? [settings.default]
      : [].concat(settings.fallback);

  fallbacks.forEach(add);

  return chain;
};

/**
 * The translator: the catalogues, and the one question asked of them.
 *
 * @class Translator
 */
class Translator {
  /**
   * Creates an instance of Translator.
   * @param {object} options `{ henri, settings }`
   * @memberof Translator
   */
  constructor({ henri = null, settings }) {
    this.henri = henri;
    this.settings = settings;
    /** The flattened catalogues, by locale */
    this.catalogues = settings.catalogues || {};
    /** Every key that was asked for and not found, bounded */
    this._missing = new Map();
    /** How many misses there were, whether or not they are remembered */
    this._misses = 0;
    /** What has been warned about once */
    this._warned = new Set();
    /** The digest of each locale's client catalogue */
    this._digests = new Map();

    this.t = this.t.bind(this);
  }

  /**
   * The locales this application has
   *
   * @returns {Array<string>} the locales
   * @memberof Translator
   */
  get locales() {
    return this.settings.locales;
  }

  /**
   * What `i18n.missing` means here and now
   *
   * @returns {string} `key`, `throw` or `warn`
   * @memberof Translator
   */
  get mode() {
    const { missing } = this.settings;

    if (missing !== 'auto') {
      return missing;
    }

    return this.henri && this.henri.isProduction ? 'key' : 'warn';
  }

  /**
   * Is this a locale the application has?
   *
   * @param {*} locale the locale
   * @returns {boolean} yes or no
   * @memberof Translator
   */
  supports(locale) {
    return typeof locale === 'string' && this.settings.locales.includes(locale);
  }

  /**
   * The raw entry for a key, and the locale it came from
   *
   * @param {string} key the key
   * @param {string} locale the locale
   * @returns {?object} `{ entry, locale }`, or null
   * @memberof Translator
   */
  lookup(key, locale) {
    for (const one of chainOf(locale, this.settings)) {
      const catalogue = this.catalogues[one];

      if (catalogue && Object.hasOwn(catalogue, key)) {
        return { entry: catalogue[key], locale: one };
      }
    }

    return null;
  }

  /**
   * Does any locale in the chain have this key?
   *
   * @param {string} key the key
   * @param {string} [locale=null] the locale, defaulting to the default one
   * @returns {boolean} yes or no
   * @memberof Translator
   */
  has(key, locale = null) {
    return this.lookup(key, locale || this.settings.default) !== null;
  }

  /**
   * The translation of a key.
   *
   * @param {string} key the key
   * @param {object} [values={}] the interpolation values (`count` selects
   *   the plural form and is interpolated like the rest)
   * @param {object} [options={}] `locale`, `default`, `ordinal`, `escape`
   * @returns {string} the translation, or the key
   * @throws {Error} `HENRI_LOCALE_TRANSLATION_MISSING`, with `missing: throw`
   * @memberof Translator
   */
  t(key, values = {}, options = {}) {
    // Guarded by hand rather than through base/arguments.js: this is the
    // one method a page calls once per string, and a schema walk per
    // string is a cost nobody asked for (the reason is in UNCHECKED)
    if (typeof key !== 'string' || key.length === 0) {
      throw fail(
        'HENRI_LOCALE_KEY_INVALID',
        `t() takes a key, and it was given ${key === null ? 'null' : typeof key}`
      );
    }

    const locale = options.locale || this.settings.default;

    if (options.locale && !this.supports(options.locale)) {
      throw fail(
        'HENRI_LOCALE_UNKNOWN',
        `no locale "${options.locale}": this application has ${this.settings.locales.join(', ') || 'none'}`
      );
    }

    const found = this.lookup(key, locale);
    const escape = options.escape || null;

    if (!found) {
      return this.absent(key, locale, values, options);
    }

    let template = found.entry;

    if (typeof template !== 'string') {
      const count = values && values.count;

      template = selectPlural(
        template,
        typeof count === 'number' ? count : Number.NaN,
        found.locale,
        options.ordinal === true
      );

      if (typeof template !== 'string') {
        // The key is a plural entry and the call passed no count: there is
        // no form to pick, and picking `other` would be a guess
        return this.absent(key, locale, values, options, 'no count');
      }
    }

    return interpolate(template, values, {
      escape,
      onMissing: (name) => this.record(`${locale}:${key}`, `{${name}}`),
    });
  }

  /**
   * What a key nobody translated answers with
   *
   * @param {string} key the key
   * @param {string} locale the locale
   * @param {object} values the interpolation values
   * @param {object} options the options of the call
   * @param {string} [why='no key'] what was missing
   * @returns {string} the fallback
   * @throws {Error} `HENRI_LOCALE_TRANSLATION_MISSING` with `missing: throw`
   * @memberof Translator
   */
  absent(key, locale, values, options, why = 'no key') {
    this.record(`${locale}:${key}`, why);

    const { mode } = this;

    if (mode === 'throw') {
      throw fail(
        'HENRI_LOCALE_TRANSLATION_MISSING',
        `no "${key}" in ${locale} (${why})`
      );
    }

    mode === 'warn' &&
      this.henri &&
      this.warnOnce(
        `${locale}:${key}`,
        `no "${key}" in ${locale}`,
        `add it to ${path.join(this.settings.dir.split(path.sep).slice(-2).join(path.sep), `${locale}.json`)}, or pass a default`
      );

    // A written-down default is not a guess: somebody typed it. It is
    // still recorded, so it shows up in `henri.i18n.missing()` like the
    // rest and does not become a translation by being invisible
    if (typeof options.default === 'string') {
      return interpolate(options.default, values, {
        escape: options.escape || null,
      });
    }

    return key;
  }

  /**
   * Remembers a key nobody translated, up to a bound
   *
   * @param {string} key `<locale>:<key>`
   * @param {string} why what was missing
   * @returns {boolean} whether it was remembered
   * @memberof Translator
   */
  record(key, why) {
    this._misses += 1;

    if (this._missing.has(key) || this._missing.size >= MAX_REMEMBERED) {
      return false;
    }

    this._missing.set(key, why);

    return true;
  }

  /**
   * Says something once, however many requests reach it
   *
   * @param {string} key what is being said
   * @param {...string} args the arguments of `pen.warn`
   * @returns {boolean} whether it was said now
   * @memberof Translator
   */
  warnOnce(key, ...args) {
    if (this._warned.has(key)) {
      return false;
    }

    this._warned.add(key);
    this.henri.pen.warn('i18n', ...args);

    return true;
  }

  /**
   * Every key that was asked for and not found
   *
   * @returns {Array<object>} `{ key, locale, why }`, oldest first
   * @memberof Translator
   */
  missing() {
    return Array.from(this._missing.entries()).map(([entry, why]) => {
      const at = entry.indexOf(':');

      return { key: entry.slice(at + 1), locale: entry.slice(0, at), why };
    });
  }

  /**
   * How many lookups missed, remembered or not
   *
   * @returns {number} the count
   * @memberof Translator
   */
  misses() {
    return this._misses;
  }

  /**
   * The catalogue of a locale, as it reaches a browser.
   *
   * The `serverOnly` prefixes are dropped, which is what keeps the strings
   * of a mail out of a page: they are written for a recipient, not for a
   * reader, and shipping them is a payload nobody reads.
   *
   * @param {string} locale the locale
   * @returns {object} the flat catalogue
   * @memberof Translator
   */
  catalogue(locale) {
    const own = this.catalogues[locale] || {};
    const { serverOnly } = this.settings;
    const out = {};

    for (const [key, value] of Object.entries(own)) {
      const hidden = serverOnly.some(
        (prefix) => key === prefix || key.startsWith(`${prefix}.`)
      );

      hidden || (out[key] = value);
    }

    return out;
  }

  /**
   * The digest of a locale's client catalogue, computed once
   *
   * @param {string} locale the locale
   * @returns {string} the digest
   * @memberof Translator
   */
  digest(locale) {
    if (!this._digests.has(locale)) {
      this._digests.set(locale, digestOf(this.catalogue(locale)));
    }

    return this._digests.get(locale);
  }

  /**
   * Where a browser fetches a locale, with the digest in the name so the
   * answer can be cached until the strings change
   *
   * @param {string} locale the locale
   * @returns {string} the path
   * @memberof Translator
   */
  url(locale) {
    return `${CLIENT_PATH}/${locale}.${this.digest(locale)}.json`;
  }

  /**
   * Which locale a request is in, and which step decided it.
   *
   * @param {object} req the request
   * @returns {{locale: string, source: string}} the decision
   * @memberof Translator
   */
  decide(req) {
    const { from } = this.settings;

    if (req && this.supports(req._locale)) {
      return { locale: req._locale, source: 'explicit' };
    }

    if (from.user && req && req.user) {
      const said = req.user[from.user];

      if (this.supports(said)) {
        return { locale: said, source: 'user' };
      }
    }

    if (from.query && req && req.query) {
      const said = req.query[from.query];

      if (this.supports(said)) {
        return { locale: said, source: 'query' };
      }
    }

    if (from.cookie && req && req.cookies) {
      const said = req.cookies[from.cookie];

      if (this.supports(said)) {
        return { locale: said, source: 'cookie' };
      }
    }

    if (from.header && req && typeof req.get === 'function') {
      const said = negotiate(req.get('accept-language'), this.settings.locales);

      if (said) {
        return { locale: said, source: 'header' };
      }
    }

    return { locale: this.settings.default, source: 'default' };
  }

  /**
   * The locale a person's record says they read in.
   *
   * The one call that turns a recipient into a locale, and the reason a
   * mail sent from a job is in the right language: a job has no request,
   * so it has to ask the record. Answers null when the application named
   * no column, when the record has nothing in it, or when what it holds is
   * not a locale this application has.
   *
   * @param {*} user the user record
   * @returns {?string} the locale, or null
   * @memberof Translator
   */
  forUser(user) {
    const column = this.settings.from.user;

    if (!column || !user || typeof user !== 'object') {
      return null;
    }

    const said = user[column];

    return this.supports(said) ? said : null;
  }
}

/**
 * The middleware that decides the locale of a request.
 *
 * Mounted only when the application has catalogues, which is what keeps an
 * application with one language from paying for one: there is no
 * middleware in its stack, not even one that returns.
 *
 * @param {object} henri the henri instance
 * @returns {function} the express middleware
 */
const middleware = (henri) => {
  const { i18n } = henri;

  return (req, res, next) => {
    const decided = i18n.decide(req);

    /**
     * Stamps what this answer is in, and what a cache has to key on.
     *
     * Called again by `setLocale()`, because a `before` hook deciding the
     * locale after the middleware ran must not leave the header saying what
     * the middleware guessed (see guides/i18n.md).
     *
     * @param {string} source which step decided
     * @returns {boolean} done
     */
    const stamp = (source) => {
      if (res.headersSent) {
        return false;
      }

      res.setHeader('Content-Language', req.locale);
      // The header henri varies on is the one that decided: a shared cache
      // that was not told would hand one visitor's language to the next
      source === 'header' && res.vary('Accept-Language');
      (source === 'cookie' || source === 'user') && res.vary('Cookie');

      return true;
    };

    req.locale = decided.locale;
    req.localeSource = decided.source;

    /**
     * Says what this request is in, from here on
     *
     * @param {string} locale the locale
     * @returns {string} the locale
     */
    req.setLocale = (locale) => {
      if (!i18n.supports(locale)) {
        throw fail(
          'HENRI_LOCALE_UNKNOWN',
          `req.setLocale("${locale}"): this application has ${i18n.locales.join(', ')}`
        );
      }

      req._locale = locale;
      req.locale = locale;
      req.localeSource = 'explicit';
      stamp('explicit');

      return locale;
    };

    /**
     * This request's translator
     *
     * @param {string} key the key
     * @param {object} [values={}] the interpolation values
     * @param {object} [options={}] `default`, `ordinal`, `locale`
     * @returns {string} the translation
     */
    req.t = (key, values = {}, options = {}) =>
      i18n.t(key, values, Object.assign({ locale: req.locale }, options));

    stamp(decided.source);

    return next();
  };
};

module.exports = {
  CLIENT_MODES,
  CLIENT_PATH,
  DEFAULT_LOCALE,
  DEFAULT_PATH,
  DEFAULT_SERVER_ONLY,
  MAX_REMEMBERED,
  MISSING_MODES,
  PLURAL_CATEGORIES,
  Translator,
  chainOf,
  digestOf,
  flatten,
  i18nConfig,
  interpolate,
  isPluralForm,
  middleware,
  negotiate,
  pluralRules,
  readCatalogues,
  selectPlural,
};
