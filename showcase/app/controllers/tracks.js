// The tracks of one edition. This controller only ever answers under its
// parent, because `resources tracks` is nested in `resources events`:
//
//   GET /events/:event_id/tracks  ->  tracks#index
//
// The parameter is named after the singular of the parent resource, which is
// how a nested route tells a controller which record it hangs under.
module.exports = {
  before: {
    all: async (req, res) => {
      req.event = await Event.findById(req.params.event_id);

      if (!req.event) {
        return res.boom.notFound(`No edition ${req.params.event_id}`);
      }
    },
  },

  index: async (req, res) => {
    const tracks = await Track.where({ eventId: req.event.id }).order('name');
    const counts = await Promise.all(
      tracks.map((track) =>
        Proposal.count({ state: 'accepted', trackId: track.id })
      )
    );

    return res.render('/tracks/index', {
      data: {
        event: req.event.toJSON(),
        tracks: tracks.map((track, index) => ({
          ...track.toJSON(),
          accepted: counts[index],
        })),
      },
    });
  },
};
