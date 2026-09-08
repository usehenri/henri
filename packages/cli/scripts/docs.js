/**
 * `henri docs`: the documentation of the henri that is installed, read from
 * disk.
 *
 * An agent that recalls henri from its training data recalls a framework
 * that was asleep for years, and the website answers for whatever version
 * is deployed rather than the one in `node_modules`. So the pages travel
 * with the package: `scripts/prepublish.js` copies
 * `website/src/content/docs` into `@usehenri/core/docs` at publish time,
 * which makes them version matched by construction -- the documentation of
 * the framework the application is running, not of the framework the
 * documentation site is running.
 *
 * This module is the reader, and everything that serves those pages goes
 * through it: the command, and the `guide` tool of `@usehenri/mcp`
 * (`src/docs.js` is a wrapper around this file, so an agent with an MCP
 * client and an agent with a terminal read the same bytes).
 *
 * Where it looks, in order:
 *
 * 1. `@usehenri/core/docs` in the application -- the version it runs;
 * 2. `@usehenri/core/docs` next to this command line, when there is no
 *    application (`henri docs` outside a project) or its core is older;
 * 3. `@usehenri/mcp/docs`, the copy that package shipped before 1.3;
 * 4. `website/src/content/docs` of the monorepo, which is the same text
 *    and is what the suites read.
 */

const fs = require('fs');
const path = require('path');

const { CliError } = require('./errors');

/** Where a package keeps them */
const DIRECTORY = 'docs';

/** The website the pages are published on */
const SITE = 'https://usehenri.io';

/** Frontmatter, at the top of every page */
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/u;

/** A slug, and nothing that leaves the directory */
const SLUG = /^[a-z0-9][a-z0-9/_-]*$/iu;

/** Characters of a description in the printed index */
const COLUMN = 96;

/**
 * The directory of an installed package, or null when it is not installed
 *
 * @param {string} name the package (`@usehenri/core`)
 * @param {string} from where to resolve it from
 * @returns {?string} the directory
 */
const packageDir = (name, from) => {
  try {
    return path.dirname(
      require.resolve(`${name}/package.json`, { paths: [path.resolve(from)] })
    );
  } catch {
    return null;
  }
};

/**
 * The version a package.json declares, when it can be read
 *
 * @param {string} dir the package directory
 * @returns {?string} the version
 */
const versionOf = (dir) => {
  try {
    return require(path.join(dir, 'package.json')).version || null;
  } catch {
    return null;
  }
};

/**
 * Every place the pages could be, best first
 *
 * @param {string} cwd the application directory
 * @returns {Array<object>} `[{ dir, package }]`
 */
const candidates = (cwd) => {
  const found = [];
  const add = (name, from) => {
    const dir = packageDir(name, from);

    if (dir) {
      found.push({ dir: path.join(dir, DIRECTORY), package: name });
    }
  };

  add('@usehenri/core', cwd);
  add('@usehenri/core', __dirname);
  add('@usehenri/mcp', cwd);
  found.push({
    dir: path.resolve(__dirname, '..', '..', '..', 'website/src/content/docs'),
    package: null,
  });

  return found;
};

/**
 * Where the pages are: the copy of the version this application runs, else
 * the one next to the command line, else the monorepo
 *
 * @param {string} [cwd=process.cwd()] the application directory
 * @returns {?object} `{ dir, package, version }`, or null when there is none
 */
const location = (cwd = process.cwd()) => {
  for (const found of candidates(cwd)) {
    if (fs.existsSync(found.dir)) {
      return {
        dir: found.dir,
        package: found.package,
        version: found.package ? versionOf(path.dirname(found.dir)) : null,
      };
    }
  }

  return null;
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
    const found = matched[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'mu'));

    return found ? found[1].trim().replace(/^['"]|['"]$/gu, '') : null;
  };

  return {
    body: source.slice(matched[0].length),
    description: read('description'),
    title: read('title'),
  };
};

/**
 * Every page of a directory, as slugs (`guides/routes`)
 *
 * @param {?string} dir the documentation directory
 * @returns {Array<string>} the slugs, sorted
 */
const slugs = (dir) => {
  if (!dir || !fs.existsSync(dir)) {
    return [];
  }

  const found = [];
  const walk = (current, prefix) => {
    for (const one of fs.readdirSync(current, { withFileTypes: true })) {
      if (one.name.startsWith('.')) {
        continue;
      }

      if (one.isDirectory()) {
        walk(path.join(current, one.name), `${prefix}${one.name}/`);
      } else if (/\.mdx?$/u.test(one.name)) {
        found.push(`${prefix}${one.name.replace(/\.mdx?$/u, '')}`);
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
 * @param {?string} dir the documentation directory
 * @returns {?string} the file, or null when there is none
 */
const fileOf = (slug, dir) => {
  if (!dir || typeof slug !== 'string' || !SLUG.test(slug)) {
    return null;
  }

  for (const extension of ['.md', '.mdx']) {
    const file = path.resolve(dir, `${slug}${extension}`);

    if (
      file.startsWith(`${path.resolve(dir)}${path.sep}`) &&
      fs.existsSync(file)
    ) {
      return file;
    }
  }

  return null;
};

/**
 * The index: every page with its title and what it covers
 *
 * @param {string} [cwd=process.cwd()] the application directory
 * @returns {?object} `{ source, count, pages }`, null without documentation
 */
const index = (cwd = process.cwd()) => {
  const source = location(cwd);

  if (!source) {
    return null;
  }

  const pages = slugs(source.dir).map((slug) => {
    const { description, title } = parse(
      fs.readFileSync(fileOf(slug, source.dir), 'utf8')
    );

    return { description, slug, title };
  });

  return { count: pages.length, pages, source };
};

/**
 * One page, as markdown
 *
 * @param {string} slug the slug (`guides/routes`)
 * @param {string} [cwd=process.cwd()] the application directory
 * @returns {?object} the page, or null when there is no such page
 */
const page = (slug, cwd = process.cwd()) => {
  const source = location(cwd);
  const file = source && fileOf(slug, source.dir);

  if (!file) {
    return null;
  }

  const { body, description, title } = parse(fs.readFileSync(file, 'utf8'));

  return {
    description,
    slug,
    source,
    text: body,
    title,
    url: `${SITE}/${slug === 'index' ? '' : `${slug}/`}`,
  };
};

/**
 * The pages whose slug looks like the one that was asked for
 *
 * @param {string} wanted what was asked for
 * @param {Array<string>} known every slug
 * @returns {Array<string>} the near misses, at most five
 */
const near = (wanted, known) => {
  const asked = String(wanted).toLowerCase();
  const tail = asked.split('/').pop();

  return known
    .filter((slug) => {
      const one = slug.toLowerCase();

      return one.includes(asked) || (tail.length > 2 && one.includes(tail));
    })
    .slice(0, 5);
};

/**
 * Print the documentation of the henri that is installed
 *
 * @param {object} [args] CLI arguments (`_[0]` a page, --json)
 * @returns {Promise<void>} Resolves when printed
 * @throws {CliError} HENRI_AGENT_NO_DOCS, HENRI_AGENT_UNKNOWN_PAGE
 */
const main = async (args = {}) => {
  const cwd = process.cwd();
  const wanted = (args._ || [])[0];
  const found = index(cwd);

  if (!found) {
    throw new CliError(
      'HENRI_AGENT_NO_DOCS',
      'no documentation is installed next to this application',
      {
        hint: 'The pages ship with @usehenri/core: upgrade it, or read them on https://usehenri.io',
      }
    );
  }

  if (!wanted) {
    return printIndex(found, args.json === true);
  }

  const one = page(String(wanted), cwd);

  if (!one) {
    const misses = near(
      wanted,
      found.pages.map((entry) => entry.slug)
    );

    throw new CliError(
      'HENRI_AGENT_UNKNOWN_PAGE',
      `there is no documentation page named "${wanted}"`,
      {
        hint: misses.length
          ? `Did you mean: ${misses.join(', ')}?`
          : 'Run `henri docs` to list the pages',
      }
    );
  }

  if (args.json === true) {
    console.log(JSON.stringify(one, null, 2));

    return;
  }

  console.log(`${one.title || one.slug} -- ${one.url}\n`);
  console.log(one.text.trim());
};

/**
 * Print the index, as text or as JSON
 *
 * @param {object} found what index() answered
 * @param {boolean} json print it as JSON
 * @returns {void}
 */
const printIndex = (found, json) => {
  if (json) {
    console.log(JSON.stringify(found, null, 2));

    return;
  }

  const from = found.source.package
    ? `${found.source.package}${found.source.version ? `@${found.source.version}` : ''}`
    : 'this repository';
  const width = found.pages.reduce(
    (longest, one) => Math.max(longest, one.slug.length),
    0
  );

  console.log(`\n  henri documentation (${from})\n`);

  let group = null;

  for (const one of found.pages) {
    const section = one.slug.includes('/') ? one.slug.split('/')[0] : '';

    if (section !== group) {
      group = section;
      console.log('');
    }

    const about = one.description || one.title || '';

    console.log(
      `  ${one.slug.padEnd(width)}  ${
        about.length > COLUMN ? `${about.slice(0, COLUMN - 3)}...` : about
      }`
    );
  }

  console.log(
    `\n  ${found.count} pages. Read one with \`henri docs <page>\`, or \`henri docs <page> --json\`.\n`
  );
};

module.exports = main;
module.exports.fileOf = fileOf;
module.exports.index = index;
module.exports.location = location;
module.exports.page = page;
module.exports.parse = parse;
module.exports.slugs = slugs;
