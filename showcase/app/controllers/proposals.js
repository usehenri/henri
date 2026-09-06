// Proposals: the resource this application is about.
//
// One controller serves a browser and an API client. `res.negotiate()` picks
// the page or the HAL answer, `before` loads the record once and enforces
// ownership, `req.permit()` decides what a request may set, and the two state
// transitions a speaker may trigger are member routes rather than a
// hand-written `state` field on the update form.
const {
  FIELDS,
  INCLUDE,
  PUBLIC_STATES,
  mayRead,
  owns,
  present,
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

  if (!proposal || !mayRead(req.user, proposal)) {
    return res.boom.notFound(`No proposal ${req.params.id}`);
  }

  req.proposal = proposal;

  return undefined;
};

/**
 * Refuses to let a speaker touch someone else's proposal
 *
 * @param {object} req Express request
 * @param {object} res Express response
 * @returns {object|undefined} The answer, or nothing when the proposal is theirs
 */
const mustOwnIt = (req, res) => {
  if (owns(req.user, req.proposal)) {
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

    const full = await Proposal.findById(proposal.id, { include: INCLUDE });

    return res.negotiate({
      html: () => res.redirect(`/proposals/${proposal.externalId}`),
      json: () => res.resource(present(full), { status: 201 }),
    });
  },

  edit: async (req, res) =>
    res.render('/proposals/edit', {
      data: { proposal: present(req.proposal), ...(await formOptions()) },
    }),

  index: async (req, res) => {
    const where = { state: PUBLIC_STATES };

    if (PUBLIC_STATES.includes(req.query.state)) {
      where.state = req.query.state;
    }

    if (req.query.event) {
      // The filter carries the public id of an edition; an unknown one
      // matches nothing rather than everything
      const edition = await Event.findById(req.query.event);

      where.eventId = edition ? edition.id : 0;
    }

    const { records, page, perPage, total, pages } = await Proposal.paginate({
      ...req.pagination(),
      include: INCLUDE,
      order: ['-submittedAt', '-id'],
      where,
    });
    const proposals = records.map((proposal) => present(proposal));

    return res.negotiate({
      html: async () => {
        const editions = await Event.order('-year');

        return res.render('/proposals/index', {
          data: {
            editions: editions.map((event) => ({
              externalId: event.externalId,
              name: event.name,
              year: event.year,
            })),
            filters: {
              event: req.query.event || '',
              state: req.query.state || '',
            },
            page,
            pages,
            perPage,
            proposals,
            total,
          },
        });
      },
      json: () => res.collection(proposals, { page, perPage, total }),
    });
  },

  mine: async (req, res) => {
    const proposals = await Proposal.where({ speakerId: req.user.id })
      .include(...INCLUDE)
      .order('-updatedAt');

    return res.render('/proposals/mine', {
      data: { proposals: proposals.map((proposal) => present(proposal)) },
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
    const proposal = present(req.proposal, { reviews });

    return res.negotiate({
      html: () =>
        res.render('/proposals/show', {
          data: { editable: owns(req.user, req.proposal), proposal },
        }),
      json: () => res.resource(proposal),
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
      json: () => res.resource(present(proposal)),
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
              proposal: { ...present(proposal), ...req.permit(...FIELDS) },
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
      json: () => res.resource(present(proposal)),
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
