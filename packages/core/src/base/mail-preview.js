const escapeHtml = require('escape-html');

const { negotiate } = require('./http');

/**
 * Escape a value for html
 *
 * @param {any} value the value
 * @returns {string} the escaped string
 */
const escape = (value) => escapeHtml(String(value === null ? '' : value));

/**
 * The headers of a rendered message, in display order
 *
 * @param {object} message the rendered message
 * @returns {Array<Array<string>>} pairs of [name, value]
 */
const headers = (message) =>
  ['from', 'to', 'cc', 'bcc', 'replyTo', 'subject']
    .filter((key) => typeof message[key] !== 'undefined' && message[key] !== '')
    .map((key) => [key, [].concat(message[key]).join(', ')]);

/**
 * The chrome around a preview: the same on the index and on a message
 *
 * @param {string} title the page title
 * @param {string} body the body html
 * @returns {string} the page
 */
const shell = (title, body) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escape(title)}</title>
<style>
  body{font-family:system-ui,sans-serif;margin:0;color:#222;background:#f6f6f6}
  header{background:#fff;border-bottom:1px solid #ddd;padding:1em 1.5em}
  h1{font-size:1.1rem;margin:0 0 .25em}
  main{padding:1.5em}
  a{color:#0b62d0}
  ul{list-style:none;margin:0;padding:0}
  li{margin:.35em 0}
  dl{display:grid;grid-template-columns:auto 1fr;gap:.15em .75em;margin:.75em 0 0;font-size:.85rem}
  dt{color:#666;text-transform:lowercase}
  dd{margin:0}
  nav a{margin-right:1em;font-size:.85rem}
  iframe{width:100%;height:70vh;border:1px solid #ddd;background:#fff}
  pre{white-space:pre-wrap;background:#fff;border:1px solid #ddd;padding:1em;overflow:auto}
</style>
</head>
<body>${body}</body>
</html>
`;

/**
 * The index page: every mailer, every action
 *
 * @param {object} tree the mailers ({ name: [actions] })
 * @param {string} base the mount path (ex: /_mailers)
 * @returns {string} the page
 */
function index(tree, base) {
  const names = Object.keys(tree).sort();
  const body = names.length
    ? names
        .map(
          (name) =>
            `<h2>${escape(name)}</h2><ul>${tree[name]
              .map(
                (action) =>
                  `<li><a href="${escape(`${base}/${name}/${action}`)}">${escape(
                    `${name}#${action}`
                  )}</a></li>`
              )
              .join('')}</ul>`
        )
        .join('')
    : `<p>No mailer found in <code>app/mailers</code>. Write one with
       <code>henri generate mailer welcome confirm</code>.</p>`;

  return shell(
    'Mailer previews',
    `<header><h1>Mailer previews</h1></header><main>${body}</main>`
  );
}

/**
 * The page of one message: its headers, and the rich part in an iframe
 *
 * @param {object} options { mailer, action, message, base }
 * @returns {string} the page
 */
function message({ mailer, action, message: rendered, base }) {
  const where = `${base}/${mailer}/${action}`;
  const rows = headers(rendered)
    .map(([key, value]) => `<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`)
    .join('');

  return shell(
    `${mailer}#${action}`,
    `<header>
      <h1>${escape(`${mailer}#${action}`)}</h1>
      <nav>
        <a href="${escape(base)}">all mailers</a>
        <a href="${escape(`${where}?part=text`)}">plain text</a>
        <a href="${escape(`${where}?part=json`)}">json</a>
      </nav>
      <dl>${rows}</dl>
    </header>
    <main><iframe title="preview" sandbox src="${escape(
      `${where}?part=html`
    )}"></iframe></main>`
  );
}

/**
 * The page shown when a preview cannot be rendered
 *
 * @param {string} title what failed
 * @param {Error} error the error
 * @param {string} base the mount path
 * @returns {string} the page
 */
const failure = (title, error, base) =>
  shell(
    title,
    `<header><h1>${escape(title)}</h1>
     <nav><a href="${escape(base)}">all mailers</a></nav></header>
     <main><pre>${escape(error.stack || error.message)}</pre></main>`
  );

/**
 * The development-only preview router, mounted at `/_mailers` behind the
 * loopback guard (see 5.router.js). It renders mailers with the sample data
 * declared next to them and never delivers anything.
 *
 *   GET /_mailers                        the mailers and their actions
 *   GET /_mailers/<mailer>/<action>      the message (headers + iframe)
 *   GET /_mailers/<mailer>/<action>?part=html|text|json
 *
 * @param {Henri} henri the henri instance
 * @param {string} [base='/_mailers'] the mount path, for the links
 * @returns {Express.Router} the router
 */
function previews(henri, base = '/_mailers') {
  const router = henri.server.express.Router();

  router.get('/', (req, res) =>
    res.type('html').send(index(henri.mailers.tree(), base))
  );

  router.get('/{*splat}', async (req, res, next) => {
    const parts = String(req.path)
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
    const action = parts.pop();
    const mailer = parts.join('/');

    if (!action || !mailer) {
      return next();
    }

    if (!henri.mailers.has(mailer, action)) {
      return negotiate(
        res,
        404,
        `No preview for ${mailer}#${action}: no such mailer action in app/mailers`
      );
    }

    let rendered;

    try {
      rendered = await henri.mailers.preview(mailer, action);
    } catch (error) {
      henri.pen.error('mailers', `preview ${mailer}#${action}`, error.message);
      res.status(500);

      return res
        .type('html')
        .send(failure(`${mailer}#${action} failed to render`, error, base));
    }

    switch (req.query.part) {
      case 'json':
        return res.json(rendered);
      case 'text':
        return res.type('txt').send(rendered.text || '');
      case 'html':
        return res.type('html').send(rendered.html || '');
      default:
        return res
          .type('html')
          .send(message({ action, base, mailer, message: rendered }));
    }
  });

  return router;
}

module.exports = previews;
module.exports.headers = headers;
