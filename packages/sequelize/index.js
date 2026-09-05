const Sequelize = require('sequelize');

const { DataTypes } = Sequelize;

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
    const isUser = model.identity === user;
    const schema = model.schema;

    if (isUser) {
      this.overload(schema, model, user);
    }

    const instance = this.connector.define(
      model.globalId,
      schema,
      model.options || {}
    );

    if (isUser) {
      const encrypt = async (record) => {
        record.password = await this.henri.user.encrypt(record.password);
      };

      instance.beforeCreate(encrypt);
      instance.beforeUpdate(async (record) => {
        if (record.changed('password')) {
          await encrypt(record);
        }
      });

      instance.prototype.hasRole = async function (roles = []) {
        const given = Array.isArray(roles) ? roles : [roles];
        const owned = this.roles || [];

        return given.every((element) => owned.includes(element));
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
   * @returns {object} The schema
   * @memberof Sql
   */
  overload(schema, model) {
    const { pen, config } = this.henri;

    pen.info(
      'sequelize',
      `Found a user model (${model.globalId}), overloading it.`
    );

    schema.email = { allowNull: false, type: DataTypes.STRING };
    schema.password = { allowNull: false, type: DataTypes.STRING };

    const baseRole = config.has('baseRole') ? [config.get('baseRole')] : [];

    if (baseRole.length > 0) {
      pen.info('sequelize', 'basic user role', baseRole);
    } else {
      pen.warn('sequelize', 'no basic user role. are you sure?');
    }

    // Roles are stored as a JSON string so the same definition works on
    // every dialect (mysql, postgresql, mssql, sqlite)
    schema.roles = {
      defaultValue: JSON.stringify(baseRole.flat()),
      /**
       * Getter for the roles
       *
       * @returns {Array<string>} The roles
       */
      get() {
        const raw = this.getDataValue('roles');

        if (Array.isArray(raw)) {
          return raw;
        }

        try {
          return raw ? JSON.parse(raw) : [];
        } catch (error) {
          return [];
        }
      },
      /**
       * Roles setter
       *
       * @param {(string|Array<string>)} val A role or a list of roles
       * @returns {void}
       */
      set(val) {
        const list = Array.isArray(val) ? val : [val];

        this.setDataValue('roles', JSON.stringify(list.flat()));
      },
      type: DataTypes.TEXT,
    };

    return schema;
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
   * @param {function} session express-session module (or its Store class)
   * @returns {object} a store
   * @memberof Sql
   */
  getSessionConnector(session) {
    const Store = session.Store || session;
    // eslint-disable-next-line global-require
    const SequelizeStore = require('connect-session-sequelize')(Store);

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
    await this.connector.authenticate();
    await this.connector.sync();
  }

  /**
   * Stops the store
   *
   * @returns {Promise} Success or not?
   * @memberof Sql
   */
  async stop() {
    await this.connector.close();
  }
}

module.exports = Sql;
