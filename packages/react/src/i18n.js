import React, { useEffect, useMemo, useState } from 'react';
import { HenriContext } from './withHenri';

/**
 * The client half of henri's i18n, for a Next.js page.
 *
 * It is a copy of the lookup and not an import of it: the server half --
 * reading `config/locales`, negotiating `Accept-Language`, deciding what a
 * missing key does, digesting a catalogue -- is `fs`, `path` and `crypto`,
 * and a view engine that pulled that into a browser bundle would be a worse
 * problem than seventy duplicated lines. What is duplicated is the part
 * that has to agree: `{name}` interpolation and `Intl.PluralRules`, both of
 * which are specified elsewhere.
 *
 * **Nothing here escapes anything, and that is right.** React escapes every
 * string it renders as a child, so `{t('greeting', { name })}` is safe
 * whatever the name holds -- and a translation carrying `<strong>` shows as
 * text rather than markup, which is the honest difference between this
 * engine and the Handlebars one.
 *
 * **How the strings get here.** The document next.js rendered on the server
 * carries the catalogue in `__NEXT_DATA__`; a client-side navigation asks
 * henri's router for the same page as JSON, and that answer carries only
 * `{ locale, source, url }`, because the browser already has the strings.
 * When the locale changes mid-session the props name a url whose digest is
 * in the file name, so it is cached forever and fetched once.
 */

/** What the browser has, by locale. Kept out of props on purpose. */
const CATALOGUES = new Map();

/** The fetches in flight, so ten pages mounting at once make one request */
const LOADING = new Map();

/** `{name}`, with `{{` and `}}` as the literal braces */
const PLACEHOLDER = /\{\{|\}\}|\{([a-z0-9_.]+)\}/giu;

/** `Intl.PluralRules` instances, which are expensive to build */
const RULES = new Map();

/** What `useTranslation()` answers before anything reached it */
export const NO_LOCALE = Object.freeze({
  locale: 'en',
  messages: {},
  source: 'default',
});

/**
 * The plural rules of a locale, built once
 *
 * @param {string} locale the locale
 * @param {boolean} ordinal ordinal rather than cardinal
 * @returns {?Intl.PluralRules} the rules, or null
 */
const pluralRules = (locale, ordinal) => {
  const key = `${locale}:${ordinal ? 'ordinal' : 'cardinal'}`;

  if (!RULES.has(key)) {
    try {
      RULES.set(
        key,
        new Intl.PluralRules(locale, {
          type: ordinal ? 'ordinal' : 'cardinal',
        })
      );
    } catch {
      RULES.set(key, null);
    }
  }

  return RULES.get(key);
};

/**
 * Fills `{name}` from the values. Nothing is escaped: React does that.
 *
 * @param {string} template the translation
 * @param {object} values the values
 * @returns {string} the filled string
 */
export const interpolate = (template, values) => {
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

    const value = values ? values[name] : undefined;

    return value === null || typeof value === 'undefined'
      ? match
      : String(value);
  });
};

/**
 * The form of a plural entry a count selects. An exact `"=0"` wins over the
 * category, because "no notes" is a sentence and not a plural of "note".
 *
 * @param {object} forms the plural forms
 * @param {number} count the count
 * @param {string} locale the locale
 * @param {boolean} ordinal ordinal rather than cardinal
 * @returns {?string} the form, or null
 */
export const selectPlural = (forms, count, locale, ordinal) => {
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
 * A `t()` over a flat catalogue.
 *
 * A key nobody translated answers the key itself, never a sentence guessed
 * from it: the server records what was asked for and `henri doctor`
 * compares the files, and both of those depend on the key surviving.
 *
 * @param {object} options `{ locale, messages }`
 * @returns {function} `t(key, values, options)`
 */
export const createTranslator = ({ locale, messages }) => {
  const catalogue = messages || {};

  return (key, values = {}, options = {}) => {
    if (typeof key !== 'string' || key.length === 0) {
      return '';
    }

    const entry = Object.hasOwn(catalogue, key) ? catalogue[key] : null;

    if (entry === null) {
      return typeof options.default === 'string'
        ? interpolate(options.default, values)
        : key;
    }

    if (typeof entry === 'string') {
      return interpolate(entry, values);
    }

    const form = selectPlural(
      entry,
      typeof values.count === 'number' ? values.count : Number.NaN,
      locale,
      options.ordinal === true
    );

    return typeof form === 'string' ? interpolate(form, values) : key;
  };
};

/**
 * Keeps the catalogue a document arrived with, so the navigations after it
 * do not have to carry one
 *
 * @param {object} i18n the `i18n` view prop
 * @returns {boolean} whether anything was kept
 */
export const remember = (i18n) => {
  if (!i18n || !i18n.locale || !i18n.messages) {
    return false;
  }

  CATALOGUES.set(i18n.locale, i18n.messages);

  return true;
};

/**
 * Fetches a catalogue the browser does not have yet, once per locale
 *
 * @param {string} locale the locale
 * @param {string} url where it is served, digest and all
 * @returns {Promise<object>} the catalogue
 */
const load = (locale, url) => {
  if (!LOADING.has(url)) {
    LOADING.set(
      url,
      fetch(url, { headers: { Accept: 'application/json' } })
        .then((answer) => (answer.ok ? answer.json() : {}))
        .then((messages) => {
          CATALOGUES.set(locale, messages);

          return messages;
        })
        // A catalogue that will not load leaves the keys on the page, which
        // is what a missing translation looks like everywhere else
        .catch(() => ({}))
    );
  }

  return LOADING.get(url);
};

/**
 * The translator of this page: `{ t, locale, source, ready }`.
 *
 * `ready` is false only while a locale the browser has never seen is being
 * fetched -- a language switch, in practice. `t()` answers the keys until
 * it lands, which is a page in the wrong language for one paint rather than
 * a page that is not there.
 *
 * @returns {object} `{ locale, ready, source, t }`
 * @example
 *   const { t } = useTranslation();
 *   return <h1>{t('notes.title', { count: notes.length })}</h1>;
 */
export const useTranslation = () => {
  const context = React.useContext(HenriContext);
  const i18n = (context && context.i18n) || NO_LOCALE;

  remember(i18n);

  const [, bump] = useState(0);
  const known = CATALOGUES.get(i18n.locale);

  useEffect(() => {
    if (CATALOGUES.has(i18n.locale) || !i18n.url) {
      return undefined;
    }

    let live = true;

    load(i18n.locale, i18n.url).then(() => live && bump((one) => one + 1));

    return () => {
      live = false;
    };
  }, [i18n.locale, i18n.url]);

  return useMemo(
    () => ({
      locale: i18n.locale,
      ready: Boolean(known),
      source: i18n.source,
      t: createTranslator({ locale: i18n.locale, messages: known }),
    }),
    [i18n.locale, i18n.source, known]
  );
};
