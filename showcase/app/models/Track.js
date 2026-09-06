// A track of one edition: the rooms a proposal can be scheduled in.
//
// `associate()` runs once every model of the store exists. Both sides of a
// relation are declared here so the order the model files are loaded in never
// matters: `belongsTo` puts the foreign key on this table, `hasMany` is the
// inverse Drizzle needs to eager load `include('tracks')`.
module.exports = {
  /**
   * Tracks belong to an edition, an edition has many tracks
   *
   * @param {object} models The models of the store, by global name
   * @returns {void}
   */
  associate(models) {
    models.Track.belongsTo(models.Event, {
      as: 'event',
      foreignKey: 'eventId',
    });
    models.Event.hasMany(models.Track, { as: 'tracks', foreignKey: 'eventId' });
  },

  schema: {
    blurb: { maxLength: 300, type: 'text' },
    // Declared here rather than left to belongsTo(), so the column is NOT
    // NULL and a deleted edition takes its tracks with it
    eventId: {
      index: true,
      references: { model: 'Event', onDelete: 'cascade' },
      required: true,
      type: 'integer',
    },
    name: {
      maxLength: 60,
      minLength: 2,
      required: true,
      trim: true,
      type: 'string',
    },
    slug: {
      index: true,
      match: [/^[a-z0-9-]+$/, 'may only hold lowercase letters, digits and -'],
      required: true,
      type: 'string',
    },
  },
};
