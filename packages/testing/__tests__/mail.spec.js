// The inbox, against the real mailers module and the real Message: what is
// proved here is the wiring itself -- both doors captured, neither counted
// twice, and one inbox per application. The demo application proves the same
// thing end to end in mail-app.spec.js, with a queue behind the second door.
const Mailers = require('@usehenri/core/src/2.mailers');

const {
  INBOX,
  addresses,
  captureMail,
  inbox,
  releaseMail,
} = require('../mail');
const { clearInbox } = require('../index.js');

const ada = 'ada@example.com';

/**
 * An application with a mail transport and mailers, and nothing else
 *
 * @param {object} [options={}] `{ mailers }`, the mailer files
 * @returns {object} a henri look-alike, with `sent` recording the transport
 */
const application = ({ mailers = {} } = {}) => {
  const sent = [];
  const henri = {
    config: {
      get: () => undefined,
      has: () => false,
    },
    cwd: () => __dirname,
    isDev: false,
    isProduction: false,
    isTest: true,
    mail: {
      send: async (message) => {
        sent.push(message);

        return { messageId: `<${sent.length}@henri>` };
      },
    },
    pen: {
      error: () => null,
      info: () => null,
      warn: () => null,
    },
    sent,
  };

  const module = new Mailers();

  module.henri = henri;
  module.configure(mailers);
  henri.mailers = module;

  return henri;
};

/** A mailer whose actions need no view: the html is written by hand */
const welcome = {
  confirm: (to) => ({
    html: '<p>Confirm your address</p>',
    subject: 'Confirm your address',
    to,
  }),

  defaults: { from: 'Henri <no-reply@example.com>' },

  digest: (to, count) => ({
    cc: ['ops@example.com, "Doe, Ada" <doe@example.com>'],
    html: `<p>${count} things happened</p>`,
    subject: 'Your digest',
    to: [to, { address: 'copy@example.com', name: 'Copy' }],
  }),
};

describe('addresses()', () => {
  test('reads every shape nodemailer takes', () => {
    expect(addresses('ada@example.com')).toEqual([ada]);
    expect(addresses('Ada <ada@example.com>')).toEqual([ada]);
    expect(addresses('ada@example.com, bob@example.com')).toEqual([
      ada,
      'bob@example.com',
    ]);
    expect(addresses({ address: ada, name: 'Ada' })).toEqual([ada]);
    expect(addresses([ada, { address: 'bob@example.com' }])).toEqual([
      ada,
      'bob@example.com',
    ]);
    expect(addresses(undefined)).toEqual([]);
  });

  test('a comma inside a display name is not a second recipient', () => {
    expect(addresses('"Doe, Ada" <ada@example.com>, bob@example.com')).toEqual([
      ada,
      'bob@example.com',
    ]);
  });
});

describe('the inbox', () => {
  let henri = null;

  beforeEach(() => {
    henri = application({ mailers: { welcome } });
    global.henri = henri;
    captureMail(henri);
  });

  afterEach(() => {
    releaseMail(henri);
    delete global.henri;
  });

  test('deliver() is captured, with the mailer that rendered it', async () => {
    await henri.mailers.welcome.confirm(ada).deliver();

    const [mail] = inbox();

    expect(inbox()).toHaveLength(1);
    expect(mail.to).toEqual([ada]);
    expect(mail.from).toBe('no-reply@example.com');
    expect(mail.subject).toBe('Confirm your address');
    expect(mail.html).toContain('Confirm your address');
    expect(mail.text).toContain('Confirm your address');
    expect(mail.mailer).toBe('welcome');
    expect(mail.action).toBe('confirm');
    expect(mail.deferred).toBe(false);
    // The payload itself is there, for whatever the entry does not lift out
    expect(mail.message.subject).toBe('Confirm your address');
  });

  test('every recipient of every header is read', async () => {
    await henri.mailers.welcome.digest(ada, 3).deliver();

    const [mail] = inbox();

    expect(mail.to).toEqual([ada, 'copy@example.com']);
    expect(mail.cc).toEqual(['ops@example.com', 'doe@example.com']);
  });

  test('a message the application sends itself is captured too', async () => {
    await henri.mail.send({ subject: 'By hand', text: 'hello', to: ada });

    expect(inbox()).toHaveLength(1);
    expect(inbox()[0].mailer).toBeNull();
    expect(inbox()[0].subject).toBe('By hand');
  });

  test('a delivery that fails is not in the inbox', async () => {
    // Its own application: the transport has to refuse before the capture
    // wraps it, the way a misconfigured one would
    const broken = application({ mailers: { welcome } });

    broken.mail.send = async () => {
      throw new Error('no transport');
    };
    global.henri = broken;
    captureMail(broken);

    await expect(broken.mailers.welcome.confirm(ada).deliver()).rejects.toThrow(
      'no transport'
    );
    expect(inbox()).toHaveLength(0);

    releaseMail(broken);
  });

  test('deliverLater() is captured once, not twice, without a queue', async () => {
    await henri.mailers.welcome.confirm(ada).deliverLater();

    const [mail] = inbox();

    // The fallback of `enqueue()` sends out of band: the same payload object
    // reaches the transport, and the inbox holds one message and not two
    expect(inbox()).toHaveLength(1);
    expect(mail.deferred).toBe(true);
    expect(mail.mailer).toBe('welcome');
    await henri.mailers.drain();
    expect(henri.sent).toHaveLength(1);
    expect(inbox()).toHaveLength(1);
  });

  test('deliverLater() is captured with a delivery handler, which is the queue', async () => {
    const enqueued = [];

    henri.mailers.onDeliverLater((message, options) => {
      enqueued.push({ message, options });

      return { id: 'job-1' };
    });

    await henri.mailers.welcome
      .confirm(ada)
      .deliverLater({ queue: 'mail', wait: '5m' });

    const [mail] = inbox();

    expect(enqueued).toHaveLength(1);
    // Nothing reached the transport: that is what a queue means
    expect(henri.sent).toHaveLength(0);
    expect(mail.deferred).toBe(true);
    expect(mail.options).toEqual({ queue: 'mail', wait: '5m' });
    expect(mail.to).toEqual([ada]);
  });

  test('what a queue runner sends later is a second entry', async () => {
    henri.mailers.onDeliverLater(() => ({ id: 'job-1' }));

    await henri.mailers.welcome.confirm(ada).deliverLater();

    // What the runner does: it rehydrates the payload from the row it read
    const [{ message }] = inbox();

    await henri.mail.send(JSON.parse(JSON.stringify(message)));

    expect(inbox().map((mail) => mail.deferred)).toEqual([true, false]);
  });

  test('the filter keeps what it says and nothing else', async () => {
    henri.mailers.onDeliverLater(() => ({ id: 'job-1' }));

    await henri.mailers.welcome.confirm(ada).deliver();
    await henri.mailers.welcome.digest('bob@example.com', 2).deliverLater();

    expect(inbox({ to: ada })).toHaveLength(1);
    expect(inbox({ to: 'ADA@EXAMPLE.COM' })).toHaveLength(1);
    expect(inbox({ deferred: true })).toHaveLength(1);
    expect(inbox({ action: 'digest' })).toHaveLength(1);
    expect(inbox({ mailer: 'welcome' })).toHaveLength(2);
    expect(inbox({ subject: /digest/iu })).toHaveLength(1);
    expect(inbox({ subject: 'Your digest' })).toHaveLength(1);
    expect(inbox({ deferred: true, to: ada })).toHaveLength(0);
    expect(inbox((mail) => mail.html.includes('2 things'))).toHaveLength(1);
  });

  test('a filter the inbox cannot answer is refused, never ignored', () => {
    expect(() => inbox({ body: 'hello' })).toThrow(/does not filter on body/u);
    expect(() => inbox({ body: 'hello' })).toThrow(/action, deferred/u);

    expect(() => inbox({ subjet: 'typo' })).toThrow(
      expect.objectContaining({ code: 'HENRI_ARGUMENT_INVALID' })
    );
    expect(() => inbox('welcome')).toThrow(/filter object or a function/u);
  });

  test('clearInbox() empties it and says whether there was one', async () => {
    await henri.mailers.welcome.confirm(ada).deliver();

    expect(clearInbox()).toBe(true);
    expect(inbox()).toHaveLength(0);

    delete global.henri;

    expect(clearInbox()).toBe(false);
  });

  test('releasing puts the application back the way it was', async () => {
    const before = henri.mail.send;

    releaseMail(henri);

    expect(henri.mail.send).not.toBe(before);
    expect(henri[INBOX]).toBeUndefined();

    await henri.mailers.welcome.confirm(ada).deliver();

    expect(henri.sent).toHaveLength(1);
    // And nothing is capturing any more, so this boots one of its own
    expect(inbox()).toHaveLength(0);
  });

  test('capturing twice is capturing once', async () => {
    expect(captureMail(henri)).toBe(henri[INBOX]);

    await henri.mailers.welcome.confirm(ada).deliver();

    expect(inbox()).toHaveLength(1);
  });
});

describe('the inbox is the application, not the process', () => {
  test('two applications in one process hold two inboxes', async () => {
    const first = application({ mailers: { welcome } });
    const second = application({ mailers: { welcome } });

    captureMail(first);
    captureMail(second);

    await first.mailers.welcome.confirm(ada).deliver();
    await second.mailers.welcome.confirm('bob@example.com').deliver();
    await second.mailers.welcome.digest('bob@example.com', 1).deliver();

    // The property is on the instance: which application you booted is what
    // decides whose mail this is, not which copy of the module got loaded
    expect(first[INBOX].messages).toHaveLength(1);
    expect(second[INBOX].messages).toHaveLength(2);
    expect(first[INBOX].messages[0].to).toEqual([ada]);

    global.henri = second;
    expect(inbox()).toHaveLength(2);

    global.henri = first;
    expect(inbox()).toHaveLength(1);

    delete global.henri;
    releaseMail(first);
    releaseMail(second);
  });

  test('a fresh application starts with an empty inbox', async () => {
    const first = application({ mailers: { welcome } });

    global.henri = first;
    captureMail(first);
    await first.mailers.welcome.confirm(ada).deliver();

    expect(inbox()).toHaveLength(1);

    // What `teardown()` then `setup()` does
    releaseMail(first);
    global.henri = application({ mailers: { welcome } });

    expect(inbox()).toHaveLength(0);

    releaseMail(global.henri);
    delete global.henri;
  });

  test('without an application there is nothing to read', () => {
    delete global.henri;

    expect(() => inbox()).toThrow(/henri is not running/u);
    expect(() => inbox()).toThrow(
      expect.objectContaining({ code: 'HENRI_BOOT_TESTING_NOT_RUNNING' })
    );
  });
});
