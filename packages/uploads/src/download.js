/**
 * The route that verifies henri's own signed urls and streams the file.
 *
 * It exists only for a storage that cannot sign its own -- the local disk --
 * and only when `uploads.urls` says so. An object store signs a url the
 * client fetches from the store itself, and nothing here ever runs for it.
 *
 * **Why it is a middleware and not a route of `config/routes.js`.** The same
 * reason the parser is: the uploads module is at runlevel 3 and the router
 * is at 5, so there is no route table yet to add to. That is not a
 * workaround, it is the right place -- this url carries its own
 * authorization in its signature, so it wants no session, no CSRF token and
 * no policy. The rate limit and helmet are mounted at runlevel 2, before
 * this, so a signed url is rate limited and gets the same headers as
 * everything else.
 *
 * **Why it fails through `next(error)`.** `res.boom` does not exist yet at
 * this point in the chain either; core's error handler negotiates an
 * `UploadError` into the JSON body a client expects or the page a browser
 * does, and the code (`HENRI_UPLOAD_URL_INVALID`, `HENRI_UPLOAD_URL_EXPIRED`)
 * reaches both. The parser refuses the same way, for the same reason.
 */
const debug = require('debug')('henri:uploads');

const { UploadError } = require('./errors');

/** The methods a signed url answers: reading, and asking about reading */
const METHODS = new Set(['GET', 'HEAD']);

/**
 * The storage key a request names, or null when the path is not one of ours
 *
 * @param {string} pathname the path of the request
 * @param {string} prefix where the route is mounted
 * @returns {?string} the key
 */
function keyIn(pathname, prefix) {
  if (!pathname.startsWith(`${prefix}/`)) {
    return null;
  }

  try {
    return decodeURIComponent(pathname.slice(prefix.length + 1));
  } catch (error) {
    debug('undecodable path %s: %s', pathname, error.message);

    return null;
  }
}

/**
 * The middleware the module mounts next to the parser.
 *
 * Like the parser, it reads the settings and the signer off the module on
 * every request rather than closing over them: a reload changes what it
 * does, never whether it is there.
 *
 * @param {object} module the uploads module (`henri.uploads`)
 * @returns {function} express middleware
 */
function downloads(module) {
  return function uploadDownload(req, res, next) {
    const { settings, signer, storage } = module;

    if (!module.enabled || !signer || !settings.urls || !storage) {
      return next();
    }

    if (!METHODS.has(req.method)) {
      return next();
    }

    const [pathname, search] = String(req.originalUrl || req.url).split('?');
    const key = keyIn(pathname, settings.urls.path);

    if (key === null) {
      return next();
    }

    const verdict = signer.verify(key, new URLSearchParams(search || ''));

    if (!verdict.ok) {
      return next(
        verdict.reason === 'expired'
          ? new UploadError(
              'URL_EXPIRED',
              'this link has expired; ask the application for another one',
              {
                expires: Number(
                  new URLSearchParams(search || '').get('expires')
                ),
              }
            )
          : new UploadError('URL_INVALID', 'this link is not valid')
      );
    }

    // Everything below is about a link henri really signed. An object that
    // is no longer there answers what an invalid link answers, rather than
    // a 404: the two are indistinguishable to a holder of the link, and a
    // link that is refused says nothing about what the storage holds
    return storage
      .stat(key)
      .then((found) => {
        if (!found) {
          return next(
            new UploadError('URL_INVALID', 'this file is no longer there')
          );
        }

        return module.send(
          res,
          {
            key,
            name: verdict.claims.filename || 'file',
            size: found.size,
            type: verdict.claims.type,
          },
          { disposition: verdict.claims.disposition }
        );
      })
      .catch(next);
  };
}

module.exports = { METHODS, downloads, keyIn };
