import { getCollection } from 'astro:content';

/** Where these pages are published */
export const SITE = 'https://usehenri.io';

/** What henri is, in one sentence */
export const SUMMARY =
  'henri is a Rails-like, server-side rendered JavaScript framework for Node.js: models, controllers, routes and React views, with real ORMs, background jobs, a JSON API layer and hot reload.';

/** A page, flattened out of the collection */
export type Page = {
  body: string;
  description: string;
  order: number;
  slug: string;
  title: string;
};

/** A group of pages, in the order the sidebar puts them */
export type Section = { name: string; pages: Page[] };

/** The sidebar order of `astro.config.mjs`, plus a home for the rest */
const SECTIONS: { name: string; prefix: string }[] = [
  { name: 'Start here', prefix: '' },
  { name: 'Guides', prefix: 'guides/' },
  { name: 'Reference', prefix: 'reference/' },
];

/** The pages of the first section, in the order the sidebar lists them */
const START = ['getting-started', 'configuration', 'upgrading'];

/** The pages of the last section, which is llmstxt.org's "Optional" */
const OPTIONAL = 'e/';

/**
 * The url a slug is published at
 *
 * @param slug the slug (`guides/routes`)
 * @returns the url, with the trailing slash the site uses
 */
export const urlOf = (slug: string): string =>
  slug === 'index' ? `${SITE}/` : `${SITE}/${slug}/`;

/**
 * Every documentation page, without the splash page (which is components
 * rather than prose) and without a page marked `draft`
 *
 * @returns the pages
 */
export const pages = async (): Promise<Page[]> => {
  const entries = await getCollection('docs');

  return entries
    .map((entry) => {
      const data = entry.data as Record<string, any>;
      const slug = (entry as { id?: string; slug?: string }).id ?? '';

      return {
        body: entry.body ?? '',
        description: String(data.description ?? ''),
        order: Number(data.sidebar?.order ?? 100),
        slug: slug.replace(/\.mdx?$/, ''),
        title: String(data.title ?? slug),
      };
    })
    .filter((page) => page.slug !== 'index' && page.body.trim() !== '');
};

/**
 * The pages grouped and ordered the way the sidebar groups and orders them
 *
 * @returns the sections, empty ones dropped
 */
export const sections = async (): Promise<Section[]> => {
  const all = await pages();
  const inSection = (page: Page, prefix: string): boolean =>
    prefix === ''
      ? !page.slug.includes('/')
      : page.slug.startsWith(prefix) && page.slug !== OPTIONAL;
  const byOrder = (one: Page, two: Page): number =>
    one.order === two.order
      ? one.title.localeCompare(two.title)
      : one.order - two.order;

  const found: Section[] = SECTIONS.map(({ name, prefix }) => ({
    name,
    pages: all
      .filter(
        (page) => !page.slug.startsWith(OPTIONAL) && inSection(page, prefix)
      )
      .sort(
        prefix === ''
          ? (one, two) => START.indexOf(one.slug) - START.indexOf(two.slug)
          : byOrder
      ),
  }));

  const errors = all
    .filter((page) => page.slug.startsWith(OPTIONAL))
    .sort((one, two) => one.slug.localeCompare(two.slug));

  if (errors.length > 0) {
    found.push({ name: 'Optional', pages: errors });
  }

  return found.filter((section) => section.pages.length > 0);
};
