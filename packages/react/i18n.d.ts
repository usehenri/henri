// Type definitions for @usehenri/react/i18n
//
// Hand-written, like the rest of this package's declarations. The client
// half of henri's i18n: the catalogue a document arrived with, the lookup
// over it, and the hook a page calls.

/** What a translation may be given to fill its `{name}` placeholders. */
export type TranslationValues = Record<string, unknown>;

/** A plural entry: the `Intl.PluralRules` categories, plus exact counts. */
export type PluralForms = Record<string, string>;

/** A flat catalogue: dotted keys to a string or a set of plural forms. */
export type Catalogue = Record<string, string | PluralForms>;

/** Options of a `t()` call that are not interpolation values. */
export interface TranslateOptions {
  /**
   * What to answer when the key is not in the catalogue. Written down by a
   * person, so it is not a guess -- and the server still records the key as
   * missing, so it stays findable.
   */
  default?: string;
  /** Select an ordinal form (`1st`, `2nd`) rather than a cardinal one. */
  ordinal?: boolean;
}

/** The translation of a key, in the locale of the page. */
export type Translate = (
  key: string,
  values?: TranslationValues,
  options?: TranslateOptions
) => string;

/** What the server said about the locale of this answer. */
export interface ViewLocale {
  locale: string;
  source: string;
  /** Where the catalogue is fetched, digest and all. */
  url?: string;
  /** The catalogue itself; present on a document, absent on a navigation. */
  messages?: Catalogue;
}

/** What `useTranslation()` answers before anything reached it. */
export const NO_LOCALE: ViewLocale;

/** Fills `{name}` from the values. Nothing is escaped: React does that. */
export function interpolate(
  template: string,
  values?: TranslationValues
): string;

/** The form of a plural entry a count selects; `"=0"` wins over a category. */
export function selectPlural(
  forms: PluralForms,
  count: number,
  locale: string,
  ordinal?: boolean
): string | null;

/** A `t()` over a flat catalogue. A missing key answers the key itself. */
export function createTranslator(options: {
  locale: string;
  messages?: Catalogue;
}): Translate;

/** Keeps the catalogue a document arrived with, for the navigations after. */
export function remember(i18n: ViewLocale | null): boolean;

/** The translator of this page. */
export function useTranslation(): {
  locale: string;
  ready: boolean;
  source: string;
  t: Translate;
};
