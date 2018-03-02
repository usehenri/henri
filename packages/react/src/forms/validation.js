// See https://www.npmjs.com/package/validator

import validator from 'validator';

const validation = (rule, opts, value) => {
  const str = value + '';
  if (!validator.hasOwnProperty(rule)) {
    console.error(`Validation rule ${rule} not found`);
    return false;
  }
  if (opts) {
    return validator[rule](str, opts);
  }
  return validator[rule](str);
};

export default validation;
