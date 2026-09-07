---
'@usehenri/core': minor
---

Time zones: `config.timeZone`, a person's zone on their record, and a mail's zone that is the recipient's

Storage was never the problem, and the survey behind this says so with numbers: every adapter keeps a moment as a moment, checked by writing under `Pacific/Kiritimati` (UTC+14) and reading under `Pacific/Niue` (UTC−11). What was broken is what a server _prints_. `Intl.DateTimeFormat` with no `timeZone` resolves to the process's zone, so one instant rendered as three different calendar days depending on where it was deployed.

`henri.time` is the zone, and it stores nothing.

- **`config.timeZone`** is the zone a server renders in — a name, or `{ default, from }`. **It defaults to `UTC` rather than the machine's zone**, which is a behaviour change: `{{date}}` used to follow `process.env.TZ`. An application that was relying on the server's zone should name it. A zone this runtime has no rules for fails the boot with `HENRI_TIME_ZONE_UNKNOWN`.
- **A person's zone lives on their record**, in the column `timeZone.from.user` names, the way `i18n.from.user` holds their locale. `henri.time.forUser(record)` reads it back.
- **A mail's zone is the recipient's**, read from `for` — the same decision the locale of a mail already makes, and the one that works from a job, which has a record and no request.
- **`req.timeZone` and `req.timeZoneSource`** say which zone a request is answered in and which step decided. Every step but the default is off until it is named: there is no header a browser sends on its own, so henri reads a cookie or a header the application decided to send and guesses nothing. A zone off the wire is a display preference and never an authorization input.
- **`{{date}}` fills in the zone of the render**, and Inertia and React pages get `{ zone, source }` in the view options next to `i18n`. henri ships no date library: `henri.time.format()` is one call to `Intl.DateTimeFormat` with the `timeZone` filled in and every other option passed through.
- **A `date` parameter with no offset is read as UTC.** It used to go through `Date.parse`, where a date _with a time and no offset_ is read in the process's zone — so the same query string meant different instants on different machines, and that was the one place the absence of a zone policy reached a stored value.
- `{{date}}` on a null column answered `1970-01-01`; it now answers nothing.

Nothing stored depends on a zone: `createdAt`, the job queue's BIGINT milliseconds, the trail, the call log, the version store, retention's cutoffs and anything an `Idempotency-Key` is computed from are untouched. The guide is `guides/time.md`, which also says plainly what henri cannot do about a column that already holds local times.
