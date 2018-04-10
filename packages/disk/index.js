const Waterline = require('waterline');
const disk = require('sails-disk');

const { pen } = henri;

class Disk {
  constructor(name, config) {
    this.adapterName = 'disk';
    this.name = name;
    this.config = config;
    this.models = {};
    this.user = null;
    this.waterline = new Waterline();
    this.instance = null;
  }

  addModel(model, user) {
    let obj = Object.assign({}, model);
    if (obj.identity === user) {
      obj = this.overload(obj, user);
      this.user = obj.globalId;
    }

    obj.schema._id = {
      type: 'number',
      autoMigrations: { autoIncrement: true },
    };
    obj.primaryKey = '_id';

    obj.attributes = model.schema;
    obj.datastore = this.name;

    delete obj.schema;
    delete obj.graphql;

    const instance = Waterline.Model.extend(obj);
    this.waterline.registerModel(instance);
    this.models[obj.globalId] = instance;
    return this.models[obj.globalId];
  }

  overload(model, user) {
    pen.info('disk', `user model`, model.globalId, `overloading...`);

    model.schema.email = { type: 'string', required: true };
    model.schema.password = { type: 'string', required: true };

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
    const NedbStore = require('nedb-session-store')(session);

    return new NedbStore({
      filename: '.tmp/nedb-sessions.db',
    });
  }

  async start() {
    return new Promise((resolve, reject) => {
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
          pen.fatal('disk', err);
        }
        this.instance = orm;
        for (let name in this.models) {
          global[name] = orm.collections[name.toLowerCase()];
        }
        resolve();
      });
    });
  }

  async stop() {
    return new Promise((resolve, reject) => {
      this.waterline.teardown(err => {
        if (err) {
          pen.error('disk', 'something went wrong while stopping the orm', err);
          return resolve(err);
        }
        setTimeout(() => resolve(), 250);
      });
    });
  }
}

module.exports = Disk;
