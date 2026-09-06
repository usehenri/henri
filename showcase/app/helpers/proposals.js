// What the proposal controllers share: the fields a request may set, the
// associations to eager load, and the shape a proposal takes when it leaves
// the server. Both the pages (res.render) and the JSON API (res.resource,
// res.collection) go through `present()`, so the two never drift and a
// speaker's email address never reaches a public page.
//
// `present()` takes a *published* proposal, not a model instance:
// `henri.model.publish()` is what removes the internal ids and turns
// `speakerId`, `eventId` and `trackId` into the public identifiers of the
// rows they name. This file used to do that by hand, one delete and one
// lookup per column, and only for the three columns somebody remembered.
// Presenting builds a new object, and a new object carries no model, so the
// framework's own exit gate cannot see the foreign keys in it: publish
// first, present second.
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
 * The public half of a user: never the email, never the roles
 *
 * @param {?object} user A published user, or undefined when not loaded
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
 * A proposal as the pages and the JSON API see it.
 *
 * `speakerId`, `eventId` and `trackId` arrive as the public identifiers of
 * the rows they name -- henri replaced them on the way out of the model --
 * so there is nothing to delete and nothing to look up here. What is left
 * is what this application decides: which columns of a speaker a reader may
 * see, and which of an edition and a track.
 *
 * @param {object} proposal A published proposal (with its associations)
 * @param {object} [options={}] `reviews` embeds the reviews and their average
 * @returns {object} A plain object
 */
const present = (proposal, { reviews = null } = {}) => ({
  ...proposal,
  event: proposal.event
    ? {
        externalId: proposal.event.externalId,
        name: proposal.event.name,
        slug: proposal.event.slug,
      }
    : null,
  speaker: speakerOf(proposal.speaker),
  track: proposal.track
    ? {
        externalId: proposal.track.externalId,
        name: proposal.track.name,
        slug: proposal.track.slug,
      }
    : null,
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
});

/**
 * Publishes a proposal (or a list of them) and presents the result.
 *
 * One call for a whole answer: `henri.model.publish()` batches the lookups
 * behind the foreign keys, so a page of proposals costs one statement per
 * model they point at rather than one per proposal.
 *
 * @param {(object|Array<object>)} proposals One proposal or a page of them
 * @param {object} [options={}] Passed to `present()`
 * @returns {Promise<(object|Array<object>)>} The presented proposals
 */
const presented = async (proposals, options = {}) => {
  const published = await henri.model.publish(proposals);

  return Array.isArray(published)
    ? published.map((proposal) => present(proposal, options))
    : present(published, options);
};

// `owns` and `mayRead` used to live here. They are rules about one record,
// which is what app/policies/proposal.js is for: the controller, the router,
// the `_links` of every JSON answer and the `paths` of every page all ask
// the same file now, and nothing has to remember to.

module.exports = {
  FIELDS,
  INCLUDE,
  PUBLIC_STATES,
  averageScore,
  present,
  presented,
  resolveReferences,
  speakerOf,
};
