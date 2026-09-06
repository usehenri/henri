/**
 * HTML helpers of the Inertia engine: the page object embedded in the
 * document, the asset tags (dev server or production manifest) and the
 * injection into the `app/views/index.html` shell.
 */
const crypto = require('crypto');

/**
 * An Error carrying one of henri's error codes
 *
 * A code is a string and nothing more (`@usehenri/core/error-codes.json` is
 * the catalogue), so a failure names itself without importing anything.
 *
 * @param {string} code The henri error code (HENRI_JOB_UNKNOWN, ...)
 * @param {string} message What went wrong
 * @returns {Error} The error to throw
 */
const coded = (code, message) => Object.assign(new Error(message), { code });

/**
 * Short content hash (used as the Inertia asset version)
 *
 * @param {(string|Buffer)} content the content
 * @returns {string} an md5 hex digest
 */
function hash(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Escape a string for an HTML text node or attribute
 *
 * @param {string} str the string
 * @returns {string} the escaped string
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Serialize the page object so it is safe inside a <script> element
 *
 * @param {object} page the Inertia page object
 * @returns {string} JSON
 */
function pageJson(page) {
  return JSON.stringify(page)
    .replace(/\//g, '\\/')
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * The <script data-page> element the Inertia client boots from
 *
 * @param {string} id the root element id
 * @param {object} page the Inertia page object
 * @returns {string} html
 */
function pageScript(id, page) {
  return `<script data-page="${escapeHtml(id)}" type="application/json">${pageJson(
    page
  )}</script>`;
}

/**
 * Body markup when the page is not rendered on the server: the page object
 * and an empty root the client mounts into.
 *
 * @param {string} id the root element id
 * @param {object} page the Inertia page object
 * @returns {string} html
 */
function clientBody(id, page) {
  return `${pageScript(id, page)}<div id="${escapeHtml(id)}"></div>`;
}

/**
 * Script tag loading the client entry through the Vite dev server
 *
 * @param {string} entry the entry file (relative to app/views)
 * @returns {string} html
 */
function devTags(entry, stylesheets = []) {
  // Vite serves a stylesheet as a javascript module that injects it once the
  // entry has run, so a server rendered document would paint unstyled first.
  // `?direct` asks the dev server for the compiled css itself, which the
  // browser can load from a <link> before it paints. The module still runs
  // and still owns hot updates; the rules it injects are the same ones.
  const links = stylesheets.map(
    (href) => `<link rel="stylesheet" href="${escapeHtml(href)}?direct">`
  );

  return links
    .concat(`<script type="module" src="/${entry}"></script>`)
    .join('\n    ');
}

/**
 * Tags loading the built client entry: its stylesheets, the entry module and
 * a modulepreload for the chunks it imports statically.
 *
 * @param {object} manifest the Vite manifest (dist/client/.vite/manifest.json)
 * @param {string} entry the entry file (relative to app/views)
 * @param {string} [base='/'] public base path
 * @returns {string} html
 * @throws when the entry is not part of the manifest
 */
function assetTags(manifest, entry, base = '/') {
  const chunk = manifest && manifest[entry];

  if (!chunk) {
    throw coded(
      'HENRI_VIEW_BUILD_FAILED',
      `inertia: '${entry}' is not in the vite manifest, run the build again`
    );
  }

  const seen = new Set();
  const css = new Set();

  /**
   * Collect the stylesheets and static imports of a chunk
   *
   * @param {string} key manifest key
   * @returns {void}
   */
  const walk = (key) => {
    if (seen.has(key) || !manifest[key]) {
      return;
    }
    seen.add(key);
    (manifest[key].css || []).forEach((file) => css.add(file));
    (manifest[key].imports || []).forEach(walk);
  };

  walk(entry);

  const tags = [...css].map(
    (file) => `<link rel="stylesheet" href="${base}${file}">`
  );

  tags.push(`<script type="module" src="${base}${chunk.file}"></script>`);

  seen.forEach((key) => {
    if (key !== entry) {
      tags.push(
        `<link rel="modulepreload" href="${base}${manifest[key].file}">`
      );
    }
  });

  return tags.join('\n');
}

/**
 * Elements a Content Security Policy nonce belongs on: a script of any type,
 * a style element, and the link relations that fetch something the policy
 * covers. `rel="icon"`, `rel="manifest"` and the rest are left alone.
 */
const NONCE_TAGS = /<(script|style|link)(\s[^>]*)?>/gi;
const NONCE_RELS = /\brel\s*=\s*["']?\s*(stylesheet|modulepreload|preload)\b/i;
const HAS_NONCE = /\snonce\s*=/i;

/**
 * The `<meta property="csp-nonce">` Vite's own runtime reads
 *
 * Vite has one nonce seam and this is it: `html.cspNonce` in the Vite config
 * is a *build time* placeholder ("make sure that this placeholder will be
 * replaced with a unique value for each request by the server", says its
 * type), which it writes onto the tags it emits and into this meta tag. Its
 * client reads the meta at runtime -- `document.querySelector('meta[property=csp-nonce]')`
 * -- for the `<style>` elements it injects in development and for the
 * `<link>` elements `__vitePreload` appends to load a lazy chunk or its css
 * in production. Neither of those exists when the document is written, so
 * neither can be nonced by rewriting html: the meta tag is the only way they
 * ever get one.
 *
 * henri does not set `html.cspNonce`, because an application owns its
 * `vite.config.mjs` and half of them would not have it. The tags Vite writes
 * are nonced by `withNonce` below instead, and this meta carries the same
 * value to the runtime.
 *
 * @param {string} nonce the nonce of this response
 * @returns {string} html
 */
function nonceMeta(nonce) {
  return `<meta property="csp-nonce" nonce="${escapeHtml(nonce)}">`;
}

/**
 * Write a nonce on every script, style and stylesheet link of a document
 *
 * This runs over the whole document rather than over the tags this engine
 * builds, because most of them are not this engine's: the application's
 * `index.html` shell has its own, `vite.transformIndexHtml` injects the dev
 * client and `@vitejs/plugin-react`'s inline React Refresh preamble, and the
 * server bundle returns whatever the page put in `head`. Dropping
 * `'unsafe-inline'` from `script-src` means all of them need the nonce, so
 * all of them get it.
 *
 * The scan is a regex over start tags, and that is a deliberate limit: a `>`
 * inside an attribute value would end a tag early. What goes through here is
 * the shell of an application, Vite's output and React's, none of which write
 * one; a full parse (parse5, as Vite itself does) would cost a parse and a
 * serialization on every render for a case that does not arise.
 *
 * @param {string} html the document
 * @param {?string} nonce the nonce, or null to leave the document alone
 * @returns {string} the document
 */
function withNonce(html, nonce) {
  if (!nonce) {
    return html;
  }

  const value = ` nonce="${escapeHtml(nonce)}"`;

  return html.replace(NONCE_TAGS, (tag, name, attributes = '') => {
    if (HAS_NONCE.test(attributes)) {
      return tag;
    }

    if (name.toLowerCase() === 'link' && !NONCE_RELS.test(attributes)) {
      return tag;
    }

    const closing = tag.endsWith('/>') ? ' />' : '>';
    const start = tag
      .slice(0, tag.length - (tag.endsWith('/>') ? 2 : 1))
      .replace(/\s+$/, '');

    return `${start}${value}${closing}`;
  });
}

/**
 * Inject the rendered head and body into the html shell. The shell should
 * contain `<!--head-->` and `<!--body-->` placeholders; without them the
 * content goes before `</head>` and `</body>`.
 *
 * @param {string} template the html shell
 * @param {object} parts the parts
 * @param {string} [parts.head=''] html for the head
 * @param {string} [parts.body=''] html for the body
 * @returns {string} the document
 */
function inject(template, { head = '', body = '' } = {}) {
  let html = template;

  html = /<!--\s*head\s*-->/.test(html)
    ? html.replace(/<!--\s*head\s*-->/, () => head)
    : html.replace(/<\/head>/i, () => `${head}\n</head>`);

  html = /<!--\s*body\s*-->/.test(html)
    ? html.replace(/<!--\s*body\s*-->/, () => body)
    : html.replace(/<\/body>/i, () => `${body}\n</body>`);

  return html;
}

module.exports = {
  assetTags,
  clientBody,
  coded,
  devTags,
  escapeHtml,
  hash,
  inject,
  nonceMeta,
  pageJson,
  pageScript,
  withNonce,
};
