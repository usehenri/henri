import React, { Component } from 'react';
import PropTypes from 'prop-types';
import shallowEqual from 'shallowequal';
import Validation from './validation';
import { FormContext } from './context';
import { HenriContext } from '../withHenri';
const _Set = require('lodash/set');

class Form extends Component {
  static displayName = 'henri(Form)';

  static contextType = HenriContext;

  constructor(props) {
    super(props);
    this.state = {
      data: this.props.data || {},
      disabled: false,
      error: null,
      errors: {},
      modified: false,
    };
    this.name = this.props.name;
    this.sanitizers = {};
    this.timer = null;
  }

  componentDidMount() {
    this.state.modified && this.setState({ modified: false });
  }

  componentDidUpdate(prevProps, prevState) {
    if (this.props.error && this.props.error !== prevProps.error) {
      this.setState({ error: this.props.error });
      this.lock(1000);
    }

    if (this.props.data && this.props.data !== prevProps.data) {
      this.setState({ data: this.props.data });
    }

    if (
      !shallowEqual(prevState.data, this.state.data) &&
      !this.state.modified
    ) {
      this.setState({ modified: true });
    }
  }

  componentWillUnmount() {
    clearTimeout(this.timer);
  }

  addSanitizer = (name, sanitizers = {}) => {
    this.sanitizers[name] = sanitizers;
  };

  handleChange = (event, validation = {}) => {
    const target = event.target;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    const name = target.name;

    this.setState(({ errors }) => ({
      error: null,
      errors: {
        ...errors,
        [name]: null,
      },
    }));

    if (value !== '') {
      for (let rule in validation) {
        if (Validation(rule, validation[rule], value) === false) {
          this.setState(({ errors }) => ({
            errors: {
              ...errors,
              [name]: rule,
            },
          }));
        }
      }
    }

    this.setState(({ data }) => {
      const newData = Object.assign({}, data);

      _Set(newData, name, value);

      return {
        data: newData,
        modified: true,
      };
    });
  };

  handleSubmit = (event) => {
    event && event.preventDefault && event.preventDefault();
    if (this.state.disabled) {
      return;
    }
    const { action = null, debug = false, handleSubmit = null } = this.props;
    let data = {};

    for (let key in this.state.data) {
      if (Object.prototype.hasOwnProperty.call(this.state.data, key)) {
        data[key] = this.state.data[key];
        for (let rule in this.sanitizers[key]) {
          if (
            Object.prototype.hasOwnProperty.call(this.sanitizers[key], rule)
          ) {
            data[key] = Validation(
              rule,
              this.sanitizers[key][rule],
              this.state.data[key]
            );
          }
        }
      }
    }

    if (handleSubmit && action) {
      // eslint-disable-next-line no-console
      return console.error(
        'You have "action" and "handleSubmit" defined, i am puzzled'
      );
    }

    if (debug) {
      // eslint-disable-next-line no-console
      console.log('========= HENRI FORM DATA SUBMISSION =========');
      // eslint-disable-next-line no-console
      console.log(data);
      // eslint-disable-next-line no-console
      console.log('+++++++++ HENRI FORM END SUBMISSION ++++++++++');
    }

    if (handleSubmit) {
      handleSubmit(action, data, this.clear);

      return this.lock();
    }

    if (action) {
      this.submit(action, data);

      return this.lock();
    }

    // eslint-disable-next-line no-console
    console.error('No handleSubmit() or action props supplied, i am off...');
  };

  submit = (action, data) => {
    const {
      debug = false,
      onSuccess = null,
      onError = null,
      onFail = '',
      method = 'post',
    } = this.props;
    const { hydrate = null, fetch } = this.context || {};

    if (typeof fetch !== 'function') {
      // eslint-disable-next-line no-console
      return console.error(
        'Form used outside a page wrapped with withHenri(): unable to submit'
      );
    }

    fetch({ method, route: action }, data)
      .then(() => {
        this.setState({ error: null });
        hydrate && hydrate();
        typeof onSuccess === 'function' && onSuccess(data);
        // eslint-disable-next-line no-console
        debug && console.log('form post successful!');
        this.clear();
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        debug && console.log('form post error:');
        // eslint-disable-next-line no-console
        debug && console.dir(err);
        const message =
          (err.response && err.response.data && err.response.data.msg) ||
          onFail ||
          true;

        typeof onError === 'function' && onError(message);
        this.raiseError('error', message);
      });
  };

  clear = () => {
    this.setState({ data: {} });
  };

  lock = (time = 750) => {
    this.setState({ disabled: true });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.setState({ disabled: false }), time);
  };

  raiseError = (name, msg) => {
    this.setState({ [name]: msg });
  };

  render() {
    const value = {
      _henriForm: true,
      addSanitizer: this.addSanitizer,
      clear: this.clear,
      data: this.state.data,
      disabled: this.state.disabled,
      error: this.state.error,
      errors: this.state.errors,
      handleChange: this.handleChange,
      handleSubmit: this.handleSubmit,
      modified: this.state.modified,
    };

    return (
      <FormContext.Provider value={value}>
        <form
          className={this.props.className}
          onSubmit={this.handleSubmit}
          id={this.name}
        >
          {this.props.children}
        </form>
      </FormContext.Provider>
    );
  }
}

Form.propTypes = {
  action: PropTypes.string,
  children: PropTypes.node,
  className: PropTypes.string,
  data: PropTypes.object,
  debug: PropTypes.bool,
  error: PropTypes.any,
  handleSubmit: PropTypes.func,
  method: PropTypes.string,
  name: PropTypes.string,
  onError: PropTypes.func,
  onFail: PropTypes.string,
  onSuccess: PropTypes.func,
};

export default Form;
