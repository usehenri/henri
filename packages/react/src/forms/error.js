import React from 'react';
import PropTypes from 'prop-types';

const Error = ({ children }, { error = null, _henriForm = false }) => {
  !_henriForm && console.warn('Error component used outside henri form.');
  if (error && children) {
    return <div>{children}</div>;
  }
  if (error) {
    return <div>{error}</div>;
  }
  return <div />;
};

Error.contextTypes = {
  data: PropTypes.object,
  disabled: PropTypes.bool,
  errors: PropTypes.object,
  error: PropTypes.oneOf([PropTypes.string, PropTypes.bool]),
  modified: PropTypes.bool,
  handleChange: PropTypes.func,
  handleSubmit: PropTypes.func,
  _henriForm: PropTypes.bool,
};

export default Error;
