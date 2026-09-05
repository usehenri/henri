// See https://www.npmjs.com/package/validator
import validator from 'validator';

/**
 * Run a validator.js rule (validation: `isLength`, `isEmail`...) or
 * sanitizer (`trim`, `escape`...) on a value
 *
 * @param {string} rule the validator.js function name
 * @param {*} opts its options (`true` for none)
 * @param {*} value the value (validator.js works on strings)
 * @returns {*} the rule's result: a boolean for validations, the sanitized
 * string for sanitizers, false for unknown rules
 */
const validation = (rule, opts, value) => {
  const str = `${value}`;

  if (typeof validator[rule] !== 'function') {
    // eslint-disable-next-line no-console
    console.error(`Validation rule ${rule} not found`);

    return false;
  }

  if (opts && opts !== true) {
    return validator[rule](str, opts);
  }

  return validator[rule](str);
};

export default validation;
