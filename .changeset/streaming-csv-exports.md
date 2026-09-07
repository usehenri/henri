---
'@usehenri/core': minor
---

`res.csv()`: an export that streams, and leaves through the same gate as every other answer.

Every application grows an export endpoint, and the shape it grows is the same one every time:

```js
const rows = await Invoice.find(where);

res.set('Content-Type', 'text/csv');
res.send(rows.map((row) => `${row.id},${row.amount}`).join('\n'));
```

which holds the whole table in memory, falls over on the row count that made anybody want an export, writes the primary key into the file, writes a column the model said must never leave, and hands a spreadsheet a cell that starts with `=`. This is henri's answer to all four:

```js
// app/controllers/invoices.js
report: async (req, res) => res.csv(Invoice, { filename: 'invoices' }),
```

**It streams.** There is no `Content-Length` — there is no number to put there without building the file first, which is the thing being avoided — so the answer is chunked, the rows are read a page at a time (`config.api.csv.batch`, 500), and `res.write()` returning `false` is awaited rather than ignored, so a slow client slows the reads instead of filling the process with a file nobody is taking. The pages are a **cursor** on the record's public identifier, never an `OFFSET`: an offset over a table that is being written to skips rows and repeats rows, and an export that quietly drops a row is worse than no export. A uuid v7 is creation order, so that is the order of the file.

**The same exit gate.** Every page goes through the same `toPublic()` call `res.resource()` uses — publish, then strip — so a foreign key leaves as the `externalId` of the row it names, no primary key leaves at all, and a column marked `personal: { expose: false }` is not in the file. A CSV looks like a report rather than an API answer, and that is exactly why it needed to be on the same path rather than beside it. The columns are the **model's**, not the rows': the header comes from the schema plus what the adapter adds, minus what is hidden, so a file with no rows still has a header and two exports of the same model have the same columns.

**It is not a per-record authorization surface.** A hundred thousand rows are not a hundred thousand policy questions, so `res.csv()` takes the position `req.filters()` takes: the list is what `policy.scope(user)` says it is, asked for by default, and `scope: false` is the explicit opt-out.

**Escaping is walked, never matched.** A cell is quoted when it holds a comma, a quote, a newline or a leading or trailing space, and a quote inside it is doubled — RFC 4180, as a walk over the code points. RFC 4180 says nothing about the fifth character: a cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return is a **formula** in Excel, Sheets and LibreOffice. henri writes such a cell as text, and the rule is narrow because the false positive matters — `-1.5` starts with `-`. Only a value that **is a string** is considered, and a string that is a **plain number** is left alone. It does change the bytes of the cells it neutralizes, so `config.api.csv.formulas: false` turns it off for an export a machine reads.

**The bound is `config.api.csv.maxRows`** (100000), checked with one `count()` before the headers go out, so an export too big to serve is a `413` carrying the bound and the number rather than a file that stops in the middle. Once bytes really are on the wire there is no status left to send, so henri **destroys the connection** instead of ending the response: a truncated CSV is a valid CSV, and a consumer has to be able to tell a file that stopped early from a file that ended. That answer is blunt, so the other half of it is making it rare — the headers go out with the first 64kb chunk rather than the first row, so an export smaller than that has written nothing when it fails and still gets an ordinary `500`.

One new configuration key, `api.csv` (`batch`, `formulas`, `maxRows`), and five new error codes: `HENRI_CSV_TOO_MANY`, `HENRI_CSV_UNKNOWN_COLUMN`, `HENRI_CSV_UNPAGEABLE`, `HENRI_CSV_INTERRUPTED` and `HENRI_CSV_ADAPTER_UNSUPPORTED`.
