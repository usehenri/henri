import React from 'react';

/**
 * Context provided by the Form component to its fields
 */
export const FormContext = React.createContext({
  // Warn if not within form
  _henriForm: false,
  // Add a sanitizer for validation
  addSanitizer: () => {},
  // Reset the form
  clear: () => {},
  // Contains the data passed down. Key should match names
  data: {},
  // Is it disabled?
  disabled: false,
  // Global form error
  error: null,
  // Per components error
  errors: {},
  // Send back the changes so we can update the state
  handleChange: () => {},
  // If a component wants to trigger a submit
  handleSubmit: () => {},
  // Is the form modified?
  modified: false,
});

/**
 * Hook giving access to the enclosing form
 *
 * @returns {object} the form context value
 */
export const useForm = () => React.useContext(FormContext);
