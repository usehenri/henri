import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { FormContext } from './context';

/**
 * Rich text editor (quill). Rendered client-side only, as quill needs a DOM.
 * Import 'react-quill-new/dist/quill.snow.css' in your page for the styles.
 */
class FormHtmlEditor extends Component {
  static contextType = FormContext;

  constructor(props) {
    super(props);
    this.ReactQuill = null;
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line global-require
      const mod = require('react-quill-new');

      this.ReactQuill = mod.default || mod;
    }
  }

  render() {
    const { validation = {}, sanitation = {}, name, ...props } = this.props;
    const ReactQuill = this.ReactQuill;

    !this.context._henriForm &&
      // eslint-disable-next-line no-console
      console.warn('Editor component used outside henri form.');

    this.context.addSanitizer(name, sanitation);

    if (typeof window !== 'undefined' && ReactQuill) {
      return (
        <ReactQuill
          onChange={(value) =>
            this.context.handleChange(
              { target: { name, value } },
              validation,
              sanitation
            )
          }
          defaultValue={this.context.data[name] || ''}
          theme="snow"
          {...props}
        />
      );
    }

    return <textarea name={name} defaultValue={this.context.data[name] || ''} />;
  }
}

FormHtmlEditor.propTypes = {
  errorMsg: PropTypes.object,
  name: PropTypes.string.isRequired,
  placeholder: PropTypes.string,
  required: PropTypes.bool,
  sanitation: PropTypes.object,
  type: PropTypes.string,
  validation: PropTypes.object,
};

export default FormHtmlEditor;
