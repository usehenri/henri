// Proposals: the resource this application is about.
//
// One controller serves a browser and an API client. `res.negotiate()` picks
// the page or the HAL answer, `before` loads the record once, `req.permit()`
// decides what a request may set, and the two state transitions a speaker may
// trigger are member routes rather than a hand-written `state` field on the
// update form.
//
// Who may do any of it is not decided here: app/policies/proposal.js holds
// the rules and `req.can()` asks them. `policy: true` in config/routes.js
// answers the questions that need no record before the action runs, and the
// hooks below answer the rest, once the proposal is loaded.
const {
  FIELDS,
  INCLUDE,
  PUBLIC_STATES,
  presented,
  resolveReferences,
} = require('../helpers/proposals');

/**
 * Denies an anonymous request: a browser goes to the login page, an API
 * client gets a 401
 *
 * @param {object} req Express request
 * @param {object} res Express response
 * @returns {object|undefined} The answer, or nothing when signed in
 */
const requireSpeaker = (req, res) => {
  if (req.user) {
    return undefined;
  }

  return res.negotiate({
    html: () => res.redirect('/login'),
    json: () => res.boom.unauthorized('Authentication required'),
  });
};

/**
 * Loads the proposal of `:id` with its associations, or answers a 404. A
 * proposal the current user may not read is a 404 too, not a 403: knowing it
 * exists is already something.
 *
 * @param {object} req Express request
 * @param {object} res Express response
 * @returns {Promise<object|undefined>} The 404 answer, or nothing
 */
const loadProposal = async (req, res) => {
  const proposal = await Proposal.findById(req.params.id, {
    include: INCLUDE,
  });

  if (!proposal || !(await req.can('show', proposal))) {
    return res.boom.notFound(`No proposal ${req.params.id}`);
  }

  req.proposal = proposal;

  return undefined;
};

/**
 * Refuses to let a speaker touch someone else's proposal.
 *
 * It asks the policy about the action of this very route, so `edit`,
 * `update`, `submit` and `withdraw` each answer for themselves; the proposal
 * is readable by then, so the refusal is a 403 rather than the 404 above.
 *
 * @param {object} req Express request
 * @param {object} res Express response
 * @returns {Promise<object|undefined>} The answer, or nothing when it is theirs
 */
const mustOwnIt = async (req, res) => {
  if (await req.can(res.locals.route.action, req.proposal)) {
    return undefined;
  }

  req.flash('alert', 'That proposal belongs to another speaker.');

  return res.negotiate({
    html: () => res.redirect('/proposals/mine'),
    json: () => res.boom.forbidden('This proposal belongs to another speaker'),
  });
};

/**
 * The editions taking submissions and their tracks, for the proposal form
 *
 * @returns {Promise<object>} `{ events, tracks }`
 */
const formOptions = async () => {
  const events = await Event.where({ state: 'open' }).order('-year');
  const tracks = await Track.where({
    eventId: events.map((event) => event.id),
  }).order('name');
  // The form posts the public id of a record, never its primary key: the
  // controller resolves them back on the way in (see resolveReferences)
  const editions = new Map(events.map((event) => [event.id, event.externalId]));

  return {
    events: events.map((event) => ({
      externalId: event.externalId,
      name: event.name,
      year: event.year,
    })),
    tracks: tracks.map((track) => ({
      eventId: editions.get(track.eventId) || null,
      externalId: track.externalId,
      name: track.name,
    })),
  };
};

module.exports = {
  // The array form of `before` takes the Rails selectors. Hooks run in
  // declaration order and a hook that answers ends the request, so an
  // anonymous POST never reaches the query below it.
  before: [
    { except: ['index', 'show'], run: requireSpeaker },
    {
      only: ['edit', 'show', 'submit', 'update', 'withdraw'],
      run: loadProposal,
    },
    { only: ['edit', 'submit', 'update', 'withdraw'], run: mustOwnIt },
  ],

  // What each action accepts, checked before it runs and coerced into the
  // declared type. The check is registered whatever the verb, so the filters
  // of `index` are refused with a 422 exactly the way the body of `create`
  // is, and `henri openapi` describes both from this block: the query
  // parameters of GET /proposals and the request body of POST /proposals are
  // this, and not a guess made from the model.
  //
  // Where the line between this and the model is: here is what may arrive
  // over HTTP -- the shape, the size, the values that exist at all -- and
  // there is what makes a proposal (a title of at least eight characters, an
  // abstract of sixty). The second is a sentence a speaker reads next to the
  // field they are filling, which is `henri.model.errors()` rendered back
  // into the form below; the first is a request nobody meant to send.
  params: {
    'create,update': {
      abstract: { maxLength: 4000, type: 'text' },
      // The public id of an edition or a track, or the empty string the form
      // posts for "none": `resolveReferences` turns either into what the
      // column holds, so this says string and not uuid
      eventId: { type: 'string' },
      title: { maxLength: 120, type: 'string' },
      trackId: { type: 'string' },
    },
    index: {
      // The public id of an edition. It is a *reference*, which henri
      // refuses as a declared filter because matching it is a lookup henri
      // would have to make per term -- so it stays a parameter and the
      // action resolves it into the scope below
      event: { type: 'uuid' },
    },
  },

  // ... and what a client may narrow and order this list by. Nothing
  // undeclared is filterable: `?filter[speakerId]=1` and `?sort=abstract`
  // are 422s before the action runs, and this block is what `henri openapi`
  // describes the `filter[...]` parameters of GET /proposals from.
  //
  // `title` names `contains` because a substring search over a text column
  // is a scan, and this application has thought about it; every other field
  // gets the equality every type gets and nothing more. `abstract` is a
  // `text` column and is in neither list: an unbounded order over one is a
  // filesort over the whole table, which henri refuses at boot.
  // eslint-disable-next-line sort-keys -- the request declarations first
  filters: {
    index: {
      default: '-submittedAt',
      sort: ['submittedAt', 'title'],
      where: {
        format: { enum: ['talk', 'workshop', 'lightning'], type: 'string' },
        level: {
          enum: ['beginner', 'intermediate', 'advanced'],
          type: 'string',
        },
        state: { enum: PUBLIC_STATES, type: 'string' },
        title: { operators: ['contains'], type: 'string' },
      },
    },
  },

  // eslint-disable-next-line sort-keys -- the hooks and the declaration first
  create: async (req, res) => {
    const attributes = req.permit(...FIELDS);
    let proposal;

    try {
      proposal = await Proposal.create({
        ...(await resolveReferences(attributes)),
        // Never from the request: the speaker is whoever is signed in, and a
        // new proposal always starts as a draft
        speakerId: req.user.id,
        state: 'draft',
      });
    } catch (error) {
      const errors = henri.model.errors(error);

      if (!errors) {
        throw error;
      }

      return res.negotiate({
        html: async () => {
          res.inertia.errors(errors);

          return res.render('/proposals/new', {
            data: { proposal: attributes, ...(await formOptions()) },
          });
        },
        json: () => res.boom.badData(error.message, { errors }),
      });
    }

    req.flash('notice', 'Draft saved. Submit it when you are happy with it.');

    const full = await Proposal.findByKey(proposal.id, { include: INCLUDE });

    return res.negotiate({
      html: () => res.redirect(`/proposals/${proposal.externalId}`),
      json: async () =>
        res.resource(await presented(full), { status: 201, subject: full }),
    });
  },

  edit: async (req, res) =>
    res.render('/proposals/edit', {
      data: {
        proposal: await presented(req.proposal),
        ...(await formOptions()),
      },
    }),

  index: async (req, res) => {
    // What this list *is*, before anything a visitor asked for: the states
    // this conference publishes, and the edition they picked. henri
    // intersects a client filter with it and never merges into it, so
    // `?filter[state]=draft` answers nothing rather than reaching a draft
    const scope = { state: PUBLIC_STATES };

    if (req.query.event) {
      // The parameter carries the public id of an edition; an unknown one
      // matches nothing rather than everything
      const edition = await Event.findById(req.query.event);

      scope.eventId = edition ? edition.id : 0;
    }

    const { order, terms, where } = await req.filters({ scope });
    const { records, page, perPage, total, pages } = await Proposal.paginate({
      ...req.pagination(),
      include: INCLUDE,
      order,
      where,
    });
    const proposals = await presented(records);
    // What the page shows as chosen, and the query it carries into every
    // link it builds -- the paging links `res.collection()` answers carry
    // the same thing, because they are the url as it was asked for
    const chosen = Object.fromEntries(
      terms.map((term) => [term.name, term.value])
    );
    const query = Object.fromEntries([
      ...terms.map((term) => [
        term.operator === 'eq'
          ? `filter[${term.name}]`
          : `filter[${term.name}][${term.operator}]`,
        term.value,
      ]),
      ['event', req.query.event || ''],
      ['sort', req.query.sort || ''],
    ]);

    return res.negotiate({
      html: async () => {
        const editions = await Event.order('-year');

        return res.render('/proposals/index', {
          data: {
            chosen,
            editions: editions.map((event) => ({
              externalId: event.externalId,
              name: event.name,
              year: event.year,
            })),
            page,
            pages,
            perPage,
            proposals,
            query,
            sort: req.query.sort || '',
            total,
          },
        });
      },
      json: () =>
        res.collection(proposals, {
          page,
          perPage,
          subject: records,
          total,
        }),
    });
  },

  mine: async (req, res) => {
    // The policy says which proposals are this speaker's own, so the rule
    // lives next to the one that says they may edit them
    const proposals = await Proposal.where(await req.scope('proposal'))
      .include(...INCLUDE)
      .order('-updatedAt');

    return res.render('/proposals/mine', {
      data: { proposals: await presented(proposals) },
    });
  },

  new: async (req, res) =>
    res.render('/proposals/new', {
      data: { proposal: {}, ...(await formOptions()) },
    }),

  show: async (req, res) => {
    const reviews =
      req.user && req.user.roles && req.user.roles.includes('admin')
        ? await Review.where({ proposalId: req.proposal.id }).include(
            'reviewer'
          )
        : null;
    const proposal = await presented(req.proposal, { reviews });

    return res.negotiate({
      html: async () =>
        res.render('/proposals/show', {
          data: {
            editable: await req.can('update', req.proposal),
            proposal,
          },
        }),
      // The proposal leaves as a presentation of itself, which has no
      // `speakerId` for the rules to read: `subject` names the record the
      // policies are asked about, so the `_links` are still the owner's
      json: () => res.resource(proposal, { subject: req.proposal }),
    });
  },

  submit: async (req, res) => {
    const { proposal } = req;

    if (proposal.state !== 'draft') {
      req.flash('alert', 'That proposal has already been submitted.');

      return res.negotiate({
        html: () => res.redirect(`/proposals/${proposal.externalId}`),
        json: () => res.boom.conflict('Only a draft can be submitted'),
      });
    }

    if (!proposal.event || proposal.event.state !== 'open') {
      req.flash('alert', 'The call for papers of that edition is closed.');

      return res.negotiate({
        html: () => res.redirect(`/proposals/${proposal.externalId}`),
        json: () => res.boom.conflict('The call for papers is closed'),
      });
    }

    await proposal.update({ state: 'submitted', submittedAt: new Date() });
    req.flash('notice', 'Submitted. The committee will review it.');

    return res.negotiate({
      html: () => res.redirect(`/proposals/${proposal.externalId}`),
      json: async () =>
        res.resource(await presented(proposal), { subject: proposal }),
    });
  },

  update: async (req, res) => {
    const { proposal } = req;

    if (proposal.state !== 'draft') {
      req.flash('alert', 'A submitted proposal can no longer be edited.');

      return res.negotiate({
        html: () => res.redirect(`/proposals/${proposal.externalId}`),
        json: () => res.boom.conflict('Only a draft can be edited'),
      });
    }

    try {
      await proposal.update(await resolveReferences(req.permit(...FIELDS)));
    } catch (error) {
      const errors = henri.model.errors(error);

      if (!errors) {
        throw error;
      }

      return res.negotiate({
        html: async () => {
          res.inertia.errors(errors);

          return res.render('/proposals/edit', {
            data: {
              proposal: {
                ...(await presented(proposal)),
                ...req.permit(...FIELDS),
              },
              ...(await formOptions()),
            },
          });
        },
        json: () => res.boom.badData(error.message, { errors }),
      });
    }

    req.flash('notice', 'Draft updated.');

    return res.negotiate({
      html: () => res.redirect(`/proposals/${proposal.externalId}`),
      json: async () =>
        res.resource(await presented(proposal), { subject: proposal }),
    });
  },

  withdraw: async (req, res) => {
    // A soft delete (`options: { paranoid: true }`): the row keeps its
    // reviews and an admin can restore it from /admin/proposals/withdrawn
    await req.proposal.destroy();
    req.flash('notice', `"${req.proposal.title}" was withdrawn.`);

    return res.negotiate({
      html: () => res.redirect('/proposals/mine'),
      json: () => res.status(204).end(),
    });
  },
};
