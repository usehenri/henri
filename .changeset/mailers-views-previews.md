---
'@usehenri/core': minor
'@usehenri/cli': minor
'@usehenri/mcp': minor
---

Mailers with views, layouts and previews.

- **`app/mailers`.** A mailer is a file whose exported functions are actions
  returning the message they want sent (`to`, `subject`, the `data` its view
  needs); `defaults` applies to every message of the mailer and `previews`
  holds the sample data. They are loaded like controllers, reload with the
  application, and are reachable as `henri.mailers.<name>.<action>(...)`,
  `henri.mailers.message(name, action, args)` and
  `henri.mailers.deliver(name, action, ...args)`. A message answers
  `render()`, `deliver()` and `deliverLater()`.
- **`app/views/mailers`.** Mail views are rendered by henri's Handlebars
  environment — the one every application has whatever its `renderer`, with
  the application's partials — unless the view engine implements
  `renderMail({ view, layout, data, meta })`, which is asked first.
  `app/views/mailers/layouts/mailer.hbs` wraps every message around
  `{{{body}}}`; `config.mailers.layout`, a mailer's `defaults.layout` and an
  action's `layout` pick another one, and `layout: false` renders the view
  alone.
- **A plain text part on every message.** It is derived from the rich part
  (blocks become blank lines, list items get a dash, links keep their target,
  entities are decoded) so the two never drift apart; a `<action>.text.hbs`
  next to the view wins when the plain part deserves its own wording, and a
  `text` set by the action wins over both.
- **Previews.** `/_mailers` lists the mailers and renders one with its sample
  data without delivering anything (`?part=html|text|json`). Like `/_routes`
  and `/_controllers` it exists only in development and only answers requests
  from the machine running the server; `config.mailers.previews: false` turns
  it off and nothing turns it on elsewhere.
- **Delivering later.** `deliverLater()` renders the message and hands the
  plain, serializable nodemailer payload to the handler registered with
  `henri.mailers.onDeliverLater(fn)`, so a queue only has to call
  `henri.mail.send(message)` on the other side. Without a handler henri sends
  it out of band and logs failures; `henri.mailers.drain()` (and
  `henri.stop()`) waits for the deliveries in flight. It is not a queue.
- **New configuration key** `mailers`: `from`, `layout` and `previews`.
- `henri generate mailer <name> [action ...]` writes the mailer, a view per
  action and the layouts; `henri destroy mailer <name>` removes the mailer and
  its views. Both are exposed by `henri mcp`.
- `henri.mail.send()` is unchanged.
