---
'@usehenri/cli': minor
'@usehenri/mcp': patch
---

The scaffolded pages read the model file.

`henri generate scaffold` wrote a page from the `name:type` pairs on the command line and nothing else, so a column that can only hold four values got a plain text input, a required column got an optional one, and a column henri strips from every answer it builds got a table column that is empty forever. The model file next to those pages had said all three the whole time — `--slug` already read it back, which is the mechanism this follows.

The fields still come from the command line. What each of them _is_ now comes from `app/models/<Name>.js`, the one this run wrote or the one that was already there:

| The model says                | The pages write                                                                |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `enum: ['draft', 'live']`     | a `<select>` of `Model.enums.<field>`, which the `new` and `edit` actions send |
| `required: true`              | a `required` input, and only there                                             |
| `personal: { expose: false }` | nothing at all — no table column, no detail row, no form field                 |

The `enum` list is **sent, never copied**: the controller passes `Model.enums` and the form maps over what it was given, so a value added to the model reaches the form without the page being regenerated. The models guide already said to pass the list rather than write a copy of it; the generator now does what it says.

The `personal` one is the one that was quietly wrong in both directions. A field marked `expose: false` never reaches a page, so a table column showed an empty string forever — and an edit form showed that empty string and posted it back over the stored value. It is written into no page now. The controller's `FIELDS` still names it, with a comment saying why: what the mark governs is answers, and a write is not an answer, so an API client may still set it. A field marked `personal` _without_ `expose: false` is untouched, because whether it is stripped is `config.privacy.expose`, which is per environment, and a page is one file for all of them.

And the generator can now write an `enum` rather than only read one:

```bash
henri generate scaffold Post title:string! status:string:enum=draft,in_review,live
```

`:enum=` is the one setting a `name:type` pair takes after its type, and the grammar is closed there on purpose: it is the mark the pages read back, and everything else a column can say — a `default`, `unique`, `index`, a `personal` mark — belongs in the model file, which is where the generators read it. `henri mcp`'s `generate` tool takes the same attribute.

Both renderers: the Inertia pages get a `<select>` and the React ones the `<Select choices={...}>` of `@usehenri/react/forms`. Regenerate the pages of a model whose marks changed with `--force`.
