/**
 * The documentation of the henri version that is installed.
 *
 * An agent that guesses henri from its training data guesses a framework
 * that was asleep for years. The pages of usehenri.io are the source of
 * truth for what the code does, so they travel with the framework:
 * `scripts/prepublish.js` copies `website/src/content/docs` into
 * `@usehenri/core/docs` at publish time, and the `guide` tool serves them
 * with the versions of the packages actually installed in the application
 * next to them.
 *
 * Finding them is `@usehenri/cli/scripts/docs`, which is also what
 * `henri docs` prints: one reader, so an agent with an MCP client and an
 * agent with a terminal read the same bytes of the same version. This file
 * is the part that is the MCP server's own -- the cap on one answer, and
 * the shape the `guide` tool hands back.
 */

const reader = require('@usehenri/cli/scripts/docs');

/** Characters of one page (they are 10-40 KB) */
const MAX = 60000;

/**
 * Where the pages are: the copy of the version the application runs, else
 * the one next to the command line, else the monorepo
 *
 * @param {string} [cwd=process.cwd()] the application directory
 * @returns {?string} the directory, or null when there is none
 */
const location = (cwd = process.cwd()) => {
  const found = reader.location(cwd);

  return found ? found.dir : null;
};

/**
 * Every page of the documentation, as slugs (`guides/routes`)
 *
 * @param {string} [cwd=process.cwd()] the application directory
 * @returns {Array<string>} the slugs, sorted
 */
const slugs = (cwd = process.cwd()) => reader.slugs(location(cwd));

/**
 * The file a slug names, refusing anything that leaves the directory
 *
 * @param {string} slug the slug (`guides/routes`)
 * @param {string} [cwd=process.cwd()] the application directory
 * @returns {?string} the file, or null when there is none
 */
const fileOf = (slug, cwd = process.cwd()) =>
  reader.fileOf(slug, location(cwd));

/**
 * The index: every page with its title and what it covers
 *
 * @param {string} [cwd=process.cwd()] the application directory
 * @returns {Array<object>} `[{ slug, title, description }]`
 */
const index = (cwd = process.cwd()) => {
  const found = reader.index(cwd);

  return found ? found.pages : [];
};

/**
 * One page, bounded
 *
 * @param {string} slug the slug
 * @param {string} [cwd=process.cwd()] the application directory
 * @returns {?object} `{ slug, title, description, text, truncated }`
 */
const page = (slug, cwd = process.cwd()) => {
  const found = reader.page(slug, cwd);

  if (!found) {
    return null;
  }

  const { text } = found;

  return {
    description: found.description,
    slug: found.slug,
    text: text.length > MAX ? `${text.slice(0, MAX)}\n...` : text,
    title: found.title,
    truncated: text.length > MAX,
  };
};

module.exports = {
  MAX,
  fileOf,
  index,
  location,
  page,
  parse: reader.parse,
  slugs,
};
