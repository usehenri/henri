import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Validation from './validation';
import axios from 'axios';

class Form extends Component {
  constructor(props) {
    super(props);
    this.state = {
      data: this.props.data || {},
      errors: {},
      error: null,
      disabled: false,
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

  handleChange = (e, validation = {}) => {
    const target = e.target;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    const name = target.name;

    this.setState(({ errors }) => ({
      errors: {
        ...errors,
        [name]: null,
      },
      error: null,
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

    this.setState(({ data }) => ({
      data: {
        ...data,
        [name]: value,
      },
    }));
  };

  handleSubmit = e => {
    e.preventDefault();
    if (this.state.disabled) {
      return;
    }
    const { action = null, debug = false, handleSubmit = null } = this.props;
    let data = {};
    for (let key in this.state.data) {
      data[key] = this.state.data[key];
      for (let rule in this.sanitizers[key]) {
        data[key] = Validation(
          rule,
          this.sanitizers[key][rule],
          this.state.data[key]
        );
      }
    }

    if (handleSubmit && action) {
      return console.error(
        'You have "action" and "handleSubmit" defined, i am puzzled'
      );
    }

    if (debug) {
      console.log('========= HENRI FORM DATA SUBMISSION =========');
      console.log(data);
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

    console.error('No handleSubmit() or action props supplied, i am off...');
  };

  submit = (action, data) => {
    const { debug = false, onSuccess = null, onFail = '' } = this.props;
    const { fetchData = null } = this.context;
    axios
      .post(action, data)
      .then(resp => {
        this.setState({ error: null });
        fetchData && fetchData();
        onSuccess && onSuccess(data);
        debug && console.log('form post successful!');
        this.clear();
      })
      .catch(err => {
        debug && console.log('form post error:');
        debug && console.dir(err);
        this.raiseError('error', err.response.data.msg || onFail || true);
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
    // setTimeout(() => this.setState({ [name]: null }), 2500);
  };

  getChildContext() {
    return {
      // Contains the data passed down. Key should match names
      data: this.state.data,
      // Is it disabled?
      disabled: this.state.disabled,
      // Per components error
      errors: this.state.errors,
      // Global form error
      error: this.state.error,
      // Send back the changes so we can update the state
      handleChange: this.handleChange,
      // If a component wants to trigger a submit
      handleSubmit: this.handleSubmit,
      // Add a sanitizer for validation
      addSanitizer: this.addSanitizer,
      // Warn if not within form
      _henriForm: true,
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
  data: PropTypes.object,
  className: PropTypes.string,
  name: PropTypes.string,
  debug: PropTypes.bool,
  action: PropTypes.string,
};

Form.childContextTypes = {
  data: PropTypes.object,
  disabled: PropTypes.bool,
  errors: PropTypes.object,
  error: PropTypes.any,
  handleChange: PropTypes.func,
  handleSubmit: PropTypes.func,
  addSanitizer: PropTypes.func,
  _henriForm: PropTypes.bool,
};

Form.contextTypes = {
  fetchData: PropTypes.func,
};

export default Form;
