import React from 'react';
import PropTypes from 'prop-types';
import { useForm } from './context';
const _Get = require('lodash/get');

const Input = ({
  disabled = false,
  className = 'form-control',
  baseClassName = 'form-group',
  errorClassName = 'help-block m-b-none',
  errorMsg = {},
  name,
  placeholder,
  required = false,
  type,
  validation = {},
  sanitation = {},
}) => {
  const context = useForm();

  !context._henriForm &&
    // eslint-disable-next-line no-console
    console.warn('Input component used outside henri form.');
  const hasError = !!context.errors[name];

  context.addSanitizer(name, sanitation);

  return (
    <div className={`${baseClassName} ${hasError ? 'has-error' : ''}`}>
      <input
        type={type}
        name={name}
        value={_Get(context.data, name, '')}
        className={className}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        onChange={(event) =>
          context.handleChange(event, validation, sanitation)
        }
      />
      {hasError && (
        <span className={errorClassName}>{errorMsg[context.errors[name]]}</span>
      )}
    </div>
  );
};

Input.propTypes = {
  baseClassName: PropTypes.string,
  className: PropTypes.string,
  disabled: PropTypes.bool,
  errorClassName: PropTypes.string,
  errorMsg: PropTypes.object,
  name: PropTypes.string.isRequired,
  placeholder: PropTypes.string,
  required: PropTypes.bool,
  sanitation: PropTypes.object,
  type: PropTypes.string,
  validation: PropTypes.object,
};

export default Input;
