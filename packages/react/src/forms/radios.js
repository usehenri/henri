import React, { useEffect } from 'react';
import get from 'lodash/get';
import { useForm } from './context';
import { messageFor } from './input';
import { warnOutsideForm } from './warn';

/**
 * One radio button of a group: `group` is the data key, `name` the value
 * this button sets
 *
 * @param {object} props props
 * @returns {React.Element} the radio
 */
const Radios = ({
  disabled = false,
  className = '',
  baseClassName = 'form-group',
  errorClassName = 'help-block m-b-none',
  errorMsg = {},
  label = '',
  name,
  group,
  children,
  required = false,
  validation = {},
  sanitation = {},
  ...props
}) => {
  const context = useForm();
  const hasError = Boolean(context.errors[group]);

  warnOutsideForm(context, 'Radio');

  useEffect(
    () => context.addSanitizer(group, sanitation),
    [group, context.addSanitizer, JSON.stringify(sanitation)]
  );

  return (
    <div className={`${baseClassName} ${hasError ? 'has-error' : ''}`}>
      <label>
        <input
          type="radio"
          name={group}
          checked={get(context.data, group) === name}
          value={name}
          id={name}
          className={className}
          required={required}
          disabled={disabled || context.disabled}
          onChange={(event) => context.handleChange(event, validation)}
          {...props}
        />{' '}
        {label || children}
        {hasError && (
          <span className={errorClassName}>
            {messageFor(errorMsg, context.errors[group])}
          </span>
        )}
      </label>
    </div>
  );
};

export default Radios;
