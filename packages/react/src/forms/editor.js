import React, { useEffect } from 'react';
import dynamic from 'next/dynamic';
import get from 'lodash/get';
import { useForm } from './context';
import { messageFor } from './input';
import { warnOutsideForm } from './warn';

/**
 * Quill needs a DOM: the editor is loaded in the browser only and the server
 * (and the first client render) show a plain textarea in its place, so the
 * markup hydrates without a mismatch.
 */
const ReactQuill = dynamic(() => import('react-quill-new'), {
  loading: () => (
    <textarea className="henri-editor-loading" readOnly value="" />
  ),
  ssr: false,
});

/**
 * Rich text editor (quill), controlled by the form data.
 * Import 'react-quill-new/dist/quill.snow.css' in your page for the styles.
 *
 * @param {object} props props
 * @returns {React.Element} the editor
 */
const Editor = ({
  baseClassName = 'form-group',
  errorClassName = 'help-block m-b-none',
  errorMsg = {},
  name,
  placeholder,
  sanitation = {},
  theme = 'snow',
  validation = {},
  ...props
}) => {
  const context = useForm();
  const hasError = Boolean(context.errors[name]);

  warnOutsideForm(context, 'Editor');

  useEffect(
    () => context.addSanitizer(name, sanitation),
    [name, context.addSanitizer, JSON.stringify(sanitation)]
  );

  return (
    <div className={`${baseClassName} ${hasError ? 'has-error' : ''}`}>
      <ReactQuill
        theme={theme}
        placeholder={placeholder}
        readOnly={context.disabled}
        value={get(context.data, name) ?? ''}
        onChange={(value) =>
          context.handleChange({ target: { name, value } }, validation)
        }
        {...props}
      />
      {hasError && (
        <span className={errorClassName}>
          {messageFor(errorMsg, context.errors[name])}
        </span>
      )}
    </div>
  );
};

export default Editor;
