const fs = require('fs');
const path = require('path');

const {
  ALPHABET,
  DECLARATION,
  EMPTY,
  KEYS,
  MASS_WRITE,
  MAX_LENGTH,
  RESERVED,
  SLUG,
  SUFFIX_LENGTH,
  discriminate,
  emptySlug,
  lengthOf,
  looksLikeUuid,
  massWrite,
  problemOf,
  slugFor,
  slugOf,
  slugify,
  writesSource,
} = require('../base/slug');

/** A model file that asks for a slug */
const model = (slug, schema = { title: { type: 'string' } }) => ({
  globalId: 'Article',
  identity: 'article',
  options: { slug },
  schema,
});

/** The compiled declaration of a model that asks for one */
const declared = (slug, schema) => slugOf(model(slug, schema));

/** What a declaration was refused with */
const refusalOf = (slug, schema) => {
  try {
    slugOf(model(slug, schema));
  } catch (error) {
    return `${error.code}: ${error.message}`;
  }

  return null;
};

describe('slugs', () => {
  describe('the copies in the adapters', () => {
    // Each adapter holds its own, the way `exact.js`, `external-id.js` and
    // `validations.js` are held: an adapter depends on no part of core at
    // runtime. Nothing but this test keeps them the same file.
    const root = path.join(__dirname, '..', '..', '..');
    const source = fs.readFileSync(
      path.join(root, 'core', 'src', 'base', 'slug.js'),
      'utf8'
    );

    for (const adapter of ['drizzle', 'mongoose', 'sequelize']) {
      test(`@usehenri/${adapter} carries the same file, byte for byte`, () => {
        const copy = fs.readFileSync(
          path.join(root, adapter, 'slug.js'),
          'utf8'
        );

        expect(copy).toBe(source);
      });

      test(`@usehenri/${adapter} publishes it`, () => {
        const manifest = JSON.parse(
          fs.readFileSync(path.join(root, adapter, 'package.json'), 'utf8')
        );

        expect(manifest.files).toContain('slug.js');
      });
    }

    test('it reaches for nothing at all', () => {
      // A copy sits at the root of an adapter, so the safest number of
      // requires it can make is none
      expect(source.match(/require\('[^']+'\)/gu)).toBeNull();
    });

    test('no regular expression touches a title', () => {
      // A title arrives through `req.permit()`, and a slugifier is the
      // shape that turns into a quadratic match. Everything here walks, so
      // the code under the comments holds no pattern and no match at all
      const code = source
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .replace(/^\s*\/\/.*$/gmu, '');

      for (const forbidden of ['RegExp', '.test(', '.match(', '.replace(']) {
        expect(code).not.toContain(forbidden);
      }
    });
  });

  describe('slugify', () => {
    test('makes a name out of a sentence', () => {
      expect(slugify('How we ship')).toBe('how-we-ship');
      expect(slugify('  Hello   World  ')).toBe('hello-world');
      expect(slugify('Getting started!')).toBe('getting-started');
      expect(slugify('2024')).toBe('2024');
    });

    test('folds what Unicode decomposes, without a transliteration table', () => {
      expect(slugify('Café Crème')).toBe('cafe-creme');
      expect(slugify('Ostrów Wielkopolski')).toBe('ostrow-wielkopolski');
      expect(slugify('ﬁnal — draft')).toBe('final-draft');
    });

    test('folds the eleven Latin letters Unicode does not', () => {
      expect(slugify('Straße in Köln')).toBe('strasse-in-koln');
      expect(slugify('Æther & Øre')).toBe('aether-ore');
      expect(slugify('Łódź')).toBe('lodz');
    });

    test('answers nothing for a script it folds nothing to', () => {
      // The honest half: henri ships no romanization, and says so
      expect(slugify('こんにちは')).toBe('');
      expect(slugify('مرحبا')).toBe('');
      expect(slugify('Привет мир')).toBe('');
    });

    test('answers nothing for what is not text', () => {
      expect(slugify('')).toBe('');
      expect(slugify(null)).toBe('');
      expect(slugify(undefined)).toBe('');
      expect(slugify({})).toBe('');
      expect(slugify([1, 2])).toBe('');
    });

    test('is bounded, and the bound is applied while it walks', () => {
      expect(slugify('a'.repeat(500))).toHaveLength(MAX_LENGTH);
      expect(slugify('a'.repeat(500), 10)).toHaveLength(10);
      expect(slugify(`${'a'.repeat(500)} ${'b'.repeat(500)}`, 10)).toBe(
        'aaaaaaaaaa'
      );
    });

    test('never begins or ends with a separator, and never doubles one', () => {
      for (const title of [
        '   ',
        '- a -',
        '!!a!!b!!',
        '.. a ..',
        'a---b',
        '💥 boom 💥',
      ]) {
        const slug = slugify(title);

        expect(slug.startsWith('-')).toBe(false);
        expect(slug.endsWith('-')).toBe(false);
        expect(slug.includes('--')).toBe(false);
      }
    });
  });

  describe('looksLikeUuid', () => {
    test('tells the two identifier spaces apart', () => {
      expect(looksLikeUuid('01a07d06-e6c4-73cd-9021-31eb06befdd7')).toBe(true);
      expect(looksLikeUuid('01A07D06-E6C4-73CD-9021-31EB06BEFDD7')).toBe(true);
      expect(looksLikeUuid('how-we-ship')).toBe(false);
      expect(looksLikeUuid('4812')).toBe(false);
      expect(looksLikeUuid('01a07d06-e6c4-73cd-9021-31eb06befdd')).toBe(false);
      expect(looksLikeUuid('01a07d06-e6c4-73cd-9021-31eb06befdd7x')).toBe(
        false
      );
      expect(looksLikeUuid('zzzzzzzz-e6c4-73cd-9021-31eb06befdd7')).toBe(false);
    });
  });

  describe('discriminate', () => {
    test('is six characters of an alphabet with no look-alikes', () => {
      expect(discriminate('01a07d06-e6c4-73cd-9021-31eb06befdd7')).toHaveLength(
        SUFFIX_LENGTH
      );

      for (const character of discriminate(null)) {
        expect(ALPHABET).toContain(character);
      }

      expect(ALPHABET).not.toContain('0');
      expect(ALPHABET).not.toContain('1');
      expect(ALPHABET).not.toContain('l');
      expect(ALPHABET).not.toContain('o');
    });

    test('is the same for the same public identifier', () => {
      const seed = '01a07d06-e6c4-73cd-9021-31eb06befdd7';

      expect(discriminate(seed)).toBe(discriminate(seed));
    });

    test('is not the same for two of them', () => {
      expect(discriminate('01a07d06-e6c4-73cd-9021-31eb06befdd7')).not.toBe(
        discriminate('01a07d06-e6c4-73cd-9021-000000000000')
      );
    });

    test('falls back to randomness with no seed to take', () => {
      expect(discriminate(null)).toHaveLength(SUFFIX_LENGTH);
      expect(discriminate('short')).toHaveLength(SUFFIX_LENGTH);
    });
  });

  describe('the declaration', () => {
    test('is a field name, or an object', () => {
      expect(declared('title')).toEqual({
        from: 'title',
        maxLength: MAX_LENGTH,
        on: 'create',
        reserved: new Set(RESERVED),
        suffix: true,
      });
      expect(declared({ from: 'title', on: 'change', suffix: false })).toEqual({
        from: 'title',
        maxLength: MAX_LENGTH,
        on: 'change',
        reserved: new Set(RESERVED),
        suffix: false,
      });
    });

    test('is null when a model asks for none', () => {
      expect(slugOf({ globalId: 'Article', schema: {} })).toBeNull();
      expect(declared(undefined)).toBeNull();
      expect(declared(null)).toBeNull();
      expect(declared(false)).toBeNull();
    });

    test('adds to the reserved words rather than replacing them', () => {
      const compiled = declared({ from: 'title', reserved: ['Search'] });

      expect(compiled.reserved.has('new')).toBe(true);
      expect(compiled.reserved.has('search')).toBe(true);
    });

    test('refuses a "from" the schema does not declare', () => {
      expect(refusalOf('headline')).toContain(DECLARATION);
      expect(refusalOf('headline')).toContain('the schema does not declare');
    });

    test('refuses a "from" that is not made of words', () => {
      expect(refusalOf('views', { views: { type: 'integer' } })).toContain(
        'not a string or a text'
      );
    });

    test('refuses a "from" that is encrypted', () => {
      expect(
        refusalOf('title', { title: { encrypted: true, type: 'string' } })
      ).toContain('which is encrypted');
    });

    test('refuses a "from" that never leaves the server', () => {
      expect(
        refusalOf('title', {
          title: { personal: { expose: false }, type: 'string' },
        })
      ).toContain('personal: { expose: false }');
      // A plain `personal: true` field is public, so it may name a record
      expect(
        refusalOf('title', { title: { personal: true, type: 'string' } })
      ).toBeNull();
    });

    test('refuses a schema that declares the column itself', () => {
      expect(
        refusalOf('title', {
          slug: { type: 'string' },
          title: { type: 'string' },
        })
      ).toContain('a "slug" field of its own');
    });

    test('refuses a slug built from itself', () => {
      expect(refusalOf('slug')).toContain('cannot be built from itself');
    });

    test('refuses an unknown key, naming the ones it takes', () => {
      const refused = refusalOf({ from: 'title', history: true });

      expect(refused).toContain('the unknown key "history"');

      for (const key of KEYS) {
        expect(refused).toContain(key);
      }
    });

    test('refuses a wrong value for every key', () => {
      expect(refusalOf({ from: 'title', on: 'save' })).toContain(
        'an "on" of "save"'
      );
      expect(refusalOf({ from: 'title', suffix: 'yes' })).toContain(
        'a "suffix" that is not true or false'
      );
      expect(refusalOf({ from: 'title', maxLength: 0 })).toContain(
        'a "maxLength" that is not a whole number'
      );
      expect(refusalOf({ from: 'title', reserved: 'new' })).toContain(
        'a "reserved" that is not a list of words'
      );
      expect(refusalOf(42)).toContain('number:');
    });
  });

  describe('the length of the column', () => {
    test('holds the name and its discriminator', () => {
      expect(lengthOf(declared('title'))).toBe(MAX_LENGTH + SUFFIX_LENGTH + 1);
      expect(lengthOf(declared({ from: 'title', suffix: false }))).toBe(
        MAX_LENGTH
      );
    });
  });

  describe('slugFor', () => {
    const seed = '01a07d06-e6c4-73cd-9021-31eb06befdd7';

    test('appends the discriminator by default', () => {
      const slug = slugFor(declared('title'), 'How we ship', seed);

      expect(slug.startsWith('how-we-ship-')).toBe(true);
      expect(slug).toHaveLength('how-we-ship-'.length + SUFFIX_LENGTH);
    });

    test('is the discriminator alone when the source folds to nothing', () => {
      expect(slugFor(declared('title'), 'こんにちは', seed)).toHaveLength(
        SUFFIX_LENGTH
      );
    });

    test('is the folded source alone with suffix: false', () => {
      const compiled = declared({ from: 'title', suffix: false });

      expect(slugFor(compiled, 'How we ship', seed)).toBe('how-we-ship');
      expect(slugFor(compiled, 'こんにちは', seed)).toBe('');
    });
  });

  describe('problemOf', () => {
    const compiled = declared('title');

    test('takes a name in any script', () => {
      expect(problemOf('how-we-ship', compiled)).toBeNull();
      expect(problemOf('こんにちは', compiled)).toBeNull();
      expect(problemOf('привет', compiled)).toBeNull();
      expect(problemOf('4812', compiled)).toBeNull();
      expect(problemOf('a.b', compiled)).toBeNull();
    });

    test('refuses what would stop being one path segment', () => {
      expect(problemOf('a/b', compiled)).toBe('must not hold "/"');
      expect(problemOf('a?b', compiled)).toBe('must not hold "?"');
      expect(problemOf('a#b', compiled)).toBe('must not hold "#"');
      expect(problemOf('a%2Fb', compiled)).toBe('must not hold "%"');
      expect(problemOf('a b', compiled)).toBe(
        'must not hold a space or a control character'
      );
      expect(problemOf('a\nb', compiled)).toBe(
        'must not hold a space or a control character'
      );
    });

    test('refuses a name shaped like a public identifier', () => {
      expect(problemOf('01a07d06-e6c4-73cd-9021-31eb06befdd7', compiled)).toBe(
        'must not be shaped like a public identifier'
      );
    });

    test('refuses a path henri already mounts', () => {
      expect(problemOf('new', compiled)).toContain('must not be "new"');
      expect(problemOf('NEW', compiled)).toContain('must not be "NEW"');
      expect(problemOf('..', compiled)).toContain('must not be ".."');
    });

    test('refuses nothing, and too much', () => {
      expect(problemOf('', compiled)).toBe('is required');
      expect(problemOf(42, compiled)).toBe('must be a string');
      expect(problemOf('a'.repeat(200), compiled)).toContain(
        `at most ${lengthOf(compiled)}`
      );
    });

    test('measures characters rather than code units', () => {
      // Four astral characters are eight code units and four columns of a
      // url, and a bound that counted the other thing would refuse them
      expect(problemOf('💥💥💥💥', compiled)).toBeNull();
    });
  });

  describe('writesSource', () => {
    const compiled = declared('title');

    test('is true only when the write names the field the slug comes from', () => {
      expect(writesSource(compiled, { title: 'x' })).toBe(true);
      expect(writesSource(compiled, { title: null })).toBe(true);
      expect(writesSource(compiled, { body: 'x' })).toBe(false);
      expect(writesSource(compiled, null)).toBe(false);
      expect(writesSource(null, { title: 'x' })).toBe(false);
    });
  });

  describe('the refusals', () => {
    test('the empty one names the field and what it held', () => {
      const error = emptySlug('Article', declared('title'), 'こんにちは');

      expect(error.code).toBe(EMPTY);
      expect(error.message).toContain('Article.title');
      expect(error.message).toContain('こんにちは');
      expect(error.message).toContain('suffix');
    });

    test('the mass write one names the loop', () => {
      const error = massWrite(
        'Article',
        declared({ from: 'title', on: 'change' }),
        'update',
        'update(attrs)'
      );

      expect(error.code).toBe(MASS_WRITE);
      expect(error.message).toContain('Article.update()');
      expect(error.message).toContain('await record.update(attrs)');
    });
  });

  test('the column is always called slug', () => {
    expect(SLUG).toBe('slug');
  });
});
