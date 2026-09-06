---
'@usehenri/jobs': minor
'@usehenri/core': minor
'@usehenri/cli': minor
---

`@usehenri/jobs` registers itself

The queue was already a package, but `@usehenri/core` carried the module that
loaded it: an application without `@usehenri/jobs` still had a `henri.jobs`,
an inert object whose every method explained what to install. The package
ships the henri module itself now (`"henri": { "module": "./module.js" }`),
the way `@usehenri/graphql` does, so depending on it is what puts
`henri.jobs` in the boot -- at level 4, so `henri jobs` still binds no port.

An application that uses jobs needs `@usehenri/jobs` in its `package.json`,
which it almost certainly already has -- nothing worked without it. `henri
doctor` reports it as a missing dependency as soon as `app/jobs` holds a file
or the configuration has a `jobs` block, and `henri jobs` says the same.
Nothing else changes: the queue, the runner, the retries, the dead letter
queue, the recurring schedules, the tables and every `henri jobs` command are
untouched, and installing the package is still not the same as using it -- an
application with neither `app/jobs` nor a `jobs` block creates no table.

An application that does not use jobs has nothing to install and hears
nothing at boot. `henri.jobs` is `undefined` rather than an object that does
nothing, which the type declarations say too, so code reading it guards with
`henri.jobs &&`. The one thing that now speaks up is a mail that cannot be
delivered when it was asked to be: `deliverLater({ wait })` or
`deliverLater({ at })` without a queue fails with the install line instead of
sending the message immediately. `deliverLater()` with nothing to honour is
unchanged -- it delivers out of band, silently.

`henri new` does not add the dependency: the scaffold's `app/jobs` is empty,
so the module would be inert in every application that never writes a job.
