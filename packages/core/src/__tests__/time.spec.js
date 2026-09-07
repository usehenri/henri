const supertest = require('supertest');

const Henri = require('../henri');
const TimeModule = require('../1.time');
const TemplateEngine = require('../engines/template');
const Message = require('../base/mail-message');
const { OWN } = require('../base/mail-message');
const {
  DEFAULT_ZONE,
  Zones,
  canonical,
  isZone,
  middleware,
  timeConfig,
} = require('../base/time');

/**
 * The two zones this suite pins the process to.
 *
 * They are the awkward ones on purpose: Kiritimati is UTC+14, the furthest
 * ahead there is, and Niue is UTC-11. An instant between 10:00Z and 11:00Z
 * is on three different calendar days in UTC, in one and in the other,
 * which is the case that produces the off-by-one-day bug.
 */
const AHEAD = 'Pacific/Kiritimati';
const BEHIND = 'Pacific/Niue';

/** 2026-03-08T10:00Z: the 9th in Kiritimati, the 7th in Niue */
const ACROSS = new Date('2026-03-08T10:00:00.000Z');

/**
 * Runs something with the process fixed to a zone, and puts the zone back.
 *
 * `process.env.TZ` takes effect immediately on every runtime henri
 * supports, which is what lets this be a test rather than a spawned
 * process (checked on Node 22 and 23).
 *
 * @param {string} zone the zone to pin the process to
 * @param {function} fn what to run
 * @returns {*} whatever fn answered
 */
const withProcessZone = (zone, fn) => {
  const before = process.env.TZ;

  process.env.TZ = zone;

  try {
    return fn();
  } finally {
    typeof before === 'undefined'
      ? delete process.env.TZ
      : (process.env.TZ = before);
  }
};

/**
 * The error a call threw, as a value rather than a branch
 *
 * @param {function} fn what to run
 * @returns {Error} what it threw
 */
const thrownBy = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }

  return new Error('nothing was thrown');
};

/**
 * A henri look-alike carrying a configuration and a pen
 *
 * @param {object} [config={}] the configuration
 * @returns {object} the fake
 */
const fakeHenri = (config = {}) => {
  const logged = [];

  return {
    config: {
      get: (key) => config[key],
      has: (key) => Object.hasOwn(config, key),
    },
    logged,
    pen: {
      error: (...args) => logged.push(['error', ...args]),
      info: (...args) => logged.push(['info', ...args]),
      warn: (...args) => logged.push(['warn', ...args]),
    },
  };
};

/**
 * A booted module, against a fake henri
 *
 * @param {object} [config={}] the configuration
 * @returns {Promise<TimeModule>} the module
 */
const moduleWith = async (config = {}) => {
  const time = new TimeModule();

  time.henri = fakeHenri(config);
  await time.init();

  return time;
};

/**
 * Runs the middleware over a request-like object
 *
 * @param {object} time the module
 * @param {object} req the request
 * @returns {object} the request, decided
 */
const decide = (time, req) => {
  const res = { setHeader: () => {}, vary: () => {} };
  const request = Object.assign({ get: () => undefined }, req);

  middleware({ time })(request, res, () => {});

  return request;
};

describe('time zones', () => {
  describe('what a zone is', () => {
    test('Intl is the authority, and the canonical name is what comes back', () => {
      expect(canonical('America/New_York')).toBe('America/New_York');
      // An alias resolves, so a record holding either compares equal
      expect(canonical('US/Eastern')).toBe('America/New_York');
      expect(canonical('utc')).toBe('UTC');
      expect(canonical('Etc/UTC')).toBe('UTC');
    });

    test('anything Intl refuses is not a zone', () => {
      ['Mars/Olympus', 'EST5EDT4', '', null, undefined, 42, {}].forEach(
        (value) => expect(canonical(value)).toBe(null)
      );
      expect(isZone('Pacific/Niue')).toBe(true);
      expect(isZone('Nowhere/Nothing')).toBe(false);
    });
  });

  describe('the configuration', () => {
    test('absent is UTC, and not the zone the process happens to be in', () => {
      withProcessZone(AHEAD, () => {
        const settings = timeConfig({});

        expect(settings.default).toBe(DEFAULT_ZONE);
        expect(settings.default).toBe('UTC');
        expect(settings.configured).toBe(false);
        expect(settings.personal).toBe(false);
      });
    });

    test('a string is the shorthand for { default }', () => {
      expect(timeConfig({ timeZone: 'Europe/Paris' }).default).toBe(
        'Europe/Paris'
      );
      expect(
        timeConfig({ timeZone: { default: 'Europe/Paris' } }).default
      ).toBe('Europe/Paris');
    });

    test('the zone is stored canonical, so two spellings are one zone', () => {
      expect(timeConfig({ timeZone: 'US/Eastern' }).default).toBe(
        'America/New_York'
      );
    });

    test('a zone this runtime has no rules for fails the boot', () => {
      const error = thrownBy(() => timeConfig({ timeZone: 'Mars/Olympus' }));

      expect(error.code).toBe('HENRI_TIME_ZONE_UNKNOWN');
      expect(error.message).toContain('Mars/Olympus');
    });

    test('every from step is off until it is named', () => {
      const { from, personal } = timeConfig({ timeZone: 'UTC' });

      expect(from).toEqual({
        cookie: false,
        header: false,
        query: false,
        user: false,
      });
      expect(personal).toBe(false);
    });

    test('naming one step is what makes an application personal', () => {
      const settings = timeConfig({
        timeZone: { default: 'UTC', from: { user: 'timeZone' } },
      });

      expect(settings.from.user).toBe('timeZone');
      expect(settings.personal).toBe(true);
    });
  });

  describe('the module', () => {
    test('zone always answers, configured or not', async () => {
      expect((await moduleWith({})).zone).toBe('UTC');
      expect((await moduleWith({ timeZone: 'Europe/Paris' })).zone).toBe(
        'Europe/Paris'
      );
    });

    test('an application that said nothing gets no boot line', async () => {
      const time = await moduleWith({});

      expect(time.configured).toBe(false);
      expect(time.henri.logged).toEqual([]);
    });

    test('one that did says the zone and that storage is UTC', async () => {
      const time = await moduleWith({ timeZone: 'Europe/Paris' });
      const [line] = time.henri.logged;

      expect(line[0]).toBe('info');
      expect(line[1]).toBe('time');
      expect(line[2]).toBe('Europe/Paris');
      expect(line[3]).toContain('storage is UTC');
    });

    test('the boot line names the steps a person is read from', async () => {
      const time = await moduleWith({
        timeZone: { default: 'UTC', from: { cookie: 'tz', user: 'timeZone' } },
      });

      expect(time.henri.logged[0][3]).toContain('user, cookie');
    });
  });

  describe('where a request zone comes from', () => {
    test('nothing configured mounts nothing and decides the default', async () => {
      const time = await moduleWith({ timeZone: 'Europe/Paris' });

      expect(time.personal).toBe(false);
      expect(time.decide({})).toEqual({
        source: 'default',
        zone: 'Europe/Paris',
      });
    });

    test('the order is explicit, user, query, cookie, header, default', async () => {
      const time = await moduleWith({
        timeZone: {
          default: 'UTC',
          from: {
            cookie: 'tz',
            header: 'X-Time-Zone',
            query: 'tz',
            user: 'timeZone',
          },
        },
      });
      const everything = {
        cookies: { tz: 'Europe/Berlin' },
        get: () => 'Asia/Tokyo',
        query: { tz: 'Europe/Madrid' },
        user: { timeZone: 'Europe/Lisbon' },
      };

      expect(time.decide({ ...everything, _timeZone: 'Europe/Rome' })).toEqual({
        source: 'explicit',
        zone: 'Europe/Rome',
      });
      expect(time.decide(everything)).toEqual({
        source: 'user',
        zone: 'Europe/Lisbon',
      });
      expect(time.decide({ ...everything, user: null })).toEqual({
        source: 'query',
        zone: 'Europe/Madrid',
      });
      expect(time.decide({ ...everything, query: {}, user: null })).toEqual({
        source: 'cookie',
        zone: 'Europe/Berlin',
      });
      expect(
        time.decide({ ...everything, cookies: {}, query: {}, user: null })
      ).toEqual({ source: 'header', zone: 'Asia/Tokyo' });
      expect(
        time.decide({ cookies: {}, get: () => undefined, query: {} })
      ).toEqual({ source: 'default', zone: 'UTC' });
    });

    test('a step that is off is not read even when the value is there', async () => {
      const time = await moduleWith({ timeZone: { default: 'UTC' } });

      expect(
        time.decide({
          cookies: { tz: 'Europe/Berlin' },
          query: { tz: 'Europe/Madrid' },
          user: { timeZone: 'Europe/Lisbon' },
        })
      ).toEqual({ source: 'default', zone: 'UTC' });
    });

    test('a zone off the wire that is not a zone falls through', async () => {
      const time = await moduleWith({
        timeZone: { default: 'UTC', from: { cookie: 'tz' } },
      });

      expect(time.decide({ cookies: { tz: '../../etc/passwd' } })).toEqual({
        source: 'default',
        zone: 'UTC',
      });
    });

    test('the decision is on the request, where it can be read', async () => {
      const time = await moduleWith({
        timeZone: { default: 'UTC', from: { user: 'timeZone' } },
      });
      const req = decide(time, { user: { timeZone: 'Europe/Lisbon' } });

      expect(req.timeZone).toBe('Europe/Lisbon');
      expect(req.timeZoneSource).toBe('user');
    });

    test('setTimeZone says so, and refuses a zone that is not one', async () => {
      const time = await moduleWith({
        timeZone: { default: 'UTC', from: { user: 'timeZone' } },
      });
      const req = decide(time, {});

      expect(req.setTimeZone('US/Eastern')).toBe('America/New_York');
      expect(req.timeZone).toBe('America/New_York');
      expect(req.timeZoneSource).toBe('explicit');

      const error = thrownBy(() => req.setTimeZone('Mars/Olympus'));

      expect(error.code).toBe('HENRI_TIME_ZONE_UNKNOWN');
    });

    test('an answer that differs per person varies on what decided it', async () => {
      const time = await moduleWith({
        timeZone: {
          default: 'UTC',
          from: { cookie: 'tz', header: 'X-Time-Zone' },
        },
      });
      const varied = [];
      const res = { setHeader: () => {}, vary: (name) => varied.push(name) };

      middleware({ time })(
        { cookies: { tz: 'Europe/Berlin' }, get: () => undefined },
        res,
        () => {}
      );
      expect(varied).toEqual(['Cookie']);

      varied.length = 0;
      middleware({ time })(
        { cookies: {}, get: () => 'Asia/Tokyo' },
        res,
        () => {}
      );
      expect(varied).toEqual(['X-Time-Zone']);
    });
  });

  describe("a person's zone, from their record", () => {
    test('reads the column the configuration names', async () => {
      const time = await moduleWith({
        timeZone: { default: 'UTC', from: { user: 'timeZone' } },
      });

      expect(time.forUser({ timeZone: 'Europe/Lisbon' })).toBe('Europe/Lisbon');
      expect(time.forUser({ timeZone: 'US/Eastern' })).toBe('America/New_York');
    });

    test('answers null rather than guessing', async () => {
      const time = await moduleWith({
        timeZone: { default: 'UTC', from: { user: 'timeZone' } },
      });

      expect(time.forUser({ timeZone: 'Mars/Olympus' })).toBe(null);
      expect(time.forUser({})).toBe(null);
      expect(time.forUser(null)).toBe(null);
    });

    test('no column named means no zone on a record', async () => {
      const time = await moduleWith({ timeZone: 'UTC' });

      expect(time.forUser({ timeZone: 'Europe/Lisbon' })).toBe(null);
    });
  });

  describe('formatting', () => {
    test('the zone of the render decides the day, not the process', async () => {
      const time = await moduleWith({ timeZone: 'UTC' });

      [AHEAD, BEHIND, 'UTC'].forEach((processZone) =>
        withProcessZone(processZone, () =>
          expect(time.format(ACROSS, { locale: 'en-CA' })).toBe('2026-03-08')
        )
      );
    });

    test('the same instant is a different day in three zones', async () => {
      const time = await moduleWith({ timeZone: 'UTC' });
      const day = (zone) => time.format(ACROSS, { locale: 'en-CA', zone });

      expect(day('UTC')).toBe('2026-03-08');
      expect(day(AHEAD)).toBe('2026-03-09');
      expect(day(BEHIND)).toBe('2026-03-07');
    });

    test('Intl options are passed through untouched', async () => {
      const time = await moduleWith({ timeZone: 'UTC' });

      expect(time.format(ACROSS, { dateStyle: 'full', locale: 'en' })).toBe(
        'Sunday, March 8, 2026'
      );
      expect(
        time.format(ACROSS, {
          hour: '2-digit',
          hour12: false,
          locale: 'en-GB',
          minute: '2-digit',
          zone: AHEAD,
        })
      ).toBe('00:00');
    });

    test('a moment it cannot read is empty, not an exception', async () => {
      const time = await moduleWith({ timeZone: 'UTC' });

      expect(time.format('not a date')).toBe('');
      expect(time.format(null)).toBe('');
      expect(time.format(undefined)).toBe('');
    });

    test('a zone it cannot render in falls back rather than throwing', async () => {
      const time = await moduleWith({ timeZone: 'Europe/Paris' });

      expect(
        time.format(ACROSS, { locale: 'en-CA', zone: 'Mars/Olympus' })
      ).toBe('2026-03-08');
    });

    test('an ISO string and epoch milliseconds are the same moment', async () => {
      const time = await moduleWith({ timeZone: 'UTC' });
      const options = { locale: 'en-CA' };

      expect(time.format(ACROSS.toISOString(), options)).toBe('2026-03-08');
      expect(time.format(ACROSS.getTime(), options)).toBe('2026-03-08');
    });

    test('a DST boundary is the zone rules, not an offset henri kept', async () => {
      const time = await moduleWith({ timeZone: 'America/New_York' });
      const at = (iso) =>
        time.format(new Date(iso), {
          hour: '2-digit',
          hour12: false,
          locale: 'en-GB',
          minute: '2-digit',
        });

      // 2026-03-08 is the US spring forward: 06:59Z is 01:59 EST and one
      // minute later is 03:00 EDT. The 02:00 hour does not exist that day
      expect(at('2026-03-08T06:59:00Z')).toBe('01:59');
      expect(at('2026-03-08T07:00:00Z')).toBe('03:00');
    });
  });

  describe('what a view carries', () => {
    test('a decided request carries its zone and what decided it', () => {
      const zones = new Zones({
        henri: {},
        settings: timeConfig({ timeZone: 'UTC' }),
      });

      expect(zones.view({ source: 'user', zone: 'Europe/Lisbon' })).toEqual({
        source: 'user',
        zone: 'Europe/Lisbon',
      });
    });

    test('one that was never decided carries the application zone', () => {
      const zones = new Zones({
        henri: {},
        settings: timeConfig({ timeZone: 'Europe/Paris' }),
      });

      expect(zones.view(null)).toEqual({
        source: 'default',
        zone: 'Europe/Paris',
      });
      // The same frozen object every time: an application with no
      // per-person zone allocates nothing per request
      expect(zones.view(null)).toBe(zones.view(null));
    });
  });

  describe('the Handlebars helper', () => {
    /**
     * Renders a template through the engine's own environment
     *
     * @param {string} source the template
     * @param {object} context what it prints
     * @param {object} frame the data frame (`@time`, `@i18n`)
     * @param {object} [time] the time module
     * @returns {string} the html
     */
    const render = (source, context, frame, time) => {
      const engine = new TemplateEngine({ time });

      return engine.hbs.compile(source)(context, { data: frame });
    };

    test('prints in the zone of the render, not the process', async () => {
      const time = await moduleWith({ timeZone: 'UTC' });
      const frame = { time: { source: 'default', zone: 'UTC' } };

      [AHEAD, BEHIND].forEach((processZone) =>
        withProcessZone(processZone, () =>
          expect(
            render('{{date at locale="en-CA"}}', { at: ACROSS }, frame, time)
          ).toBe('2026-03-08')
        )
      );
    });

    test("a person's zone in the frame is what the page prints", async () => {
      const time = await moduleWith({
        timeZone: { default: 'UTC', from: { user: 'timeZone' } },
      });

      expect(
        render(
          '{{date at locale="en-CA"}}',
          { at: ACROSS },
          { time: { source: 'user', zone: AHEAD } },
          time
        )
      ).toBe('2026-03-09');
    });

    test("a timeZone in the hash still wins: the options are the caller's", async () => {
      const time = await moduleWith({ timeZone: 'UTC' });

      expect(
        render(
          '{{date at locale="en-CA" timeZone="Pacific/Niue"}}',
          { at: ACROSS },
          { time: { source: 'default', zone: 'UTC' } },
          time
        )
      ).toBe('2026-03-07');
    });

    test('with no frame it is the application zone', async () => {
      const time = await moduleWith({ timeZone: BEHIND });

      withProcessZone(AHEAD, () =>
        expect(
          render('{{date at locale="en-CA"}}', { at: ACROSS }, {}, time)
        ).toBe('2026-03-07')
      );
    });

    test('an engine with no time module still renders', () => {
      withProcessZone('UTC', () =>
        expect(
          render('{{date at locale="en-CA"}}', { at: ACROSS }, {}, undefined)
        ).toBe('2026-03-08')
      );
    });
  });

  describe('what a request carries in, parsed', () => {
    const { coerce, rule } = require('../base/params-schema');
    const compiled = rule({ type: 'date' }, 'moments#index', 'at');

    /**
     * One value through the parameter rules, as a query string carries it
     * (textual) or as a JSON body does (not)
     *
     * @param {string} given the text
     * @param {boolean} [textual=true] is the source textual?
     * @returns {Date} the moment the rule answered
     */
    const asQuery = (given, textual = true) =>
      coerce(compiled, given, textual).value;

    test('a moment with no offset is UTC, not the process zone', () => {
      [AHEAD, BEHIND, 'UTC'].forEach((processZone) =>
        withProcessZone(processZone, () =>
          expect(asQuery('2026-03-08T09:00:00').toISOString()).toBe(
            '2026-03-08T09:00:00.000Z'
          )
        )
      );
    });

    test('a bare date was already UTC and still is', () => {
      withProcessZone(AHEAD, () =>
        expect(asQuery('2026-03-08').toISOString()).toBe(
          '2026-03-08T00:00:00.000Z'
        )
      );
    });

    test('an offset that was written down is honoured', () => {
      withProcessZone(AHEAD, () => {
        expect(asQuery('2026-03-08T09:00:00Z').toISOString()).toBe(
          '2026-03-08T09:00:00.000Z'
        );
        expect(asQuery('2026-03-08T09:00:00+02:00').toISOString()).toBe(
          '2026-03-08T07:00:00.000Z'
        );
      });
    });
  });

  describe('the zone of a mail', () => {
    /**
     * A message on a fake henri carrying a time module
     *
     * @param {object} envelope what the action returned
     * @param {object} [defaults={}] the mailer's defaults
     * @param {object} [config] the configuration
     * @returns {Promise<Message>} the message
     */
    const messageWith = async (envelope, defaults = {}, config = null) => {
      const time = await moduleWith(
        config || {
          timeZone: { default: 'Europe/Paris', from: { user: 'timeZone' } },
        }
      );

      return new Message(
        { i18n: null, mailers: {}, server: null, time },
        { action: 'confirm', defaults, envelope, mailer: 'welcome' }
      );
    };

    test("is the recipient's, read from their record", async () => {
      const message = await messageWith({
        for: { email: 'ada@example.com', timeZone: AHEAD },
        to: 'ada@example.com',
      });

      expect(message.zone).toBe(AHEAD);
    });

    test('is what the action said, when it said one', async () => {
      const message = await messageWith({
        for: { timeZone: AHEAD },
        timeZone: BEHIND,
        to: 'ada@example.com',
      });

      expect(message.zone).toBe(BEHIND);
    });

    test("falls back to the mailer's defaults, then the application", async () => {
      expect(
        (await messageWith({ to: 'ada@example.com' }, { timeZone: BEHIND }))
          .zone
      ).toBe(BEHIND);
      expect((await messageWith({ to: 'ada@example.com' })).zone).toBe(
        'Europe/Paris'
      );
    });

    test('a recipient with no zone is the application zone', async () => {
      const message = await messageWith({
        for: { email: 'ada@example.com' },
        to: 'ada@example.com',
      });

      expect(message.zone).toBe('Europe/Paris');
    });

    test('the view reads it from the meta, source "message"', async () => {
      const message = await messageWith({
        for: { timeZone: AHEAD },
        to: 'ada@example.com',
      });

      expect(message.meta().time).toEqual({ source: 'message', zone: AHEAD });
    });

    test("the zone is the message's own and never reaches the transport", () => {
      // `render()` copies everything that is not in OWN into the
      // nodemailer payload, so this is what keeps `timeZone` out of it
      expect(OWN.has('timeZone')).toBe(true);
      expect(OWN.has('for')).toBe(true);
      expect(OWN.has('to')).toBe(false);
    });
  });
});

describe('time zones (demo app, disk store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  let henri;
  let request;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
    request = supertest(henri.server.app);
  }, 60000);

  afterAll(async () => {
    await henri.stop();
    delete global.henri;
    if (typeof skipWorkers === 'undefined') {
      delete process.env.SKIP_WORKERS;
    } else {
      process.env.SKIP_WORKERS = skipWorkers;
    }
  }, 60000);

  test('the application renders in the zone it configured', () => {
    expect(henri.time.zone).toBe('Europe/Paris');
    expect(henri.time.configured).toBe(true);
    expect(henri.time.personal).toBe(true);
  });

  test('a page is told the zone, and prints the day that zone is on', async () => {
    const answer = await request.get('/hello');

    expect(answer.text).toContain('<p id="zone">Europe/Paris/default</p>');
    // 2026-03-08T10:00Z is still the 8th in Paris
    expect(answer.text).toContain('<p id="when">2026-03-08</p>');
  });

  test('a zone on the request changes the day, and says which step said so', async () => {
    const ahead = await request.get('/hello?tz=Pacific/Kiritimati');

    expect(ahead.text).toContain('<p id="zone">Pacific/Kiritimati/query</p>');
    expect(ahead.text).toContain('<p id="when">2026-03-09</p>');

    const behind = await request.get('/hello?tz=Pacific/Niue');

    expect(behind.text).toContain('<p id="zone">Pacific/Niue/query</p>');
    expect(behind.text).toContain('<p id="when">2026-03-07</p>');
  });

  test("a zone that is not a zone falls through to the application's", async () => {
    const answer = await request.get('/hello?tz=Mars/Olympus');

    expect(answer.text).toContain('<p id="zone">Europe/Paris/default</p>');
    expect(answer.text).toContain('<p id="when">2026-03-08</p>');
  });

  test('the process zone decides nothing about what the page says', async () => {
    for (const zone of [AHEAD, BEHIND]) {
      const answer = await withProcessZone(zone, () => request.get('/hello'));

      expect(answer.text).toContain('<p id="when">2026-03-08</p>');
    }
  });
});
