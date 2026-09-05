import React from 'react';
import PropTypes from 'prop-types';
import { useForm } from './context';

const Button = ({
  children,
  className = 'btn btn-primary block full-width m-b',
  label,
  type = 'submit',
  ...props
}) => {
  const { disabled = false, _henriForm = false } = useForm();

  // eslint-disable-next-line no-console
  !_henriForm && console.warn('Button component used outside henri form.');

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

Button.propTypes = {
  children: PropTypes.node,
  className: PropTypes.string,
  label: PropTypes.string,
  type: PropTypes.string,
};

export default Button;
