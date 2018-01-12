import React from 'react';
import PropTypes from 'prop-types';

const Button = (
  {
    children,
    className = 'btn btn-primary block full-width m-b',
    label,
    type = 'submit',
  },
  { disabled = null, _henriForm = false }
) => {
  !_henriForm && console.warn('Button component used outside henri form.');
  return (
    <button
      type={type}
      className={`${className} ${disabled && 'disabled'}`}
      disabled={disabled}
    >
      {label || children || ''}
    </button>
  );
};

Button.contextTypes = {
  data: PropTypes.object,
  disabled: PropTypes.bool,
  errors: PropTypes.object,
  handleChange: PropTypes.func,
  handleSubmit: PropTypes.func,
  _henriForm: PropTypes.bool,
};

export default Button;
