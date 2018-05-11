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
   * @async
   * @returns {!string} The name of the module
   * @memberof Mailer
   */
  async init() {
    if (!this.henri.config.has('mail') && !this.henri.isTest) {
      this.henri.pen.warn('mail', 'no mail configuration found');

      return this.name;
    }

    this.config = this.henri.config.get('mail', true);

    if ((this.henri.isTest && this.henri.forceMail) || this.config === 'test') {
      this.henri.pen.info('mail', 'creating test account');

      try {
        const filePath = path.join(process.cwd(), '.mailerTestCreds');

        // Should be rethinked...
        try {
          fs.accessSync(filePath);
          this.testAccount = JSON.parse(fs.readFileSync(filePath));
        } catch (error) {
          this.testAccount = await nodemailer.createTestAccount();
          fs.writeFileSync(filePath, JSON.stringify(this.testAccount));
        }

        this.config = {
          auth: {
            pass: this.testAccount.pass,
            user: this.testAccount.user,
          },
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
        };
      } catch (error) {
        this.henri.pen.error('mail', 'unable to create test account');
        throw error;
      }
    } else {
      return this.name;
    }

    this.transporter = this.nodemailer.createTransport(this.config);

    try {
      await this.transporter.verify();
    } catch (error) {
      this.henri.pen.error('mail', 'invalid mail configuration');

      throw error;
    }

    return this.name;
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
    return new Promise((resolve, reject) => {
      if (!this.transporter) {
        this.henri.pen.error('mail', 'transport not initialized');

        return reject(
          new Error('Trying to send an email without proper transport')
        );
      }

      this.transporter.sendMail(opts, (error, info) => {
        if (error) {
          return reject(error);
        }

        this.henri.pen.info('mail', `Message sent: ${info.messageId}`);
        this.testAccount &&
          this.henri.pen.info(
            'mail',
            `Message url: ${this.nodemailer.getTestMessageUrl(info)}`
          );

        return resolve(info);
      });
    });
  }
}

module.exports = Mailer;
