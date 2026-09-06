---
title: Uploads
description: Multipart parsing with limits that exist before the first byte, files typed by their content, generated names, an object store, signed urls, variants and cleanup that never leaves a temporary file behind.
sidebar:
  order: 10
---

An upload is the one request where a stranger writes to your disk. Everything on this page follows from that: the limits are enforced by the parser as it reads, the type comes from the bytes rather than from what the client called them, the name that reaches the filesystem is generated, and nothing is kept unless a controller says so.

```bash
npm install @usehenri/uploads     # once, in your application
```

Uploads live in [`@usehenri/uploads`](https://www.npmjs.com/package/@usehenri/uploads). The package [ships a henri module](/reference/under-the-hood/#where-it-goes-a-module-that-arrives-from-a-package), so depending on it is all there is to do: it is in the boot as `henri.uploads`, at level 3, and `req.files`, `req.file()` and `req.permitFiles()` are on every request. An application that does not depend on it parses no multipart body at all — `henri new` does not install it, because most applications never accept a file, and a multipart parser nobody uses is a dependency nobody wanted.

## A controller that accepts a file

```jsx
// app/views/pages/artworks/new.jsx
<form action="/artworks" method="post" encType="multipart/form-data">
  <input type="hidden" name="_csrf" value={csrf} />
  <input name="title" />
  <input type="file" name="scan" accept="image/png,image/jpeg" />
  <button>Save</button>
</form>
```

```js
// app/controllers/artworks.js
module.exports = {
  async create(req, res) {
    const data = req.permit('title', 'year');
    const { scan } = req.permitFiles('scan');

    if (scan) {
      data.scan = await scan[0].store({ prefix: 'artworks' });
    }

    const artwork = await Artwork.create(data);

    return res.resource(artwork);
  },
};
```

`req.permit()` is the fields, `req.permitFiles()` is the files, and they behave the same way: only what the controller listed comes back. The difference is what happens to the rest — a body field it did not ask for merely stays unread, while a **file** it did not ask for is removed from the disk on the spot.

`store()` resolves with the record, which is what a model holds (a `json` column, or a `text` one):

```json
{
  "key": "artworks/2026/09/6f1c…9ab.png",
  "name": "Portrait of Ada.png",
  "type": "image/png",
  "size": 184320,
  "checksum": "c414cd0e…ce77",
  "storage": "local",
  "uploadedAt": "2026-09-06T07:05:25.247Z"
}
```

Three helpers are on the request, always — they exist on a `GET` with an empty body the way `req.permit()` does:

| Call                            | What it answers                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `req.files`                     | `{ [field]: UploadedFile[] }`, everything that arrived and passed the limits.                   |
| `req.file('scan')`              | The first file of a field, or `null`.                                                           |
| `req.permitFiles('scan', 'cv')` | Only those fields; the files of every other one are discarded immediately. `req.files` follows. |

An `UploadedFile` carries `field`, `name` (the original, cleaned), `type` (what the bytes say), `declaredType` (what the client claimed), `mistyped`, `sniffed`, `size` and `checksum`, plus `store(options)` and `discard()`.

## Handing a file back

Nothing uploaded is ever served from a directory the application serves, so a stored file is reached through a controller, which is where the decision about who may read it belongs:

```js
async show(req, res) {
  const artwork = await Artwork.findOne({ externalId: req.params.id });

  if (!artwork || !(await artwork.readableBy(req.user))) {
    return res.boom.notFound();
  }

  return henri.uploads.send(res, artwork.scan);
}
```

`send()` streams it with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, the type henri recognized and `Cache-Control: private`. `{ disposition: 'inline' }` is there for the types an application knows it can trust — an image it generated, a PDF it wrote — and is never the default: a file rendered on your own origin is a file that runs on your own origin. `henri.uploads.get(record)` gives the raw stream, and `henri.uploads.delete(record)` removes it.

That is the right shape when _who may read this_ has to be decided per request. When it does not — a link in a page you already authorized, an image in a mail — [a signed url](#signed-urls) hands the file to the client without the bytes passing through the application at all.

## The limits

Every one of these is handed to the parser, not checked afterwards. A size checked once the file is on disk has already let the disk fill.

| Key                         | Default     | Bounds                                             |
| --------------------------- | ----------- | -------------------------------------------------- |
| `uploads.maxTotalSize`      | `"25mb"`    | The whole multipart body, all parts together.      |
| `uploads.maxFileSize`       | `"10mb"`    | One file.                                          |
| `uploads.maxFiles`          | `10`        | How many files one request may carry.              |
| `uploads.maxFields`         | `100`       | How many non-file fields it may carry.             |
| `uploads.maxFieldNameSize`  | `100`       | How long one field name may be, in bytes.          |
| `uploads.maxFieldSize`      | `bodyLimit` | One non-file part.                                 |
| `uploads.maxFilenameLength` | `255`       | How much of the original name is kept as metadata. |

Past any of them the request is refused — `413`, or `415` for a type — and everything already written is removed before the answer goes out. The body is then read and discarded to the end (for at most five seconds) so the client sees the status instead of a connection reset while it is still uploading.

`maxTotalSize` is checked twice: against `Content-Length` before a parser is even built, and again as the bytes arrive, because a chunked request has no `Content-Length` and a request that has one is under no obligation to be honest about it.

### How this relates to `bodyLimit`

[`config.bodyLimit`](/configuration/#headers-logs-and-limits) (`1mb`) is what `express.json()` and `express.urlencoded()` accept for a whole body. It does not apply to `multipart/form-data`, which those parsers never look at — so a `bodyLimit` of `1mb` has never bounded an upload, and `maxTotalSize` is what does. The one place they meet is `maxFieldSize`, which **defaults to `bodyLimit`**: one text field of a form then costs the same whichever encoding the form was posted with.

Each of `maxTotalSize`, `maxFileSize`, `maxFiles` and `maxFields` accepts `false`, which removes the bound. `henri audit` reports it (`uploads.limits-disabled`); raise the number instead.

### Narrowing the surface

The parser runs before sessions and CSRF (see below), so it is the first thing an unauthenticated request meets. `uploads.paths` narrows that to the routes that actually take a file:

```json
{ "uploads": { "paths": ["/artworks", "/api/v1/artworks"] } }
```

A multipart body posted anywhere else is not read at all, and `req.files` stays empty.

## The type is what the bytes say

A part's `Content-Type` and its filename are written by whoever is uploading. Neither is evidence. henri reads the first 4kb and matches a signature table: what it recognizes is the type, and the client's claim is kept as `declaredType` for the record and used for nothing.

```js
const file = req.file('scan');

file.declaredType; // 'image/png'  — what the client said
file.type; // 'application/x-elf' — what it is
file.mistyped; // true
```

`uploads.allow` matches the type henri decided on, so `allow: ["image/png"]` cannot be satisfied by naming an executable `avatar.png`:

```json
{ "uploads": { "allow": ["image/png", "image/jpeg", "application/pdf"] } }
```

**What this does not do**, plainly:

- **It does not guess a type from an extension.** Ever. A format henri has no signature for is `application/octet-stream`, not "probably a CSV because it ends in `.csv`".
- **It does not open archives.** A `.docx`, an `.xlsx` and a `.odt` are all `application/zip`, which is what they are. Whether the zip holds a document or a zip bomb is not something a signature knows.
- **It reads a prefix, not the whole file.** A valid PNG header followed by anything at all is `image/png` to henri, as it is to every browser. If a format has to be _valid_ and not merely _recognized_, parse it in the controller.
- **Text is inferred, not signed.** A sample that decodes as UTF-8 with no control characters is text: `text/plain` for CSV, JSON and Markdown alike, and `text/html` or `image/svg+xml` when it opens with those. Those last two are named so an `allow` list can refuse them — both carry script, and neither should be served inline from your own origin.
- **`uploads.sniff: false`** turns all of it off and takes the client's word. `henri audit` reports it (`uploads.type-check-disabled`).

## Names, and why the stored one is generated

There are two names and they never meet.

The **stored name** is `<yyyy>/<mm>/<32 hex characters>.<extension>`, where the extension comes from the type the bytes were recognized as. Nothing the client sent takes part in it. That is one answer to a list of problems that is really one problem — `../../etc/passwd`, `/etc/passwd`, `C:\boot.ini`, a NUL byte in the middle, `CON`, `.htaccess`, `avatar.php`, a name four thousand characters long — because none of them are consulted when a path is built. The storage refuses any key that does not have that exact shape, and refuses again if the path it resolves to is not inside the root.

The **original name** is metadata: separators, control characters, quotes and wildcards removed, leading and trailing dots stripped, Windows device names prefixed, cut to `maxFilenameLength`. It is what the record holds and what a download is called.

The two scriptable types henri recognizes, `text/html` and `image/svg+xml`, are stored under a `.bin` extension, so a web server misconfigured to serve the storage directory still has nothing there it would render.

## Where the files go

`storage/uploads` in the application, by default, on the machine that is running. [An object store](#an-object-store) is one configuration key away, and is what a second machine needs. Outside `app/views/public`, which `express.static` serves; outside `app/views`, which the Inertia dev server has for a root; outside `.henri`, which `henri clean` removes. The directory is created `0700`, every stored object `0600`, and a `.gitignore` is written into it the first time so uploads never reach a commit.

`henri audit` reports a `root` inside a directory the application serves (`uploads.root-served`), which is the mistake this default exists to avoid.

## Nothing is kept unless you say so

A parsed file lives in a private temporary area until `store()` moves it in. Everything else is removed when the response closes — answered, refused, timed out or abandoned by the client, which is the whole list of ways a request ends. `permitFiles()` removes what the controller did not ask for immediately rather than at the end, and a refusal frees what it had already read before the answer goes out.

The one case a request cannot clean up after is a process that was killed outright, so the storage sweeps its temporary area when it starts.

Calling `store()` after the response has closed throws rather than half-working: a file is stored during the request or not at all.

## Where the parser sits, and why

Runlevel 3, before the user module. It has to be: the `_csrf` field of a `multipart/form-data` form is _inside the body_, and the CSRF middleware reads `req.body`. Parse any later and no ordinary HTML upload form could pass the token check.

The consequence is that an unauthenticated `POST` reaches the parser before it reaches a session, which is why every limit above is enforced before a byte is read, why `uploads.paths` exists, and why nothing is kept by default.

## Where the files live

`"storage": "local"` is the disk, and it is what an application that says nothing gets. It is also the assumption a second machine breaks: two processes behind a load balancer do not share a directory, and the Dockerfile the scaffold writes is an invitation to find that out in production.

### An object store

```bash
npm install @usehenri/s3
```

```json
{
  "uploads": {
    "storage": {
      "adapter": "s3",
      "bucket": "henri-uploads",
      "region": "us-east-1"
    }
  }
}
```

That is the whole change: `store()`, `send()`, `get()`, `delete()` and `url()` are the same calls, the record a model holds is the same record, and every rule on this page still holds — the type still comes from the bytes and becomes the object's `Content-Type`, the key is still generated and still refused if it is not, the original name is still metadata (`x-amz-meta-name`), and a part is still streamed to a private local file that only `store()` promotes.

The credentials come from `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` unless the block names them, because a key in a configuration file is a key in a repository.

**One backend, not four.** S3, [R2](https://developers.cloudflare.com/r2/), [Spaces](https://www.digitalocean.com/products/spaces), [MinIO](https://min.io/) and GCS's interoperability mode all speak the same API; what tells them apart is an endpoint and a region:

```json
{
  "uploads": {
    "storage": {
      "adapter": "s3",
      "bucket": "henri-uploads",
      "region": "auto",
      "endpoint": "https://<account>.r2.cloudflarestorage.com"
    }
  }
}
```

Everything else in the block reaches the backend: `pathStyle` (path style unless an endpoint is named otherwise), `publicEndpoint` (the host presigned urls are built against — a custom domain in front of an R2 bucket), `expiresIn`, `timeout` and `retries`. `henri doctor` reports the missing package when the storage names `s3`.

The package carries no dependency but `debug`: [AWS Signature Version 4](https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-authenticating-requests.html) is two hundred lines of `node:crypto`, checked against the vectors AWS publishes, and the five requests it makes go out through `node:http`.

**What it does not do.** One `PUT` per file, so no multipart upload and no resumable one: the bounds on this page cap a file at 10mb by default and a single `PUT` is good to 5gb. No bucket creation, no lifecycle rules, no listing, no replication, no server-side encryption settings — a bucket is infrastructure, and henri writes objects into one somebody else made.

### A storage of your own

`HenriStorage` is to uploads what `HenriAdapter` is to the stores, and it is deliberately narrow enough that the second implementation is a hundred lines rather than a fork:

```js
// lib/gcs-storage.js
class GcsStorage {
  constructor(name, config, henri) {} // config: { options, root, config }
  async start() {}
  async stop() {}
  async temp() {} // { path }: a private local file to stream a part into
  async put(source, key, meta) {} // upload, remove the part, answer the key
  async get(key) {} // a readable stream
  async stat(key) {} // { size, modifiedAt } or null
  async delete(key) {} // true when something was removed
  url(key, options) {} // a signed url, or null when there is no such thing
}

module.exports = GcsStorage;
```

```json
{ "uploads": { "storage": "./lib/gcs-storage" } }
```

The module id is resolved from the application, the way [`rateLimit.store`](/configuration/#rate-limits) is, and it may export a class, a `(henri, { name, config, options }) => storage` factory, or an object that is already one. The object form of `storage` carries settings to it: `adapter` names the backend, everything else is the backend's own.

`temp()` is part of the contract because only the storage knows where a part should land so that keeping it is cheap: on the local disk it is a directory inside the root, so promoting a file is a rename on the same filesystem rather than a copy. On an object store it is a local directory too — a part has to land somewhere before anything has authorized keeping it, and an upload that is going to be refused should not be paid for first.

`meta` is `{ checksum, name, size, type }`: what the parser already measured on the way in, so a backend that keeps a content type and signs a digest does not read the bytes again to learn it.

## Signed urls

A signed url is a time-limited link that hands the bytes to the client without proxying them through the application. It is one call, and it means the same thing whichever backend is under it:

```json
{ "uploads": { "urls": { "expiresIn": 300 } } }
```

```js
async show(req, res) {
  const artwork = await Artwork.findById(req.params.id);

  await req.authorize(artwork, 'show');

  return res.render('/artworks/show', {
    data: { artwork, scan: await henri.uploads.url(artwork.scan) },
  });
}
```

On an object store that is the provider's own signature and the bytes never reach this process. On the local disk it is henri's own — an HMAC over the key, the expiry, the disposition, the download name and the type — verified by a route mounted at `uploads.urls.path` (`/_uploads`) which streams the file. `url()` takes `{ expiresIn, disposition, filename, type }` and the record's own name and type fill in.

### What the signature covers

Both signatures cover **the key**, so a url for one object is not a url for another; **the expiry**, so the window cannot be widened; and **how the file is served** — the disposition, the download name and the media type — so a link to a download cannot be edited into an inline `text/html` page on your own origin. `text/html` and `image/svg+xml` are refused `inline` at signing time, which is the same rule that stores them under a `.bin` extension.

Editing any of those changes the string the signature is of, and producing the right signature needs a key that never leaves the server. Past the expiry the verifier refuses it against **its own clock**, not against anything in the url.

### What a signed url is, plainly

Until it expires, it is a **bearer capability**: whoever holds the link holds the file, and no session, role or policy is consulted. That is what a signed url is for, it is what a presigned S3 url is, and it is the reason `uploads.urls` is off by default and `henri.uploads.url()` refuses with `HENRI_UPLOAD_URLS_DISABLED` rather than quietly answering `null`. Choose accordingly:

| The question                             | The answer                                               |
| ---------------------------------------- | -------------------------------------------------------- |
| May _this viewer_ read it, right now?    | A controller, a policy and `henri.uploads.send()`.       |
| May whoever I hand this link to read it? | `henri.uploads.url()`, with a window you are happy with. |

Nothing is stored: there is no table of urls and no way to revoke one link. Rotating `HENRI_SECRET` invalidates every outstanding henri-signed url at once, and a shorter `expiresIn` bounds the next ones.

### Behind a CDN

`uploads.urls.cdn` is the base url henri's own signed urls are built against:

```json
{
  "uploads": {
    "urls": { "expiresIn": 3600, "cdn": "https://files.example.com" }
  }
}
```

The host is deliberately **outside** henri's signature, so a cache that forwards the path and the query forwards everything the signature is of. A provider-signed url is the opposite — SigV4 covers the host — so an object store names its public host in its own block (`storage.publicEndpoint`), and that host has to be one the provider itself answers on: an R2 custom domain or a MinIO behind a proxy, not an arbitrary cache in front of a bucket. A CDN with a signing scheme of its own (CloudFront key pairs, for instance) is that CDN's feature, and henri does not implement it.

## Variants

A derived file is a file with a key, so the storage seam was already the right shape for one. Declare what you want by name:

```json
{
  "uploads": {
    "variants": {
      "thumb": { "width": 320, "height": 320, "fit": "cover" },
      "hero": { "width": 1600, "format": "avif", "quality": 70 }
    }
  }
}
```

```js
const thumb = await henri.uploads.variant(artwork.scan, 'thumb');

// A record like any other: a key, a type, a size
await henri.uploads.url(thumb);
await henri.uploads.send(res, thumb);
```

Each takes `width`, `height` (one of the two is required), `fit` (`cover`, `contain`, `fill`, `inside`, `outside`), `format` (`webp`, `avif`, `jpeg`, `png`) and `quality`. An image is never enlarged past its own size.

### Where the work happens

**On demand, once.** The derived key is the source's plus a digest of the variant's own _terms_, so it is the same key in every process and every environment: the first caller pays for the resize, everyone after that reads a stored object, and a variant that exists costs one `stat`. A hundred concurrent misses in one process derive it once.

Not on write — every upload would then pay for every variant nobody looked at, in the request a person is watching. Not in a job either, though an application that wants that has it for free: the record has a key and `henri.jobs` is already there, so calling `variant()` from a job after `store()` warms it before the first viewer arrives.

Nothing is invalidated, ever, because nothing needs to be: change a variant's terms and it is simply a different key that has not been written yet. The old objects stay until you delete them.

### Without an image library

henri ships none. `sharp` is a native addon — libvips, a platform binary, a build or a download at install time — and putting that in the install of everyone who accepts a PDF is exactly the weight this package exists on the right side of. So it is an **optional peer dependency**, resolved from the application the way `@opentelemetry/api` is for [telemetry](/guides/telemetry/):

```bash
npm install sharp
```

An application that has not installed it pays nothing at all — no require, no probe at boot, no branch on a hot path — and the first `variant()` call refuses with `HENRI_UPLOAD_NO_IMAGE_LIBRARY` and that install line. It does not quietly answer the original: a page that asked for a 320px thumbnail and got a 12mb photograph is a worse outcome than an error. `henri doctor` reports the missing dependency when `uploads.variants` is configured.

### What is refused

- **A name the configuration does not declare.** `variant(record, name)` reads `uploads.variants` and nothing else. An ad-hoc `{ width }` taken from a request would let one visitor ask for ten thousand distinct sizes — a decode, a resize and an object written for each — which is a denial of service with a storage bill attached.
- **Anything that is not an image henri recognized**, by its bytes as everywhere else. `image/svg+xml` is refused outright: it is one of the two scriptable types, and rendering one means handing untrusted XML to a parser.
- **A source past 50 megapixels**, one frame of an animated image (a ten thousand frame GIF is a bomb whatever its file size), and no metadata carried forward — a thumbnail does not inherit the source's GPS coordinates. The EXIF orientation is applied and then dropped.
- **Bytes that are not what was asked for.** What comes back out of the resize is sniffed like anything else and compared with the format requested; a mismatch is `HENRI_UPLOAD_VARIANT_FAILED` rather than an object stored under a `.webp` key that is not one.

## Out of scope, on purpose

These are all real, and each of them is a feature rather than half a feature. henri does none of them, and says so here rather than doing one badly:

- **Direct-to-storage uploads.** A presigned `PUT` the browser writes to is the right answer above a certain size, and it is the _opposite_ design: the bytes never reach the application, so none of the limits, the sniffing or the cleanup on this page apply. Getting it right means bounding a policy, verifying the object afterwards and reconciling what was uploaded but never claimed. `@usehenri/s3` signs a `GET`, deliberately, and nothing else.
- **Virus scanning.** It is a daemon (ClamAV) or a paid API, it is the sort of thing that must not run inside a request, and a scanner henri shipped would be a scanner henri kept up to date. Call one from a job before the file is shown to anyone else.
- **Video and audio transcoding.** ffmpeg is not a library, it is a pipeline: a queue, a machine sized for it and a set of decisions no framework can make for you. `variant()` is images, and says so.
- **A media library, an admin, or tracking which records point at which key.** An upload record is a column your model holds; what is orphaned and what is not is a question about your schema.

## Turning uploads off

```json
{ "uploads": false }
```

The module stays in the boot — `req.files` is there and empty, so nothing in a controller has to ask first — no storage is prepared, and no multipart body is read. Anything that reaches for a file says what to do about it.
