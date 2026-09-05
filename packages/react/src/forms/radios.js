import React from 'react';
import PropTypes from 'prop-types';
import { useForm } from './context';

const Radios = ({
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
  validation = {},
  sanitation = {},
}) => {
  const context = useForm();

  !context._henriForm &&
    // eslint-disable-next-line no-console
    console.warn('Radio component used outside henri form.');

  const hasError = !!context.errors[name];

  context.addSanitizer(name, sanitation);

  return (
    <div className={`${baseClassName} ${hasError ? 'has-error' : ''}`}>
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
          onChange={(elem) => context.handleChange(elem, validation, sanitation)}
        />{' '}
        {label || children}
        {hasError && errorMsg && (
          <span className={errorClassName}>
            {errorMsg[context.errors[name]]}
          </span>
        )}
      </label>
    </div>
  );
};

Radios.propTypes = {
  baseClassName: PropTypes.string,
  children: PropTypes.node,
  className: PropTypes.string,
  disabled: PropTypes.bool,
  errorClassName: PropTypes.string,
  errorMsg: PropTypes.object,
  group: PropTypes.string.isRequired,
  label: PropTypes.string,
  name: PropTypes.string.isRequired,
  required: PropTypes.bool,
  sanitation: PropTypes.object,
  validation: PropTypes.object,
};

export default Radios;
