import React from 'react';
import PropTypes from 'prop-types';

const Radios = (
  {
    disabled = false,
    className = '',
    baseClassName = 'form-group',
    errorClassName = 'help-block m-b-none',
    errorMsg,
    label = '',
    name,
    group,
    children,
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
      <label>
        <input
          type="radio"
          name={group}
          checked={context.data[group] === name}
          value={name}
          id={name}
          className={className}
          required={required}
          disabled={disabled}
          onChange={e => context.handleChange(e, validation, sanitation)}
        />{' '}
        {label || children}
        {hasError && (
          <span className={errorClassName}>
            {errorMsg[context.errors[name]]}
          </span>
        )}
      </label>
    </div>
  );
};

Radios.propTypes = {
  name: PropTypes.string.isRequired,
  type: PropTypes.string,
  label: PropTypes.string,
  required: PropTypes.bool,
  placeholder: PropTypes.string,
  validation: PropTypes.object,
  errorMsg: PropTypes.object,
  sanitation: PropTypes.object,
};

Radios.contextTypes = {
  data: PropTypes.object,
  errors: PropTypes.object,
  handleChange: PropTypes.func,
  handleSubmit: PropTypes.func,
  addSanitizer: PropTypes.func,
  _henriForm: PropTypes.bool,
};

export default Radios;
