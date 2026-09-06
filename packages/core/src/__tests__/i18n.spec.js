const fs = require('fs');
const os = require('os');
const path = require('path');
const supertest = require('supertest');

const Henri = require('../henri');
const I18nModule = require('../1.i18n');
const TemplateEngine = require('../engines/template');
const {
  CLIENT_PATH,
  Translator,
  chainOf,
  digestOf,
  flatten,
  i18nConfig,
  interpolate,
  isPluralForm,
  negotiate,
  readCatalogues,
  selectPlural,
} = require('../base/i18n');

const DEMO = path.resolve(__dirname, '../../../demo');

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
 * A henri look-alike: a configuration, a working directory and a pen that
 * keeps what it was told
 *
 * @param {object} [config={}] the configuration
 * @param {object} [flags={}] `cwd`, `isProduction`
 * @returns {object} the fake
 */
const fakeHenri = (config = {}, flags = {}) => {
  const logged = [];

  return {
    config: {
      get: (key) => config[key],
      has: (key) => Object.hasOwn(config, key),
    },
    cwd: () => flags.cwd || DEMO,
    isDev: !flags.isProduction,
    isProduction: Boolean(flags.isProduction),
    isTest: false,
    logged,
    pen: {
      error: (...args) => logged.push(['error', ...args]),
      info: (...args) => logged.push(['info', ...args]),
      warn: (...args) => logged.push(['warn', ...args]),
    },
  };
};

/**
 * Writes a throw-away application directory holding locale files
 *
 * @param {object} files `{ 'en.json': {...}, 'fr/nav.json': {...} }`
 * @returns {string} the application directory
 */
const appWith = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-i18n-'));

  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, 'config/locales', name);

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      typeof content === 'string' ? content : JSON.stringify(content)
    );
  }

  return root;
};

/**
 * A module, booted against a fake henri
 *
 * @param {object} config the configuration
 * @param {object} [flags={}] `cwd`, `isProduction`
 * @returns {Promise<I18nModule>} the module
 */
const moduleWith = async (config, flags = {}) => {
  const i18n = new I18nModule();

  i18n.henri = fakeHenri(config, flags);
  await i18n.init();

  return i18n;
};

describe('i18n', () => {
  describe('the catalogues on disk', () => {
    test('reads one file per locale, flattened to dotted keys', () => {
      const root = appWith({
        'en.json': { nav: { home: 'Home' }, title: 'Notes' },
        'fr.json': { nav: { home: 'Accueil' }, title: 'Notes' },
      });
      const { catalogues, problems } = readCatalogues(
        path.join(root, 'config/locales')
      );

      expect(problems).toEqual([]);
      expect(Object.keys(catalogues).sort()).toEqual(['en', 'fr']);
      expect(catalogues.en).toEqual({ 'nav.home': 'Home', title: 'Notes' });
    });

    test('reads a directory per locale, the file name as the prefix', () => {
      const root = appWith({
        'fr/nav.json': { home: 'Accueil' },
        'fr/notes.json': { title: 'Notes' },
      });
      const { catalogues } = readCatalogues(path.join(root, 'config/locales'));

      expect(catalogues.fr).toEqual({
        'nav.home': 'Accueil',
        'notes.title': 'Notes',
      });
    });

    test('ignores anything that is not named like a locale', () => {
      const root = appWith({
        'README.json': { a: 'b' },
        'en.json': { a: 'b' },
      });
      const { catalogues } = readCatalogues(path.join(root, 'config/locales'));

      expect(Object.keys(catalogues)).toEqual(['en']);
    });

    test('answers nothing at all for a directory that is not there', () => {
      expect(readCatalogues('/nowhere/at/all')).toEqual({
        catalogues: {},
        problems: [],
      });
    });

    test('numbers the entries of a list', () => {
      const out = flatten({ days: ['Mon', 'Tue'] }, '', {}, []);

      expect(out).toEqual({ 'days.0': 'Mon', 'days.1': 'Tue' });
    });

    test('refuses a value that is not text', () => {
      const problems = [];

      flatten({ count: 2, ok: true }, '', {}, problems);

      expect(problems).toEqual([
        'count is number, and a translation is text',
        'ok is boolean, and a translation is text',
      ]);
    });

    test('tells a plural form from a namespace by its "other"', () => {
      expect(isPluralForm({ one: '1', other: 'n' })).toBe(true);
      expect(isPluralForm({ '=0': 'none', other: 'n' })).toBe(true);
      // A namespace that happens to be called "one"
      expect(isPluralForm({ one: { a: 'b' } })).toBe(false);
      expect(isPluralForm({ other: 'n', title: 'x' })).toBe(false);
      expect(isPluralForm('a string')).toBe(false);
    });

    test('the digest follows the strings and nothing else', () => {
      const one = digestOf({ a: '1', b: '2' });

      // eslint-disable-next-line sort-keys -- the point is the other order
      expect(digestOf({ b: '2', a: '1' })).toBe(one);
      expect(digestOf({ a: '1', b: '3' })).not.toBe(one);
      expect(one).toMatch(/^[0-9a-f]{8}$/u);
    });
  });

  describe('the settings', () => {
    test('an application with no catalogue and no block is off', () => {
      const settings = i18nConfig({}, appWith({}));

      expect(settings.enabled).toBe(false);
      expect(settings.locales).toEqual([]);
    });

    test('a catalogue on disk is enough: no block is needed', () => {
      const settings = i18nConfig({}, appWith({ 'fr.json': { a: 'b' } }));

      expect(settings.enabled).toBe(true);
      expect(settings.locales).toEqual(['fr']);
      // No `en` on disk, so the one locale there is becomes the default
      expect(settings.default).toBe('fr');
    });

    test('`i18n: false` turns it off whatever is on disk', () => {
      const settings = i18nConfig(
        { i18n: false },
        appWith({ 'en.json': { a: 'b' } })
      );

      expect(settings.enabled).toBe(false);
    });

    test('the defaults are the documented ones', () => {
      const settings = i18nConfig({}, appWith({ 'en.json': { a: 'b' } }));

      expect(settings.client).toBe('auto');
      expect(settings.missing).toBe('auto');
      expect(settings.fallback).toBe(true);
      expect(settings.serverOnly).toEqual(['mailers']);
      expect(settings.from).toEqual({
        cookie: 'henri.locale',
        header: true,
        query: 'locale',
        user: null,
      });
    });
  });

  describe('interpolation', () => {
    test('fills {name} and leaves the rest alone', () => {
      expect(interpolate('Hi {name}, {name}!', { name: 'Ada' })).toBe(
        'Hi Ada, Ada!'
      );
      expect(interpolate('nothing here', {})).toBe('nothing here');
    });

    test('{{ and }} are the literal braces', () => {
      expect(interpolate('{{name}}', { name: 'Ada' })).toBe('{name}');
    });

    test('a value nobody passed stays visible as its placeholder', () => {
      const missed = [];

      expect(
        interpolate('Hi {name}', {}, { onMissing: (one) => missed.push(one) })
      ).toBe('Hi {name}');
      expect(missed).toEqual(['name']);
    });

    test('escapes the values when it is given something to escape with', () => {
      expect(
        interpolate(
          '<b>{name}</b>',
          { name: '<script>' },
          { escape: (one) => one.replace(/</gu, '&lt;') }
        )
      ).toBe('<b>&lt;script></b>');
    });
  });

  describe('plurals', () => {
    const forms = { '=0': 'none', one: 'one note', other: '{count} notes' };

    test('Intl.PluralRules picks the category', () => {
      expect(selectPlural(forms, 1, 'en')).toBe('one note');
      expect(selectPlural(forms, 5, 'en')).toBe('{count} notes');
      // French makes one of zero, and Intl knows that; henri does not
      expect(selectPlural({ one: 'un', other: 'des' }, 0, 'fr')).toBe('un');
      expect(selectPlural({ one: 'one', other: 'many' }, 0, 'en')).toBe('many');
    });

    test('an exact form wins over the category', () => {
      expect(selectPlural(forms, 0, 'en')).toBe('none');
    });

    test('a locale Intl will not take falls back to "other"', () => {
      expect(selectPlural(forms, 3, 'not a tag at all')).toBe('{count} notes');
    });

    test('anything that is not a number selects nothing', () => {
      expect(selectPlural(forms, Number.NaN, 'en')).toBe(null);
    });
  });

  describe('negotiating Accept-Language', () => {
    const have = ['en', 'fr', 'pt-BR'];

    test('the highest q value that is on disk wins', () => {
      expect(negotiate('de;q=0.9, fr;q=0.8, en;q=0.1', have)).toBe('fr');
    });

    test('a region falls back to its language, and back again', () => {
      expect(negotiate('fr-CA', have)).toBe('fr');
      expect(negotiate('pt', have)).toBe('pt-BR');
    });

    test('* takes the first one', () => {
      expect(negotiate('*', have)).toBe('en');
    });

    test('nothing it can use answers null', () => {
      expect(negotiate('de, es', have)).toBe(null);
      expect(negotiate('', have)).toBe(null);
      expect(negotiate(undefined, have)).toBe(null);
      expect(negotiate('en', [])).toBe(null);
    });

    test('a q of zero is a refusal, not a preference', () => {
      expect(negotiate('fr;q=0, en', have)).toBe('en');
    });
  });

  describe('the lookup chain', () => {
    const settings = (extra) =>
      Object.assign({ default: 'en', fallback: true }, extra);

    test('the locale, its language, then the default', () => {
      expect(chainOf('fr-CA', settings())).toEqual(['fr-CA', 'fr', 'en']);
    });

    test('fallback: false stops at the language', () => {
      expect(chainOf('fr-CA', settings({ fallback: false }))).toEqual([
        'fr-CA',
        'fr',
      ]);
    });

    test('a named fallback, and no locale twice', () => {
      expect(chainOf('fr', settings({ fallback: ['fr', 'es'] }))).toEqual([
        'fr',
        'es',
      ]);
    });
  });

  describe('the translator', () => {
    const build = (extra = {}, flags = {}) =>
      new Translator({
        henri: fakeHenri({}, flags),
        settings: Object.assign(
          {
            catalogues: {
              en: {
                greeting: 'Hello, {name}!',
                notes: { one: '{count} note', other: '{count} notes' },
                only: 'English only',
              },
              fr: { greeting: 'Bonjour, {name} !' },
            },
            default: 'en',
            dir: '/app/config/locales',
            fallback: true,
            from: {},
            locales: ['en', 'fr'],
            missing: 'auto',
            serverOnly: [],
          },
          extra
        ),
      });

    test('translates, interpolates and pluralizes', () => {
      const one = build();

      expect(one.t('greeting', { name: 'Ada' })).toBe('Hello, Ada!');
      expect(one.t('greeting', { name: 'Ada' }, { locale: 'fr' })).toBe(
        'Bonjour, Ada !'
      );
      expect(one.t('notes', { count: 1 })).toBe('1 note');
      expect(one.t('notes', { count: 7 })).toBe('7 notes');
    });

    test('a key the locale has not falls back, silently', () => {
      const one = build();

      expect(one.t('only', {}, { locale: 'fr' })).toBe('English only');
      expect(one.missing()).toEqual([]);
    });

    test('fallback: false makes that key missing', () => {
      const one = build({ fallback: false });

      expect(one.t('only', {}, { locale: 'fr' })).toBe('only');
    });

    test('a key nobody translated answers the key, never a guess', () => {
      const one = build();

      expect(one.t('nav.settings')).toBe('nav.settings');
      expect(one.missing()).toEqual([
        { key: 'nav.settings', locale: 'en', why: 'no key' },
      ]);
      expect(one.misses()).toBe(1);
    });

    test('a written default is used, and still recorded', () => {
      const one = build();

      expect(one.t('nav.settings', {}, { default: 'Settings' })).toBe(
        'Settings'
      );
      expect(one.missing()).toHaveLength(1);
    });

    test('warn says it once, whatever the number of lookups', () => {
      const one = build();

      one.t('nope');
      one.t('nope');

      expect(
        one.henri.logged.filter(([level]) => level === 'warn')
      ).toHaveLength(1);
    });

    test('throw is the mode that fails a build', () => {
      const one = build({ missing: 'throw' });

      expect(() => one.t('nope')).toThrow(/no "nope" in en/u);
      expect(thrownBy(() => one.t('nope')).code).toBe(
        'HENRI_LOCALE_TRANSLATION_MISSING'
      );
    });

    test('auto is warn outside production and key inside it', () => {
      expect(build().mode).toBe('warn');
      expect(build({}, { isProduction: true }).mode).toBe('key');
    });

    test('a plural entry with no count is missing, not a guess at "other"', () => {
      const one = build();

      expect(one.t('notes')).toBe('notes');
      expect(one.missing()).toEqual([
        { key: 'notes', locale: 'en', why: 'no count' },
      ]);
    });

    test('a key that is not a string is refused by code', () => {
      const one = build();

      expect(() => one.t(null)).toThrow(/t\(\) takes a key/u);
      expect(thrownBy(() => one.t(42)).code).toBe('HENRI_LOCALE_KEY_INVALID');
    });

    test('a locale the application has not is refused by name', () => {
      const one = build();
      const error = thrownBy(() => one.t('greeting', {}, { locale: 'de' }));

      expect(error.code).toBe('HENRI_LOCALE_UNKNOWN');
      expect(error.message).toContain('en, fr');
    });

    test('the record of what is missing is bounded', () => {
      const one = build();

      for (let index = 0; index < 1200; index++) {
        one.t(`key.${index}`);
      }

      expect(one.missing()).toHaveLength(1000);
      expect(one.misses()).toBe(1200);
    });

    test('serverOnly prefixes never reach the client catalogue', () => {
      const one = build({
        catalogues: { en: { 'mailers.hi': 'Hi', title: 'Notes' } },
        serverOnly: ['mailers'],
      });

      expect(one.catalogue('en')).toEqual({ title: 'Notes' });
      expect(one.t('mailers.hi')).toBe('Hi');
      expect(one.url('en')).toMatch(
        new RegExp(`^${CLIENT_PATH}/en\\.[0-9a-f]{8}\\.json$`, 'u')
      );
    });
  });

  describe('deciding the locale of a request', () => {
    const build = (from) =>
      new Translator({
        henri: fakeHenri(),
        settings: {
          catalogues: { en: {}, fr: {} },
          default: 'en',
          dir: '/x',
          fallback: true,
          from: Object.assign(
            {
              cookie: 'henri.locale',
              header: true,
              query: 'locale',
              user: null,
            },
            from
          ),
          locales: ['en', 'fr'],
          missing: 'auto',
          serverOnly: [],
        },
      });

    const req = (extra) =>
      Object.assign({ cookies: {}, get: () => undefined, query: {} }, extra);

    test('an explicit call wins over everything', () => {
      expect(
        build().decide(req({ _locale: 'fr', query: { locale: 'en' } }))
      ).toEqual({ locale: 'fr', source: 'explicit' });
    });

    test('then the user, when the application named a column', () => {
      expect(
        build({ user: 'locale' }).decide(req({ user: { locale: 'fr' } }))
      ).toEqual({ locale: 'fr', source: 'user' });
      // No column named: the user is not asked at all
      expect(build().decide(req({ user: { locale: 'fr' } })).source).toBe(
        'default'
      );
    });

    test('then the query, then the cookie, then the header', () => {
      expect(build().decide(req({ query: { locale: 'fr' } }))).toEqual({
        locale: 'fr',
        source: 'query',
      });
      expect(
        build().decide(req({ cookies: { 'henri.locale': 'fr' } }))
      ).toEqual({ locale: 'fr', source: 'cookie' });
      expect(build().decide(req({ get: () => 'fr-CA' }))).toEqual({
        locale: 'fr',
        source: 'header',
      });
    });

    test('a locale the application has not is not a locale', () => {
      expect(build().decide(req({ query: { locale: 'de' } })).source).toBe(
        'default'
      );
    });

    test('a step turned off is not consulted', () => {
      expect(
        build({ query: false }).decide(req({ query: { locale: 'fr' } })).source
      ).toBe('default');
      expect(
        build({ header: false }).decide(req({ get: () => 'fr' })).source
      ).toBe('default');
    });

    test('the recipient of a mail is read the same way', () => {
      const one = build({ user: 'locale' });

      expect(one.forUser({ locale: 'fr' })).toBe('fr');
      expect(one.forUser({ locale: 'de' })).toBe(null);
      expect(one.forUser(null)).toBe(null);
      expect(build().forUser({ locale: 'fr' })).toBe(null);
    });
  });

  describe('the module', () => {
    test('an application with one language has an inert module', async () => {
      const i18n = await moduleWith({}, { cwd: appWith({}) });

      expect(i18n.enabled).toBe(false);
      expect(i18n.locales).toEqual([]);
      expect(i18n.t('nav.home')).toBe('nav.home');
      expect(i18n.has('nav.home')).toBe(false);
      expect(i18n.supports('en')).toBe(false);
      expect(i18n.forUser({ locale: 'fr' })).toBe(null);
      expect(i18n.catalogue('en')).toEqual({});
      expect(i18n.url('en')).toBe(null);
      expect(i18n.view({ locale: 'en', source: 'default' })).toBe(null);
      expect(i18n.missing()).toEqual([]);
      // And it says nothing at all
      expect(i18n.henri.logged).toEqual([]);
    });

    test('a boot line, once there is something to say', async () => {
      const i18n = await moduleWith(
        {},
        { cwd: appWith({ 'en.json': { a: 'b' }, 'fr.json': { a: 'c' } }) }
      );

      expect(i18n.enabled).toBe(true);
      expect(i18n.henri.logged).toEqual([
        [
          'info',
          'i18n',
          'en, fr',
          '1 string, en by default, a missing key is said once, the client reads auto',
        ],
      ]);
    });

    test('a locale file henri cannot read fails the boot', async () => {
      const cwd = appWith({ 'en.json': '{ not json' });

      await expect(moduleWith({}, { cwd })).rejects.toThrow(/en\.json/u);
      await expect(moduleWith({}, { cwd })).rejects.toMatchObject({
        code: 'HENRI_LOCALE_CATALOGUE_INVALID',
      });
    });

    test('a configured locale with no catalogue fails the boot', async () => {
      const cwd = appWith({ 'en.json': { a: 'b' } });

      await expect(
        moduleWith({ i18n: { locales: ['en', 'de'] } }, { cwd })
      ).rejects.toMatchObject({ code: 'HENRI_LOCALE_UNKNOWN' });
    });

    test('a default nothing translates fails the boot', async () => {
      const cwd = appWith({ 'fr.json': { a: 'b' } });

      await expect(
        moduleWith({ i18n: { default: 'de' } }, { cwd })
      ).rejects.toThrow(/no catalogue for it/u);
    });

    test('a reload re-reads the files', async () => {
      const cwd = appWith({ 'en.json': { title: 'Notes' } });
      const i18n = await moduleWith({}, { cwd });

      expect(i18n.t('title')).toBe('Notes');

      fs.writeFileSync(
        path.join(cwd, 'config/locales/en.json'),
        JSON.stringify({ title: 'Memos' })
      );
      await i18n.reload();

      expect(i18n.t('title')).toBe('Memos');
    });

    test('view() carries the locale, embed() adds the strings', async () => {
      const i18n = await moduleWith(
        {},
        { cwd: appWith({ 'en.json': { title: 'Notes' } }) }
      );
      const carried = i18n.view({ locale: 'en', source: 'header' });

      expect(carried.messages).toBeUndefined();
      expect(carried.url).toMatch(
        /^\/_henri\/locales\/en\.[0-9a-f]{8}\.json$/u
      );
      expect(i18n.embed(carried).messages).toEqual({ title: 'Notes' });
    });

    test('client: always puts the strings in every answer', async () => {
      const i18n = await moduleWith(
        { i18n: { client: 'always' } },
        { cwd: appWith({ 'en.json': { title: 'Notes' } }) }
      );

      expect(i18n.view({ locale: 'en', source: 'default' }).messages).toEqual({
        title: 'Notes',
      });
    });

    test('client: false keeps the strings on the server', async () => {
      const i18n = await moduleWith(
        { i18n: { client: false } },
        { cwd: appWith({ 'en.json': { title: 'Notes' } }) }
      );
      const carried = i18n.view({ locale: 'en', source: 'default' });

      expect(carried).toEqual({ locale: 'en', source: 'default' });
      expect(i18n.embed(carried)).toEqual(carried);
      expect(i18n.url('en')).toBe(null);
    });
  });

  describe('the handlebars helpers', () => {
    /**
     * An engine whose henri translates, over a catalogue given here
     *
     * @param {object} catalogues the catalogues, by locale
     * @returns {TemplateEngine} the engine
     */
    const engineWith = (catalogues) => {
      const translator = new Translator({
        henri: fakeHenri(),
        settings: {
          catalogues,
          default: 'en',
          dir: '/x',
          fallback: true,
          from: {},
          locales: Object.keys(catalogues),
          missing: 'key',
          serverOnly: [],
        },
      });
      const henri = fakeHenri();

      henri.i18n = {
        enabled: true,
        supports: (one) => translator.supports(one),
        t: (...args) => translator.t(...args),
      };

      return new TemplateEngine(henri);
    };

    test('the translation goes out as written, the values escaped', () => {
      const engine = engineWith({
        en: { hi: 'Read <b>{name}</b>' },
      });
      const render = engine.hbs.compile('{{t "hi" name=name}}');

      expect(render({ name: '<script>x</script>' })).toBe(
        'Read <b>&lt;script&gt;x&lt;/script&gt;</b>'
      );
    });

    test('the plain part of a mail escapes nothing', () => {
      const engine = engineWith({ en: { hi: 'Hi {name}' } });
      const render = engine.hbs.compile('{{t "hi" name=name}}');

      expect(
        render(
          { name: 'A & B' },
          { data: { i18n: { locale: 'en', text: true } } }
        )
      ).toBe('Hi A & B');
      expect(
        render({ name: 'A & B' }, { data: { i18n: { locale: 'en' } } })
      ).toBe('Hi A &amp; B');
    });

    test('the locale comes from the data frame, or from the hash', () => {
      const engine = engineWith({ en: { hi: 'Hi' }, fr: { hi: 'Salut' } });

      expect(
        engine.hbs.compile('{{t "hi"}}')(
          {},
          { data: { i18n: { locale: 'fr' } } }
        )
      ).toBe('Salut');
      expect(engine.hbs.compile('{{t "hi" locale="fr"}}')({})).toBe('Salut');
    });

    test('number and date hand their hash to Intl, unchanged', () => {
      const engine = engineWith({ en: {} });
      const frame = { data: { i18n: { locale: 'fr-CA' } } };

      expect(
        engine.hbs.compile('{{number n style="percent"}}')({ n: 0.25 }, frame)
      ).toContain('25');
      expect(
        engine.hbs.compile('{{date d year="numeric"}}')(
          { d: '2020-06-15T00:00:00Z' },
          frame
        )
      ).toBe('2020');
      // Nothing to format is nothing printed, rather than "NaN"
      expect(engine.hbs.compile('{{number n}}')({ n: 'x' }, frame)).toBe('');
      expect(engine.hbs.compile('{{date d}}')({ d: 'x' }, frame)).toBe('');
    });

    test('an application with no catalogue gets the key back', () => {
      const engine = new TemplateEngine(fakeHenri());

      expect(engine.hbs.compile('{{t "nav.home"}}')({})).toBe('nav.home');
    });
  });
});

describe('i18n (demo app, disk store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  let henri;
  let app;
  let request;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
    app = henri.server.app;
    request = supertest(app);
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

  test('the demo application has two languages', () => {
    expect(henri.i18n.enabled).toBe(true);
    expect(henri.i18n.locales).toEqual(['en', 'fr']);
  });

  test('the default, and what says so', async () => {
    const answer = await request.get('/hello');

    expect(answer.headers['content-language']).toBe('en');
    expect(answer.text).toContain('Hello, Ada!');
    expect(answer.text).toContain('<p id="lang">en/default</p>');
    // Nothing was negotiated, so nothing varies on the header
    expect(answer.headers.vary || '').not.toContain('Accept-Language');
  });

  test('a query parameter, and it says which step answered', async () => {
    const answer = await request.get('/hello?locale=fr&name=Ada');

    expect(answer.headers['content-language']).toBe('fr');
    expect(answer.text).toContain('Bonjour, Ada !');
    expect(answer.text).toContain('<p id="lang">fr/query</p>');
  });

  test('Accept-Language, and the answer varies on it', async () => {
    const answer = await request
      .get('/hello')
      .set('Accept-Language', 'fr-CA,fr;q=0.9,en;q=0.1');

    expect(answer.headers['content-language']).toBe('fr');
    expect(answer.headers.vary).toContain('Accept-Language');
    expect(answer.text).toContain('<p id="lang">fr/header</p>');
  });

  test('a cookie henri reads and never writes', async () => {
    const answer = await request.get('/hello').set('Cookie', 'henri.locale=fr');

    expect(answer.text).toContain('<p id="lang">fr/cookie</p>');
    expect(
      (answer.headers['set-cookie'] || []).filter((one) =>
        one.startsWith('henri.locale=')
      )
    ).toEqual([]);
  });

  test('the values of a translation are escaped, the translation is not', async () => {
    const answer = await request.get('/hello?name=%3Cscript%3E');

    expect(answer.text).toContain('Hello, &lt;script&gt;!');
    // The <strong> is in the catalogue, so a person wrote it
    expect(answer.text).toContain(
      '<p id="html">Read <strong>the guide</strong></p>'
    );
  });

  test('the plural forms, and the exact one', async () => {
    expect((await request.get('/hello?count=0')).text).toContain(
      '<p id="notes">No notes yet</p>'
    );
    expect((await request.get('/hello?count=1')).text).toContain(
      '<p id="notes">1 note</p>'
    );
    expect((await request.get('/hello?count=4')).text).toContain(
      '<p id="notes">4 notes</p>'
    );
  });

  test('a key nobody translated is the key, and it is recorded', async () => {
    const answer = await request.get('/hello');

    expect(answer.text).toContain('<p id="missing">nothing.here</p>');
    expect(henri.i18n.missing().some((one) => one.key === 'nothing.here')).toBe(
      true
    );
  });

  test('the JSON answer of the same page carries the locale, no strings', async () => {
    const answer = await request
      .get('/hello?locale=fr')
      .set('Accept', 'application/json');

    expect(answer.body.i18n.locale).toBe('fr');
    expect(answer.body.i18n.source).toBe('query');
    expect(answer.body.i18n.messages).toBeUndefined();
    expect(answer.body.i18n.url).toMatch(/^\/_henri\/locales\/fr\./u);
  });

  test('the catalogue is served once, immutably, under its digest', async () => {
    const url = henri.i18n.url('fr');
    const answer = await request.get(url);

    expect(answer.status).toBe(200);
    expect(answer.headers['cache-control']).toContain('immutable');
    expect(answer.body.greeting).toBe('Bonjour, {name} !');
    // Written for a recipient, not for a reader
    expect(answer.body['mailers.welcome']).toBeUndefined();
  });

  test('a stale digest is a 404, not the current strings', async () => {
    expect((await request.get('/_henri/locales/fr.deadbeef.json')).status).toBe(
      404
    );
    expect((await request.get('/_henri/locales/de.deadbeef.json')).status).toBe(
      404
    );
  });

  describe('mails', () => {
    test('the locale of a mail is the recipient s, from their record', async () => {
      const message = henri.mailers.welcome.greet({
        email: 'ada@example.com',
        locale: 'fr',
        name: 'Ada',
      });

      expect(message.locale).toBe('fr');

      const rendered = await message.render();

      expect(rendered.html).toContain('Bienvenue, Ada');
      // `for` and `locale` are henri's, and never reach the transport
      expect(rendered.for).toBeUndefined();
      expect(rendered.locale).toBeUndefined();
    });

    test('a recipient who said nothing gets the default', async () => {
      const message = henri.mailers.welcome.greet({
        email: 'ada@example.com',
        name: 'Ada',
      });

      expect(message.locale).toBe('en');
      expect((await message.render()).html).toContain('Welcome aboard, Ada');
    });

    test('what the action said wins over the recipient', async () => {
      const message = henri.mailers.message(
        'welcome',
        'greet',
        [{ email: 'ada@example.com', locale: 'fr', name: 'Ada' }],
        { locale: 'en' }
      );

      expect(message.locale).toBe('en');
    });

    test('the html part escapes the values, the text part does not', async () => {
      const message = henri.mailers.welcome.greet({
        email: 'ada@example.com',
        name: 'A & B',
      });
      const { html, text } = await message.render();

      expect(html).toContain('Welcome aboard, A &amp; B');
      expect(text).toContain('Welcome aboard, A & B');
    });
  });
});
