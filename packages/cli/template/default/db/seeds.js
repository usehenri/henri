// Seed data, Rails' db/seeds.rb: `henri db:seed` boots the models only (no
// views, no workers) and awaits what this file exports. The models are
// globals here, like everywhere else in the application, and `henri` is the
// running instance.
//
// Keep it idempotent: seeds are run again on every machine and after every
// reset. `find or create` is the idiom for that.

module.exports = async () => {
  // for (const name of ['Write the seeds', 'Ship it']) {
  //   const existing = await Task.findOne({ name });
  //
  //   if (!existing) {
  //     await Task.create({ category: 'medium', name });
  //   }
  // }
  //
  // henri.pen.info('seeds', 'tasks are ready');
};
