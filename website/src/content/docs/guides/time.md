---
title: Time zones
description: henri.time — storage is UTC on every adapter, config.timeZone is the zone a server renders in, a person's zone lives on their record the way their locale does, and a mail's zone is the recipient's.
sidebar:
  order: 12
---

There are two questions people mean by "time zones", and a framework that answers them together gets both wrong.

The first is **what is stored**. henri's answer has always been the same and does not change: a moment is an instant, in UTC, on every adapter. The second is **what a person is shown**, and until now henri had no answer at all — every date a server printed came out in whatever zone the machine happened to be in.

`henri.time` is the second answer. It stores nothing.

## What was measured

This was surveyed before it was designed, because the survey decided the design. Every adapter was given the same instants and read back with the process pinned to `Pacific/Kiritimati` (UTC+14) and `Pacific/Niue` (UTC−11) — written under one, read under the other, 25 hours apart:

| store                | column                        | instant | milliseconds |
| -------------------- | ----------------------------- | ------- | ------------ |
| drizzle / sqlite     | `integer`, epoch milliseconds | kept    | yes          |
| drizzle / postgres   | `timestamp with time zone`    | kept    | yes          |
| drizzle / mysql      | `datetime(3)`                 | kept    | yes          |
| mongoose             | BSON date, int64 epoch ms     | kept    | yes          |
| sequelize / mssql    | `DATETIMEOFFSET`              | kept    | yes          |
| sequelize / sqlite   | `DATETIME` text, `+00:00`     | kept    | yes          |
| sequelize / postgres | `timestamp with time zone`    | kept    | yes          |
| sequelize / mysql    | `DATETIME`                    | kept    | **no**       |

**Storage was never the problem.** The one defect is the last row, and an application does not reach it: a MySQL store is `@usehenri/drizzle` with the dialect chosen, and gets `datetime(3)`. Sequelize is behind `@usehenri/mssql` alone, where the column is a `DATETIMEOFFSET`. It is a precision bug rather than a zone one — `12:34:56.789` is stored as `12:34:56` in every zone alike.

The wire was fine too. A `Date` reaches `res.json()` untouched and `JSON.stringify` writes ISO-8601 with a `Z`, so an Inertia or React page already receives an unambiguous instant.

What was broken was **rendering on the server**. `Intl.DateTimeFormat` with no `timeZone` resolves to the process's zone, so one instant printed as three different calendar days depending on where it was deployed:

```text
2026-03-08T10:00:00Z

TZ=UTC                 2026-03-08
TZ=Pacific/Kiritimati  2026-03-09
TZ=Pacific/Niue        2026-03-07
```

That is the off-by-one-day bug, and `TZ` is not something an application chose.

## The application's zone

```json
{
  "timeZone": "America/Montreal"
}
```

That is the whole setting for most applications: every date a server renders is written in that zone, whatever machine it runs on.

**Absent, it is `UTC` — not the machine's zone.** That is deliberate, and it is a change from what henri did before: a value nobody set should mean the same thing everywhere, and a rendering that follows `process.env.TZ` moves when the deployment does. If your application was relying on the server's zone, name it here.

The name is IANA's, and `Intl` is the authority — henri ships no zone list of its own, because a zone database that is a year old is worse than none. An alias resolves to its canonical name, so `US/Eastern` and `America/New_York` are one zone and compare equal. A name this runtime has no rules for fails the boot with [`HENRI_TIME_ZONE_UNKNOWN`](/reference/errors/#henri_time_zone_unknown) rather than quietly answering in another one. An abbreviation is not a zone: `EST` is a fixed offset half the year and names nothing.

## A person's zone

A zone is not one thing. The application has one; a _person_ has one, and it lives on their record — exactly where their locale already lives:

```json
{
  "timeZone": {
    "default": "UTC",
    "from": { "user": "timeZone" }
  }
}
```

```js
// app/models/user.js
module.exports = {
  attributes: {
    timeZone: { type: 'string' },
  },
};
```

`henri.time.forUser(record)` reads it back, and answers `null` when the record holds nothing or holds something that is not a zone. It never guesses.

The reason it is on the record and not only in the session is the next section.

## A mail's zone is the recipient's

A mail is rendered without a request. A nightly digest, an administrator acting on somebody else's account, and a job retrying a delivery an hour later all produce a mail whose reader is not whoever made the request — and two of those have no request at all. A record is the one thing a job has.

So a message carries its own zone, in this order:

1. `timeZone` in what the mailer action returned;
2. `timeZone` in the mailer's `defaults`;
3. the recipient's own, when the action named them with `for`;
4. `config.timeZone`.

```js
// app/mailers/digest.js
module.exports = {
  nightly: (user) => ({
    data: { since: user.lastSeenAt },
    for: user, // ← this is what makes the times right
    subject: 'Your day',
    to: user.email,
  }),
};
```

This is the same decision the [locale of a mail](/guides/i18n/#mails) makes, for the same reason, and it is why both live on the user's record.

## Where a request's zone comes from

`decide()` answers in one order, and the decision is visible on the request:

| step       | read from                      | default |
| ---------- | ------------------------------ | ------- |
| `explicit` | `req.setTimeZone()`            | always  |
| `user`     | the column `from.user` names   | off     |
| `query`    | `?tz=` (`from.query`)          | off     |
| `cookie`   | the cookie `from.cookie` names | off     |
| `header`   | the header `from.header` names | off     |
| `default`  | `config.timeZone`              | —       |

`req.timeZone` is the answer and `req.timeZoneSource` is the step that decided, because a decision nobody can see is a decision nobody can debug. The answer varies on `Cookie` when a cookie or the signed-in user decided, and on the header when a header did.

**Every step but the last is off until you name it.** This is the one place the design differs from the locale's, and it is deliberate: `Accept-Language` is a header browsers send on their own, negotiated and meant for exactly this, and **there is no such header for a zone**. What a browser can offer is `Intl.DateTimeFormat().resolvedOptions().timeZone`, which reaches a server only in a cookie or a header your own script sets. henri will read either, and neither is a guess it makes for you.

```js
// the application's own script, once
document.cookie = `henri.tz=${Intl.DateTimeFormat().resolvedOptions().timeZone};path=/;SameSite=Lax`;
```

```json
{ "timeZone": { "from": { "cookie": "henri.tz" } } }
```

henri **reads** that cookie and never writes it — a zone switcher is an action of the application, and a framework that sets a cookie nobody asked for is a framework that broke somebody's cache.

### A zone off the wire is a display preference, never an authorization input

Anyone can set any cookie and send any header. A zone that arrived from a client may decide **how a moment is printed** and must never decide which records are returned, whether something has expired, or what a signature covers. Nothing in henri reads `req.timeZone` for any of those, and your application should not either.

## Formatting

henri ships no date library and wraps none of `Intl`. What it adds is the one input `Intl` cannot guess and the application knows: the zone.

**Handlebars** gets `{{date}}`, which already existed and now fills in the `timeZone` of the render. The hash is still the `Intl` options object, passed through unchanged:

```hbs
{{date note.createdAt dateStyle='long' timeStyle='short'}}
{{date note.createdAt timeZone='UTC'}}
{{! still wins: the options are yours }}
```

**Inertia and React** pages get the instant and the zone, and call `Intl` themselves — which is what pages already do for numbers and dates:

```jsx
export default function Note({ note, time }) {
  return (
    <time dateTime={note.createdAt}>
      {new Intl.DateTimeFormat(undefined, {
        dateStyle: 'long',
        timeZone: time.zone,
      }).format(new Date(note.createdAt))}
    </time>
  );
}
```

`time` is `{ zone, source }` in the view options, next to `i18n`. Using it rather than the browser's own zone is what makes a page and the mail about the same record agree.

**Anywhere else** — a job, a controller, the console — it is `henri.time.format()`:

```js
henri.time.format(note.createdAt, { dateStyle: 'long', locale: 'fr' });
henri.time.format(note.createdAt, { zone: 'Asia/Tokyo' });
```

A moment it cannot read answers `''`, and a zone it cannot render in falls back to the application's rather than throwing — it is called from inside a render, and a page that fails to answer over a mistyped zone is worse than one that says the time in UTC. The two calls that _do_ throw are the boot and `req.setTimeZone()`, which are both a mistake at a moment somebody can act on it.

## What a zone must never touch

A zone is a presentation concern. None of this is stored, and nothing stored depends on it:

- `createdAt` and `updatedAt` stay instants;
- the [job queue](/guides/jobs/) keeps every moment as a BIGINT of epoch milliseconds, and its cron is UTC;
- the [access trail](/guides/trail/), the [call log](/guides/calls/) and the [version store](/guides/versions/) keep their own BIGINTs;
- [retention](/guides/retention/) keeps comparing instants to a cutoff;
- nothing an `Idempotency-Key` or an ETag is computed from has learned a zone.

If a stored value ever moves because somebody changed their zone, that is a bug in henri.

### Why the queue got this right first

The queue stores every moment as a BIGINT of milliseconds since the epoch, and the reason is worth repeating because the survey confirmed it: sqlite has no date type at all, and MySQL, PostgreSQL and MSSQL disagree about both the precision and the time zone of a bare `TIMESTAMP`. A claim compares `run_at` to the runner's clock, and that comparison has to mean the same thing on every dialect. An integer means the same thing everywhere; a `DATETIME` does not — which is exactly what the MySQL row of the table above shows.

## A column that already holds local times

henri cannot fix that, and this guide will not pretend otherwise.

If a column was written by something that stored a wall clock — a `DATETIME` filled by an older application, an import that dropped the offset — then the rows are not instants and no setting makes them into instants. The offset each one needs depends on the date it was written (daylight saving), and for the hour a fall-back repeats, two different instants wrote the same text and the original is not recoverable from the column alone.

What you have to do is a migration, and it is yours to write: decide the zone those values were in, convert each row to UTC with that zone's rules for _that date_, and accept that the ambiguous hour is a guess you are making on purpose. `config.timeZone` is not a compatibility switch for this, and it is deliberately not settable per model.

## What this does not do

Named so an application knows where the edge is:

- **No parsing of a wall clock in a person's zone.** A `date` parameter with no offset is read as **UTC** — which is a change: it used to be read in the process's zone, so the same query string meant different instants on different machines. An application that wants "09:00 in the user's zone" takes the parts and says which zone they are in itself.
- **No calendar arithmetic.** No "start of day in Europe/Paris", no "same time next month", no business days. `Intl.DateTimeFormat().formatToParts()` is the seam, and a library is the answer if you need more.
- **No zone-aware grouping or querying.** "All orders on 2026-03-08 in Montreal" is a range of instants you compute and pass; henri writes no `AT TIME ZONE` for you.
- **No ambient scope.** There is no `Time.use_zone` equivalent: the zone is a value on the request, the message or the call, not process state an async boundary could lose.
- **No zone picker.** The list of zones is `Intl.supportedValuesOf('timeZone')`; the page is yours.
- **The job queue's cron stays UTC.** A recurring job fires at the same absolute moment wherever the runner is, so no daylight saving change can make an hourly schedule fire twice or not at all. A schedule that has to follow a wall clock is enqueued from a job that knows the zone.
