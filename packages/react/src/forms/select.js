import React, { useEffect } from 'react';
import get from 'lodash/get';
import { useForm } from './context';
import { messageFor } from './input';
import { warnOutsideForm } from './warn';

/**
 * The value of a choice: its public identifier for records (`externalId`,
 * what a record carries once the internal id stops leaving the server),
 * its `_id`/`id`/`value` otherwise, itself when it is not an object
 *
 * @param {*} item a choice
 * @returns {string} its value
 */
const valueOf = (item) => {
  if (item && typeof item === 'object') {
    return String(item.externalId ?? item._id ?? item.id ?? item.value ?? '');
  }

  return String(item ?? '');
};

const Select = ({
  className = 'form-control m-b',
  baseClassName = 'form-group',
  errorClassName = 'help-block m-b-none',
  errorMsg = {},
  disabled = false,
  displayProp = 'name',
  name,
  placeholder = null,
  required = false,
  sanitation = {},
  validation = {},
  choices = [],
  ...props
}) => {
  const context = useForm();
  const hasError = Boolean(context.errors[name]);

  warnOutsideForm(context, 'Select');

  useEffect(
    () => context.addSanitizer(name, sanitation),
    [name, context.addSanitizer, JSON.stringify(sanitation)]
  );

  const current = get(context.data, name);
  const value = valueOf(current);

  return (
    <div className={`${baseClassName} ${hasError ? 'has-error' : ''}`}>
      <select
        className={className}
        name={name}
        value={value}
        onChange={(event) => context.handleChange(event, validation)}
        required={required}
        disabled={disabled || context.disabled}
        {...props}
      >
        {placeholder !== null && (
          <option value="" disabled={required}>
            {placeholder}
          </option>
        )}
        {choices.map((item) => {
          const key = valueOf(item);
          const label =
            item && typeof item === 'object' ? item[displayProp] : item;

          return (
            <option key={key} value={key}>
              {label}
            </option>
          );
        })}
      </select>
      {hasError && (
        <span className={errorClassName}>
          {messageFor(errorMsg, context.errors[name])}
        </span>
      )}
    </div>
  );
};

export default Select;
