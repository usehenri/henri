import React from 'react';
import PropTypes from 'prop-types';
import { useForm } from './context';

const FormError = ({ children }) => {
  const { error = null, _henriForm = false } = useForm();

  // eslint-disable-next-line no-console
  !_henriForm && console.warn('Error component used outside henri form.');

  if (error && children) {
    return <div>{children}</div>;
  }
  if (error) {
    return <div>{error === true ? 'An error occurred' : error}</div>;
  }

  return <div />;
};

FormError.propTypes = {
  children: PropTypes.node,
};

export default FormError;
