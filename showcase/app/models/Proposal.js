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

  options: {
    paranoid: true,
    // What happens to a proposal when its speaker asks to be erased. The
    // default, spelled out because it is a decision: the row stays, because
    // the programme this conference ran is its own record and not only the
    // speaker's, and the speaker becomes a row that names nobody. Nothing
    // here is marked `personal`: a title and an abstract are the talk, and
    // the person is one join away.
    personal: { onErase: 'anonymize' },
    // How long the conference keeps a proposal, and what happens then. Two
    // classes of record, two clocks, two verbs:
    //
    // - a draft nobody ever submitted is deleted six months after it was
    //   written, because there is nothing here worth keeping and the
    //   speaker's words are the only thing in it;
    // - a decided proposal goes into the trash two years *after the
    //   decision*, not after it was written: `submittedAt` and `createdAt`
    //   are the wrong clocks for a promise made about a decision. Soft,
    //   because this model is paranoid and an admin restoring one is the
    //   whole point of that.
    //
    // Neither is `anonymize`: nothing here is marked personal, so there
    // would be nothing to write over, and henri refuses that rule rather
    // than reporting a sweep that touched no field.
    retention: [
      {
        action: 'soft-delete',
        after: '2y',
        from: 'decidedAt',
        name: 'decided',
      },
      { after: '180d', name: 'drafts', where: { state: 'draft' } },
    ],
  },

  schema: {
    abstract: {
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

  // What must be true of a proposal, in the one vocabulary every adapter
  // shares. The two lengths used to sit in the schema next to the types,
  // where they were the drizzle adapter's own keys: they worked here, and
  // the same lines would have failed the boot on an mssql store and been
  // checked on three write paths out of five on MongoDB. Here they mean
  // one thing, and the schema above says what the columns are.
  validates: {
    abstract: { maxLength: 4000, minLength: 60 },
    title: { maxLength: 120, minLength: 8 },
  },
};
