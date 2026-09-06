const { check } = require('./base/arguments');
const { fail } = require('./base/errors');
const BaseModule = require('./base/module');

const fs = require('fs');
const path = require('path');

const nodemailer = require('nodemailer');

/**
 * Mail transport module
 *
 * @class Mailer
 * @extends {BaseModule}
 */
class Mailer extends BaseModule {
  /**
   * Creates an instance of Mailer.
   * @memberof Mailer
   */
  constructor() {
    super();

    this.reloadable = false;
    this.needs = ['config'];
    this.runlevel = 1;
    this.name = 'mail';
    this.henri = undefined;

    this.nodemailer = nodemailer;
    this.transporter = undefined;
    this.testAccount = undefined;
    this.config = undefined;

    this.init = this.init.bind(this);
    this.send = this.send.bind(this);
  }

  /**
   * Module initialization
   * Called after being loaded by Modules
   *
   * The `mail` configuration is nodemailer's transport configuration and
   * always reaches createTransport() + verify(). `"test"` swaps it for an
   * Ethereal account (cached in .mailerTestCreds). Under NODE_ENV=test the
   * json transport is used (no network) unless henri.forceMail is set.
   *
   * @async
   * @returns {!string} The name of the module
   * @memberof Mailer
   */
  async init() {
    const { config, pen } = this.henri;

    if (!config.has('mail') && !this.henri.isTest) {
      pen.warn('mail', 'no mail configuration found');

      return this.name;
    }

    this.config = config.get('mail', true);

    if (this.henri.isTest && !this.henri.forceMail) {
      this.config = { jsonTransport: true };
    } else if (this.config === 'test') {
      pen.info('mail', 'creating test account');
      this.config = await this.testConfig();
    }

    if (!this.config || typeof this.config !== 'object') {
      pen.error('mail', 'invalid mail configuration', String(this.config));

      throw fail(
        'HENRI_MAIL_TRANSPORT_INVALID',
        'The mail configuration must be a nodemailer transport object or "test"'
      );
    }

    this.transporter = this.nodemailer.createTransport(this.config);

    try {
      await this.transporter.verify();
    } catch (error) {
      pen.error('mail', 'invalid mail configuration');

      throw error;
    }

    return this.name;
  }

  /**
   * Ethereal test account configuration, cached in .mailerTestCreds
   *
   * @async
   * @returns {object} the nodemailer transport configuration
   * @memberof Mailer
   */
  async testConfig() {
    const filePath = path.join(this.henri.cwd(), '.mailerTestCreds');

    try {
      try {
        this.testAccount = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (error) {
        this.testAccount = await this.nodemailer.createTestAccount();
        fs.writeFileSync(filePath, JSON.stringify(this.testAccount));
      }
    } catch (error) {
      this.henri.pen.error('mail', 'unable to create test account');
      throw error;
    }

    return {
      auth: {
        pass: this.testAccount.pass,
        user: this.testAccount.user,
      },
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
    };
  }

  /**
   * Send an email
   *
   * @async
   * @param {any} opts An email object
   * @returns {Promise} The result
   * @memberof Mailer
   */
  async send(opts) {
    check('henri.mail.send', [opts]);

    // Under NODE_ENV=test the transport is nodemailer's json one, which
    // happily "sends" a message nobody will ever receive; in production the
    // same call is an SMTP EENVELOPE three deploys later
    if (!opts.to && !opts.cc && !opts.bcc) {
      throw fail(
        'HENRI_MAIL_NO_RECIPIENT',
        'henri.mail.send(message) needs a recipient: give it a to, a cc or a bcc'
      );
    }

    if (!this.transporter) {
      this.henri.pen.error('mail', 'transport not initialized');

      throw fail(
        'HENRI_MAIL_NO_TRANSPORT',
        'Trying to send an email without proper transport'
      );
    }

    // Both records want this call: the outbound call log holds what was
    // attempted and what came back, the span holds the boundary. Neither
    // holds the message -- no recipient, no subject, no body -- because an
    // SMTP conversation is worth timing and its contents are personal data
    const { telemetry } = this.henri;
    const finish = this.tracked();
    const deliver = () => this.transporter.sendMail(opts);
    let info;

    try {
      info = await (telemetry
        ? telemetry.span(
            'henri.mail.deliver',
            { boundary: 'mail', kind: 'client' },
            deliver
          )
        : deliver());
    } catch (error) {
      finish({ error: error.code || error.name, status: null });

      throw error;
    }

    finish({
      meta: {
        accepted: (info.accepted || []).length,
        messageId: info.messageId,
        rejected: (info.rejected || []).length,
      },
      status: (info.rejected || []).length > 0 ? 550 : 250,
    });

    this.henri.pen.info('mail', `Message sent: ${info.messageId}`);
    this.testAccount &&
      this.henri.pen.info(
        'mail',
        `Message url: ${this.nodemailer.getTestMessageUrl(info)}`
      );

    return info;
  }

  /**
   * The endpoint the transport talks to, as a url.
   *
   * There is no address in it and there is none in the row either: a
   * recipient is personal data, and what a call log is asked is "did the
   * mail go out during this request, and how long did it take". The counts
   * and the message id answer that; the addresses are the mailer's own
   * concern (`guides/calls.md` says so).
   *
   * @returns {string} a url
   * @memberof Mailer
   */
  endpoint() {
    const config = this.config;

    if (!config || typeof config !== 'object') {
      return 'mail://transport';
    }

    if (config.host) {
      return `smtp://${config.host}:${config.port || 587}`;
    }

    if (config.service) {
      return `smtp://${config.service}`;
    }

    return config.jsonTransport ? 'mail://json' : 'mail://transport';
  }

  /**
   * Starts timing one send, when there is a call log to time it into
   *
   * @returns {function} the finisher (a no-op without a call log)
   * @memberof Mailer
   */
  tracked() {
    const { calls } = this.henri;

    if (!calls || !calls.enabled) {
      return () => null;
    }

    return calls.track({
      method: 'SEND',
      service: 'mail',
      url: this.endpoint(),
    });
  }

  /**
   * Stops the module
   *
   * @async
   * @returns {(string|boolean)} Module name or false
   * @memberof Mailer
   */
  async stop() {
    if (this.transporter && typeof this.transporter.close === 'function') {
      this.transporter.close();
      this.transporter = undefined;

      return this.name;
    }

    return false;
  }
}

module.exports = Mailer;
