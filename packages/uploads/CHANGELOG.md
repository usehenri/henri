# @usehenri/uploads

## 1.2.0

### Minor Changes

- [#372](https://github.com/usehenri/henri/pull/372) [`1a86acb`](https://github.com/usehenri/henri/commit/1a86acbf15e4a43e5fb81277bb22e101c06e77a4) Thanks [@reel](https://github.com/reel)! - File uploads, in a new package: `@usehenri/uploads`.
  
  An application installs it and gets `henri.uploads`, `req.files`,
  `req.file(field)` and `req.permitFiles(...fields)` — `req.permit()` for files,
  which removes what a controller did not ask for on the spot. `store()` moves a
  file into the storage and answers the record to write to a model
  (`{ key, name, type, size, checksum, storage, uploadedAt }`), and
  `henri.uploads.send(res, record)` streams it back as a download.
  
  The parser is busboy, and every bound is enforced as it reads rather than
  checked afterwards: `maxTotalSize` (25mb, checked against `Content-Length`
  first and counted again as the bytes arrive), `maxFileSize` (10mb), `maxFiles`
  (10), `maxFields` (100), `maxFieldNameSize` (100 bytes) and `maxFieldSize`,
  which defaults to `config.bodyLimit`. The type of a file is decided from its
  first bytes, never from the `Content-Type` or the extension the client sent,
  and `uploads.allow` matches that. The stored name is generated, so no name a
  client sends ever reaches a path. Files land in `storage/uploads` (`0700`,
  objects `0600`), outside everything the application serves, and nothing is kept
  unless a controller calls `store()` — a request that is refused, times out or is
  abandoned leaves no temporary file behind.
  
  The local disk is one implementation of a documented `HenriStorage` contract;
  an object store is another, named by module id in `config.uploads.storage` and
  resolved from the application. henri ships no S3 client.
  
  `@usehenri/core` gains the `uploads` configuration key (validated whether or
  not the package is installed), the `req.files`/`req.file`/`req.permitFiles`
  declarations, and `res.boom.payloadTooLarge()` and
  `res.boom.unsupportedMediaType()`.
  
  `henri audit` gains three checks: `uploads.limits-disabled` (V12.1.1),
  `uploads.type-check-disabled` (V12.2.1) and `uploads.root-served` (V12.4.1).

- [#407](https://github.com/usehenri/henri/pull/407) [`de1c1e0`](https://github.com/usehenri/henri/commit/de1c1e02ed83d13dcfeb8e44012f309eb663f03e) Thanks [@reel](https://github.com/reel)! - Uploads that survive a second machine: an object store, signed urls and variants
  
  `@usehenri/uploads` shipped one backend — the local disk — and said `url()`
  was allowed to answer `null` forever. Two application processes on two
  machines therefore did not share uploads at all, a link to a stored file
  meant writing a controller and a route for every one of them, and a
  thumbnail meant leaving the framework entirely. All three are closed here.
  
  **`@usehenri/s3`, a new package.** `config.uploads.storage` takes an object
  now (`{ "adapter": "s3", "bucket": "…", "region": "…" }`, the shape
  `config.shared` and a store already have) and `s3` resolves the package from
  the application. One backend speaks to S3, R2, Spaces, MinIO and GCS's
  interoperability mode; what tells them apart is an endpoint and a region. It
  carries no dependency but `debug` — AWS Signature Version 4 is two hundred
  lines of `node:crypto`, checked against the vectors AWS publishes. Every
  safety property survives the move: the key is generated and refused if it is
  not, the type still comes from the bytes and becomes the object's
  `Content-Type`, the original name is metadata, and a part still lands on a
  private local file that only `store()` promotes.
  
  **Signed urls.** `henri.uploads.url(record, { expiresIn, disposition,
  filename, type })` is one call whatever the backend: the provider's own
  signature on an object store, henri's own (an HMAC over the key, the expiry,
  the disposition, the name and the type, verified by a route it mounts) on
  the local disk. Neither can be edited to name another object, widened, or
  replayed past its expiry. Until then a signed url **is** a bearer
  capability, so `config.uploads.urls` is off by default and `url()` refuses
  with `HENRI_UPLOAD_URLS_DISABLED` rather than answering `null`.
  `uploads.urls.cdn` puts a cache in front of henri's own, whose signature
  deliberately does not cover the host.
  
  **Variants.** `config.uploads.variants` declares them by name and
  `henri.uploads.variant(record, 'thumb')` answers a record like any other.
  The key is the source's plus a digest of the variant's terms, so the work
  happens once, on demand, and never in the request that uploaded. `sharp` is
  an **optional peer dependency** resolved from the application: without it
  `variant()` refuses with `HENRI_UPLOAD_NO_IMAGE_LIBRARY` and the install
  line rather than quietly answering the original, and `henri doctor` reports
  it. A name never comes from a request, an SVG is refused, a source is
  bounded at fifty megapixels and one frame, no metadata is carried forward,
  and what the resize produced is sniffed before it is stored.
  
  New configuration: `uploads.storage` in its object form, `uploads.urls`
  (`expiresIn`, `path`, `cdn`) and `uploads.variants`. New codes:
  `HENRI_UPLOAD_NO_IMAGE_LIBRARY`, `HENRI_UPLOAD_STORAGE_FAILED`,
  `HENRI_UPLOAD_STORAGE_MISCONFIGURED`, `HENRI_UPLOAD_URLS_DISABLED`,
  `HENRI_UPLOAD_URL_EXPIRED`, `HENRI_UPLOAD_URL_INVALID`,
  `HENRI_UPLOAD_VARIANT_FAILED`, `HENRI_UPLOAD_VARIANT_UNKNOWN`,
  `HENRI_UPLOAD_VARIANT_UNSUPPORTED`. `henri doctor` asks for
  `@usehenri/s3` and `sharp` when the configuration names them.

### Patch Changes

- [#384](https://github.com/usehenri/henri/pull/384) [`68fe3af`](https://github.com/usehenri/henri/commit/68fe3afa8bdaa6d9a95d0e60858fd4abe28028b2) Thanks [@reel](https://github.com/reel)! - Test factories: a valid record with the fields the test does not care about already filled in.
  
  A factory lives in `test/factories/<name>.js` and is read the first time a test asks for one. It is a plain object -- `{ attributes, traits, model, after }` -- and `@usehenri/testing` now exports `create`, `build`, `createList`, `defineFactory` and `resetFactories`:
  
  ```js
  // test/factories/proposal.js
  module.exports = {
    attributes: {
      eventId: async ({ create }) => (await create('event')).id,
      speakerId: async ({ create }) => (await create('user')).id,
      title: ({ sequence }) => `A proposal ${sequence}`,
    },
    traits: { submitted: { state: 'submitted', submittedAt: () => new Date() } },
  };
  
  await create('proposal', 'submitted', { speakerId: me.id });
  ```
  
  Three rules hold it together. What the caller gives is never made, so an override of an association creates no second record. A value is a literal or a function of the build context (`attrs`, `build`, `create`, `sequence`, `traits`, `uid`), so there is no separate vocabulary for associations, sequences or computed fields. Fields resolve on demand rather than in the order they are written, so `await attrs.eventId` from another field's function keeps two of them on one parent whatever order the keys sit in. A trait is an override object with a name, kept next to the model because a state is rarely one field.
  
  A factory writes through the model, so the password is still hashed, the timestamps are still stamped and a `paranoid` model still soft-deletes; `after(record, context)` covers what the model refuses to mass assign. Failures carry the new `HENRI_FACTORY_*` codes.
  
  `@usehenri/uploads`: the local storage sweeps only the parts older than an hour when it starts. It could not tell a part a dead process left behind from one another process is streaming into right now, so a second application process -- or a second test file -- booting mid-upload failed that upload.
- Updated dependencies [[`1e23664`](https://github.com/usehenri/henri/commit/1e23664829bd1a356de28f404cfb21c9ae211388), [`5b627ad`](https://github.com/usehenri/henri/commit/5b627adfa37e9f16bc75af96cc8ff5308a91f688), [`1b316c6`](https://github.com/usehenri/henri/commit/1b316c6f3c5d5eb5752c70b534092d1052956cc6), [`7fd13f6`](https://github.com/usehenri/henri/commit/7fd13f631b75f7aa152b73046b50c6902ae3ca93), [`b559fb7`](https://github.com/usehenri/henri/commit/b559fb72b391eeb21a3f6a0cda1515e01ecbfafc), [`1c0dfe8`](https://github.com/usehenri/henri/commit/1c0dfe84a98eff2122512256c4f42ec7ccde4212), [`93060a8`](https://github.com/usehenri/henri/commit/93060a86df795dbbd99bf1895beb0cf14c4b86de), [`e031900`](https://github.com/usehenri/henri/commit/e031900082f28aec72af4cda9cd959f932e2ebc7), [`9173000`](https://github.com/usehenri/henri/commit/91730005efa88f073bfaaf67078c3ec0e137b459), [`62fac46`](https://github.com/usehenri/henri/commit/62fac46fd6cae5581979b73daf99700fd246e0ea), [`b278119`](https://github.com/usehenri/henri/commit/b2781190de436eb5838e866446c9a0c8210bb6ca), [`b161e1b`](https://github.com/usehenri/henri/commit/b161e1b8fad94af2d2afc351dc1bc07dabbb1379), [`1616e34`](https://github.com/usehenri/henri/commit/1616e343a612be2bffffcfa5b23bfa8ad191bbe3), [`bcf4ce2`](https://github.com/usehenri/henri/commit/bcf4ce22bcd294844504164fac1fa4aef1ffec41), [`ab5a8e4`](https://github.com/usehenri/henri/commit/ab5a8e4a88c80cca070a2b8ad398c80babdaff11), [`43d267f`](https://github.com/usehenri/henri/commit/43d267f0f9d192b2c01e89c3925b7daf5000041b), [`9f868f3`](https://github.com/usehenri/henri/commit/9f868f3d9162fa218e34304110210e6949f97d5c), [`89dda62`](https://github.com/usehenri/henri/commit/89dda62da456a0a55600e79cfb65ce89f11258e2), [`62fac46`](https://github.com/usehenri/henri/commit/62fac46fd6cae5581979b73daf99700fd246e0ea), [`d9f3be4`](https://github.com/usehenri/henri/commit/d9f3be49c5929d929a220220bf6e72fdcb135595), [`c44f025`](https://github.com/usehenri/henri/commit/c44f025acec3d5bbbb57e2310d02184a1053a10d), [`67cfb20`](https://github.com/usehenri/henri/commit/67cfb200ea0e0b31bacf2af183db6467b0fa011d), [`e661f98`](https://github.com/usehenri/henri/commit/e661f98fe8f8acce15aa10ce2dc320c5a2cb006f), [`2c8a826`](https://github.com/usehenri/henri/commit/2c8a8265262dbf6ea5c3e73e8e7892a230d4d0f0), [`46d5dbc`](https://github.com/usehenri/henri/commit/46d5dbcc983c03e96ae5a87d7288c5d8a5adbc24), [`ba97ea9`](https://github.com/usehenri/henri/commit/ba97ea968f0b34cd67b7a3e803ecd34543b8aaaf), [`5ccd537`](https://github.com/usehenri/henri/commit/5ccd537b3621b54d11e7f24ccca39643ae7d5cf7), [`9895cbf`](https://github.com/usehenri/henri/commit/9895cbf4be85b476e341a5be915e3049e5a027de), [`5a150d5`](https://github.com/usehenri/henri/commit/5a150d576208571c32b9cd12827d035e31ed4313), [`3c1c5b8`](https://github.com/usehenri/henri/commit/3c1c5b83ea135b000ddd6ffbfd05457b000f2f7c), [`aa3f90b`](https://github.com/usehenri/henri/commit/aa3f90bd6f42bb05431c33f3e4bf2202cb6bb7c6), [`a1c6769`](https://github.com/usehenri/henri/commit/a1c6769099e3dc28b22b5338a2a57b13bdf69f7a), [`ec1c8c4`](https://github.com/usehenri/henri/commit/ec1c8c419f4d9063a7617472b2970fdb8a929fa1), [`dd2731d`](https://github.com/usehenri/henri/commit/dd2731d6a20fd96aa1be1aeb5e6ec0155001326b), [`b7038ce`](https://github.com/usehenri/henri/commit/b7038ceaa430f4a0b9eaf7e983fc2844421bf636), [`1ea0f85`](https://github.com/usehenri/henri/commit/1ea0f85066b86fba31f58937cc10abb6359e6a26), [`01a561a`](https://github.com/usehenri/henri/commit/01a561aa58650ec15df1c2659795a5e4c5bbfd53), [`e31a3f7`](https://github.com/usehenri/henri/commit/e31a3f73e7e8facf3cedf7460f115e57995f32c3), [`2689779`](https://github.com/usehenri/henri/commit/26897798b840fd28a4bc091c050a83457b36905d), [`72cd1d3`](https://github.com/usehenri/henri/commit/72cd1d35ffb99311bbca815c1f6ab41ee3682f64), [`a2e1ec2`](https://github.com/usehenri/henri/commit/a2e1ec29df52462f12ebaae9bfbc1ad4f427b27f), [`afead74`](https://github.com/usehenri/henri/commit/afead7489498ed42e1893a25123ea772cac2ca09), [`a4ecba5`](https://github.com/usehenri/henri/commit/a4ecba50c663f4d5c741adbb6cd9bc0eefe0e5cc), [`baec3fd`](https://github.com/usehenri/henri/commit/baec3fd22be92bf8ffbaeb251b0b6c2771f8347a), [`e865d94`](https://github.com/usehenri/henri/commit/e865d945d65419ac676f5a2fe3ba3b6114a1e53d), [`4274567`](https://github.com/usehenri/henri/commit/4274567e20a980657f07df9ec7db25296c7d55f5), [`aea429c`](https://github.com/usehenri/henri/commit/aea429ca99338a62370ab3e3d94bdc6b8c227601), [`8a8e3b3`](https://github.com/usehenri/henri/commit/8a8e3b33d7967b81f66633aa25c3075318f01d60), [`18715f9`](https://github.com/usehenri/henri/commit/18715f90ea8958dc57da1bb029b8209c36b84cc6), [`831aa5c`](https://github.com/usehenri/henri/commit/831aa5c011f3432630c68b8d26755d2582f82f74), [`16824e8`](https://github.com/usehenri/henri/commit/16824e8fe9ccc6a04dab5d9b2481c29ff4f6b64b), [`fda9366`](https://github.com/usehenri/henri/commit/fda9366e9ed2b072764a995c5aa60205ca7a4725), [`1a86acb`](https://github.com/usehenri/henri/commit/1a86acbf15e4a43e5fb81277bb22e101c06e77a4), [`0b32fbd`](https://github.com/usehenri/henri/commit/0b32fbde19c95da8fe07fab76933840a4242c71c), [`c0c16e8`](https://github.com/usehenri/henri/commit/c0c16e873ba440aee9832160553cbb12ab81bd2c), [`41470bf`](https://github.com/usehenri/henri/commit/41470bf378d83ca3d35d00e8c31796fea5eb15e0), [`8e44e7e`](https://github.com/usehenri/henri/commit/8e44e7e882dd8741b3ac632651b453389d76bf2c), [`de1c1e0`](https://github.com/usehenri/henri/commit/de1c1e02ed83d13dcfeb8e44012f309eb663f03e), [`4b4677d`](https://github.com/usehenri/henri/commit/4b4677d4a09d39fe50b1fa4af577600342578daf)]:
  - @usehenri/core@1.2.0
