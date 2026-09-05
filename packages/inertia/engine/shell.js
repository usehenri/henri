/**
 * HTML helpers of the Inertia engine: the page object embedded in the
 * document, the asset tags (dev server or production manifest) and the
 * injection into the `app/views/index.html` shell.
 */
const crypto = require('crypto');

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
function devTags(entry) {
  return `<script type="module" src="/${entry}"></script>`;
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
    throw new Error(
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
  devTags,
  escapeHtml,
  hash,
  inject,
  pageJson,
  pageScript,
};
