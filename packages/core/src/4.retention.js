const BaseModule = require('./base/module');

const fs = require('fs');
const path = require('path');
const debug = require('debug')('henri:retention');
const { randomUUID } = require('node:crypto');

const { fail } = require('./base/errors');
const { PACKAGE } = require('./base/jobs');
const {
  planOf,
  retentionConfig,
  rulesOf,
  sweepOf,
} = require('./base/retention');

/** The name of the job that sweeps, when the application has the queue */
const JOB = 'henri/retention';

/**
 * Retention: `henri.retention`, how long each model keeps its records and
 * the sweep that enforces it.
 *
 * The design -- the three verbs, the clock a rule is measured from, what
 * proves a sweep ran and the two things standing between a wrong rule and a
 * deleted table -- is in the header of `base/retention.js`. This is the
 * module: it reads the rules out of the models at boot, says at boot what is
 * going to run them (and, more usefully, what is not), and carries the
 * sweep.
 *
 * The sweep needs nothing installed. `@usehenri/jobs` is one way to run it
 * and `henri retention:sweep` from cron is the other, so an application
 * without the queue is never quietly left with rules nobody applies: the
 * boot line names the command.
 *
 * @class Retention
 * @extends {BaseModule}
 */
class Retention extends BaseModule {
  /**
   * Creates an instance of Retention.
   * @memberof Retention
   */
  constructor() {
    super();

    this.reloadable = true;
    // The rules are read from the model files, and `anonymize` writes what
    // the privacy map says is personal
    this.needs = ['config', 'model', 'privacy'];
    // A sweep is recorded in the trail when there is one
    this.after = ['trail', 'jobs'];
    this.runlevel = 4;
    this.name = 'retention';
    this.henri = null;

    /** `config.retention`, normalized */
    this.settings = retentionConfig(null);
    /** The rules of every model, each with its token */
    this.rules = [];

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.plan = this.plan.bind(this);
    this.sweep = this.sweep.bind(this);

    debug('constructor initialized');
  }

  /**
   * Module initialization: reads the rules and says what runs them
   *
   * @async
   * @returns {Promise<string>} the name of the module
   * @throws HENRI_RETENTION_INVALID_RULE when a model declares a rule that
   *   cannot be carried out
   * @memberof Retention
   */
  async init() {
    const { config, pen } = this.henri;

    this.settings = retentionConfig(config);
    this.rules = rulesOf((this.henri.model && this.henri.model.models) || [], {
      fields: (name) => this.henri.privacy.fields(name),
    });

    if (this.rules.length === 0) {
      debug('no model declares a retention rule');

      return this.name;
    }

    const pending = this.rules.filter(
      (rule) =>
        this.settings.approve && !this.settings.approved.includes(rule.token)
    );

    pen.info(
      'retention',
      `${this.rules.length} rule${this.rules.length === 1 ? '' : 's'}`,
      this.schedule(),
      pending.length > 0
        ? `${pending.length} not approved: they plan and write nothing`
        : ''
    );

    return this.name;
  }

  /**
   * Registers the recurring sweep with the queue, and answers with what a
   * person reading the boot log needs to know.
   *
   * This is the one place that says out loud what an application is not
   * getting: without `@usehenri/jobs` there is no schedule, and the line
   * names the command a cron entry would run instead. A rule that nothing
   * applies is a promise nobody keeps.
   *
   * @returns {string} what runs the sweep, in words
   * @memberof Retention
   */
  schedule() {
    const { jobs } = this.henri;
    const spec = this.settings.schedule;

    if (spec === false) {
      return 'nothing runs them (retention.schedule is off): henri retention:sweep --yes';
    }

    if (!jobs || !jobs.enabled || typeof jobs.recur !== 'function') {
      return `nothing runs them here: ${PACKAGE} is not part of this boot, so cron runs "henri retention:sweep --yes"`;
    }

    // A cron expression has fields and therefore spaces; anything else is
    // an interval (`'1d'`), which is the queue's other way of saying when
    jobs.recur(JOB, {
      job: JOB,
      ...(/\s/u.test(spec) ? { cron: spec } : { every: spec }),
    });

    return `swept by ${JOB} (${spec})`;
  }

  /**
   * Rebuilds the rules after a reload of the models
   *
   * @async
   * @returns {Promise<string>} the name of the module
   * @memberof Retention
   */
  async reload() {
    return this.init();
  }

  /**
   * The context a plan and a sweep run in
   *
   * @returns {object} `{ application, fieldsOf, modelOf, rules, settings }`
   * @memberof Retention
   */
  context() {
    return {
      application: this.applicationName(),
      fieldsOf: (name) => this.henri.privacy.fields(name),
      modelOf: (name) => this.henri.privacy.modelOf(name),
      rules: this.rules,
      settings: this.settings,
    };
  }

  /**
   * The name of the application, for the receipts it produces
   *
   * @returns {?string} the name from its package.json, or null
   * @memberof Retention
   */
  applicationName() {
    try {
      return require(path.join(this.henri.cwd(), 'package.json')).name || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * The rules, as data: what `henri retention` prints
   *
   * @returns {object} the rules and the settings
   * @memberof Retention
   */
  describe() {
    return {
      rules: this.rules.map((rule) => ({
        action: rule.action,
        after: rule.after,
        approved:
          !this.settings.approve || this.settings.approved.includes(rule.token),
        from: rule.from,
        model: rule.model,
        rule: rule.name,
        token: rule.token,
        where: rule.where,
      })),
      settings: this.settings,
    };
  }

  /**
   * What a sweep would do, without doing it
   *
   * @async
   * @param {object} [options={}] `only`, `now`
   * @returns {Promise<object>} the plan
   * @memberof Retention
   */
  async plan(options = {}) {
    return planOf(this.context(), options);
  }

  /**
   * Sweeps every rule, writes the receipt and records what happened
   *
   * @async
   * @param {object} [options={}] `only`, `now`, `dryRun`
   * @returns {Promise<object>} the receipt, with the file it was written to
   * @memberof Retention
   */
  async sweep(options = {}) {
    const receipt = await sweepOf(this.context(), options);

    receipt.id = randomUUID();
    receipt.file = options.dryRun ? null : this.write(receipt);

    await this.tell(receipt, options);

    const swept = receipt.rules.reduce(
      (total, rule) => total + rule.written,
      0
    );

    this.henri.pen.info(
      'retention',
      options.dryRun ? 'sweep (dry run)' : 'swept',
      `${swept} record(s) over ${receipt.rules.length} rule(s)`,
      receipt.file || ''
    );

    return receipt;
  }

  /**
   * Records one entry per rule in the trail, and prunes the trail itself:
   * the sweep that enforces every other retention enforces the trail's too
   *
   * @async
   * @param {object} receipt the receipt
   * @param {object} options the options of the sweep
   * @returns {Promise<void>} resolves when recorded
   * @memberof Retention
   */
  async tell(receipt, options) {
    const { trail } = this.henri;

    if (!trail || !trail.enabled) {
      return;
    }

    for (const rule of receipt.rules) {
      await trail.record({
        action: 'retention.sweep',
        fields: rule.fields,
        ids: rule.sample,
        meta: {
          action: rule.action,
          cutoff: rule.cutoff,
          dryRun: receipt.dryRun,
          matched: rule.matched,
          remaining: rule.remaining,
          rule: rule.rule,
          skipped: rule.skipped,
          token: rule.token,
          waiting: rule.waiting,
        },
        model: rule.model,
        outcome: this.outcome(rule),
        records: rule.written,
        source: options.source || 'app',
      });
    }

    if (!receipt.dryRun) {
      await trail.prune();
    }
  }

  /**
   * How one rule of a receipt ended
   *
   * @param {object} rule one rule of a receipt
   * @returns {string} `ok`, `refused` or `failed`
   * @memberof Retention
   */
  outcome(rule) {
    if (rule.failed) {
      return 'failed';
    }

    return rule.skipped && rule.skipped !== 'dry run' ? 'refused' : 'ok';
  }

  /**
   * Writes a receipt where `config.retention.receipts` says
   *
   * @param {object} receipt the receipt
   * @returns {?string} the path it was written to, or null
   * @throws HENRI_RETENTION_RECEIPT_UNWRITABLE when it cannot be written
   * @memberof Retention
   */
  write(receipt) {
    const { receipts } = this.settings;

    if (receipts === false) {
      return null;
    }

    const folder = path.resolve(this.henri.cwd(), receipts);
    const stamp = receipt.at.replace(/[:.]/gu, '-');
    const file = path.join(folder, `retention-${stamp}-${receipt.id}.json`);

    try {
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
    } catch (error) {
      const failure = fail(
        'HENRI_RETENTION_RECEIPT_UNWRITABLE',
        `the sweep ran and its receipt could not be written to ${file}: ${error.message}`,
        { cause: error }
      );

      failure.hint =
        'Make the directory writable, point config.retention.receipts elsewhere, or set it to false and keep the receipt the command printed';

      throw failure;
    }

    return path.relative(this.henri.cwd(), file);
  }
}

module.exports = Retention;
module.exports.JOB = JOB;
