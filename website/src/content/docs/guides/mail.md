---
title: Mail
description: Mailers with views, layouts and previews, delivered with nodemailer.
sidebar:
  order: 9
---

A mailer is a file in `app/mailers` whose functions describe a message: who it goes to, what it is about and the data its view needs. henri renders it with the mail views in `app/views/mailers` and delivers it through nodemailer. In development you can look at every message in the browser without sending anything.

```bash
henri generate mailer welcome confirm
```

writes `app/mailers/welcome.js`, `app/views/mailers/welcome/confirm.hbs` and the shared layout, and

```js
await henri.mailers.welcome.confirm(user).deliver();
```

sends it.

## The mailer

```js
// app/mailers/welcome.js
module.exports = {
  // Merged into every message of this mailer
  defaults: {
    from: 'Acme <no-reply@acme.com>',
  },

  confirm: (user, token) => ({
    to: user.email,
    subject: 'Confirm your address',
    data: { token, user },
  }),

  // Sample data for the previews: the arguments of the action
  previews: {
    confirm: () => [{ email: 'ada@example.com', name: 'Ada' }, 'abc123'],
  },
};
```

Every exported function is an action; `defaults` and `previews` describe the mailer instead. Files in sub-directories keep their path in the name (`app/mailers/admin/digest.js` is `admin/digest`).

An action returns the message. `data` is the context of the view, `view` and `layout` pick them; everything else is handed to nodemailer as it is — `to`, `cc`, `bcc`, `replyTo`, `subject`, `attachments`, `headers`, `priority`. Nothing is sent while the action runs: it returns a message, and the caller decides when it goes out.

Actions are called through `henri.mailers`:

```js
const message = henri.mailers.welcome.confirm(user, token);

await message.deliver(); // render and send now
await message.deliverLater(); // hand it to the delivery handler
const { html, text, subject } = await message.render(); // render only
```

`henri.mailers.deliver('welcome', 'confirm', user, token)` is the one-liner, and the only way to reach a mailer whose name has a slash in it (`henri.mailers.message('admin/digest', 'daily', [today])`).

## The views

A message renders `app/views/mailers/<mailer>/<action>` — Handlebars, the environment henri gives every application whatever its renderer, with the same partials your pages use (`app/views/partials`). Email is its own medium: no scripts, inline styles, tables for layout, so mail views are written on their own rather than reused from the pages. `{{@mailer}}`, `{{@action}}` and `{{@localUrl}}` are available as data variables.

```hbs
<!-- app/views/mailers/welcome/confirm.hbs -->
<h1>Hello {{user.name}}</h1>
<p>Confirm your address with the code <b>{{token}}</b>.</p>
<p><a href='https://acme.com/confirm/{{token}}'>Confirm</a></p>
```

A view engine that knows how to render mail itself takes over: an engine exposing `renderMail({ view, layout, data, meta })` and answering `{ html, text }` (or a string) is asked first. Neither the React nor the Inertia engine implements it today, so both render mail through Handlebars.

### The layout

`app/views/mailers/layouts/mailer.hbs` wraps every message. `{{{body}}}` is where the view goes; the signature, the footer and the unsubscribe link are written once.

```hbs
<html>
  <body style='margin:0;padding:24px;background:#f4f4f5;'>
    {{{body}}}
    <p style='font-size:12px;color:#71717a;'>Sent by Acme</p>
  </body>
</html>
```

`config.mailers.layout` picks another name, an action can pick its own with `layout: 'newsletter'`, and `layout: false` renders the view alone.

### The plain text part

Every message is multipart. The text part is **derived from the rich one** unless you write it: no `text` view means the html is turned into readable text — blocks become blank lines, list items get a dash, links keep their target (`Confirm (https://acme.com/confirm/abc123)`), entities are decoded. Two copies of the same copy is exactly the pair that drifts apart, so henri only asks for one.

When the plain part deserves its own wording, write it next to the view and it wins:

```
app/views/mailers/welcome/confirm.hbs        the rich part
app/views/mailers/welcome/confirm.text.hbs   the plain part, authored
app/views/mailers/layouts/mailer.hbs         the layout
app/views/mailers/layouts/mailer.text.hbs    the layout of the plain part
```

An action that sets `text` itself wins over both.

## The mails henri sends itself

One mailer ships with henri: `auth`, the three messages of the [account flows](/guides/users/#the-mails) — confirm an address, reset a password, confirm a new address. It is registered only in an application that turned one of those flows on, and it is an ordinary mailer otherwise: it shows up on `/_mailers`, its views live behind yours, and it is overridden in the two usual ways.

- `app/views/mailers/auth/reset.hbs` (and `reset.text.hbs`) replaces one view. henri's own views sit behind the application's, so writing this file is enough.
- `app/mailers/auth.js` replaces the subjects, the sender or the data. An action it leaves out keeps henri's, so a file with only `reset` in it still confirms addresses.

`henri generate authentication` writes both, which is the usual way to change the wording.

The same fallback applies to the layout: an application with no `app/views/mailers/layouts/mailer.hbs` gets henri's, a plain centered shell, rather than an unwrapped body.

## Previews

While the server runs in development, `http://localhost:3000/_mailers` lists every mailer and every action, and renders one with the sample data declared in its `previews`. Nothing is delivered.

| Path                                    | Answers                                   |
| --------------------------------------- | ----------------------------------------- |
| `/_mailers`                             | the mailers and their actions             |
| `/_mailers/<mailer>/<action>`           | the headers, and the rich part in a frame |
| `/_mailers/<mailer>/<action>?part=html` | the rich part alone                       |
| `/_mailers/<mailer>/<action>?part=text` | the plain part, as `text/plain`           |
| `/_mailers/<mailer>/<action>?part=json` | the whole message as JSON                 |

`previews` maps an action to the arguments it should be called with, as an array. It may be a function (it receives the henri instance, so a preview can read a real record) and it may be async. An action with no entry is previewed with no arguments.

Like `/_routes` and `/_controllers`, the previews exist **only in development** (`NODE_ENV` neither `production` nor `test`) and answer **only requests from the machine running the server**: anything else gets a 404. `"previews": false` in the [`mailers` configuration](/configuration/#the-mailers-object) turns them off; nothing turns them on anywhere else.

## Delivering later

`deliverLater()` renders the message and hands it to a delivery handler instead of sending it inline. **Install [`@usehenri/jobs`](/guides/jobs/) and that handler is already registered**: the rendered message becomes a job on the `mailers` queue, retried with a backoff and, out of attempts, kept in the dead letter queue like anything else.

```js
await henri.mailers.welcome.confirm(user).deliverLater();
await henri.mailers.welcome.confirm(user).deliverLater({ wait: '10m' });
```

The options of the call are the options of an enqueue, so `wait`, `at`, `queue` and `priority` all work — and only those four: a misspelled `wait` used to be ignored, which is a mail that leaves immediately, so an option henri does not know is now refused and the right name is suggested. `henri jobs` sends them. See [Jobs](/guides/jobs/#delivering-mail-through-the-queue). Without a queue there is nothing to hold a message back, so a call carrying a `wait` or an `at` is refused and says to install the package rather than sending the mail now; `deliverLater()` on its own delivers out of band, as below.

Another queue plugs into the same seam:

```js
henri.mailers.onDeliverLater((message, options) =>
  myQueue.push('mail', message, options)
);
```

The handler receives the **rendered** message — a plain, serializable object in nodemailer's shape (`from`, `to`, `subject`, `html`, `text`, ...) — and the options of the call. A worker that gets it back only has to call `henri.mail.send(message)`; nothing has to be re-rendered, and no model has to be reachable from the worker.

Without a handler henri delivers out of band: the send is started, `deliverLater()` returns `{ deferred: true, handler: 'inline' }` without waiting for it, and failures are logged. That is not a queue — nothing survives a restart — so it is a convenience for development, not a substitute. `await henri.mailers.drain()` waits for the deliveries in flight (`henri.stop()` does it too), which is what tests want.

## Configuration

```json
{
  "mail": {
    "host": "smtp.example.com",
    "port": 587,
    "secure": false,
    "auth": { "user": "apikey", "pass": "..." }
  },
  "mailers": {
    "from": "Acme <no-reply@acme.com>",
    "layout": "mailer"
  }
}
```

`mail` is nodemailer's transport configuration and always goes through `createTransport()` then `verify()` on boot: a wrong host or wrong credentials fail the boot instead of the first `send()`. Without a `mail` key the module logs a warning and `send()` rejects.

Set `"mail": "test"` to use an [Ethereal](https://ethereal.email/) fake account: nothing is delivered, and the console prints a link to every message (the account is cached in `.mailerTestCreds`).

`mailers` holds the defaults of the mailers themselves: `from`, `layout` and `previews`. See [Configuration](/configuration/#the-mailers-object).

## Sending without a mailer

`henri.mail.send()` still takes a nodemailer message, and now refuses one with no recipient (`HENRI_MAIL_NO_RECIPIENT`): under `NODE_ENV=test` the transport is nodemailer's json one, which happily "sends" a message nobody will ever receive, so a missing `to` used to be invisible until production.

```js
await henri.mail.send({
  from: '"Henri Server" <foo@example.com>',
  to: 'bar@example.com, baz@example.com',
  subject: 'Hello',
  text: 'Hello world?',
  html: '<b>Hello world?</b>',
});
```

It resolves with nodemailer's `info` and logs the message id. `henri.mail.nodemailer` is the nodemailer package and `henri.mail.transporter` the configured transport, if you need them directly; the transport is closed when henri stops.

## In tests

Under `NODE_ENV=test` henri ignores the mail configuration and uses nodemailer's JSON transport: `send()` works, nothing leaves the machine, and `info.message` is the message as JSON. Set `henri.forceMail = true` on the instance before it boots to use the configured transport in tests.

```js
const info = await henri.mailers.welcome.confirm(user).deliver();
const message = JSON.parse(info.message);

expect(message.subject).toBe('Confirm your address');
expect(message.html).toContain('Hello Ada');
expect(message.text).toContain('Hello Ada');
```

`henri.mailers.preview('welcome', 'confirm')` renders an action with its sample data without sending it, which is a cheap way to keep a mail view honest in a test.
