import React from 'react';
import PropTypes from 'prop-types';

const Radios = (
  {
    disabled = false,
    className = '',
    baseClassName = 'form-group',
    errorClassName = 'help-block m-b-none',
    errorMsg = null,
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
          onChange={elem => context.handleChange(elem, validation, sanitation)}
        />{' '}
        {label || children}
        {hasError &&
          errorMsg && (
            <span className={errorClassName}>
              {errorMsg[context.errors[name]]}
            </span>
          )}
      </label>
    </div>
  );
};

Radios.propTypes = {
  errorMsg: PropTypes.object,
  label: PropTypes.string,
  name: PropTypes.string.isRequired,
  placeholder: PropTypes.string,
  required: PropTypes.bool,
  sanitation: PropTypes.object,
  type: PropTypes.string,
  validation: PropTypes.object,
};

Radios.contextTypes = {
  _henriForm: PropTypes.bool,
  addSanitizer: PropTypes.func,
  data: PropTypes.object,
  errors: PropTypes.object,
  handleChange: PropTypes.func,
  handleSubmit: PropTypes.func,
  modified: PropTypes.bool,
};

export default Radios;
