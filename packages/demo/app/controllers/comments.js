// A nested resource: `resources comments` declared under `resources notes`
// answers on /notes/:note_id/comments
module.exports = {
  index: async (req) => ({ comments: [], noteId: req.params.note_id }),
};
