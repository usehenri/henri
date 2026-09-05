/**
 * Pagination (`?page=2&per_page=50`) and the links around a page.
 *
 * ```js
 * const { page, perPage, skip, limit } = req.pagination();
 * const tasks = await Task.find().skip(skip).limit(limit);
 *
 * res.collection(tasks, { page, perPage, total: await Task.countDocuments() });
 * ```
 */
const DEFAULTS = Object.freeze({ maxPerPage: 100, perPage: 25 });

/**
 * A positive integer from a query value
 *
 * @param {*} value the value
 * @param {number} fallback used when the value is not a positive integer
 * @returns {number} the integer
 */
function toInt(value, fallback) {
  const number = parseInt(Array.isArray(value) ? value[0] : value, 10);

  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/**
 * The page asked by a request, bounded
 *
 * @param {Express.Request} req the request
 * @param {object} [options={}] options
 * @param {number} [options.perPage=25] default page size
 * @param {number} [options.maxPerPage=100] largest page size a client may ask
 * @returns {{page: number, perPage: number, offset: number, limit: number, skip: number}} the page
 */
function paginate(
  req,
  { perPage = DEFAULTS.perPage, maxPerPage = DEFAULTS.maxPerPage } = {}
) {
  const query = (req && req.query) || {};
  const page = toInt(query.page, 1);
  const requested = toInt(
    typeof query.per_page === 'undefined' ? query.perPage : query.per_page,
    perPage
  );
  const size = Math.min(Math.max(1, requested), Math.max(1, maxPerPage));
  const offset = (page - 1) * size;

  return { limit: size, offset, page, perPage: size, skip: offset };
}

/**
 * Express middleware adding `req.pagination([overrides])`
 *
 * @param {function(): object} settings returns `{ perPage, maxPerPage }`
 * @returns {function} middleware
 */
function paginationMiddleware(settings) {
  return (req, res, next) => {
    req.pagination = (overrides = {}) => {
      const result = paginate(req, Object.assign({}, settings(), overrides));

      req._pagination = result;

      return result;
    };

    next();
  };
}

/**
 * The same url with other `page` / `per_page` parameters
 *
 * @param {string} url the current url (path and query)
 * @param {number} page the page
 * @param {number} perPage the page size
 * @returns {string} the url
 */
function pageUrl(url, page, perPage) {
  const parsed = new URL(String(url || '/'), 'http://henri.invalid');

  parsed.searchParams.set('page', String(page));
  parsed.searchParams.set('per_page', String(perPage));
  parsed.searchParams.delete('perPage');

  return `${parsed.pathname}${parsed.search}`;
}

/**
 * The links around a page: `self` (the url as requested), `first`, `prev`,
 * `next`, `last`
 *
 * Without a `total`, `next` is offered while a page is full and `last` is
 * unknown.
 *
 * @param {string} url the current url
 * @param {object} options options
 * @param {number} options.page current page
 * @param {number} options.perPage page size
 * @param {number} [options.count] items in the current page
 * @param {?number} [options.total=null] total number of items, when known
 * @returns {object} links (`{ rel: href }`)
 */
function pageLinks(url, { page, perPage, count = 0, total = null }) {
  const links = { self: String(url || '/') };
  const known = total !== null && Number.isFinite(total);
  const pages = known ? Math.max(1, Math.ceil(total / perPage)) : null;

  links.first = pageUrl(url, 1, perPage);

  if (page > 1) {
    links.prev = pageUrl(
      url,
      known ? Math.min(page - 1, pages) : page - 1,
      perPage
    );
  }

  if (known ? page < pages : count >= perPage) {
    links.next = pageUrl(url, page + 1, perPage);
  }

  if (known) {
    links.last = pageUrl(url, pages, perPage);
  }

  return links;
}

/**
 * The `Link` header (RFC 8288) for the links around a page
 *
 * @param {object} links `{ rel: href }` (self is left out)
 * @returns {string} the header value (empty when there is nothing to say)
 */
function linkHeader(links) {
  return Object.keys(links)
    .filter((rel) => rel !== 'self')
    .map((rel) => `<${links[rel]}>; rel="${rel}"`)
    .join(', ');
}

module.exports = {
  DEFAULTS,
  linkHeader,
  pageLinks,
  pageUrl,
  paginate,
  paginationMiddleware,
};
