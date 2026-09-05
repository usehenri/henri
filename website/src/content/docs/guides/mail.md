---
title: Mail
description: Send email with nodemailer through henri.mail.
sidebar:
  order: 7
---

henri wraps [nodemailer](https://nodemailer.com). Configure a transport and `henri.mail.send()` is ready.

## Configuration

```json
{
  "mail": {
    "host": "smtp.example.com",
    "port": 587,
    "secure": false,
    "auth": { "user": "apikey", "pass": "..." }
  }
}
```

The `mail` object is nodemailer's transport configuration and always goes through `createTransport()` then `verify()` on boot: a wrong host or wrong credentials fail the boot instead of the first `send()`. Without a `mail` key the module logs a warning and `send()` rejects.

Set `"mail": "test"` to use an [Ethereal](https://ethereal.email/) fake account: nothing is delivered, and the console prints a link to every message (the account is cached in `.mailerTestCreds`).

Under `NODE_ENV=test` henri ignores the configuration and uses nodemailer's JSON transport: `henri.mail.send()` works, nothing leaves the machine, and the returned `info.message` is the message as JSON. Set `henri.forceMail = true` on the instance before it boots to use the configured transport in tests.

## Sending

```js
await henri.mail.send({
  from: '"Henri Server" <foo@example.com>',
  to: 'bar@example.com, baz@example.com',
  subject: 'Hello',
  text: 'Hello world?',
  html: '<b>Hello world?</b>',
});
```

`send()` resolves with nodemailer's `info` and logs the message id. `henri.mail.nodemailer` is the nodemailer package and `henri.mail.transporter` the configured transport, if you need them directly; the transport is closed when henri stops.
