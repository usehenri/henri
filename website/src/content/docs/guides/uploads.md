---
title: Uploads
description: Multipart parsing with limits that exist before the first byte, files typed by their content, generated names, a storage seam and cleanup that never leaves a temporary file behind.
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

`storage/uploads` in the application, by default. Outside `app/views/public`, which `express.static` serves; outside `app/views`, which the Inertia dev server has for a root; outside `.henri`, which `henri clean` removes. The directory is created `0700`, every stored object `0600`, and a `.gitignore` is written into it the first time so uploads never reach a commit.

`henri audit` reports a `root` inside a directory the application serves (`uploads.root-served`), which is the mistake this default exists to avoid.

## Nothing is kept unless you say so

A parsed file lives in a private temporary area until `store()` moves it in. Everything else is removed when the response closes — answered, refused, timed out or abandoned by the client, which is the whole list of ways a request ends. `permitFiles()` removes what the controller did not ask for immediately rather than at the end, and a refusal frees what it had already read before the answer goes out.

The one case a request cannot clean up after is a process that was killed outright, so the storage sweeps its temporary area when it starts.

Calling `store()` after the response has closed throws rather than half-working: a file is stored during the request or not at all.

## Where the parser sits, and why

Runlevel 3, before the user module. It has to be: the `_csrf` field of a `multipart/form-data` form is _inside the body_, and the CSRF middleware reads `req.body`. Parse any later and no ordinary HTML upload form could pass the token check.

The consequence is that an unauthenticated `POST` reaches the parser before it reaches a session, which is why every limit above is enforced before a byte is read, why `uploads.paths` exists, and why nothing is kept by default.

## A storage of your own

`HenriStorage` is to uploads what `HenriAdapter` is to the stores. henri ships the local disk and no client for anybody's object store — an S3 client is a dependency, a credential chain, a region, a retry policy and a bill, and none of that belongs in a framework that would then own its upgrades.

```js
// lib/s3-storage.js
class S3Storage {
  constructor(name, config, henri) {}
  async start() {}
  async stop() {}
  async temp() {} // { path }: a private local file to stream a part into
  async put(source, key) {} // upload, remove the part, answer the key
  async get(key) {} // a readable stream
  async stat(key) {} // { size, modifiedAt } or null
  async delete(key) {} // true when something was removed
  url(key) {} // a public url, or null
}

module.exports = S3Storage;
```

```json
{ "uploads": { "storage": "./lib/s3-storage" } }
```

The module id is resolved from the application, the way [`rateLimit.store`](/configuration/#rate-limits) is, and it may export a class, a `(henri, { name, config }) => storage` factory, or an object that is already one.

`temp()` is part of the contract because only the storage knows where a part should land so that keeping it is cheap: on the local disk it is a directory inside the root, so promoting a file is a rename on the same filesystem rather than a copy.

## Out of scope, on purpose

These are all real, and each of them is a feature rather than half a feature. henri does none of them, and says so here rather than doing one badly:

- **Image processing, variants and thumbnails.** A resize is a native dependency (sharp, libvips), a queue, a cache and a set of decisions about quality that belong to an application, not to a framework. Do it in a [job](/guides/jobs/) after `store()` — the record has the key, and the queue is already there.
- **Direct-to-S3 signed uploads.** They are the right answer above a certain size, and they are the _opposite_ design: the bytes never reach the application, so none of the limits, the sniffing or the cleanup on this page apply. Getting that right means signing a policy, verifying the object afterwards and reconciling what was uploaded but never claimed. A storage that does it can be written against the seam above; henri does not pretend the two are the same feature.
- **A CDN story.** `url()` exists in the contract for a storage that has public urls. What is cached where, for how long, and how a private file is signed for one viewer is a deployment decision.
- **Virus scanning.** It is a daemon (ClamAV) or a paid API, it is the sort of thing that must not run inside a request, and a scanner henri shipped would be a scanner henri kept up to date. Call one from a job before the file is shown to anyone else.

## Turning uploads off

```json
{ "uploads": false }
```

The module stays in the boot — `req.files` is there and empty, so nothing in a controller has to ask first — no storage is prepared, and no multipart body is read. Anything that reaches for a file says what to do about it.
