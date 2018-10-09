const Sequelize = require('sequelize');

/**
 * Sequelize database adapter
 *
 * @class Sql
 */
class Sql {
  /**
   * Creates an instance of Sequelize.
   * @param {string} name Store name
   * @param {any} config Store configuration
   * @param {Henri} thisHenri Current henri instance
   * @memberof Sql
   */
  constructor(name, config, thisHenri) {
    this.name = name;
    this.config = config;
    this.models = {};
    this.Sequelize = Sequelize;
    this.connector = null;
    this.henri = thisHenri;
  }

  /**
   * Add a model to the store
   *
   * @param {object} model The model object
   * @param {string} user The user object name
   * @returns {object} The model instance (initialized)
   * @memberof Sql
   */
  addModel(model, user) {
    let isUser = false;
    const schema = model.schema;

    if (model.identity === user) {
      this.overload(schema, model, user);
      isUser = true;
      isUser = true;
    }

    const instance = this.connector.define(
      model.globalId,
      model.schema,
      model.options || {}
    );

    if (isUser) {
      instance.beforeCreate(async user => {
        user.password = await this.henri.user.encrypt(user.password);
      });
      instance.prototype.hasRole = async function(roles = []) {
        let given = Array.isArray(roles) ? roles : [roles];

        return given.every(element => this.roles.includes(element));
      };
      this.henri._user = instance;
    }

    this.models[model.globalId] = instance;

    return this.models[model.globalId];
  }

  /**
   * Overload the user entity
   *
   * @param {any} schema The schema
   * @param {any} model  The model
   * @returns {object} The model
   * @memberof Sql
   */
  overload(schema, model) {
    const { pen, config } = this.henri;

    pen.info(
      'sequelize',
      `Found a user model (${model.globalId}), overloading it.`
    );
    schema.email = { required: true, type: Sequelize.STRING };
    schema.password = { required: true, type: Sequelize.STRING };

    const baseRole = (config.has('baseRole') && [config.get('baseRole')]) || '';

    if (baseRole.length > 0) {
      pen.info('mongoose', 'basic user role', baseRole);
    } else {
      pen.warn('mongoose', 'no basic user role. are you sure?');
    }

    schema.roles = {
      defaultValue: baseRole,
      /**
       * Getter for the roles
       *
       * @returns {object} The values
       */
      get: function() {
        return JSON.parse(this.getDataValue('roles'));
      },
      /**
       * Roles setter
       *
       * @param {string} val A role
       * @returns {Boolean} True or not?
       */
      set: function(val) {
        return this.setDataValue('roles', JSON.stringify(val));
      },
      type: 'string',
    };
  }

  /**
   * Returns the models of this store
   *
   * @returns {object} the models
   * @memberof Sql
   */
  getModels() {
    return this.models || {};
  }

  /**
   * Returns the session connector (for connect styles session storage)
   *
   * @param {function} session session-store function
   * @returns {object} a store
   * @memberof Sql
   */
  getSessionConnector(session) {
    // eslint-disable-next-line global-require
    const SequelizeStore = require('connect-session-sequelize')(session);

    return new SequelizeStore({
      db: this.connector,
    });
  }

  /**
   * Starts the store
   *
   * @returns {Promise} Resolves or not
   * @memberof Sql
   */
  async start() {
    return new Promise((resolve, reject) => {
      this.connector
        .authenticate()
        .then(() => {
          this.connector.sync();
          resolve();
        })
        .catch(err => reject(err));
    });
  }

  /**
   * Stops the store
   *
   * @returns {Promise} Success or not?
   * @memberof Sql
   */
  async stop() {
    return new Promise((resolve, reject) => {
      this.connector
        .close()
        .then(() => {
          resolve();
        })
        .catch(err => reject(err));
    });
  }
}

module.exports = Sql;
