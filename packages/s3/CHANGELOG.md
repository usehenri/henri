# @usehenri/s3

## 1.2.0

### Minor Changes

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

- Updated dependencies [[`68fe3af`](https://github.com/usehenri/henri/commit/68fe3afa8bdaa6d9a95d0e60858fd4abe28028b2), [`1a86acb`](https://github.com/usehenri/henri/commit/1a86acbf15e4a43e5fb81277bb22e101c06e77a4), [`de1c1e0`](https://github.com/usehenri/henri/commit/de1c1e02ed83d13dcfeb8e44012f309eb663f03e)]:
  - @usehenri/uploads@1.2.0
