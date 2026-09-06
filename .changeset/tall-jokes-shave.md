---
'@usehenri/uploads': minor
'@usehenri/core': minor
'@usehenri/cli': minor
---

File uploads, in a new package: `@usehenri/uploads`.

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
