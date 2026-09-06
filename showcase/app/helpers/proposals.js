// What the proposal controllers share: the fields a request may set, the
// associations to eager load, and the shape a proposal takes when it leaves
// the server. Both the pages (res.render) and the JSON API (res.resource,
// res.collection) go through `present()`, so the two never drift and a
// speaker's email address never reaches a public page.
//
// app/helpers is watched like the controllers, so saving this file reloads
// the application in development.

/** Attributes a speaker may set on a proposal (see req.permit) */
const FIELDS = ['abstract', 'eventId', 'format', 'level', 'title', 'trackId'];

/** Associations loaded with a proposal, in one query */
const INCLUDE = ['event', 'speaker', 'track'];

/** The states anyone may read: a draft or a rejection is nobody's business */
const PUBLIC_STATES = ['accepted', 'submitted'];

/**
 * The public half of a user: never the email, never the roles, and the
 * public identifier rather than the primary key
 *
 * @param {?object} user A User instance, or undefined when not loaded
 * @returns {?object} `{ externalId, name, company }` or null
 */
const speakerOf = (user) =>
  user
    ? {
        company: user.company || null,
        externalId: user.externalId,
        name: user.name,
      }
    : null;

/**
 * Turns the public identifiers a form posts for `eventId` and `trackId`
 * into the primary keys those columns hold.
 *
 * The foreign keys of the database are internal ids and stay that way; what
 * a page shows and posts back is the external id of the record, so nothing
 * outside ever sees a sequential number.
 *
 * @param {object} attributes The permitted attributes of a request
 * @returns {Promise<object>} The attributes, with the references resolved
 */
const resolveReferences = async (attributes) => {
  const resolved = { ...attributes };
  const references = [
    ['eventId', Event],
    ['trackId', Track],
  ];

  for (const [name, Model] of references) {
    if (!Object.prototype.hasOwnProperty.call(resolved, name)) {
      continue;
    }

    const given = resolved[name];

    if (given === '' || given === null || typeof given === 'undefined') {
      resolved[name] = null;

      continue;
    }

    const record = await Model.findById(given);

    // An unknown reference stays a validation failure of the model rather
    // than a silent write on the wrong row
    resolved[name] = record ? record.id : 0;
  }

  return resolved;
};

/**
 * The average of a list of reviews, rounded to one decimal
 *
 * @param {Array} [reviews=[]] Reviews, plain objects, or bare scores
 * @returns {?number} The average score, or null without a review
 */
const averageScore = (reviews = []) => {
  if (reviews.length === 0) {
    return null;
  }

  const total = reviews.reduce(
    (sum, review) =>
      sum +
      Number(
        review !== null && typeof review === 'object' ? review.score : review
      ),
    0
  );

  return Math.round((total / reviews.length) * 10) / 10;
};

/**
 * A proposal as the pages and the JSON API see it
 *
 * @param {object} proposal A Proposal instance (with its associations)
 * @param {object} [options={}] `reviews` embeds the reviews and their average
 * @returns {object} A plain object
 */
const present = (proposal, { reviews = null } = {}) => {
  const plain = proposal.toJSON();

  // `toJSON()` already dropped the primary key; the foreign keys are internal
  // too, and the form posts the public id of the edition and of the track
  delete plain.speakerId;
  delete plain.eventId;
  delete plain.trackId;

  return {
    ...plain,
    event: plain.event
      ? {
          externalId: plain.event.externalId,
          name: plain.event.name,
          slug: plain.event.slug,
        }
      : null,
    eventId: plain.event ? plain.event.externalId : null,
    speaker: speakerOf(proposal.speaker),
    track: plain.track
      ? {
          externalId: plain.track.externalId,
          name: plain.track.name,
          slug: plain.track.slug,
        }
      : null,
    trackId: plain.track ? plain.track.externalId : null,
    ...(reviews
      ? {
          reviews: reviews.map((review) => ({
            comment: review.comment,
            createdAt: review.createdAt,
            externalId: review.externalId,
            reviewer: speakerOf(review.reviewer),
            score: review.score,
          })),
          score: averageScore(reviews),
        }
      : {}),
  };
};

/**
 * Is this user the speaker of this proposal?
 *
 * @param {?object} user `req.user`, or null for an anonymous visitor
 * @param {object} proposal A Proposal instance
 * @returns {boolean} true when the proposal is the user's own
 */
const owns = (user, proposal) =>
  Boolean(user) && String(proposal.speakerId) === String(user.id);

/**
 * May this user read this proposal? Everyone reads what was submitted or
 * accepted; a draft and a rejection belong to their speaker and to the
 * committee.
 *
 * @param {?object} user `req.user`, or null for an anonymous visitor
 * @param {object} proposal A Proposal instance
 * @returns {boolean} true when the proposal may be shown
 */
const mayRead = (user, proposal) => {
  if (PUBLIC_STATES.includes(proposal.state)) {
    return true;
  }

  const roles = (user && Array.isArray(user.roles) && user.roles) || [];

  return roles.includes('admin') || owns(user, proposal);
};

module.exports = {
  FIELDS,
  INCLUDE,
  PUBLIC_STATES,
  averageScore,
  mayRead,
  owns,
  present,
  resolveReferences,
  speakerOf,
};
