const {
  contentDisposition,
  isKey,
  keyFor,
  safeName,
  safePrefix,
} = require('../src/names');

describe('the original name', () => {
  test.each([
    ['../../etc/passwd', 'passwd'],
    ['..\\..\\windows\\system32\\cmd.exe', 'cmd.exe'],
    ['/etc/shadow', 'shadow'],
    ['C:\\boot.ini', 'boot.ini'],
    ['....//....//etc/passwd', 'passwd'],
    ['..', 'file'],
    ['.', 'file'],
    ['...', 'file'],
    ['', 'file'],
    ['   ', 'file'],
    ['.htaccess', 'htaccess'],
    ['.env', 'env'],
    ['photo.png', 'photo.png'],
    ['a b c.png', 'a b c.png'],
    ['résumé.pdf', 'résumé.pdf'],
    ['trailing.  ', 'trailing'],
  ])('%s becomes %s', (given, expected) => {
    expect(safeName(given)).toBe(expected);
  });

  test('a NUL byte, and everything else that is not printable, is removed', () => {
    expect(safeName('shell\u0000.png')).toBe('shell.png');
    expect(safeName('a\u0007b\u001bc.png')).toBe('abc.png');
    expect(safeName('a\nb.png')).toBe('ab.png');
  });

  test('the characters a shell or a filesystem would read are removed', () => {
    expect(safeName('a"b<c>d|e*f?g:h.png')).toBe('abcdefgh.png');
  });

  test('a windows device name cannot be one', () => {
    expect(safeName('CON')).toBe('_CON');
    expect(safeName('con.txt')).toBe('_con.txt');
    expect(safeName('LPT9.png')).toBe('_LPT9.png');
    expect(safeName('COMPANY.txt')).toBe('COMPANY.txt');
  });

  test('a name of four thousand characters is cut, keeping its extension', () => {
    const long = `${'a'.repeat(4000)}.png`;
    const kept = safeName(long);

    expect(kept).toHaveLength(255);
    expect(kept.endsWith('.png')).toBe(true);
  });

  test('anything that is not a string is a name all the same', () => {
    expect(safeName(null)).toBe('file');
    expect(safeName(42)).toBe('file');
    expect(safeName(undefined)).toBe('file');
  });
});

describe('the stored name', () => {
  test('is generated: nothing the client sent takes part in it', () => {
    const key = keyFor({ extension: 'png' });

    expect(key).toMatch(/^\d{4}\/\d{2}\/[0-9a-f]{32}\.png$/u);
    expect(isKey(key)).toBe(true);
  });

  test('two keys are never the same', () => {
    const keys = new Set(
      Array.from({ length: 500 }, () => keyFor({ extension: 'bin' }))
    );

    expect(keys.size).toBe(500);
  });

  test('a prefix is reduced to what a key may hold', () => {
    expect(safePrefix('artworks')).toBe('artworks');
    expect(safePrefix('../../etc')).toBe('etc');
    expect(safePrefix('a/b/c/d/e/f')).toBe('a/b/c/d');
    expect(safePrefix('Users/../..')).toBe('users');
    expect(safePrefix('...')).toBeNull();
    expect(safePrefix(42)).toBeNull();
    expect(isKey(keyFor({ extension: 'png', prefix: '../../etc' }))).toBe(true);
  });

  test('a storage refuses anything henri did not generate', () => {
    expect(isKey('../../etc/passwd')).toBe(false);
    expect(isKey('/etc/passwd')).toBe(false);
    expect(isKey('2026/09/../../../etc/passwd')).toBe(false);
    expect(isKey('2026/09/abc.png')).toBe(false);
    expect(isKey(`2026/09/${'0'.repeat(32)}.png\u0000.txt`)).toBe(false);
    expect(isKey('')).toBe(false);
    expect(isKey(null)).toBe(false);
    expect(isKey(`${'a/'.repeat(400)}${'0'.repeat(32)}.png`)).toBe(false);
  });
});

describe('handing a name to a browser', () => {
  test('is an attachment, in both encodings', () => {
    expect(contentDisposition('résumé.pdf')).toBe(
      'attachment; filename="r_sum_.pdf"; filename*=UTF-8\'\'r%C3%A9sum%C3%A9.pdf'
    );
  });

  test('a quote cannot end the header early', () => {
    expect(contentDisposition('a";x=y.png')).not.toContain('";x=y');
  });

  test('inline is asked for, never assumed', () => {
    expect(contentDisposition('a.png', 'inline')).toContain(
      'inline; filename='
    );
  });
});
