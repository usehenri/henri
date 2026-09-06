const { check } = require('./arguments');
const { DEFAULT_LAYOUT } = require('./mail-view');
const { htmlToText } = require('./mail-text');

/**
 * The keys of an envelope henri reads itself; everything else is handed to
 * nodemailer as is (from, to, cc, bcc, replyTo, subject, attachments,
 * headers, priority...)
 */
const OWN = new Set(['data', 'layout', 'view']);

/**
 * One message, as returned by a mailer action
 *
 * A mailer action describes the message (recipients, subject, the data its
 * view needs) and returns; henri renders it and delivers it:
 *
 *     const message = henri.mailers.welcome.confirm(user);
 *
 *     await message.deliver();       // now, through henri.mail
 *     await message.deliverLater();  // through the delivery handler
 *     const { html, text } = await message.render();
 *
 * @class Message
 */
class Message {
  /**
   * Creates an instance of Message.
   *
   * @param {Henri} henri the henri instance
   * @param {object} options the message
   * @param {string} options.mailer the mailer name (ex: welcome)
   * @param {string} options.action the action name (ex: confirm)
   * @param {object} [options.envelope={}] what the action returned
   * @param {object} [options.defaults={}] the mailer's `defaults`
   * @memberof Message
   */
  constructor(henri, { mailer, action, envelope = {}, defaults = {} }) {
    this.henri = henri;
    this.mailer = mailer;
    this.action = action;
    this.defaults = defaults || {};
    this.envelope = envelope || {};

    this.deliver = this.deliver.bind(this);
    this.deliverLater = this.deliverLater.bind(this);
    this.render = this.render.bind(this);
  }

  /**
   * The view of the message: `<mailer>/<action>` unless the action said
   * otherwise
   *
   * @readonly
   * @returns {string} the view name
   * @memberof Message
   */
  get view() {
    return (
      this.envelope.view ||
      this.defaults.view ||
      `${this.mailer}/${this.action}`
    );
  }

  /**
   * The layout of the message: the action's, then the mailer's `defaults`,
   * then `config.mailers.layout`, then `mailer`. `false` renders no layout.
   *
   * @readonly
   * @returns {(string|boolean)} the layout name
   * @memberof Message
   */
  get layout() {
    for (const source of [this.envelope, this.defaults, this.settings]) {
      if (typeof source.layout !== 'undefined') {
        return source.layout;
      }
    }

    return DEFAULT_LAYOUT;
  }

  /**
   * The `mailers` configuration of the application
   *
   * @readonly
   * @returns {object} the configuration (an empty object when there is none)
   * @memberof Message
   */
  get settings() {
    const { mailers } = this.henri;

    return (mailers && mailers.settings) || {};
  }

  /**
   * Render the message into what nodemailer expects
   * Everything the action returned is forwarded, minus `data`, `view` and
   * `layout`; an `html` given by the action is used as is (no view is read).
   *
   * @async
   * @returns {Promise<object>} the nodemailer message
   * @throws when the view is missing or fails to render
   * @memberof Message
   */
  async render() {
    const payload = {};

    for (const [key, value] of Object.entries(
      Object.assign({}, this.defaults, this.envelope)
    )) {
      if (!OWN.has(key)) {
        payload[key] = value;
      }
    }

    if (!payload.from && this.settings.from) {
      payload.from = this.settings.from;
    }

    if (typeof payload.html === 'string') {
      if (typeof payload.text !== 'string') {
        payload.text = htmlToText(payload.html);
      }

      return payload;
    }

    const { html, text } = await this.henri.mailers.views.render({
      data: this.data(),
      layout: this.layout,
      meta: this.meta(),
      view: this.view,
    });

    payload.html = html;

    if (typeof payload.text !== 'string') {
      payload.text = text;
    }

    return payload;
  }

  /**
   * The template context: what the action put in `data`
   *
   * @returns {object} the context
   * @memberof Message
   */
  data() {
    return Object.assign({}, this.defaults.data, this.envelope.data);
  }

  /**
   * The handlebars data variables of a mail view: `{{@action}}`,
   * `{{@mailer}}` and `{{@localUrl}}` (the url of the running server, so a
   * view can build absolute links)
   *
   * @returns {object} the data variables
   * @memberof Message
   */
  meta() {
    const { server } = this.henri;

    return {
      action: this.action,
      localUrl: (server && server.url) || null,
      mailer: this.mailer,
      subject: this.envelope.subject || null,
    };
  }

  /**
   * Render and deliver the message now, through `henri.mail.send()`
   *
   * @async
   * @returns {Promise<object>} nodemailer's info
   * @throws when the view fails or the transport rejects
   * @memberof Message
   */
  async deliver() {
    return this.henri.mail.send(await this.render());
  }

  /**
   * Render the message and hand it to the delivery handler instead of
   * sending it inline (see `henri.mailers.onDeliverLater`)
   *
   * @async
   * @param {object} [options={}] passed on to the delivery handler
   * @returns {Promise<object>} what the handler answered
   * @memberof Message
   */
  async deliverLater(options = {}) {
    // A misspelled `wait` is a mail that leaves immediately: the fallback
    // handler only holds a message back for the two keys it reads
    check('message.deliverLater', [options]);

    return this.henri.mailers.enqueue(await this.render(), options);
  }
}

module.exports = Message;
module.exports.OWN = OWN;
