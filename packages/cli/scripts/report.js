/**
 * What a generator or a destroyer did, printed line by line as it goes
 * (`> created model "Post.js" @ app/models/Post.js`) or as one JSON summary
 * at the end with --json.
 *
 * @class Report
 */
class Report {
  /**
   * @param {object} [options] Options
   * @param {string} [options.command] generate or destroy
   * @param {boolean} [options.json=false] Collect silently, print JSON at the end
   */
  constructor({ command = 'generate', json = false } = {}) {
    this.command = command;
    this.json = json;
    this.target = null;
    this.name = null;
    this.backup = null;
    this.created = [];
    this.updated = [];
    this.skipped = [];
    this.removed = [];
    this.missing = [];
    this.routes = { added: [], removed: [] };
  }

  /**
   * Print a progress line (nothing in JSON mode)
   *
   * @param {...*} args What console.log would get
   * @returns {void}
   */
  log(...args) {
    if (!this.json) {
      console.log(...args);
    }
  }

  /**
   * Record a file (or a route) change
   *
   * @param {('created'|'updated'|'skipped'|'removed'|'missing'|'routes.added'|'routes.removed')} kind What happened
   * @param {string} value The relative path, or the route key
   * @returns {void}
   */
  add(kind, value) {
    if (kind === 'routes.added' || kind === 'routes.removed') {
      this.routes[kind.split('.')[1]].push(value);

      return;
    }

    this[kind].push(value);
  }

  /**
   * The summary
   *
   * @returns {object} What was done
   */
  toJSON() {
    if (this.command === 'destroy') {
      return {
        backup: this.backup,
        command: this.command,
        missing: this.missing,
        name: this.name,
        removed: this.removed,
        routes: { removed: this.routes.removed },
        target: this.target,
      };
    }

    return {
      command: this.command,
      created: this.created,
      generator: this.target,
      name: this.name,
      routes: { added: this.routes.added },
      skipped: this.skipped,
      updated: this.updated,
    };
  }

  /**
   * Print the summary (JSON mode only)
   *
   * @returns {void}
   */
  print() {
    if (this.json) {
      console.log(JSON.stringify(this.toJSON(), null, 2));
    }
  }
}

module.exports = Report;
