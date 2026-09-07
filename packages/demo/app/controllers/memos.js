// Nothing in here decides who may do what: app/policies/memo.js does, and
// `policy: true` in the routes is what asks it.
const FIELDS = ['body', 'title'];

/**
 * The id of the signed-in user, as the model stores it
 *
 * @param {Express.Request} req the request
 * @returns {?string} the id, or null
 */
const owner = (req) =>
  (req.user && String(req.user.id || req.user._id)) || null;

/**
 * Loads the memo of a member route (henri's before_action)
 *
 * @param {Express.Request} req the request
 * @param {Express.Response} res the response
 * @returns {Promise<*>} nothing, or the 404
 */
const loadMemo = async (req, res) => {
  req.memo = await Memo.findById(req.params.id);

  if (!req.memo) {
    // The same 404 a policy refusal answers, on purpose: see
    // packages/core/src/base/http.js (`spoken`)
    return res.notFound(`Memo ${req.params.id} not found`);
  }

  return undefined;
};

module.exports = {
  before: { 'peek,show,update,destroy': loadMemo },

  // What a client may ask to see next to a memo, and nothing else: `owner`
  // goes through `ownerId`, which the model declared as a reference to the
  // user (`ref: 'User'`), so henri can load it and publish it. An
  // `?embed=` naming anything else is a 422 before the action runs (see
  // base/embeds.js)
  embeds: { 'index,search,show': { owner: 'ownerId' } },

  // What a client may narrow and order this list by, and nothing else: an
  // undeclared name is a 422 before the action runs, and `contains` is
  // named because a substring search over a text column is a scan (see
  // base/filters.js). `body` is personal and stays out of both lists.
  filters: {
    search: {
      default: '-createdAt',
      sort: ['archivedAt', 'createdAt', 'title'],
      where: {
        archivedAt: { type: 'date' },
        title: { operators: ['contains', 'starts'], type: 'string' },
      },
    },
  },

  // eslint-disable-next-line sort-keys -- the hooks and the declaration first
  create: async (req, res) => {
    const memo = await Memo.create(
      Object.assign(req.permit(...FIELDS), { ownerId: owner(req) })
    );

    return res.resource(memo, { status: 201 });
  },

  destroy: async (req, res) => {
    await req.authorize('destroy', req.memo);
    await req.memo.deleteOne();

    return res.status(204).end();
  },

  // The list is what the policy says it is (`scope`), not what the table has
  index: async (req, res) =>
    res.collection(await Memo.find(await req.scope('memo'))),

  // Deliberately asks nothing: the route declared a policy henri could not
  // answer without the record, and this action never authorizes. That is
  // what config.policies.verify reports.
  peek: async (req, res) => res.json({ title: req.memo.title }),

  // The whole list as a file, streamed. `where` is left out on purpose:
  // `res.csv()` asks app/policies/memo.js for the scope the way
  // `req.filters()` does, so an export is what the policy says the list is
  // (see base/csv.js)
  report: async (req, res) => res.csv(Memo, { filename: 'memos' }),

  // The filtered half of the list. The scope is what the policy says the
  // list is, plus what this action is about -- a memo the author has not
  // put away -- and a client filter is intersected with it, never merged
  // into it: `?filter[archivedAt][gte]=...` answers nothing here rather
  // than reaching the archive
  search: async (req, res) => {
    const { order, where } = await req.filters({
      scope: { ...(await req.scope('memo')), archivedAt: null },
    });
    const { page, perPage, records, total } = await Memo.paginate({
      ...req.pagination(),
      order,
      where,
    });

    return res.collection(records, { page, perPage, total });
  },

  // Asks nothing either, but answers through res.resource(): the policy is
  // enforced there, because that is where the record finally is
  show: async (req, res) => res.resource(req.memo),

  update: async (req, res) => {
    await req.authorize('update', req.memo);
    req.memo.set(req.permit(...FIELDS));
    await req.memo.save();

    return res.resource(req.memo);
  },
};
