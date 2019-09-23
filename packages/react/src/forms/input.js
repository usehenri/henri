import React from 'react';
import PropTypes from 'prop-types';
const _Get = require('lodash.get');

const Input = (
  {
    disabled = false,
    className = 'form-control',
    baseClassName = 'form-group',
    errorClassName = 'help-block m-b-none',
    errorMsg,
    name,
    placeholder,
    required = false,
    type,
    validation = {},
    sanitation = {},
  },
  context
) => {
  !context._henriForm &&
    // eslint-disable-next-line no-console
    console.warn('Input component used outside henri form.');
  const hasError = !!context.errors[name];

  context.addSanitizer(name, sanitation);

  return (
    <div className={`${baseClassName} ${hasError && 'has-error'}`}>
      <input
        type={type}
        name={name}
        value={_Get(context.data, name, '')}
        className={className}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        onChange={event => context.handleChange(event, validation, sanitation)}
      />
      {hasError && (
        <span className={errorClassName}>{errorMsg[context.errors[name]]}</span>
      )}
    </div>
  );
};

Input.propTypes = {
  errorMsg: PropTypes.object,
  name: PropTypes.string.isRequired,
  placeholder: PropTypes.string,
  required: PropTypes.bool,
  sanitation: PropTypes.object,
  type: PropTypes.string,
  validation: PropTypes.object,
};

Input.contextTypes = {
  _henriForm: PropTypes.bool,
  addSanitizer: PropTypes.func,
  data: PropTypes.object,
  errors: PropTypes.object,
  handleChange: PropTypes.func,
  handleSubmit: PropTypes.func,
  modified: PropTypes.bool,
};

export default Input;
