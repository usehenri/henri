import React from 'react';
import { useForm } from './context';
import { warnOutsideForm } from './warn';

/**
 * The form-level error (what the server answered, or `onFail`)
 *
 * @param {object} props props
 * @param {React.ReactNode} [props.children] shown instead of the message
 * @param {string} [props.className] wrapper class
 * @returns {React.Element} the error
 */
const FormError = ({ children, className = 'form-error' }) => {
  const context = useForm();
  const { error = null } = context;

  warnOutsideForm(context, 'FormError');

  if (!error) {
    return null;
  }

  if (children) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={className}>
      {error === true ? 'An error occurred' : String(error)}
    </div>
  );
};

export default FormError;
