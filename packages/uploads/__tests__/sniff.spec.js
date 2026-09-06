const { accepts, allowed, extensionFor, sniff } = require('../src/sniff');
const { ELF, PDF, PNG } = require('./helpers');

/**
 * A sample from a hex signature, padded so the text inference never sees a
 * short buffer as a whole file
 *
 * @param {string} hex the leading bytes
 * @returns {Buffer} the sample
 */
const sample = (hex) =>
  Buffer.concat([Buffer.from(hex, 'hex'), Buffer.alloc(64, 0xff)]);

describe('what the bytes say', () => {
  test.each([
    ['png', PNG, 'image/png'],
    ['jpeg', sample('ffd8ffe0'), 'image/jpeg'],
    ['gif', sample('474946383961'), 'image/gif'],
    ['webp', sample('52494646000000005745425056503820'), 'image/webp'],
    ['pdf', PDF, 'application/pdf'],
    ['zip (and every docx)', sample('504b03041400'), 'application/zip'],
    ['gzip', sample('1f8b08'), 'application/gzip'],
    ['mp4', sample('0000001c6674797069736f6d'), 'video/mp4'],
    ['webm', sample('1a45dfa3'), 'video/webm'],
  ])('recognizes a %s', (name, bytes, type) => {
    expect(sniff(bytes)).toEqual({ sniffed: true, type });
  });

  test('an executable is named, so an allow list can refuse it', () => {
    expect(sniff(ELF).type).toBe('application/x-elf');
    expect(sniff(sample('4d5a90')).type).toBe('application/x-msdownload');
    expect(sniff(Buffer.from('#!/bin/sh\nrm -rf /\n')).type).toBe(
      'text/x-shellscript'
    );
  });

  test('text is recognized as text, and scripts inside it are named', () => {
    expect(sniff(Buffer.from('a,b,c\n1,2,3\n'), true).type).toBe('text/plain');
    expect(sniff(Buffer.from('{"a":1}'), true).type).toBe('text/plain');
    expect(
      sniff(Buffer.from('<!DOCTYPE html><script>x</script>'), true).type
    ).toBe('text/html');
    expect(sniff(Buffer.from('<svg onload="alert(1)"></svg>'), true).type).toBe(
      'image/svg+xml'
    );
  });

  test('what henri does not recognize stays unrecognized', () => {
    const noise = Buffer.from([0x00, 0x01, 0x02, 0xfe, 0xff, 0x03, 0x04]);

    expect(sniff(noise, true)).toEqual({
      sniffed: false,
      type: 'application/octet-stream',
    });
    expect(sniff(null)).toEqual({ sniffed: true, type: 'text/plain' });
  });

  test('invalid utf-8 is not text', () => {
    expect(sniff(Buffer.from([0xc3, 0x28, 0x41, 0x42]), true).sniffed).toBe(
      false
    );
  });

  test('a png called .jpg is still a png', () => {
    expect(sniff(PNG).type).toBe('image/png');
  });
});

describe('the extension a stored object gets', () => {
  test('comes from the type, not from the name', () => {
    expect(extensionFor('image/png')).toBe('png');
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('application/pdf')).toBe('pdf');
    expect(extensionFor('application/octet-stream')).toBe('bin');
    expect(extensionFor('application/x-php')).toBe('bin');
  });

  test('is never one a web server would act on', () => {
    expect(extensionFor('text/html')).toBe('bin');
    expect(extensionFor('image/svg+xml')).toBe('bin');
    expect(extensionFor('text/x-shellscript')).toBe('bin');
    expect(extensionFor('application/x-msdownload')).toBe('bin');
  });
});

describe('the allow list', () => {
  test('matches a type, a subtype wildcard, or everything', () => {
    expect(accepts('image/png', 'image/png')).toBe(true);
    expect(accepts('image/png', 'IMAGE/PNG')).toBe(true);
    expect(accepts('image/png', 'image/*')).toBe(true);
    expect(accepts('image/png', '*')).toBe(true);
    expect(accepts('image/png', 'image/jpeg')).toBe(false);
    expect(accepts('text/html', 'image/*')).toBe(false);
  });

  test('without one, every type is accepted', () => {
    expect(allowed('application/x-elf', null)).toBe(true);
    expect(allowed('application/x-elf', ['image/*'])).toBe(false);
    expect(allowed('image/png', ['image/*', 'application/pdf'])).toBe(true);
  });
});
