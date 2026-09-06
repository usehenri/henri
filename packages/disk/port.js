/**
 * The port a disk store asks mongod to listen on.
 *
 * mongodb-memory-server finds a port by binding one with `listen(0)`,
 * closing that probe and then launching mongod on it. Nothing holds the port
 * in between, its cache of ports already handed out lives in one process,
 * and both Linux and macOS allocate ephemeral ports in order. Two processes
 * that boot a store at the same moment -- test workers, an application and
 * its suite, several applications in a monorepo -- therefore probe the same
 * region of the range within milliseconds of each other, and the second
 * mongod dies with `Port "<n>" already in use`, which the library does not
 * retry.
 *
 * Giving each process a starting port of its own removes the convergence:
 * the library tries that port first and only falls back to its own search
 * when it is genuinely taken. Sibling processes get consecutive pids, so
 * they get distinct ports; a store asked for a specific port through
 * `config.port` is given that one instead.
 *
 * The range sits below the ephemeral ports of both Linux (32768 and up) and
 * macOS (49152 and up), so a starting port is never one the kernel is about
 * to hand to something else, and below mongod's own default of 27017.
 */

/** First port of the range */
const FLOOR = 20000;

/** One past the last port of the range */
const CEILING = 27000;

/** Ports reserved per process, for an application with several disk stores */
const PER_PROCESS = 4;

/** Stores started by this process so far */
let started = 0;

/**
 * The starting port of the next store of this process
 *
 * @returns {number} a port between 20000 and 26999
 */
function startingPort() {
  const slot = process.pid * PER_PROCESS + started++;

  return FLOOR + (slot % (CEILING - FLOOR));
}

module.exports = { CEILING, FLOOR, PER_PROCESS, startingPort };
