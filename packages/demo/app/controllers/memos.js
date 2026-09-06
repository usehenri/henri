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
    return res.boom.notFound(`Memo ${req.params.id} not found`);
  }

  return undefined;
};

module.exports = {
  before: { 'peek,show,update,destroy': loadMemo },

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
