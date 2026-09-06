/**
 * The plain text part of an email, derived from its html part.
 *
 * A mailer view may ship an authored text part (`<view>.text.hbs`), and that
 * one always wins. When it does not, the text part is derived from the html
 * one rather than left out: every message stays multipart (which is what
 * spam filters and text-only clients expect) without asking the developer to
 * write, and keep in sync, the same copy twice.
 *
 * The conversion is deliberately small and predictable: block elements become
 * blank lines, list items get a dash, links keep their target, and everything
 * else is dropped.
 */

/** Elements whose content never belongs in the text part */
const DROPPED = ['script', 'style', 'head', 'title'];

/** Elements that end a block: they become a blank line */
const BLOCKS = [
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'table',
  'tr',
  'ul',
  'ol',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
];

/** The named html entities that show up in mail */
const ENTITIES = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  laquo: '«',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
  raquo: '»',
  rdquo: '”',
  rsquo: '’',
};

/**
 * Decode the html entities of a string
 *
 * @param {string} value the string
 * @returns {string} the decoded string
 */
function decode(value) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);

      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }

    const named = ENTITIES[entity.toLowerCase()];

    return typeof named === 'string' ? named : match;
  });
}

/**
 * Removes every occurrence of a pattern, and keeps removing until the string
 * stops changing.
 *
 * One pass is not enough: `<scr<script>ipt>` becomes `<script` once the inner
 * tag is taken out, so a single replace leaves a fragment in the text part.
 * Every pass strictly shortens the string, so this terminates.
 *
 * @param {string} value the string to clean
 * @param {RegExp} pattern what to remove, with the global flag
 * @returns {string} the string, with nothing left to remove
 */
function removeAll(value, pattern) {
  let text = value;
  let previous = null;

  while (previous !== text) {
    previous = text;
    text = text.replace(pattern, '');
  }

  return text;
}

/**
 * The text of an anchor, with its target when it adds something
 * `<a href="https://x">Open</a>` becomes `Open (https://x)`, and an anchor
 * whose text already is the url is left alone.
 *
 * @param {string} href the href attribute
 * @param {string} inner the inner html of the anchor
 * @returns {string} the replacement
 */
function anchor(href, inner) {
  const target = decode(String(href || '')).trim();
  const label = decode(removeAll(inner, /<[^>]*>/g)).trim();

  if (!target || target.startsWith('#') || target === label) {
    return inner;
  }

  if (!label) {
    return target;
  }

  return `${inner} (${target})`;
}

/**
 * Derive the plain text part of an html document
 *
 * @param {string} html the html part
 * @returns {string} the text part
 */
function htmlToText(html) {
  let text = String(html || '');

  for (const tag of DROPPED) {
    text = text.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'),
      ''
    );
  }

  text = removeAll(text, /<!--[\s\S]*?-->/g);
  // Anchors keep their target before the tags go away
  text = text.replace(
    /<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi,
    (match, raw, double, single, bare, inner) =>
      anchor(
        typeof double === 'string'
          ? double
          : (typeof single === 'string' && single) || bare,
        inner
      )
  );

  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');
  // The dash comes with the opening tag so that a list written without
  // closing tags (which html allows) still reads as a list
  text = text.replace(/<li\b[^>]*>/gi, '\n- ');
  text = text.replace(/<\/li\s*>/gi, '');
  text = text.replace(/<\/(?:td|th)\s*>/gi, '\n');

  for (const tag of BLOCKS) {
    text = text.replace(new RegExp(`</${tag}\\s*>`, 'gi'), '\n\n');
  }

  text = removeAll(text, /<[^>]*>/g);
  // A malformed document can leave an unterminated opener behind, and
  // `<scr` is not a tag any pattern above will match. Drop the bracket so
  // nothing element shaped survives into the text part.
  text = text.replace(/<(?=[/!?a-z])/gi, '');
  text = decode(text);

  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { decode, htmlToText };
