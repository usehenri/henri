import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Validation from './validation';
import shallowEqual from 'shallowequal';
import { Object } from 'core-js';
const _Set = require('lodash.set');

class Form extends Component {
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
  }

  static displayName = 'henri(Form)';

  componentWillReceiveProps(nextProps) {
    if (nextProps.error) {
      this.setState({ error: nextProps.error });
      this.lock(1000);
    }
    if (nextProps.data) {
      this.setState({ data: nextProps.data });
    }
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
      _Set(data, name, value);

      const newData = Object.assign({}, data);

      return {
        data: newData,
        modified: true,
      };
    });
  };

  handleSubmit = event => {
    event.preventDefault();
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
      handleSubmit && handleSubmit(action, data, this.clear);

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
    const { hydrate = null, fetch } = this.context;

    fetch({ method, route: action }, data)
      .then(resp => {
        this.setState({ error: null });
        hydrate && hydrate();
        typeof onSuccess === 'function' && onSuccess(data);
        // eslint-disable-next-line no-console
        debug && console.log('form post successful!');
        this.clear();
      })
      .catch(err => {
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
    this.setState({ data: Object.assign({}) });
  };

  lock = (time = 750) => {
    this.setState({ disabled: true });
    setInterval(() => this.setState({ disabled: false }), time);
  };

  raiseError = (name, msg) => {
    this.setState({ [name]: msg });
    // TODO: not fired... hmm
    // SetTimeout(() => this.setState({ [name]: null }), 2500);
  };

  componentDidMount = () => {
    this.state.modified && this.setState({ modified: false });
  };

  componentDidUpdate = (prevProps, prevState) => {
    if (!shallowEqual(prevState.data, this.state.data)) {
      this.setState({ modified: true });
    }
  };

  getChildContext() {
    return {
      // Warn if not within form
      _henriForm: true,
      // Add a sanitizer for validation
      addSanitizer: this.addSanitizer,
      // Reset the form
      clear: this.clear,
      // Contains the data passed down. Key should match names
      data: this.state.data,
      // Is it disabled?
      disabled: this.state.disabled,
      // Global form error
      error: this.state.error,
      // Per components error
      errors: this.state.errors,
      // Send back the changes so we can update the state
      handleChange: this.handleChange,
      // If a component wants to trigger a submit
      handleSubmit: this.handleSubmit,
      // Is the form modified?
      modified: this.state.modified,
    };
  }

  render() {
    return (
      <form
        className={this.props.className}
        onSubmit={this.handleSubmit}
        id={this.name}
      >
        {this.props.children}
      </form>
    );
  }
}

Form.propTypes = {
  action: PropTypes.string,
  className: PropTypes.string,
  data: PropTypes.object,
  debug: PropTypes.bool,
  method: PropTypes.string,
  name: PropTypes.string,
  onError: PropTypes.func,
  onFail: PropTypes.string,
  onSuccess: PropTypes.func,
};

Form.childContextTypes = {
  _henriForm: PropTypes.bool,
  addSanitizer: PropTypes.func,
  clear: PropTypes.func,
  data: PropTypes.object,
  disabled: PropTypes.bool,
  error: PropTypes.any,
  errors: PropTypes.object,
  handleChange: PropTypes.func,
  handleSubmit: PropTypes.func,
  modified: PropTypes.bool,
};

Form.contextTypes = {
  fetch: PropTypes.func,
  hydrate: PropTypes.func,
};

export default Form;
