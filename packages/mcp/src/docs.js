const fs = require('fs');
const path = require('path');

/**
 * The documentation of the henri version that is installed.
 *
 * An agent that guesses henri from its training data guesses a framework
 * that was asleep for years. The pages of usehenri.io are the source of
 * truth for what the code does, so they travel with this package
 * (`scripts/prepublish.js` copies `website/src/content/docs` into `docs/`
 * at publish time) and the `guide` tool serves them with the versions of
 * the packages actually installed in the application next to them.
 *
 * Inside the monorepo there is no copy: the pages are read from the website
 * directory, which is the same text.
 */

/** Characters of one page (they are 10-40 KB) */
const MAX = 60000;

/** Frontmatter, at the top of every page */
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

/**
 * Where the pages are: the copy shipped with this package, else the
 * website of the monorepo
 *
 * @returns {?string} the directory, or null when there is none
 */
const location = () => {
  const candidates = [
    path.resolve(__dirname, '..', 'docs'),
    path.resolve(__dirname, '..', '..', '..', 'website/src/content/docs'),
  ];

  return candidates.find((dir) => fs.existsSync(dir)) || null;
};

/**
 * The `title` and `description` of a page, from its frontmatter
 *
 * @param {string} source the page
 * @returns {{title: ?string, description: ?string, body: string}} the page
 */
const parse = (source) => {
  const matched = source.match(FRONTMATTER);

  if (!matched) {
    return { body: source, description: null, title: null };
  }

  const read = (key) => {
    const found = matched[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));

    return found ? found[1].trim().replace(/^['"]|['"]$/g, '') : null;
  };

  return {
    body: source.slice(matched[0].length),
    description: read('description'),
    title: read('title'),
  };
};

/**
 * Every page of the documentation, as slugs (`guides/routes`)
 *
 * @param {?string} [dir=location()] the documentation directory
 * @returns {Array<string>} the slugs, sorted
 */
const slugs = (dir = location()) => {
  if (!dir) {
    return [];
  }

  const found = [];
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), `${prefix}${entry.name}/`);
      } else if (/\.mdx?$/.test(entry.name)) {
        found.push(`${prefix}${entry.name.replace(/\.mdx?$/, '')}`);
      }
    }
  };

  walk(dir, '');

  return found.sort();
};

/**
 * The file a slug names, refusing anything that leaves the directory
 *
 * @param {string} slug the slug (`guides/routes`)
 * @param {?string} [dir=location()] the documentation directory
 * @returns {?string} the file, or null when there is none
 */
const fileOf = (slug, dir = location()) => {
  if (!dir || typeof slug !== 'string' || !/^[a-z0-9/_-]+$/i.test(slug)) {
    return null;
  }

  for (const extension of ['.md', '.mdx']) {
    const file = path.resolve(dir, `${slug}${extension}`);

    if (file.startsWith(`${dir}${path.sep}`) && fs.existsSync(file)) {
      return file;
    }
  }

  return null;
};

/**
 * The index: every page with its title and what it covers
 *
 * @returns {Array<object>} `[{ slug, title, description }]`
 */
const index = () => {
  const dir = location();

  return slugs(dir).map((slug) => {
    const { description, title } = parse(
      fs.readFileSync(fileOf(slug, dir), 'utf8')
    );

    return { description, slug, title };
  });
};

/**
 * One page, bounded
 *
 * @param {string} slug the slug
 * @returns {?object} `{ slug, title, description, text, truncated }`
 */
const page = (slug) => {
  const file = fileOf(slug);

  if (!file) {
    return null;
  }

  const { body, description, title } = parse(fs.readFileSync(file, 'utf8'));

  return {
    description,
    slug,
    text: body.length > MAX ? `${body.slice(0, MAX)}\n...` : body,
    title,
    truncated: body.length > MAX,
  };
};

module.exports = { MAX, fileOf, index, location, page, parse, slugs };
