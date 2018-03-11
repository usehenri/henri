const Sequelize = require('sequelize');

const { config, log } = henri;

class Sql {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.models = {};
    this.Sequelize = Sequelize;
    this.connector = null;
  }

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
      instance.beforeCreate(async (user, options) => {
        user.password = await henri.user.encrypt(user.password);
      });
      instance.prototype.hasRole = async function(roles = []) {
        let given = Array.isArray(roles) ? roles : [roles];
        return given.every(element => this.roles.includes(element));
      };
      henri._user = instance;
    }

    this.models[model.globalId] = instance;
    return this.models[model.globalId];
  }

  overload(schema, model, user) {
    log.info(`Found a user model (${model.globalId}), overloading it.`);
    schema.email = { type: Sequelize.STRING, required: true };
    schema.password = { type: Sequelize.STRING, required: true };
    const baseRole = (config.has('baseRole') && [config.get('baseRole')]) || '';
    schema.roles = {
      type: 'string',
      defaultValue: baseRole,
      get: function() {
        return JSON.parse(this.getDataValue('roles'));
      },
      set: function(val) {
        return this.setDataValue('roles', JSON.stringify(val));
      },
    };
  }

  getModels() {
    return this.models || {};
  }

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
