const fs = require('fs');
const path = require('path');

const {
  BIGINT_MAX,
  BIGINT_MIN,
  DEFAULT_PRECISION,
  DEFAULT_SCALE,
  EXACT_TYPES,
  canonical,
  canonicalInteger,
  checkSettings,
  compare,
  isExact,
  literalOf,
  settingsOf,
  toNumber,
} = require('../base/exact');

/** The settings a field gets when it says nothing */
const settings = { precision: DEFAULT_PRECISION, scale: DEFAULT_SCALE };

/** Two decimal places, which is what money looks like */
const money = { precision: 12, scale: 2 };

describe('exact numbers', () => {
  test('there are two of them and they are the ones a number cannot carry', () => {
    expect(EXACT_TYPES).toEqual(['bigint', 'decimal']);
    expect(isExact('decimal')).toBe(true);
    expect(isExact('bigint')).toBe(true);
    expect(isExact('number')).toBe(false);
    expect(isExact('float')).toBe(false);
  });

  describe('the copies in the adapters', () => {
    // Each adapter holds its own, the way `external-id.js` and
    // `encrypted.js` are held: an adapter depends on no part of core at
    // runtime. Nothing but this test keeps them the same file.
    const root = path.join(__dirname, '..', '..', '..');
    const source = fs.readFileSync(
      path.join(root, 'core', 'src', 'base', 'exact.js'),
      'utf8'
    );

    for (const adapter of ['drizzle', 'mongoose', 'sequelize']) {
      test(`@usehenri/${adapter} carries the same file, byte for byte`, () => {
        const copy = fs.readFileSync(
          path.join(root, adapter, 'exact.js'),
          'utf8'
        );

        expect(copy).toBe(source);
      });

      test(`@usehenri/${adapter} publishes it`, () => {
        const manifest = JSON.parse(
          fs.readFileSync(path.join(root, adapter, 'package.json'), 'utf8')
        );

        expect(manifest.files).toContain('exact.js');
      });
    }
  });

  describe('a decimal', () => {
    test('is the digits, padded to the scale', () => {
      expect(canonical('19.99', money)).toEqual({ value: '19.99' });
      expect(canonical('19.9', money)).toEqual({ value: '19.90' });
      expect(canonical('19', money)).toEqual({ value: '19.00' });
      expect(canonical('.5', money)).toEqual({ value: '0.50' });
      expect(canonical('-2.5', money)).toEqual({ value: '-2.50' });
    });

    test('keeps the literal a person wrote, through a javascript number', () => {
      // `String(19.99)` is the shortest representation that round-trips,
      // so the literal survives even though the double did not hold it
      expect(canonical(19.99, money)).toEqual({ value: '19.99' });
      expect(canonical(0.1, settings)).toEqual({ value: '0.1000' });
    });

    test('refuses arithmetic that already lost the value', () => {
      expect(canonical(0.1 + 0.2, settings).error).toMatch(
        /at most 4 decimal places/u
      );
      expect(canonical(1 / 3, settings).error).toMatch(
        /at most 4 decimal places/u
      );
    });

    test('reads an exponent, because a javascript number writes one', () => {
      expect(canonical('1e3', money)).toEqual({ value: '1000.00' });
      expect(canonical('1.5e-3', settings)).toEqual({ value: '0.0015' });
      expect(canonical(1e21, { precision: 30, scale: 0 })).toEqual({
        value: '1000000000000000000000',
      });
    });

    test('does not count trailing zeros as decimal places', () => {
      expect(canonical('19.9900', money)).toEqual({ value: '19.99' });
      expect(canonical('19.999', money).error).toMatch(
        /at most 2 decimal places/u
      );
    });

    test('counts the digits before the point against the precision', () => {
      expect(canonical('9999999999.99', money)).toEqual({
        value: '9999999999.99',
      });
      expect(canonical('99999999999.99', money).error).toMatch(
        /at most 10 digits before the decimal point/u
      );
    });

    test('has one spelling of zero, with no sign', () => {
      expect(canonical('-0.0000', settings)).toEqual({ value: '0.0000' });
      expect(canonical(0, money)).toEqual({ value: '0.00' });
    });

    test('is a number or nothing', () => {
      for (const value of ['', 'nineteen', '0x10', 'Infinity', NaN, {}, true]) {
        expect(canonical(value, money).error).toBe('must be a decimal number');
      }
    });

    test('with a scale of zero is a whole number', () => {
      const whole = { precision: 10, scale: 0 };

      expect(canonical('42', whole)).toEqual({ value: '42' });
      expect(canonical('42.5', whole).error).toBe('must be a whole number');
    });
  });

  describe('a bigint', () => {
    test('takes both ends of the signed 64-bit range', () => {
      expect(canonicalInteger(BIGINT_MAX)).toEqual({ value: BIGINT_MAX });
      expect(canonicalInteger(BIGINT_MIN)).toEqual({ value: BIGINT_MIN });
    });

    test('refuses a value past it, rather than wrapping', () => {
      expect(canonicalInteger('9223372036854775808').error).toBe(
        `must be between ${BIGINT_MIN} and ${BIGINT_MAX}`
      );
    });

    test('takes a BigInt, a safe number and a string', () => {
      expect(canonicalInteger(42n)).toEqual({ value: '42' });
      expect(canonicalInteger(42)).toEqual({ value: '42' });
      expect(canonicalInteger('+007')).toEqual({ value: '7' });
      expect(canonicalInteger('-0')).toEqual({ value: '0' });
    });

    test('refuses a number that is not exact, rather than rounding it', () => {
      expect(canonicalInteger(2 ** 60).error).toMatch(/pass it as a string/u);
      expect(canonicalInteger(1.5).error).toBe('must be a whole number');
    });

    test('is a whole number or nothing', () => {
      for (const value of ['1.0', '1e3', 'x', '', {}, null]) {
        expect(canonicalInteger(value).error).toBe('must be a whole number');
      }
    });
  });

  describe('the settings of a decimal', () => {
    test('default to 19 digits with 4 after the point', () => {
      expect(settingsOf({})).toEqual({ precision: 19, scale: 4 });
      expect(settingsOf({ scale: 2 })).toEqual({ precision: 19, scale: 2 });
    });

    test('refuse a precision no dialect carries', () => {
      expect(checkSettings('decimal', { precision: 39 })).toMatch(
        /between 1 and 38/u
      );
      expect(checkSettings('decimal', { precision: 0 })).toMatch(
        /between 1 and 38/u
      );
    });

    test('refuse a scale bigger than the precision', () => {
      expect(checkSettings('decimal', { precision: 4, scale: 6 })).toMatch(
        /more than its precision/u
      );
    });

    test('refuse a fraction of a digit', () => {
      expect(checkSettings('decimal', { scale: 1.5 })).toMatch(
        /not a whole number/u
      );
      expect(checkSettings('decimal', { precision: -2 })).toMatch(
        /not a whole number/u
      );
    });

    test('belong to a decimal and to nothing else', () => {
      expect(checkSettings('bigint', { scale: 2 })).toBe(
        "takes no 'scale': only a decimal has one"
      );
      expect(checkSettings('string', { precision: 4 })).toBe(
        "takes no 'precision': only a decimal has one"
      );
      expect(checkSettings('bigint', {})).toBeNull();
      expect(checkSettings('decimal', {})).toBeNull();
    });
  });

  describe('comparing', () => {
    test('is by value and not by letter', () => {
      // The one a text column gets wrong, and the reason sqlite casts
      expect(compare('9.99', '10')).toBe(-1);
      expect(compare('100.50', '99')).toBe(1);
    });

    test('reads the sign before the magnitude', () => {
      expect(compare('-2', '-10')).toBe(1);
      expect(compare('-1', '1')).toBe(-1);
      expect(compare('0', '-0')).toBe(0);
    });

    test('ignores how a value was spelled', () => {
      expect(compare('5', '5.00')).toBe(0);
      expect(compare('5e0', '5')).toBe(0);
    });

    test('is exact past what a double carries', () => {
      expect(compare('9007199254740993', '9007199254740992')).toBe(1);
      expect(compare('1.0000000000000001', '1')).toBe(1);
    });

    test('answers null when either side is not a number', () => {
      expect(compare('x', '1')).toBeNull();
      expect(compare('1', undefined)).toBeNull();
    });
  });

  describe('the pieces the adapters reach for', () => {
    test('literalOf writes an exponent out', () => {
      expect(literalOf('1e3')).toBe('1000');
      expect(literalOf(1e-7)).toBe('0.0000001');
      expect(literalOf(9n)).toBe('9');
      expect(literalOf('nope')).toBeNull();
      expect(literalOf(Infinity)).toBeNull();
    });

    test('toNumber is the double a dialect without the type compares through', () => {
      expect(toNumber('19.99')).toBe(19.99);
      expect(Number.isNaN(toNumber('x'))).toBe(true);
    });
  });
});
