const mongoose = require('mongoose');
const { log, user } = henri;

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

  addModel(model) {
    const schema = new this.mongoose.Schema(model.schema, model.options || {});
    if (model.identity === 'user' || model.identity === 'users') {
      log.info('Found a user model, overloading it.');
      schema.add({ email: { type: String, required: true } });
      schema.add({ password: { type: String, required: true } });
      schema.pre('save', async function(next) {
        if (!this.isModified('password')) return next();
        this.password = await user.encrypt(this.password);
        next();
      });
    }
    const instance = this.mongoose.model(model.globalId, schema);
    this.models[model.globalId] = instance;
    return this.models[model.globalId];
  }

  getModels() {
    return this.mongoose.models || {};
  }

  async start() {
    return new Promise((resolve, reject) => {
      mongoose
        .connect(this.config.url || this.config.host, { useMongoClient: true })
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
