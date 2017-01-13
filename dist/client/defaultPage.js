'use strict';

var _extends2 = require('babel-runtime/helpers/extends');

var _extends3 = _interopRequireDefault(_extends2);

var _getPrototypeOf = require('babel-runtime/core-js/object/get-prototype-of');

var _getPrototypeOf2 = _interopRequireDefault(_getPrototypeOf);

var _classCallCheck2 = require('babel-runtime/helpers/classCallCheck');

var _classCallCheck3 = _interopRequireDefault(_classCallCheck2);

var _createClass2 = require('babel-runtime/helpers/createClass');

var _createClass3 = _interopRequireDefault(_createClass2);

var _possibleConstructorReturn2 = require('babel-runtime/helpers/possibleConstructorReturn');

var _possibleConstructorReturn3 = _interopRequireDefault(_possibleConstructorReturn2);

var _inherits2 = require('babel-runtime/helpers/inherits');

var _inherits3 = _interopRequireDefault(_inherits2);

var _react = require('react');

var _react2 = _interopRequireDefault(_react);

var _client = require('feathers/client');

var _client2 = _interopRequireDefault(_client);

var _feathersHooks = require('feathers-hooks');

var _feathersHooks2 = _interopRequireDefault(_feathersHooks);

var _feathersAuthenticationClient = require('feathers-authentication-client');

var _feathersAuthenticationClient2 = _interopRequireDefault(_feathersAuthenticationClient);

var _client3 = require('feathers-rest/client');

var _client4 = _interopRequireDefault(_client3);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

require('es6-promise').polyfill(); /* global fetch */

require('isomorphic-fetch');

module.exports = function (Page) {
  return function (_React$Component) {
    (0, _inherits3.default)(_class, _React$Component);

    function _class(props) {
      (0, _classCallCheck3.default)(this, _class);

      var _this = (0, _possibleConstructorReturn3.default)(this, (_class.__proto__ || (0, _getPrototypeOf2.default)(_class)).call(this, props));

      _this.logout = _this.logout.bind(_this);
      _this.login = _this.login.bind(_this);
      _this.signup = _this.signup.bind(_this);
      _this.update = _this.update.bind(_this);

      _this.app = (0, _client2.default)().configure((0, _feathersHooks2.default)());

      var _props$_opts = props._opts,
          _opts = _props$_opts === undefined ? {} : _props$_opts;

      _this.app._opts = _opts;

      if (_opts.socketio && !_this.app.defaultService) {
        var io = require('socket.io-client');
        var socketio = require('feathers-socketio/client');
        var socket = io(_opts.socketio);
        _this.app.configure(socketio(socket));
      }

      if (_opts.rest && !_this.app.defaultService) {
        _this.app.configure((0, _client4.default)(_opts.rest).fetch(fetch));
      }

      if (process.browser && _opts.auth) {
        _this.app.configure((0, _feathersAuthenticationClient2.default)({
          storage: window.localStorage
        }));
      }

      _this.state = {
        authenticated: _this.props.authenticated,
        user: _this.props.user,
        connected: false
      };
      return _this;
    }

    (0, _createClass3.default)(_class, [{
      key: 'componentDidMount',
      value: function componentDidMount() {
        console.log('opts', this.app._opts);
        this.update();
      }
    }, {
      key: 'logout',
      value: function logout(ev) {
        ev.preventDefault();
        this.setState({ authenticated: false, user: null });
        return this.app.logout();
      }
    }, {
      key: 'login',
      value: function login(_ref) {
        var _this2 = this;

        var email = _ref.email,
            password = _ref.password;

        // eslint-disable-next-line no-undef
        console.log('this.app.defaultService');
        return fetch('/authentication', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
          body: 'strategy=local&email=' + encodeURIComponent(email) + '&password=' + encodeURIComponent(password)
        }).then(function (response) {
          if (response.status >= 400) {
            throw new Error('Unauthorized');
          }
          return response.json();
        }).then(function (body) {
          _this2.update(body.accessToken);
          return body.accessToken;
        });
      }
    }, {
      key: 'signup',
      value: function signup() {
        var _this3 = this;

        var opts = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

        if (!opts.email || !opts.password) {
          throw new Error('Missing email or password');
        }
        return this.app.service('users').create(opts).then(function (result) {
          var email = opts.email,
              password = opts.password;

          _this3.login({ email: email, password: password }).then(function (token) {
            return token;
          }).catch(function (err) {
            return err;
          });
        }).catch(function (err) {
          return err;
        });
      }
    }, {
      key: 'update',
      value: function update(token) {
        var _this4 = this;

        var opts = token ? { strategy: 'jwt', accessToken: token } : {};
        return this.app.authenticate(opts).then(function (result) {
          _this4.setState({ authenticated: true, user: _this4.app.get('user') });
        }).catch(function (err) {
          if (err) {
            _this4.setState({ authenticated: false, user: null });
          }
        });
      }
    }, {
      key: 'render',
      value: function render() {
        return _react2.default.createElement(Page, (0, _extends3.default)({}, this.props, {
          app: this.app,
          login: this.login,
          logout: this.logout,
          signup: this.signup,
          update: this.update,
          authenticated: this.state.authenticated,
          user: this.state.user,
          token: this.state.token
        }));
      }
    }], [{
      key: 'getInitialProps',
      value: function getInitialProps(_ref2) {
        var req = _ref2.req,
            res = _ref2.res,
            pathname = _ref2.pathname,
            query = _ref2.query,
            err = _ref2.err,
            xhr = _ref2.xhr;

        if (typeof Page.getInitialProps === 'function') {
          Page.getInitialProps();
        }
        return { authenticated: req.authenticated, user: req.user, _opts: req._opts };
      }
    }]);
    return _class;
  }(_react2.default.Component);
};