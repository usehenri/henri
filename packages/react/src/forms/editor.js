import React, { Component } from 'react';
import PropTypes from 'prop-types';

class FormHtmlEditor extends Component {
  constructor(props) {
    super(props);
    if (typeof window !== 'undefined') {
      this.ReactQuill = require('react-quill');
    }
  }

  render() {
    const { validation = {}, sanitation = {}, name } = this.props;
    const ReactQuill = this.ReactQuill;
    if (typeof window !== 'undefined' && ReactQuill) {
      return (
        <ReactQuill
          onChange={value =>
            this.context.handleChange(
              { target: { name, value } },
              validation,
              sanitation
            )
          }
          defaultValue={this.context.data[name] || ''}
          theme="snow"
          {...this.props}
        />
      );
    } else {
      return <textarea />;
    }
  }
}

FormHtmlEditor.propTypes = {
  name: PropTypes.string.isRequired,
  type: PropTypes.string,
  required: PropTypes.bool,
  placeholder: PropTypes.string,
  validation: PropTypes.object,
  errorMsg: PropTypes.object,
  sanitation: PropTypes.object,
};

FormHtmlEditor.contextTypes = {
  data: PropTypes.object,
  errors: PropTypes.object,
  handleChange: PropTypes.func,
  handleSubmit: PropTypes.func,
  addSanitizer: PropTypes.func,
  _henriForm: PropTypes.bool,
};

export default FormHtmlEditor;
