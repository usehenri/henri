const Waterline = require('waterline');
const disk = require('sails-disk');

class Disk {
  constructor(name, config, henri) {
    this.adapterName = 'disk';
    this.name = name;
    this.config = config;
    this.models = {};
    this.user = null;
    this.waterline = new Waterline();
    this.instance = null;
    this.henri = henri;
  }

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
      henri._user = instance;
    }
    this.models[obj.globalId] = instance;

    return this.models[obj.globalId];
  }

  overload(model, user) {
    this.pen.info('disk', `user model`, model.globalId, `overloading...`);

    model.schema.email = { required: true, type: 'string' };
    model.schema.password = { required: true, type: 'string' };

    model.beforeCreate = async (values, cb) => {
      values.password = await user.encrypt(values.password);
      cb();
    };
    model.beforeUpdate = async (values, cb) => {
      if (values.hasOwnProperty('password')) {
        values.password = await user.encrypt(values.password);
      }
      cb();
    };
    model.hasRole = async function(roles = []) {
      let given = Array.isArray(roles) ? roles : [roles];

      return given.every(element => this.roles.includes(element));
    };
  }

  getModels() {
    return this.models || {};
  }

  getSessionConnector(session) {
    // eslint-disable-next-line global-require
    const NedbStore = require('nedb-session-store')(session);

    return new NedbStore({
      filename: '.tmp/nedb-sessions.db',
    });
  }

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
          this.henri.pen.fatal('disk', err);
        }
        this.instance = orm;
        for (let name in this.models) {
          if (typeof this.models[name] !== 'undefined') {
            global[name] = orm.collections[name.toLowerCase()];
          }
        }
        resolve();
      });
    });
  }

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
