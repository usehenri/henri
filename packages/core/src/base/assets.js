/**
 * Where the compiled assets of an application are served from.
 *
 * ---------------------------------------------------------------------------
 * What this is, and what it is not
 * ---------------------------------------------------------------------------
 *
 * `config.assets.prefix` is what a bundler calls an asset prefix: Next's
 * `assetPrefix`, Vite's `base`. It goes in front of the urls the view engine
 * writes for the files its build produced -- the entry module, its chunks,
 * the stylesheets, the fonts and images their css names -- so a document
 * served by this application loads them from somewhere else.
 *
 * It is **not** `uploads.urls.cdn`, and the two are deliberately not the same
 * word. That one is a cache in front of henri's own `/_uploads` route: the
 * cache forwards the path and the query to this application, which verifies
 * a signature and streams a file a person uploaded. This one names a host
 * that serves files *the build wrote*, which this application never looks
 * at again. One forwards to henri, the other replaces it.
 *
 * Nothing about the origin changes: the built assets are still served by the
 * application at the same paths (`express.static` for Inertia, Next's own
 * handler for React), which is exactly what an origin-pull CDN needs to pull
 * from. What changes is the url in the document.
 *
 * ---------------------------------------------------------------------------
 * The Content Security Policy is the whole trap
 * ---------------------------------------------------------------------------
 *
 * `default-src 'self'` and `script-src 'self'` refuse a script from another
 * origin. An asset prefix that did not also reach the policy would produce
 * an application that boots, answers 200, and paints nothing -- every script
 * of the document refused, with the reason only in the browser console. So
 * the prefix is read in one place and used in two: the engine writes the
 * urls, and `base/headers.js` names the origin in the directives that carry
 * compiled assets (`script-src`, `style-src`, `font-src`, `img-src`,
 * `connect-src`, `worker-src`, `media-src`).
 *
 * `default-src` is left alone on purpose. Widening it would let the asset
 * host be framed and embedded as well, which is not what it is for, and the
 * one thing that falls back to it here is a `<link rel="prefetch">` -- a
 * refused prefetch costs a warm cache, never a page.
 *
 * The policy names the origin in every environment, not only where the
 * prefix is used. It costs nothing, and it means a production configuration
 * is never one directive away from a blank page.
 */

/**
 * The prefix an application configured, without its trailing slashes.
 *
 * Walked rather than matched: `/\/+$/` is quadratic on a run of slashes.
 * The value comes from the configuration rather than from a request, so it
 * is not a denial of service -- but a reader should not have to work out
 * which one it is (`@usehenri/uploads` says the same thing about the same
 * shape of value).
 *
 * @param {*} value what `config.assets.prefix` holds
 * @returns {string} the prefix, or '' when there is none
 */
function normalize(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const text = value.trim();
  let end = text.length;

  while (end > 0 && text[end - 1] === '/') {
    end -= 1;
  }

  return text.slice(0, end);
}

/**
 * The asset prefix of an application
 *
 * Reads henri's config module or a plain `config/<env>.json` object, so the
 * same call works from a booted application and from `henri build`, which
 * builds without booting.
 *
 * @param {?object} config henri's config module, or a plain object
 * @returns {string} the prefix, or '' when the application named none
 */
function assetPrefix(config) {
  if (!config) {
    return '';
  }

  const assets =
    typeof config.has === 'function' && typeof config.get === 'function'
      ? config.has('assets') && config.get('assets')
      : config.assets;

  return assets && typeof assets === 'object' ? normalize(assets.prefix) : '';
}

/**
 * The origin the Content Security Policy has to name, for a prefix.
 *
 * A prefix that is a path (`/assets`) is this application's own origin and
 * needs nothing: the policy already says `'self'`. Only an absolute url
 * moves the assets somewhere the policy does not know about yet.
 *
 * @param {string} prefix a normalized prefix
 * @returns {?string} the origin (`https://cdn.example.com`), or null
 */
function assetOrigin(prefix) {
  if (!prefix || prefix.startsWith('/')) {
    return null;
  }

  try {
    return new URL(prefix).origin;
  } catch (error) {
    // The schema refuses anything that is not a path or an absolute http
    // url, so this is a value that never went through a boot
    return null;
  }
}

module.exports = { assetOrigin, assetPrefix, normalize };
