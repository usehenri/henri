const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

/**
 * Websocket loader
 *
 * Attaches socket.io to the henri http server and, on every connection,
 * loads the handlers found in ./app/websocket (or config `location.websocket`).
 * A handler file exports a function receiving the socket.
 *
 * @class Websocket
 */
class Websocket {
  /**
   * Creates an instance of Websocket.
   *
   * @param {object} thisHenri The henri instance
   * @param {import('http').Server} [server=null] The http server to attach to
   * @memberof Websocket
   */
  constructor(thisHenri, server = null) {
    if (!thisHenri) {
      throw new Error('websocket: a henri instance is required');
    }

    this.henri = thisHenri;
    this.server = server;
    this.io = null;
    this.socket = null;
    this.active = false;
    this.files = [];
    this.failed = [];

    this.init = this.init.bind(this);
    this.load = this.load.bind(this);
    this.reload = this.reload.bind(this);
    this.stop = this.stop.bind(this);
  }

  /**
   * Directory holding the websocket handlers
   *
   * @returns {string} Absolute path
   * @memberof Websocket
   */
  location() {
    const { config } = this.henri;

    return path.resolve(
      config && config.has('location.websocket')
        ? config.get('location.websocket')
        : './app/websocket'
    );
  }

  /**
   * Loads every handler in a directory and hands it the active socket
   *
   * @param {string} location Directory to scan
   * @returns {Promise<Array<string>>} Files that loaded successfully
   * @memberof Websocket
   */
  async load(location) {
    const { pen, utils } = this.henri;

    this.files = [];
    this.failed = [];

    let entries;

    try {
      entries = fs
        .readdirSync(location, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
        .map((entry) => path.join(entry.parentPath || entry.path, entry.name));
    } catch {
      pen && pen.warn('websocket', 'unable to read', location);

      return [];
    }

    for (const file of entries) {
      try {
        if (utils && typeof utils.syntax === 'function') {
          await utils.syntax(file, undefined, this.henri);
        }

        const mod = require(file);

        if (typeof mod === 'function') {
          mod(this.socket, this.henri);
        }
        this.files.push(file);
      } catch (error) {
        this.failed.push(file);
        pen && pen.error('websocket', 'failed to load', file, error.message);
      }
    }

    return this.files;
  }

  /**
   * Attaches socket.io to the http server
   *
   * @returns {import('socket.io').Server} The socket.io server
   * @memberof Websocket
   */
  init() {
    if (!this.server) {
      throw new Error('websocket: no http server to attach to');
    }

    this.io = new Server(this.server);
    this.active = true;

    this.io.on('connection', async (socket) => {
      this.socket = socket;
      this.henri.websocket = socket;
      await this.load(this.location());
    });

    return this.io;
  }

  /**
   * Stops the socket.io server
   *
   * @returns {Promise<void>} Resolves when closed
   * @memberof Websocket
   */
  async stop() {
    if (this.io) {
      await new Promise((resolve) => this.io.close(() => resolve()));
      this.io = null;
    }
    this.active = false;
  }

  /**
   * Reloads the socket.io server
   *
   * @returns {Promise<void>} Resolves when reloaded
   * @memberof Websocket
   */
  async reload() {
    await this.stop();
    this.init();
    this.henri.pen && this.henri.pen.warn('websocket', 'reloaded');
  }
}

module.exports = Websocket;
