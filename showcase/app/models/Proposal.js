// A talk proposal: what a speaker writes and what the committee reviews.
//
// `options.paranoid` turns deletes into soft deletes: withdrawing a proposal
// stamps `deletedAt` and hides the row from every query, so the reviews
// written on it stay meaningful and an admin can restore it from the trash
// (`Proposal.onlyDeleted()`, `proposal.restore()`).
module.exports = {
  /**
   * Proposals belong to a speaker, an edition and a track
   *
   * @param {object} models The models of the store, by global name
   * @returns {void}
   */
  associate(models) {
    models.Proposal.belongsTo(models.User, {
      as: 'speaker',
      foreignKey: 'speakerId',
    });
    models.Proposal.belongsTo(models.Event, {
      as: 'event',
      foreignKey: 'eventId',
    });
    models.Proposal.belongsTo(models.Track, {
      as: 'track',
      foreignKey: 'trackId',
    });
    models.User.hasMany(models.Proposal, {
      as: 'proposals',
      foreignKey: 'speakerId',
    });
    models.Event.hasMany(models.Proposal, {
      as: 'proposals',
      foreignKey: 'eventId',
    });
    models.Track.hasMany(models.Proposal, {
      as: 'proposals',
      foreignKey: 'trackId',
    });
  },

  options: { paranoid: true },

  schema: {
    abstract: {
      maxLength: 4000,
      minLength: 60,
      required: true,
      type: 'text',
    },
    decidedAt: { type: 'date' },
    eventId: {
      index: true,
      references: { model: 'Event', onDelete: 'cascade' },
      required: true,
      type: 'integer',
    },
    format: {
      default: 'talk',
      enum: ['talk', 'workshop', 'lightning'],
      type: 'string',
    },
    level: {
      default: 'intermediate',
      enum: ['beginner', 'intermediate', 'advanced'],
      type: 'string',
    },
    speakerId: {
      index: true,
      references: { model: 'User', onDelete: 'cascade' },
      required: true,
      type: 'integer',
    },
    // Never mass assigned: only the member routes of the controllers move a
    // proposal from one state to the next
    state: {
      default: 'draft',
      enum: ['draft', 'submitted', 'accepted', 'rejected'],
      index: true,
      type: 'string',
    },
    submittedAt: { type: 'date' },
    title: {
      maxLength: 120,
      minLength: 8,
      required: true,
      trim: true,
      type: 'string',
    },
    // A draft has no track yet, so the column is nullable
    trackId: {
      index: true,
      references: { model: 'Track', onDelete: 'set null' },
      type: 'integer',
    },
  },
};
