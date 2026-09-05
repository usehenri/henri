import React, { useEffect } from 'react';
import get from 'lodash/get';
import { useForm } from './context';
import { warnOutsideForm } from './warn';

/**
 * The message for a field error: the `errorMsg` entry for the failed rule,
 * or the server's message itself
 *
 * @param {object} errorMsg `{ [rule]: message }`
 * @param {*} failure the failed rule name or a message
 * @returns {string} the message
 */
export function messageFor(errorMsg, failure) {
  if (errorMsg && typeof failure === 'string' && errorMsg[failure]) {
    return errorMsg[failure];
  }

  return typeof failure === 'string' ? failure : '';
}

const Input = ({
  disabled = false,
  className = 'form-control',
  baseClassName = 'form-group',
  errorClassName = 'help-block m-b-none',
  errorMsg = {},
  name,
  placeholder,
  required = false,
  type = 'text',
  validation = {},
  sanitation = {},
  ...props
}) => {
  const context = useForm();
  const hasError = Boolean(context.errors[name]);

  warnOutsideForm(context, 'Input');

  useEffect(
    () => context.addSanitizer(name, sanitation),
    [name, context.addSanitizer, JSON.stringify(sanitation)]
  );

  const value = get(context.data, name);
  const checked = type === 'checkbox' ? Boolean(value) : undefined;

  return (
    <div className={`${baseClassName} ${hasError ? 'has-error' : ''}`}>
      <input
        type={type}
        name={name}
        value={type === 'checkbox' ? undefined : (value ?? '')}
        checked={checked}
        className={className}
        placeholder={placeholder}
        required={required}
        disabled={disabled || context.disabled}
        onChange={(event) => context.handleChange(event, validation)}
        {...props}
      />
      {hasError && (
        <span className={errorClassName}>
          {messageFor(errorMsg, context.errors[name])}
        </span>
      )}
    </div>
  );
};

export default Input;
