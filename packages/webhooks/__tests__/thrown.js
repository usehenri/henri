/**
 * The error a call threw, so a test can assert on more than its message
 * without putting an `expect` inside a `catch`
 *
 * @param {(Function|Promise)} what A call, or the promise of one
 * @returns {Promise<?Error>} What it threw, or null when it did not
 */
const thrown = async (what) => {
  try {
    await (typeof what === 'function' ? what() : what);

    return null;
  } catch (error) {
    return error;
  }
};

module.exports = { thrown };
