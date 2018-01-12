import React from 'react';
import PropTypes from 'prop-types';

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
    console.warn('Input component used outside henri form.');
  const hasError = !!context.errors[name];
  context.addSanitizer(name, sanitation);
  return (
    <div className={`${baseClassName} ${hasError && 'has-error'}`}>
      <input
        type={type}
        name={name}
        value={context.data[name] || ''}
        className={className}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        onChange={e => context.handleChange(e, validation, sanitation)}
      />
      {hasError && (
        <span className={errorClassName}>{errorMsg[context.errors[name]]}</span>
      )}
    </div>
  );
};

Input.propTypes = {
  name: PropTypes.string.isRequired,
  type: PropTypes.string,
  required: PropTypes.bool,
  placeholder: PropTypes.string,
  validation: PropTypes.object,
  errorMsg: PropTypes.object,
  sanitation: PropTypes.object,
};

Input.contextTypes = {
  data: PropTypes.object,
  errors: PropTypes.object,
  handleChange: PropTypes.func,
  handleSubmit: PropTypes.func,
  addSanitizer: PropTypes.func,
  _henriForm: PropTypes.bool,
};

export default Input;
