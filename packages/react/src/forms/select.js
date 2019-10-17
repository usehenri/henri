import React from 'react';
import PropTypes from 'prop-types';

const Select = (
  {
    disabled = false,
    className = 'form-control m-b',
    baseClassName = 'form-group',
    errorClassName = null,
    displayProp = 'name',
    errorMsg,
    name,
    placeholder,
    required = false,
    type,
    validation = {},
    sanitation = {},
    choices = [],
  },
  context
) => {
  !context._henriForm &&
    // eslint-disable-next-line no-console
    console.warn('Select component used outside henri form.');
  const hasError = !!context.errors[name];

  context.addSanitizer(name, sanitation);

  return (
    <div className={`${baseClassName} ${hasError && 'has-error'}`}>
      <select
        className={className}
        name={name}
        value={
          (context.data[name] && context.data[name]._id) ||
          context.data[name] ||
          placeholder ||
          ''
        }
        onChange={elem => context.handleChange(elem)}
        required={required}
      >
        {choices.map(item => (
          <option key={item._id} value={item._id}>
            {item[displayProp]}
          </option>
        ))}
      </select>
    </div>
  );
};

Select.propTypes = {
  displayProp: PropTypes.string,
  errorMsg: PropTypes.object,
  name: PropTypes.string.isRequired,
  placeholder: PropTypes.string,
  required: PropTypes.bool,
  sanitation: PropTypes.object,
  type: PropTypes.string,
  validation: PropTypes.object,
};

Select.contextTypes = {
  _henriForm: PropTypes.bool,
  addSanitizer: PropTypes.func,
  data: PropTypes.object,
  errors: PropTypes.object,
  handleChange: PropTypes.func,
  handleSubmit: PropTypes.func,
  modified: PropTypes.bool,
};

export default Select;
