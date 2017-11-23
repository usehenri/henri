import React from 'react';
import PropTypes from 'prop-types';

const Select = (
  {
    disabled = false,
    className = null,
    errorClassName = null,
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
    console.warn('Select component used outside henri form.');
  const hasError = !!context.errors[name];
  context.addSanitizer(name, sanitation);
  return (
    <div className={`${hasError && 'has-error'}`}>
      <select
        className={className}
        name={name}
        value={context.data[name] || ''}
        onChange={e => context.handleChange(e)}
      >
        {choices.map(item => (
          <option key={item._id} value={item._id}>
            {item.name}
          </option>
        ))}
      </select>
    </div>
  );
};

Select.propTypes = {
  name: PropTypes.string.isRequired,
  type: PropTypes.string,
  required: PropTypes.bool,
  placeholder: PropTypes.string,
  validation: PropTypes.object,
  errorMsg: PropTypes.object,
  sanitation: PropTypes.object,
};

Select.contextTypes = {
  data: PropTypes.object,
  errors: PropTypes.object,
  handleChange: PropTypes.func,
  handleSubmit: PropTypes.func,
  addSanitizer: PropTypes.func,
  _henriForm: PropTypes.bool,
};

export default Select;
