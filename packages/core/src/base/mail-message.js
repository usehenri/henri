const { check } = require('./arguments');
const { DEFAULT_LAYOUT } = require('./mail-view');
const { htmlToText } = require('./mail-text');

/**
 * The keys of an envelope henri reads itself; everything else is handed to
 * nodemailer as is (from, to, cc, bcc, replyTo, subject, attachments,
 * headers, priority...). `locale` and `for` are the two the language of
 * the message is decided from (see `Message#locale`), and neither reaches
 * the transport -- `for` in particular is a user record, which is exactly
 * what a mail payload must not carry into a queue row.
 */
const OWN = new Set(['data', 'for', 'layout', 'locale', 'view']);

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
    const meta = {
      action: this.action,
      localUrl: (server && server.url) || null,
      mailer: this.mailer,
      subject: this.envelope.subject || null,
    };

    // `{{t "..."}}` in a mail view reads this, the way a page reads the
    // one `res.render()` put in the view options
    this.henri.i18n &&
      this.henri.i18n.enabled &&
      (meta.i18n = { locale: this.locale, source: 'message' });

    return meta;
  }

  /**
   * The language this message is written in.
   *
   * **The locale of a mail is the recipient's, and it is never the
   * request's.** A request is the wrong place to ask: an administrator
   * acting on somebody else's account, a nightly digest and a job retrying
   * a delivery an hour later all produce a mail whose reader is not
   * whoever made the request, and two of those have no request at all. So
   * a message carries its own, in this order:
   *
   * 1. `locale` in what the action returned;
   * 2. `locale` in the mailer's `defaults`;
   * 3. the recipient's own setting, when the action named them: `for` is a
   *    user record and `henri.i18n.forUser()` reads the column
   *    `i18n.from.user` names -- this is the one that works from a job,
   *    because a record is something a job has;
   * 4. `i18n.default`.
   *
   * The account flows are the one place henri passes a request's locale,
   * and they may because there the recipient *is* the person who asked
   * (see base/accounts.js).
   *
   * @readonly
   * @returns {string} the locale
   * @memberof Message
   */
  get locale() {
    const { i18n } = this.henri;

    if (!i18n || !i18n.enabled) {
      return 'en';
    }

    const said = this.envelope.locale || this.defaults.locale || null;

    if (i18n.supports(said)) {
      return said;
    }

    const recipient = this.envelope.for || this.defaults.for || null;

    return i18n.forUser(recipient) || i18n.fallback;
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
