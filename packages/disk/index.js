const Waterline = require('waterline');
const disk = require('sails-disk');

/**
 * Disk database adapter
 *
 * @class Disk
 */
class Disk {
  /**
   * Creates an instance of Disk.
   *
   * @param {string} name Store name
   * @param {any} config Store configuration
   * @param {Henri} thisHenri Current henri instance
   * @memberof Disk
   */
  constructor(name, config, thisHenri) {
    this.adapterName = 'disk';
    this.name = name;
    this.config = config;
    this.models = {};
    this.user = null;
    this.waterline = new Waterline();
    this.instance = null;
    this.sessionPath = '.tmp/nedb-sessions.db';
    this.henri = thisHenri;

    this.addModel = this.addModel.bind(this);
    this.overload = this.overload.bind(this);
    this.getModels = this.getModels.bind(this);
    this.getSessionConnector = this.getSessionConnector.bind(this);
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
  }

  /**
   * Add a model to the store
   *
   * @param {object} model The model object
   * @param {string} user The user object name
   * @returns {object} The model instance (initialized)
   * @memberof Disk
   */
  addModel(model, user) {
    let obj = Object.assign({}, model);
    let isUser = false;

    if (obj.identity === user) {
      obj = this.overload(obj, user);
      this.user = obj.globalId;
      isUser = true;
    }

    obj.schema._id = {
      autoMigrations: { autoIncrement: true },
      type: 'number',
    };
    obj.primaryKey = '_id';

    obj.attributes = model.schema;
    obj.datastore = this.name;

    delete obj.schema;
    delete obj.graphql;

    const instance = Waterline.Model.extend(obj);

    this.waterline.registerModel(instance);
    if (isUser) {
      this.user = obj.globalId;
    }
    this.models[obj.globalId] = instance;

    return this.models[obj.globalId];
  }

  /**
   * Overload the user entity
   *
   * @param {any} model Current model
   * @returns {object} the model
   * @memberof Disk
   */
  overload(model) {
    this.henri.pen.info('disk', `user model`, model.globalId, `overloading...`);

    model.schema.email = { required: true, type: 'string' };
    model.schema.password = { required: true, type: 'string' };

    model.beforeCreate = async (values, cb) => {
      values.password = await this.henri.user.encrypt(values.password);
      cb();
    };
    model.beforeUpdate = async (values, cb) => {
      if (values.hasOwnProperty('password')) {
        values.password = await this.henri.user.encrypt(values.password);
      }
      cb();
    };
    model.hasRole = async function(roles = []) {
      let given = Array.isArray(roles) ? roles : [roles];

      return given.every(element => this.roles.includes(element));
    };

    return model;
  }

  /**
   * Returns the models of this store
   *
   * @returns {object} the models
   * @memberof Disk
   */
  getModels() {
    return this.models || {};
  }

  /**
   * Returns the session connector (for connect styles session storage)
   *
   * @param {function} session session-store function
   * @returns {object} a store
   * @memberof Disk
   */
  getSessionConnector(session) {
    // eslint-disable-next-line global-require
    const NedbStore = require('nedb-session-store')(session);

    return new NedbStore({
      filename: this.sessionPath,
    });
  }

  /**
   * Start the store
   *
   * @returns {Promise} Resolves or not
   * @memberof Disk
   */
  async start() {
    return new Promise(resolve => {
      var config = {
        adapters: {
          disk: disk,
        },

        datastores: {
          [this.name]: {
            adapter: 'disk',
          },
        },
      };

      this.waterline.initialize(config, (err, orm) => {
        if (err) {
          throw err;
        }
        this.instance = orm;
        for (let name in this.models) {
          if (typeof this.models[name] !== 'undefined') {
            if (name === this.user) {
              this.henri._user = orm.collections[name.toLowerCase()];
            }
            global[name] = orm.collections[name.toLowerCase()];
          }
        }
        resolve();
      });
    });
  }

  /**
   * Stops the store
   *
   * @returns {Promise} Success or not?
   * @memberof Disk
   */
  async stop() {
    return new Promise(resolve => {
      this.waterline.teardown(err => {
        if (err) {
          this.henri.pen.error(
            'disk',
            'something went wrong while stopping the orm',
            err
          );

          return resolve(err);
        }
        setTimeout(() => resolve(), 250);
      });
    });
  }
}

module.exports = Disk;
