const fs = require('fs');

/**
 * The idempotent idiom of the documentation: find, then create
 *
 * @returns {Promise<void>} Resolves when the task exists
 */
const plant = async () => {
  const existing = await Task.findOne({ name: 'Seeded' });

  if (!existing) {
    await Task.create({ name: 'Seeded' });
  }
};

/**
 * Seeds the fixture and, when the test asked for it, writes what it
 * observed to HENRI_SEED_REPORT
 *
 * @param {object} henri The running instance
 * @returns {Promise<void>} Resolves when done
 */
module.exports = async (henri) => {
  await plant();
  await plant();

  if (!process.env.HENRI_SEED_REPORT) {
    return;
  }

  fs.writeFileSync(
    process.env.HENRI_SEED_REPORT,
    JSON.stringify({
      count: await Task.count(),
      henri: typeof henri.stop === 'function',
      timestamps: (await Task.first()).createdAt instanceof Date,
    })
  );
};
