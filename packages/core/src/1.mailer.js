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

    const info = await this.transporter.sendMail(opts);

    this.henri.pen.info('mail', `Message sent: ${info.messageId}`);
    this.testAccount &&
      this.henri.pen.info(
        'mail',
        `Message url: ${this.nodemailer.getTestMessageUrl(info)}`
      );

    return info;
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
