const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const supertest = require('supertest');

const Henri = require('../henri');
const Mailers = require('../2.mailers');
const MailViews = require('../base/mail-view');
const { htmlToText } = require('../base/mail-text');
const previews = require('../base/mail-preview');
const { loopbackOnly } = require('../base/http');

const DEMO = path.resolve(__dirname, '../../../demo');
const ada = { email: 'ada@example.com', name: 'Ada' };

/**
 * A minimal henri for the mailers module
 *
 * @param {object} [options={}] { cwd, isDev, mailers, send }
 * @returns {object} a henri look-alike, with the pen output recorded
 */
const fakeHenri = ({
  cwd = DEMO,
  isDev = false,
  mailers = undefined,
  send = async () => ({ messageId: '<stub@henri>' }),
} = {}) => {
  const logs = [];
  const sent = [];

  return {
    config: {
      get: (key) => (key === 'mailers' ? mailers : undefined),
      has: (key) => key === 'mailers' && typeof mailers !== 'undefined',
    },
    cwd: () => cwd,
    isDev,
    isProduction: false,
    isTest: !isDev,
    logs,
    mail: {
      send: async (message) => {
        sent.push(message);

        return send(message);
      },
    },
    pen: {
      error: (...args) => logs.push(['error', ...args]),
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
    },
    sent,
    server: { express, url: 'http://localhost:3000/' },
  };
};

/**
 * A booted Mailers module bound to a fake henri
 *
 * @param {object} [options={}] see fakeHenri
 * @returns {Promise<{module: Mailers, henri: object}>} both
 */
const boot = async (options = {}) => {
  const henri = fakeHenri(options);
  const module = new Mailers();

  module.henri = henri;
  henri.mailers = module;
  await module.init();

  return { henri, module };
};

describe('mailers', () => {
  describe('loading (demo app)', () => {
    test('exposes the mailers and their actions', async () => {
      const { module } = await boot();

      expect(module.names()).toEqual(['welcome']);
      expect(module.actions('welcome')).toEqual(['confirm', 'digest', 'plain']);
      expect(module.tree()).toEqual({
        welcome: ['confirm', 'digest', 'plain'],
      });
      expect(module.has('welcome', 'confirm')).toBe(true);
      expect(module.has('welcome', 'defaults')).toBe(false);
      expect(module.has('welcome', 'previews')).toBe(false);
      expect(typeof module.welcome.confirm).toBe('function');
    });

    test('an unknown mailer or action says what it knows', async () => {
      const { module } = await boot();

      expect(() => module.message('nope', 'confirm')).toThrow(
        /No mailer 'nope'.*welcome/s
      );
      expect(() => module.message('welcome', 'nope')).toThrow(
        /no action 'nope'.*confirm/s
      );
    });

    test('an action that returns nothing is refused', async () => {
      const { module } = await boot();

      module._mailers.set('broken', { hello: () => undefined });

      expect(() => module.message('broken', 'hello')).toThrow(
        /must return the message it wants sent/
      );
    });

    test('reload drops what it exposed and loads again', async () => {
      const { module } = await boot();

      module._mailers.set('gone', { hello: () => ({}) });
      module.expose('gone', module._mailers.get('gone'));
      expect(module.gone).toBeDefined();

      await module.reload();

      expect(module.gone).toBeUndefined();
      expect(module.names()).toEqual(['welcome']);
    });
  });

  describe('rendering', () => {
    test('renders the view inside the layout', async () => {
      const { module } = await boot();
      const message = await module.welcome.confirm(ada).render();

      expect(message.html).toContain('<h1>Hello Ada</h1>');
      expect(message.html).toContain('<b>abc123</b>');
      // The layout wraps it
      expect(message.html).toMatch(/^<html>/);
      expect(message.html).toContain('The Henri Gallery');
    });

    test('carries the envelope of the action, plus the mailer defaults', async () => {
      const { module } = await boot();
      const message = await module.welcome.confirm(ada).render();

      expect(message.to).toBe(ada.email);
      expect(message.subject).toBe(`Confirm ${ada.email}`);
      expect(message.from).toBe('Henri <no-reply@example.com>');
      // `data`, `view` and `layout` never reach nodemailer
      expect(message.data).toBeUndefined();
      expect(message.layout).toBeUndefined();
      expect(message.view).toBeUndefined();
    });

    test('config.mailers.from is the fallback sender', async () => {
      const { module } = await boot({
        mailers: { from: 'Fallback <hi@example.com>' },
      });

      module._mailers.set('bare', {
        hello: () => ({ subject: 'hi', to: 'a@b.c', view: 'welcome/digest' }),
      });

      const message = await module.message('bare', 'hello').render();

      expect(message.from).toBe('Fallback <hi@example.com>');
    });

    test('layout: false renders the view alone', async () => {
      const { module } = await boot();
      const message = await module.welcome.digest(ada, 3).render();

      expect(message.html.trim()).toBe('<p>Ada, you have 3 new comments.</p>');
      expect(message.html).not.toContain('The Henri Gallery');
    });

    test('config.mailers.layout changes the default layout', async () => {
      const { module } = await boot({ mailers: { layout: false } });
      const message = await module.welcome.confirm(ada).render();

      expect(message.html).not.toContain('<html>');
      expect(message.html).toContain('<h1>Hello Ada</h1>');
    });

    test('a missing view says where it looked', async () => {
      const { module } = await boot();

      module._mailers.set('bare', { hello: () => ({ to: 'a@b.c' }) });

      await expect(module.message('bare', 'hello').render()).rejects.toThrow(
        /No mail view found for 'bare\/hello' in app\/views\/mailers/
      );
    });

    test('an html given by the action skips the views', async () => {
      const { module } = await boot();
      const message = await module.welcome.plain(ada).render();

      expect(message.html).toBe('<p>Written by hand</p>');
      expect(message.text).toBe('Written by hand');
    });
  });

  describe('the plain text part', () => {
    test('is derived from the rich part when none is authored', async () => {
      const { module } = await boot();
      const { text } = await module.welcome.confirm(ada).render();

      expect(text).toContain('Hello Ada');
      expect(text).toContain('Confirm your address with the code abc123.');
      // Links keep their target
      expect(text).toContain('Confirm (https://example.com/confirm/abc123)');
      expect(text).not.toContain('<');
    });

    test('an authored <view>.text.* part wins', async () => {
      const { module } = await boot();
      const { text } = await module.welcome.digest(ada, 3).render();

      expect(text).toContain('Read them at https://example.com/comments');
    });

    test('the layout applies to both parts', async () => {
      const { module } = await boot();
      const { text } = await module.welcome.confirm(ada).render();

      expect(text).toContain('The Henri Gallery');
    });

    test('a text given by the action is kept as is', async () => {
      const { module } = await boot();

      module._mailers.set('bare', {
        hello: () => ({
          text: 'exactly this',
          to: 'a@b.c',
          view: 'welcome/digest',
        }),
      });

      const message = await module.message('bare', 'hello').render();

      expect(message.text).toBe('exactly this');
    });
  });

  describe('htmlToText', () => {
    test('leaves nothing element shaped behind, however malformed', () => {
      // One strip pass turns `<scr<script>ipt>` into `<script`, and the
      // leftover opener has no closing bracket for a tag pattern to match
      expect(htmlToText('<p>Hello <scr<script>ipt>alert(1)</script></p>')).toBe(
        'Hello scr'
      );
      expect(htmlToText('<p>a<!--<!-- nested -->b</p>')).toBe('ab');
      expect(htmlToText('<p>x</p>')).not.toContain('<');
    });

    test('keeps a less-than sign that is not a tag', () => {
      expect(htmlToText('<p>5 &lt; 6 and 7 &gt; 6</p>')).toBe(
        '5 < 6 and 7 > 6'
      );
    });

    test('drops what never belongs in the text part', () => {
      expect(
        htmlToText('<style>b{color:red}</style><script>x()</script><p>Hi</p>')
      ).toBe('Hi');
      expect(htmlToText('<!-- gone --><p>Hi</p>')).toBe('Hi');
    });

    test('keeps the blocks apart and the list items marked', () => {
      expect(htmlToText('<p>one</p><p>two</p>')).toBe('one\n\ntwo');
      expect(htmlToText('a<br>b')).toBe('a\nb');
      expect(htmlToText('<ul><li>one</li><li>two</li></ul>')).toBe(
        '- one\n- two'
      );
    });

    test('keeps the target of a link, unless it says nothing new', () => {
      expect(htmlToText('<a href="https://x.io">Open</a>')).toBe(
        'Open (https://x.io)'
      );
      expect(htmlToText('<a href="https://x.io">https://x.io</a>')).toBe(
        'https://x.io'
      );
      expect(htmlToText('<a href="#top">Top</a>')).toBe('Top');
      expect(htmlToText("<a href='https://x.io'>Open</a>")).toBe(
        'Open (https://x.io)'
      );
    });

    test('decodes the entities', () => {
      expect(htmlToText('<p>Tea &amp; cake &mdash; &#65;&#x42;</p>')).toBe(
        'Tea & cake — AB'
      );
      expect(htmlToText('<p>a&nbsp;b</p>')).toBe('a b');
      expect(htmlToText('<p>&unknown;</p>')).toBe('&unknown;');
    });

    test('never leaves more than one blank line', () => {
      expect(htmlToText('<div><p>a</p></div><div><p>b</p></div>')).toBe(
        'a\n\nb'
      );
    });
  });

  describe('views', () => {
    test('never resolves outside app/views/mailers', () => {
      const views = new MailViews(fakeHenri());

      expect(views.resolve('../pages/index')).toBeNull();
      expect(views.resolve('welcome/confirm')).toBe(
        path.join(DEMO, 'app/views/mailers/welcome/confirm.hbs')
      );
      expect(views.resolve('welcome/confirm', '.text')).toBeNull();
      expect(views.resolve('welcome/digest', '.text')).toBe(
        path.join(DEMO, 'app/views/mailers/welcome/digest.text.hbs')
      );
    });

    test('lists the layouts', () => {
      const views = new MailViews(fakeHenri());

      expect(views.layouts()).toEqual(['mailer']);
      expect(views.layout(false)).toBeNull();
      expect(views.layout('nope')).toBeNull();
    });

    test('an application with no mail views at all still boots', async () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-mailers-'));

      try {
        const { module } = await boot({ cwd });

        expect(module.names()).toEqual([]);
        expect(module.tree()).toEqual({});
        // The `mailer` layout henri ships sits behind the application's, so
        // a mailer written before any template exists still renders
        expect(new MailViews(fakeHenri({ cwd })).layouts()).toEqual(['mailer']);
      } finally {
        fs.rmSync(cwd, { force: true, recursive: true });
      }
    });

    test('the view engine renders the mail when it knows how', async () => {
      const { henri, module } = await boot();

      henri.view = {
        engine: {
          renderMail: async ({ view, data }) => ({
            html: `<p>${view} for ${data.user.name}</p>`,
          }),
        },
      };

      const message = await module.welcome.confirm(ada).render();

      expect(message.html).toBe('<p>welcome/confirm for Ada</p>');
      expect(message.text).toBe('welcome/confirm for Ada');
    });
  });

  describe('delivery', () => {
    test('deliver() renders and sends through henri.mail', async () => {
      const { henri, module } = await boot();
      const info = await module.welcome.confirm(ada).deliver();

      expect(info.messageId).toBe('<stub@henri>');
      expect(henri.sent).toHaveLength(1);
      expect(henri.sent[0].subject).toBe(`Confirm ${ada.email}`);
      expect(henri.sent[0].html).toContain('<h1>Hello Ada</h1>');
      expect(henri.sent[0].text).toContain('Hello Ada');
    });

    test('deliver(name, action, ...args) is the one-liner', async () => {
      const { henri, module } = await boot();

      await module.deliver('welcome', 'confirm', ada);

      expect(henri.sent[0].to).toBe(ada.email);
    });

    test('deliverLater() defers to the delivery handler', async () => {
      const { module } = await boot();
      const queued = [];

      module.onDeliverLater((message, options) => {
        queued.push([message, options]);

        return { id: 'job-1' };
      });

      const answer = await module.welcome
        .confirm(ada)
        .deliverLater({ runAt: 42 });

      expect(answer).toEqual({ id: 'job-1' });
      expect(queued).toHaveLength(1);
      // The handler gets the rendered message: plain, serializable, and
      // enough for a worker to call henri.mail.send() with it
      expect(queued[0][0].to).toBe(ada.email);
      expect(queued[0][0].html).toContain('<h1>Hello Ada</h1>');
      expect(JSON.parse(JSON.stringify(queued[0][0]))).toEqual(queued[0][0]);
      expect(queued[0][1]).toEqual({ runAt: 42 });
    });

    test('without a handler it delivers out of band, and drain() waits', async () => {
      const { henri, module } = await boot();
      const answer = await module.welcome.confirm(ada).deliverLater();

      expect(answer).toEqual({ deferred: true, handler: 'inline' });

      await module.drain();

      expect(henri.sent).toHaveLength(1);
      expect(module.pending.size).toBe(0);
    });

    test('a deferred delivery that fails is logged, not thrown', async () => {
      const { henri, module } = await boot({
        send: async () => {
          throw new Error('smtp is down');
        },
      });

      await module.welcome.confirm(ada).deliverLater();
      await module.drain();

      expect(henri.logs).toContainEqual([
        'error',
        'mailers',
        'deferred delivery failed',
        'smtp is down',
      ]);
    });

    test('the handler must be a function', async () => {
      const { module } = await boot();

      expect(module.onDeliverLater('nope')).toBe(false);
      expect(module.onDeliverLater(null)).toBe(true);
    });

    test('stop() waits for the deferred deliveries', async () => {
      const { henri, module } = await boot();

      await module.welcome.confirm(ada).deliverLater();

      await expect(module.stop()).resolves.toBe('mailers');
      expect(henri.sent).toHaveLength(1);
    });
  });

  describe('previews', () => {
    test('are development only, and nothing turns them on elsewhere', async () => {
      const off = await boot({ isDev: false });
      const on = await boot({ isDev: true });
      const disabled = await boot({
        isDev: true,
        mailers: { previews: false },
      });

      expect(off.module.previewable).toBe(false);
      expect(on.module.previewable).toBe(true);
      expect(disabled.module.previewable).toBe(false);
    });

    test('render the sample data declared next to the mailer', async () => {
      const { henri, module } = await boot({ isDev: true });

      expect(await module.sample('welcome', 'confirm')).toEqual([ada]);
      expect(await module.sample('welcome', 'plain')).toEqual([]);

      const message = await module.preview('welcome', 'confirm');

      expect(message.subject).toBe(`Confirm ${ada.email}`);
      expect(message.html).toContain('<h1>Hello Ada</h1>');
      // A preview never delivers anything
      expect(henri.sent).toHaveLength(0);
    });

    test('a sample that is not an array is one argument', async () => {
      const { module } = await boot({ isDev: true });

      module._mailers.set('bare', {
        hello: (user) => ({ data: { user }, view: 'welcome/digest' }),
        previews: { hello: ada },
      });

      expect(await module.sample('bare', 'hello')).toEqual([ada]);
    });

    describe('the router', () => {
      let request;
      let module;

      beforeAll(async () => {
        const booted = await boot({ isDev: true });
        const app = express();

        module = booted.module;
        app.use('/_mailers', loopbackOnly(), module.previews());
        request = supertest(app);
      });

      test('lists the mailers and their actions', async () => {
        const res = await request.get('/_mailers');

        expect(res.status).toBe(200);
        expect(res.text).toContain('welcome#confirm');
        expect(res.text).toContain('/_mailers/welcome/confirm');
      });

      test('shows the headers and frames the rich part', async () => {
        const res = await request.get('/_mailers/welcome/confirm');

        expect(res.status).toBe(200);
        expect(res.text).toContain('welcome#confirm');
        expect(res.text).toContain(`Confirm ${ada.email}`);
        expect(res.text).toContain('/_mailers/welcome/confirm?part=html');
      });

      test('serves the rich part, the plain part and the json', async () => {
        const html = await request.get('/_mailers/welcome/confirm?part=html');

        expect(html.headers['content-type']).toMatch(/html/);
        expect(html.text).toContain('<h1>Hello Ada</h1>');

        const text = await request.get('/_mailers/welcome/confirm?part=text');

        expect(text.headers['content-type']).toMatch(/text\/plain/);
        expect(text.text).toContain('Hello Ada');
        expect(text.text).not.toContain('<h1>');

        const json = await request.get('/_mailers/welcome/confirm?part=json');

        expect(json.body.subject).toBe(`Confirm ${ada.email}`);
        expect(json.body.to).toBe(ada.email);
      });

      test('an unknown mailer action is a 404', async () => {
        const res = await request
          .get('/_mailers/welcome/nope')
          .set('Accept', 'application/json');

        expect(res.status).toBe(404);
        expect(res.body.message).toMatch(/No preview for welcome#nope/);
      });

      test('a view that throws shows the stack instead of a blank page', async () => {
        module._mailers.set('broken', {
          hello: () => ({ to: 'a@b.c' }),
          previews: { hello: () => [] },
        });

        const res = await request.get('/_mailers/broken/hello');

        expect(res.status).toBe(500);
        expect(res.text).toContain('broken#hello failed to render');
        expect(res.text).toContain('No mail view found');
      });

      test('nothing outside this machine reaches them', async () => {
        const app = express();

        app.use((req, res, next) => {
          Object.defineProperty(req.socket, 'remoteAddress', {
            value: '10.0.0.5',
          });
          next();
        });
        app.use('/_mailers', loopbackOnly(), module.previews());

        const res = await supertest(app)
          .get('/_mailers')
          .set('Accept', 'application/json');

        expect(res.status).toBe(404);
      });
    });
  });

  describe('through henri (demo app)', () => {
    let henri;
    let request;

    beforeAll(async () => {
      process.env.SKIP_WORKERS = 'true';
      henri = new Henri({ runlevel: 5 });
      await henri.init();
      request = supertest(henri.server.app);
    }, 60000);

    afterAll(async () => {
      delete process.env.SKIP_WORKERS;
      await henri.stop();
    }, 60000);

    test('henri.mailers is loaded and delivers through the test transport', async () => {
      // `auth` is henri's own: the demo application turned the account flows
      // on, so the mails they send are registered next to the demo's mailer
      expect(henri.mailers.names()).toEqual(['auth', 'welcome']);

      const info = await henri.mailers.welcome.confirm(ada).deliver();
      const message = JSON.parse(info.message);

      expect(message.subject).toBe(`Confirm ${ada.email}`);
      expect(message.html).toContain('<h1>Hello Ada</h1>');
      expect(message.text).toContain('Hello Ada');
      expect(message.from.address).toBe('no-reply@example.com');
    });

    test('the previews are mounted in development, and only there', async () => {
      expect(henri.isDev).toBe(false);

      const hidden = await request
        .get('/_mailers')
        .set('Accept', 'application/json');

      expect(hidden.status).toBe(404);

      henri.isDev = true;
      try {
        await henri.router.reload();

        const index = await request.get('/_mailers');

        expect(index.status).toBe(200);
        expect(index.text).toContain('welcome#confirm');

        const preview = await request.get(
          '/_mailers/welcome/confirm?part=json'
        );

        expect(preview.status).toBe(200);
        expect(preview.body.subject).toBe(`Confirm ${ada.email}`);
      } finally {
        henri.isDev = false;
        await henri.router.reload();
      }

      const again = await request
        .get('/_mailers')
        .set('Accept', 'application/json');

      expect(again.status).toBe(404);
    });
  });
});

describe('previews() without mailers', () => {
  test('says where to write one', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-mailers-'));

    try {
      const henri = fakeHenri({ cwd, isDev: true });
      const module = new Mailers();

      module.henri = henri;
      henri.mailers = module;
      await module.init();

      const app = express();

      app.use('/_mailers', previews(henri));

      const res = await supertest(app).get('/_mailers');

      expect(res.status).toBe(200);
      expect(res.text).toContain('henri generate mailer');
    } finally {
      fs.rmSync(cwd, { force: true, recursive: true });
    }
  });
});
