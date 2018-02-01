const mongoose = require('mongoose');
const { config, log } = henri;

if (global.Promise) {
  mongoose.Promise = global.Promise;
}

class Mongoose {
  constructor(name, config) {
    if (!config.url && !config.host) {
      log.fatalError(`Missing url or host in store ${name}`);
    }
    this.name = name;
    this.config = config;
    this.models = {};
    this.mongoose = mongoose;
  }

  addModel(model, user) {
    let isUser = false;

    const schema = new this.mongoose.Schema(model.schema, model.options || {});

    if (model.identity === user) {
      this.overload(schema, model, user);
      isUser = true;
    }

    const instance = this.mongoose.model(model.globalId, schema);

    if (isUser) {
      henri._user = instance;
    }

    this.models[model.globalId] = instance;
    return this.models[model.globalId];
  }

  overload(schema, model, user) {
    log.info(`Found a user model (${model.globalId}), overloading it.`);
    schema.add({ email: { type: String, required: true } });
    schema.add({ password: { type: String, required: true } });
    const baseRole = (config.has('baseRole') && [config.get('baseRole')]) || [];
    schema.add({ roles: { type: Array, default: baseRole } });
    schema.pre('save', async function(next) {
      if (!this.isModified('password')) return next();
      this.password = await user.encrypt(this.password);
      next();
    });
    schema.methods.hasRole = async function(roles = []) {
      let given = Array.isArray(roles) ? roles : [roles];
      return given.every(element => this.roles.includes(element));
    };
  }

  getModels() {
    return this.mongoose.models || {};
  }

  async start() {
    return new Promise((resolve, reject) => {
      mongoose
        .connect(this.config.url || this.config.host)
        .then(() => resolve(), err => reject(err));
    });
  }

  async stop() {
    return new Promise((resolve, reject) => {
      mongoose.disconnect().then(() => resolve(), err => reject(err));
    });
  }
}

module.exports = Mongoose;
