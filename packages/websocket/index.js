const { config, log, syntax } = henri;
const glob = require('glob');
const path = require('path');

class Websocket {
  constructor(server = null) {
    this.server = server;
    this.socket = null;
    this.active = false;
    this.files = [];
    this.failed = [];
  }

  async load(location) {
    return new Promise((resolve, reject) => {
      glob(`${path.resolve(location)}/**/*.js`, (err, files) => {
        if (err) {
          log.error('unable to parse websocket directory');
          return resolve([]);
        }
        let results = files.map(async file => {
          try {
            await syntax(file);
            // it will be executed
            const mod = require(file);
            // if we have a module.exports, we inject websocket ninja style
            if (typeof mod === 'function') {
              mod(this.socket);
            }
            return file;
          } catch (e) {
            this.failed.push(file);
            // silently fail...
            // syntax is dealt with by the upper call and will throw
          }
        });
        Promise.all(results).then(good =>
          resolve(good.filter(d => typeof d !== 'undefined'))
        );
      });
    });
  }

  async init() {
    const io = require('socket.io')(this.server);
    io.on('connection', async socket => {
      this.socket = socket;
      henri.websocket = socket;
      await this.load(
        config.has('location.websocket')
          ? path.resolve(config.get('location.websocket'))
          : './app/websocket'
      );
    });
  }

  async reload() {
    await this.stop();
    await this.init();
    this.active && log.warn('websockets reloaded');
  }
}

module.exports = Websocket;
