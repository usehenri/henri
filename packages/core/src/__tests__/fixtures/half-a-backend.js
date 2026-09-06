/**
 * A backend that only counts: half the contract, which is refused at boot
 * rather than at the first idempotent request
 *
 * @class HalfBackend
 */
class HalfBackend {
  /**
   * An express-rate-limit store
   *
   * @returns {object} the store
   * @memberof HalfBackend
   */
  rateLimitStore() {
    return { decrement() {}, increment() {}, resetKey() {} };
  }
}

module.exports = HalfBackend;
