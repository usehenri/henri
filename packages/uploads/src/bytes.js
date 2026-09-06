/**
 * Sizes, the way the configuration writes them.
 *
 * `config.bodyLimit` is `"1mb"` or a number of bytes, and the upload limits
 * are read the same way so that the two are comparable at a glance. This is
 * the parser: no dependency, no unit henri does not document, and `false`
 * kept as `false` because a limit an application removed on purpose is not
 * the same thing as a limit it wrote badly.
 */

/** Multipliers of the suffixes a size accepts (no suffix is bytes) */
const UNITS = { gb: 1024 * 1024 * 1024, kb: 1024, mb: 1024 * 1024 };

/** A size: a number, with an optional unit */
const SIZE = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/iu;

/**
 * A size in bytes
 *
 * @param {*} value a number of bytes, a string (`'10mb'`), or `false`
 * @param {(number|false|null)} [fallback=null] what an unreadable value becomes
 * @returns {(number|false|null)} the size, `false` for no limit, or the fallback
 */
function bytes(value, fallback = null) {
  if (value === false) {
    return false;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const match = SIZE.exec(value);

  if (!match) {
    return fallback;
  }

  const unit = String(match[2] || '').toLowerCase();
  const size = Number(match[1]) * (UNITS[unit] || 1);

  return size > 0 ? Math.floor(size) : fallback;
}

/**
 * A size, printed the way the documentation writes it
 *
 * @param {(number|false)} value a size in bytes, or `false`
 * @returns {string} `'10mb'`, `'512kb'`, `'900b'` or `'no limit'`
 */
function format(value) {
  if (value === false || value === null) {
    return 'no limit';
  }

  for (const unit of ['gb', 'mb', 'kb']) {
    if (value >= UNITS[unit]) {
      return `${Math.round((value / UNITS[unit]) * 10) / 10}${unit}`;
    }
  }

  return `${value}b`;
}

/**
 * A limit as busboy wants it: a number, or `Infinity` for no limit
 *
 * @param {(number|false|null)} value the limit
 * @returns {number} the limit, or `Infinity`
 */
const orInfinity = (value) =>
  typeof value === 'number' && value > 0 ? value : Infinity;

module.exports = { UNITS, bytes, format, orInfinity };
