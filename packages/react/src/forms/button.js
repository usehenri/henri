import React from 'react';
import { useForm } from './context';
import { warnOutsideForm } from './warn';

const Button = ({
  children,
  className = 'btn btn-primary block full-width m-b',
  label,
  type = 'submit',
  ...props
}) => {
  const context = useForm();
  const { disabled = false } = context;

  warnOutsideForm(context, 'Button');

  return (
    <button
      type={type}
      className={`${className} ${disabled ? 'disabled' : ''}`}
      disabled={disabled}
      {...props}
    >
      {label || children || ''}
    </button>
  );
};

export default Button;
