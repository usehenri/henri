---
'@usehenri/testing': minor
'@usehenri/uploads': patch
---

Test factories: a valid record with the fields the test does not care about already filled in.

A factory lives in `test/factories/<name>.js` and is read the first time a test asks for one. It is a plain object -- `{ attributes, traits, model, after }` -- and `@usehenri/testing` now exports `create`, `build`, `createList`, `defineFactory` and `resetFactories`:

```js
// test/factories/proposal.js
module.exports = {
  attributes: {
    eventId: async ({ create }) => (await create('event')).id,
    speakerId: async ({ create }) => (await create('user')).id,
    title: ({ sequence }) => `A proposal ${sequence}`,
  },
  traits: { submitted: { state: 'submitted', submittedAt: () => new Date() } },
};

await create('proposal', 'submitted', { speakerId: me.id });
```

Three rules hold it together. What the caller gives is never made, so an override of an association creates no second record. A value is a literal or a function of the build context (`attrs`, `build`, `create`, `sequence`, `traits`, `uid`), so there is no separate vocabulary for associations, sequences or computed fields. Fields resolve on demand rather than in the order they are written, so `await attrs.eventId` from another field's function keeps two of them on one parent whatever order the keys sit in. A trait is an override object with a name, kept next to the model because a state is rarely one field.

A factory writes through the model, so the password is still hashed, the timestamps are still stamped and a `paranoid` model still soft-deletes; `after(record, context)` covers what the model refuses to mass assign. Failures carry the new `HENRI_FACTORY_*` codes.

`@usehenri/uploads`: the local storage sweeps only the parts older than an hour when it starts. It could not tell a part a dead process left behind from one another process is streaming into right now, so a second application process -- or a second test file -- booting mid-upload failed that upload.
