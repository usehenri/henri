const fs = require('node:fs');
const path = require('node:path');
const supertest = require('supertest');

const { MAX_SIDE, keyFor, specOf, variantsOf } = require('../src/variants');
const { PDF, PNG, application, objects } = require('./helpers');
const { isKey } = require('../src/names');

/** The variants every application in this file declares */
const VARIANTS = {
  square: { fit: 'cover', format: 'webp', height: 64, width: 64 },
  wide: { format: 'jpeg', quality: 60, width: 96 },
};

/** A key of the shape henri generates */
const KEY = 'artworks/2026/09/0123456789abcdef0123456789abcdef.png';

/**
 * A 16x8 png, so a resize has something to do
 *
 * Built with sharp itself, which is what the suite is proving works: a
 * hand-written one pixel image would make every fit and every dimension the
 * same answer.
 *
 * @returns {Promise<Buffer>} the bytes
 */
async function wideImage() {
  const sharp = require('sharp');

  return sharp({
    create: {
      background: { b: 20, g: 120, r: 240 },
      channels: 3,
      height: 8,
      width: 16,
    },
  })
    .png()
    .toBuffer();
}

/**
 * An application with a file already stored
 *
 * @param {Buffer} bytes what to upload
 * @param {string} [filename='wide.png'] what to call it
 * @returns {Promise<object>} `{ uploads, stored }`
 */
async function stored(bytes, filename = 'wide.png') {
  const { app, uploads } = await application(
    { variants: VARIANTS },
    { handler: async (req, res) => res.json(await req.file('scan').store()) }
  );
  const answer = await supertest(app)
    .post('/upload')
    .attach('scan', bytes, { filename });

  return { app, stored: answer.body, uploads };
}

describe('a derived key', () => {
  test('sits beside the file it came from, and is still a key', () => {
    const key = keyFor(KEY, specOf(VARIANTS.square));

    expect(key).toMatch(
      /^artworks\/2026\/09\/0123456789abcdef0123456789abcdef\/[0-9a-f]{32}\.webp$/u
    );
    expect(isKey(key)).toBe(true);
  });

  test('is the same everywhere, so a variant is made once', () => {
    expect(keyFor(KEY, specOf(VARIANTS.square))).toBe(
      keyFor(
        KEY,
        specOf({ fit: 'cover', format: 'webp', height: 64, width: 64 })
      )
    );
  });

  test('is of the terms and not of the name: a changed variant is a new key', () => {
    expect(keyFor(KEY, specOf(VARIANTS.square))).not.toBe(
      keyFor(KEY, specOf({ height: 65, width: 64 }))
    );
    expect(keyFor(KEY, specOf({ width: 64 }))).not.toBe(
      keyFor(KEY, specOf({ format: 'png', width: 64 }))
    );
  });

  test('one source is not another', () => {
    expect(keyFor(KEY, specOf(VARIANTS.square))).not.toBe(
      keyFor(
        'artworks/2026/09/fedcba9876543210fedcba9876543210.png',
        specOf(VARIANTS.square)
      )
    );
  });
});

describe('what a variant may be', () => {
  test('needs a width, a height, or both', () => {
    expect(specOf({ width: 64 })).toMatchObject({ height: null, width: 64 });
    expect(specOf({ height: 64 })).toMatchObject({ height: 64, width: null });
    expect(specOf({})).toBeNull();
    expect(specOf({ fit: 'cover' })).toBeNull();
    expect(specOf(null)).toBeNull();
  });

  test('a side past what an image is has no spec', () => {
    expect(specOf({ width: MAX_SIDE })).toMatchObject({ width: MAX_SIDE });
    expect(specOf({ width: MAX_SIDE + 1 })).toBeNull();
    expect(specOf({ width: 0 })).toBeNull();
    expect(specOf({ width: 1.5 })).toBeNull();
  });

  test('nonsense falls back to the defaults', () => {
    expect(
      specOf({ fit: 'squish', format: 'gif', quality: 900, width: 64 })
    ).toEqual({
      fit: 'cover',
      format: 'webp',
      height: null,
      quality: 80,
      width: 64,
    });
  });

  test('a block of nothing usable is no variants at all', () => {
    expect(variantsOf(undefined)).toBeNull();
    expect(variantsOf({})).toBeNull();
    expect(variantsOf({ thumb: {} })).toBeNull();
    expect(variantsOf({ 'not a name': { width: 64 } })).toBeNull();
    expect(Object.keys(variantsOf(VARIANTS))).toEqual(['square', 'wide']);
  });
});

describe('deriving one', () => {
  test('resizes, converts and stores it under its own key', async () => {
    const { stored: record, uploads } = await stored(await wideImage());
    const variant = await uploads.variant(record, 'square');

    expect(variant.type).toBe('image/webp');
    expect(variant.of).toBe(record.key);
    expect(variant.key.startsWith(record.key.replace(/\.png$/u, '/'))).toBe(
      true
    );
    expect(variant.size).toBeGreaterThan(0);

    // The bytes are a webp, and the sniffer says so rather than the extension
    const { sniff } = require('../src/sniff');
    const chunks = [];

    for await (const chunk of await uploads.get(variant)) {
      chunks.push(chunk);
    }

    expect(sniff(Buffer.concat(chunks), true).type).toBe('image/webp');
  });

  test('is derived once: the second call reads what the first wrote', async () => {
    const { stored: record, uploads } = await stored(await wideImage());
    const first = await uploads.variant(record, 'square');
    const before = objects(uploads).length;
    const second = await uploads.variant(record, 'square');

    expect(second.key).toBe(first.key);
    expect(objects(uploads).length).toBe(before);
  });

  test('a hundred concurrent misses derive it once', async () => {
    const { stored: record, uploads } = await stored(await wideImage());
    const puts = [];
    const put = uploads.storage.put.bind(uploads.storage);

    uploads.storage.put = (source, key, meta) => {
      puts.push(key);

      return put(source, key, meta);
    };

    const all = await Promise.all(
      Array.from({ length: 100 }, () => uploads.variant(record, 'square'))
    );

    expect(new Set(all.map((one) => one.key)).size).toBe(1);
    expect(puts).toHaveLength(1);
  });

  test('two variants of one file are two objects', async () => {
    const { stored: record, uploads } = await stored(await wideImage());
    const square = await uploads.variant(record, 'square');
    const wide = await uploads.variant(record, 'wide');

    expect(square.key).not.toBe(wide.key);
    expect(wide.type).toBe('image/jpeg');
  });

  test('a variant is a record like any other: send() and delete() take it', async () => {
    const { stored: record, uploads } = await stored(await wideImage());
    const variant = await uploads.variant(record, 'square');
    const express = require('express');
    const app = express();

    app.get('/thumb', (req, res) => uploads.send(res, variant));

    const answer = await supertest(app).get('/thumb');

    expect(answer.status).toBe(200);
    expect(answer.headers['content-type']).toContain('image/webp');
    expect(answer.headers['x-content-type-options']).toBe('nosniff');
    expect(answer.headers['content-disposition']).toContain('attachment');

    expect(await uploads.delete(variant)).toBe(true);
    expect(await uploads.delete(variant)).toBe(false);
    // Deleting a variant leaves the file it came from where it was
    expect(objects(uploads)).toEqual([record.key]);
  });
});

describe('what is refused', () => {
  test('a name the configuration does not declare', async () => {
    const { stored: record, uploads } = await stored(await wideImage());
    const failure = await uploads
      .variant(record, 'gigantic')
      .catch((error) => error);

    expect(failure.code).toBe('HENRI_UPLOAD_VARIANT_UNKNOWN');
    expect(failure.message).toContain('square, wide');
  });

  test('anything that is not an image henri recognized', async () => {
    const { stored: record, uploads } = await stored(PDF, 'paper.pdf');
    const failure = await uploads
      .variant(record, 'square')
      .catch((error) => error);

    expect(failure.code).toBe('HENRI_UPLOAD_VARIANT_UNSUPPORTED');
    expect(record.type).toBe('application/pdf');
  });

  test('an SVG, which is text that carries script', async () => {
    const { stored: record, uploads } = await stored(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      'logo.svg'
    );
    const failure = await uploads
      .variant(record, 'square')
      .catch((error) => error);

    expect(record.type).toBe('image/svg+xml');
    expect(failure.code).toBe('HENRI_UPLOAD_VARIANT_UNSUPPORTED');
    expect(failure.message).toContain('carries script');
  });

  test('a file whose first bytes lied about being an image', async () => {
    const lying = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(64)]);
    const { stored: record, uploads } = await stored(lying, 'not.png');
    const failure = await uploads
      .variant(record, 'square')
      .catch((error) => error);

    expect(record.type).toBe('image/png');
    expect(failure.code).toBe('HENRI_UPLOAD_VARIANT_FAILED');
    // Nothing was stored: a failed derivation leaves no half object
    expect(objects(uploads)).toEqual([record.key]);
  });
});

describe('without an image library', () => {
  test('refuses with the install line, rather than answering the original', async () => {
    const { stored: record, uploads } = await stored(await wideImage());

    // What an application that never installed sharp has: `resolveFrom`
    // finds nothing, which is exactly what this reproduces
    uploads.henri.utils.resolveFrom = () => {
      throw new Error("Cannot find module 'sharp'");
    };

    const failure = await uploads
      .variant(record, 'square')
      .catch((error) => error);

    expect(failure.code).toBe('HENRI_UPLOAD_NO_IMAGE_LIBRARY');
    expect(failure.message).toContain('pnpm add sharp');
  });

  test('an application that declares no variant never asks for one', async () => {
    const { uploads } = await application({});

    expect(uploads.settings.variants).toBeNull();

    const failure = await uploads.variant(KEY, 'square').catch((one) => one);

    expect(failure.code).toBe('HENRI_UPLOAD_VARIANT_UNKNOWN');
    expect(failure.message).toContain('declare one under uploads.variants');
  });
});

describe('a variant and a signed url', () => {
  test('the derived record signs like the original', async () => {
    const {
      app,
      stored: record,
      uploads,
    } = await application(
      { urls: { expiresIn: 300 }, variants: VARIANTS },
      { handler: async (req, res) => res.json(await req.file('scan').store()) }
    ).then(async (built) => {
      built.henri.config.get = ((get) => (key) =>
        key === 'secret' ? 'a-secret-long-enough-to-be-one' : get(key))(
        built.henri.config.get
      );
      built.uploads.signer = built.uploads.signerOf();

      const answer = await supertest(built.app)
        .post('/upload')
        .attach('scan', await wideImage(), { filename: 'wide.png' });

      return { app: built.app, stored: answer.body, uploads: built.uploads };
    });
    const variant = await uploads.variant(record, 'square');
    const url = await uploads.url(variant);
    const answer = await supertest(app).get(url);

    expect(answer.status).toBe(200);
    expect(answer.headers['content-type']).toContain('image/webp');
    expect(fs.existsSync(path.join(uploads.storage.root, variant.key))).toBe(
      true
    );
  });
});
