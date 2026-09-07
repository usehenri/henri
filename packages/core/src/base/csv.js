/**
 * `res.csv()`: an export that streams, and leaves through the same gate as
 * every other answer.
 *
 * Every application grows an export endpoint, and the shape it grows is the
 * same one every time:
 *
 * ```js
 * const rows = await Invoice.find(where);
 *
 * res.set('Content-Type', 'text/csv');
 * res.send(rows.map((row) => `${row.id},${row.amount}`).join('\n'));
 * ```
 *
 * which holds the whole table in memory, falls over on the row count that
 * made anybody want an export, writes the primary key into the file, writes
 * a column the model said must never leave, and hands a spreadsheet a cell
 * that starts with `=`. This is henri's answer to all four.
 *
 * ```js
 * // app/controllers/invoices.js
 * exportAll: async (req, res) => res.csv(Invoice, { filename: 'invoices' }),
 * ```
 *
 * ## It streams, and it says so by not saying how long it is
 *
 * There is no `Content-Length`, because there is no number to put there
 * without building the file first -- which is the thing being avoided. The
 * answer is chunked, the rows are read a page at a time
 * (`config.api.csv.batch`, 500), and `res.write()` returning false is
 * awaited rather than ignored, so a slow client slows the reads instead of
 * filling this process's memory with a file nobody is taking.
 *
 * The pages are a **cursor**, not an offset: `WHERE externalId > :last
 * ORDER BY externalId` (the primary key on a model that opted out of the
 * public one). An `OFFSET` over a table that is being written to skips rows
 * and repeats rows, and an export that quietly drops a row is worse than no
 * export -- the same reasoning `base/filters.js` gives for appending
 * `externalId` to every order it builds. A uuid v7 is also creation order,
 * so the file is in the order the records were made, and a client's `sort`
 * has no say: an export is a dump rather than a page.
 *
 * ## The exit gate, again, and it matters more here
 *
 * A CSV looks like a report rather than an API answer, and that is exactly
 * why it is the dangerous one: nobody thinks of it as a serialization path.
 * So it is not one. Every page goes through the same `toPublic()` call
 * `res.resource()` uses -- `publish()` then `henri.privacy.strip()` -- so a
 * foreign key leaves as the `externalId` of the row it names, no primary
 * key leaves at all, and a column marked `personal: { expose: false }` is
 * not in the file. `include` is the same way back it is everywhere else.
 *
 * The columns are the model's, not the rows': the header comes from the
 * schema (plus what the adapters add), minus what is hidden, so a file with
 * no rows still has a header and two exports of the same model have the
 * same columns whatever the rows happened to hold. `columns` narrows and
 * reorders that list, and a name that is not one of them is refused before
 * a byte is written.
 *
 * ## What it is not: a per-record authorization surface
 *
 * A hundred thousand rows are not a hundred thousand policy questions.
 * `res.csv()` takes the position `req.filters()` takes: **the list is what
 * `policy.scope(user)` says it is**, asked for by default, and an
 * application whose export is genuinely everything says so once
 * (`scope: false`). What `_embedded` does per record (`base/embeds.js`) is
 * affordable because it is bounded; this is not, and pretending otherwise
 * would be a rule that quietly stops holding at scale.
 *
 * ## Escaping, walked rather than matched
 *
 * A cell is quoted when it holds the delimiter, a quote, a newline or a
 * leading or trailing space, and a quote inside it is doubled -- RFC 4180,
 * written as a walk over the code points. There is no regular expression
 * over a cell anywhere in this file, for the reason the repository has
 * fixed several times: a pattern over text somebody else stored is a
 * quadratic backtrack waiting for the right input.
 *
 * ### And the fifth character, which is not in RFC 4180
 *
 * A cell whose text starts with `=`, `+`, `-`, `@`, a tab or a carriage
 * return is a **formula** in Excel, Sheets and LibreOffice. `=cmd|'/c
 * calc'!A1` is the famous one; `=IMPORTXML(...)` quietly posts the row it
 * sits next to at a url of the attacker's choosing, and nothing in the file
 * format says any of that.
 *
 * henri neutralizes it, and the argument for the exact rule is the false
 * positive: `-1.5` starts with `-`, and an export where every negative
 * number has been mangled is not an export. So the rule is narrow, and it
 * is narrow along the two lines henri can actually see:
 *
 * - only a value that is a **string** is considered. A number, a date, a
 *   decimal, a boolean is text henri wrote itself and never a formula.
 * - a string that is a **plain number** (an optional sign, digits, at most
 *   one point) is left alone, which is the whole of the false positive
 *   above -- a numeric value stored in a text column.
 *
 * What is left is neutralized by writing the cell quoted with a leading
 * apostrophe (`"'=SUM(A1)"`), which is what every spreadsheet reads as "this
 * is text" and what OWASP recommends. It **changes the bytes**, and that is
 * said out loud here and in the guide rather than hidden: an application
 * exporting for a machine rather than for a person turns it off with
 * `config.api.csv.formulas: false` and gets the value as it is stored.
 *
 * ## The bound, and what happens at it
 *
 * `config.api.csv.maxRows` (100000). It is checked **before the headers go
 * out**, with one `count()`, so an export too big to serve is a `413`
 * carrying the bound and the number -- an answer a client can act on -- and
 * not a file that stops in the middle.
 *
 * ## And a failure after the headers are out
 *
 * There is no status left to send. `base/timeout.js` faced this first and
 * its answer is written down there: once the headers are out, nothing is
 * sent and only `req.timedout` is set. Here the answer has to be louder,
 * because a truncated CSV is a **valid CSV** -- a consumer cannot tell a
 * file that stopped early from a file that ended.
 *
 * So henri **destroys the connection** instead of ending the response. The
 * terminating zero-length chunk is never written, so every conforming HTTP
 * client reports a transport error rather than a complete body, and the
 * half file is not mistaken for the whole one. The failure is logged with
 * the row count reached, and goes to `henri.reporter` like any other 5xx
 * henri answers on the application's behalf.
 *
 * That answer is blunt, so the other half of it is **making it rare**: the
 * headers go out with the first chunk rather than with the first row, and a
 * chunk is 64kb. An export smaller than that -- which is most of them --
 * has written nothing at all when it fails, so it still has a status and
 * gets an ordinary 500 through the error handler. The connection is only
 * destroyed once bytes really are on the wire.
 *
 * @module base/csv
 */

const { EXTERNAL_ID } = require('./external-id');
const { fail } = require('./errors');
const { conditionFor, narrow, orderFor } = require('./filters');
const {
  countRecords,
  findRecords,
  hasColumn,
  primaryOf,
} = require('./records');
const { columnsOf, settingsOf } = require('./openapi');

/** The code every failure of this module carries when a model cannot be read */
const ADAPTER = 'HENRI_CSV_ADAPTER_UNSUPPORTED';

/** What `config.api.csv` holds when the application says nothing */
const DEFAULTS = Object.freeze({
  batch: 500,
  formulas: true,
  maxRows: 100000,
});

/** The field separator. RFC 4180, and not a setting: a `.csv` is comma separated */
const DELIMITER = ',';

/** The line ending. RFC 4180 says CRLF, and every reader takes it */
const NEWLINE = '\r\n';

/** What a spreadsheet reads as the start of a formula */
const FORMULA = new Set(['=', '+', '-', '@', '\t', '\r']);

/** The byte order mark, for the readers that want to be told the encoding */
const BOM = '﻿';

/** How much is gathered before a write: one row per write is one syscall per row */
const CHUNK = 64 * 1024;

/** The characters a filename may carry into `Content-Disposition` */
const NAMED = new Set([
  '-',
  '.',
  '_',
  ...'0123456789',
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
]);

/**
 * The refusal an export too big to serve answers.
 *
 * A 413 rather than a 500: the number is a fact about the request, the
 * bound is a setting of this application, and both are in the message, so a
 * client can narrow what it asked for. It is raised **before the headers go
 * out**, which is what makes it an answer rather than a file that stops in
 * the middle.
 *
 * @param {string} message what happened
 * @returns {Error} the error to throw
 */
function refuse(message) {
  const error = fail('HENRI_CSV_TOO_MANY', message, {
    hint: 'Narrow it -- a date range is the usual one -- or raise config.api.csv.maxRows for an application that can afford the read',
  });

  error.status = 413;

  return error;
}

/**
 * The `csv` settings of an application, with the defaults filled in
 *
 * @param {Henri} henri the henri instance
 * @returns {{batch: number, formulas: boolean, maxRows: number}} the settings
 */
function settings(henri) {
  const config = henri && henri.config;
  const has = config && typeof config.has === 'function' && config.has('api');
  const api = has ? config.get('api') : null;
  const raw = api && typeof api === 'object' ? api.csv : null;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULTS };
  }

  const positive = (value, fallback) =>
    Number.isInteger(value) && value > 0 ? value : fallback;

  return {
    batch: positive(raw.batch, DEFAULTS.batch),
    formulas: raw.formulas !== false,
    maxRows: positive(raw.maxRows, DEFAULTS.maxRows),
  };
}

/**
 * Is this text a plain number? Walked, never matched.
 *
 * It is the one exception to the formula rule below, and it is the whole of
 * the false positive that rule would otherwise have: a negative number
 * stored in a text column starts with `-`.
 *
 * @param {string} text the cell text
 * @returns {boolean} true for an optional sign, digits and at most one point
 */
function numeric(text) {
  if (text.length === 0) {
    return false;
  }

  let index = text[0] === '-' || text[0] === '+' ? 1 : 0;
  let digits = 0;
  let points = 0;

  for (; index < text.length; index++) {
    const character = text[index];

    if (character >= '0' && character <= '9') {
      digits++;
      continue;
    }

    if (character === '.') {
      points++;

      if (points > 1) {
        return false;
      }

      continue;
    }

    return false;
  }

  return digits > 0;
}

/**
 * A value as the text of a cell.
 *
 * A `Date` is ISO 8601 because that is what the JSON answer carries, a
 * `decimal` and a `bigint` are already the exact strings `base/exact.js`
 * hands over, and anything with a shape of its own -- a json column, a
 * list -- is written as its JSON rather than as `[object Object]`.
 *
 * @param {*} value anything a published record holds
 * @returns {string} the text
 */
function textOf(value) {
  if (value === null || typeof value === 'undefined') {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('base64');
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      // A value that cannot be serialized is a cell henri has nothing to
      // say about; an empty one is the honest answer
      return '';
    }
  }

  return String(value);
}

/**
 * One cell, escaped.
 *
 * The whole of RFC 4180 plus the formula guard, as a single walk over the
 * code points: the quote is doubled, the delimiter, the newlines and a
 * leading or trailing space ask for quotes, and nothing here is a pattern.
 *
 * @param {*} value the value
 * @param {boolean} [formulas=true] neutralize a leading `=`, `+`, `-`, `@`
 * @returns {string} the cell
 */
function cell(value, formulas = true) {
  const text = textOf(value);

  if (text === '') {
    return '';
  }

  // Only a string is a formula risk: a number, a date, a boolean is text
  // henri wrote itself, and a text column holding a plain number is the
  // false positive this rule exists not to have
  const dangerous =
    formulas &&
    typeof value === 'string' &&
    FORMULA.has(text[0]) &&
    !numeric(text);
  let quoted =
    dangerous ||
    text[0] === ' ' ||
    text[text.length - 1] === ' ' ||
    text[0] === '\t';
  let body = '';

  for (const character of text) {
    if (character === '"') {
      body += '""';
      quoted = true;
      continue;
    }

    if (
      character === DELIMITER ||
      character === '\n' ||
      character === '\r' ||
      character === '\t'
    ) {
      quoted = true;
    }

    body += character;
  }

  if (!quoted) {
    return body;
  }

  return `"${dangerous ? `'${body}` : body}"`;
}

/**
 * One row, as a line
 *
 * @param {object} record a published record
 * @param {Array<string>} columns the header
 * @param {boolean} formulas neutralize the formula shape
 * @returns {string} the line, with its ending
 */
function line(record, columns, formulas) {
  const cells = [];

  for (const column of columns) {
    cells.push(
      cell(
        record && Object.prototype.hasOwnProperty.call(record, column)
          ? record[column]
          : null,
        formulas
      )
    );
  }

  return cells.join(DELIMITER) + NEWLINE;
}

/**
 * A filename a `Content-Disposition` can carry, walked rather than matched.
 *
 * Anything outside the set becomes `-`, so a name taken from a record
 * cannot carry a newline into a header, a quote out of the parameter or a
 * path separator into whatever saves it.
 *
 * @param {*} wanted what the caller asked for
 * @param {string} fallback the name to use when it asked for nothing usable
 * @returns {string} the filename, ending in `.csv`
 */
function filenameOf(wanted, fallback) {
  const text = typeof wanted === 'string' ? wanted : '';
  let cleaned = '';

  for (const character of text) {
    cleaned += NAMED.has(character) ? character : '-';
  }

  while (cleaned.startsWith('-') || cleaned.startsWith('.')) {
    cleaned = cleaned.slice(1);
  }

  const named = cleaned.length > 0 ? cleaned.slice(0, 100) : fallback;

  return named.toLowerCase().endsWith('.csv') ? named : `${named}.csv`;
}

/**
 * The model file of an ORM model, through the table the boot already built
 *
 * @param {Henri} henri the henri instance
 * @param {*} Model an ORM model
 * @returns {?object} the model file, or null
 */
function fileOf(henri, Model) {
  const table = (henri.model && henri.model.referenceTable) || null;
  const classes = (table && table.classes) || new Map();
  const globalId = classes.get(Model);
  const files = (henri.model && henri.model.models) || [];

  return files.find((file) => file.globalId === globalId) || null;
}

/**
 * The header of the file: the model's columns, not the rows'.
 *
 * A file with no rows still has a header, and two exports of the same model
 * have the same columns whatever the rows happened to hold -- which is what
 * makes an export something a script can read twice.
 *
 * @param {Henri} henri the henri instance
 * @param {*} Model an ORM model
 * @param {object} options `{ columns, include }`
 * @returns {Array<string>} the column names, in order
 * @throws {Error} HENRI_CSV_UNKNOWN_COLUMN when `columns` names one that is
 *   not a column of the model, or one that never leaves the server
 */
function headerOf(henri, Model, { columns = null, include = [] } = {}) {
  const file = fileOf(henri, Model);
  const hidden = (henri.privacy && henri.privacy.private) || new Set();
  const known = file ? columnsOf(file, settingsOf(henri.config)) : {};
  const available = Object.keys(known).filter(
    (name) =>
      (known[name] || {}).select !== false &&
      (!hidden.has(name) || include.includes(name))
  );

  if (!Array.isArray(columns)) {
    return available;
  }

  const unknown = columns.filter((name) => !available.includes(name));

  if (unknown.length > 0) {
    throw fail(
      'HENRI_CSV_UNKNOWN_COLUMN',
      `res.csv() was asked for ${unknown.join(', ')}, which ${
        unknown.length > 1 ? 'are not columns' : 'is not a column'
      } this export can carry`,
      {
        hint: `It carries ${available.join(', ')}; a column marked personal: { expose: false } is named in \`include\` or not at all`,
      }
    );
  }

  return columns.slice();
}

/**
 * The column the cursor walks, and the order the file is in
 *
 * @param {*} Model an ORM model
 * @returns {string} `externalId`, or the primary key on a model without one
 */
function cursorOf(Model) {
  return hasColumn(Model, EXTERNAL_ID) ? EXTERNAL_ID : primaryOf(Model);
}

/**
 * The condition of one page: what the caller asked for, and everything
 * after the last row of the page before.
 *
 * An `and`, spelled for the adapter by `base/filters.js`, for the reason it
 * gives there: two conditions on one column have to hold at once rather
 * than replace each other.
 *
 * @param {*} Model an ORM model
 * @param {*} where the caller's condition
 * @param {string} key the cursor column
 * @param {*} after the last value of the page before, or null
 * @returns {*} the condition
 * @throws {Error} HENRI_CSV_UNPAGEABLE when the two cannot be intersected
 */
function pageWhere(Model, where, key, after) {
  if (after === null || typeof after === 'undefined') {
    return where;
  }

  const cursor = conditionFor(Model, [
    { column: key, operator: 'gt', value: after },
  ]);

  try {
    return narrow(Model, where, cursor);
  } catch (error) {
    throw fail(
      'HENRI_CSV_UNPAGEABLE',
      `res.csv() cannot put a cursor under the condition it was given: ${error.message}`,
      {
        hint: 'An export is read a page at a time, so its condition has to be a plain object henri can intersect with the cursor -- what req.filters() answers is one',
      }
    );
  }
}

/**
 * Waits for the socket to take more, and gives up when it goes away.
 *
 * Without this the loop would keep building rows a client is not reading,
 * which is the memory the whole file exists to avoid.
 *
 * @param {Express.Response} res the response
 * @returns {Promise<void>} when the socket is ready
 * @throws {Error} HENRI_CSV_INTERRUPTED when the client left
 */
function drained(res) {
  return new Promise((resolve, reject) => {
    /**
     * Removes both listeners, whichever fired
     *
     * @returns {void}
     */
    const off = () => {
      res.off('drain', ready);
      res.off('close', gone);
      res.off('error', gone);
    };
    /**
     * The socket took more
     *
     * @returns {void}
     */
    const ready = () => {
      off();
      resolve();
    };
    /**
     * ... or the client left
     *
     * @returns {void}
     */
    const gone = () => {
      off();
      reject(fail('HENRI_CSV_INTERRUPTED', 'the client closed the connection'));
    };

    res.once('drain', ready);
    res.once('close', gone);
    res.once('error', gone);
  });
}

/**
 * Writes a chunk, honouring backpressure
 *
 * @param {Express.Response} res the response
 * @param {string} chunk the bytes
 * @returns {Promise<void>} when it is written or buffered
 * @throws {Error} HENRI_CSV_INTERRUPTED when the client left
 */
async function push(res, chunk) {
  if (res.writableEnded || res.destroyed) {
    throw fail('HENRI_CSV_INTERRUPTED', 'the client closed the connection');
  }

  if (!res.write(chunk)) {
    await drained(res);
  }
}

/**
 * The headers of the file, set as late as they can be.
 *
 * Nothing goes out until there is a chunk worth sending, and that is a
 * decision rather than an accident: a failure **before** the first write
 * still has a status to answer with, so the honest-but-blunt answer below
 * -- destroying the connection -- is only reached once bytes really are on
 * the wire. A small export that fails half way through therefore gets a
 * 500 like any other action.
 *
 * @param {Express.Response} res the response
 * @param {string} name the filename
 * @returns {void}
 */
function headers(res, name) {
  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  // No length: there is no number to put here without building the file
  // first, which is the thing this exists not to do
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

/**
 * The pages of an export, in cursor order
 *
 * @param {*} Model an ORM model
 * @param {object} context `{ batch, key, where }`
 * @yields {Array} one page of records
 * @returns {AsyncGenerator} the pages
 */
async function* pages(Model, { batch, key, where }) {
  const order = orderFor(Model, [], key);
  let after = null;

  for (;;) {
    // A cursor is sequential by construction: the next page starts where
    // this one ended
    const rows = await findRecords(Model, pageWhere(Model, where, key, after), {
      code: ADAPTER,
      limit: batch,
      order,
    });

    if (rows.length === 0) {
      return;
    }

    yield rows;

    if (rows.length < batch) {
      return;
    }

    after = rows[rows.length - 1][key];
  }
}

/**
 * `res.csv(Model, options)`: the records of a model, streamed as a file.
 *
 * @param {Henri} henri the henri instance
 * @param {Express.Request} req the request
 * @param {Express.Response} res the response
 * @param {*} Model an ORM model
 * @param {object} [options={}] options
 * @param {*} [options.where] the condition, already intersected with the scope
 * @param {Array<string>} [options.columns] the columns, in order
 * @param {Array<string>} [options.include] the fields marked
 *   `personal: { expose: false }` this file is allowed to carry
 * @param {string} [options.filename] the name the browser saves it under
 * @param {boolean} [options.bom] write a byte order mark (for Excel)
 * @returns {Promise<Express.Response>} the response
 * @throws {Error} before a byte is written: an unknown column, a condition
 *   with no cursor under it, or more rows than `config.api.csv.maxRows`
 */
async function csv(henri, req, res, Model, options = {}) {
  const { bom = false, columns = null, include = [], where = {} } = options;
  const file = fileOf(henri, Model);
  const config = settings(henri);
  const header = headerOf(henri, Model, { columns, include });
  const key = cursorOf(Model);
  const total = await countRecords(Model, where, { code: ADAPTER });

  if (total > config.maxRows) {
    throw refuse(
      `this export is ${total} rows and at most ${config.maxRows} may be exported at once`
    );
  }

  const name = filenameOf(
    options.filename,
    (file && file.identity) || 'export'
  );

  let started = false;
  let written = 0;
  let buffer = bom ? BOM : '';
  /**
   * Flushes what has been gathered, setting the headers on the way out the
   * first time
   *
   * @returns {Promise<void>} when it is written or buffered
   */
  const flush = async () => {
    if (!started) {
      started = true;
      headers(res, name);
    }

    const chunk = buffer;

    buffer = '';

    await push(res, chunk);
  };

  buffer += `${header.map((column) => cell(column, false)).join(DELIMITER)}${NEWLINE}`;

  try {
    for await (const rows of pages(Model, {
      batch: config.batch,
      key,
      where,
    })) {
      // The same two passes every other answer leaves through, one page at
      // a time: the foreign keys of a page are resolved in one statement
      // per target model and the hidden columns are dropped (base/hateoas.js)
      const published = await toPublic(henri, rows, include);

      henri.trail && (await henri.trail.seen(req, rows));

      for (const record of published) {
        buffer += line(record, header, config.formulas);
        written++;

        if (buffer.length >= CHUNK) {
          await flush();
        }
      }

      if (written > config.maxRows) {
        // Rows were added under the export: the count above was honest when
        // it was taken and is not any more. There is no status left to send,
        // so this lands in `interrupted()` like every other late failure
        throw refuse(
          `this export went past ${config.maxRows} rows while it was being written`
        );
      }
    }

    if (buffer.length > 0) {
      await flush();
    }

    res.end();

    return res;
  } catch (error) {
    // Nothing on the wire yet: there is still a status to answer with, so
    // this is an ordinary failure and the error handler says so
    if (!started) {
      throw error;
    }

    return interrupted(henri, req, res, error, written);
  }
}

/**
 * The answer to a failure once the headers are out.
 *
 * There is no status left to send -- `base/timeout.js` reached the same
 * wall and stops there -- and a CSV makes it worse, because a truncated one
 * is a **valid** one: a consumer cannot tell a file that stopped early from
 * a file that ended.
 *
 * So the connection is destroyed rather than ended. The terminating chunk
 * is never written, every conforming client reports a transport error, and
 * the half file is not mistaken for the whole one.
 *
 * @param {Henri} henri the henri instance
 * @param {Express.Request} req the request
 * @param {Express.Response} res the response
 * @param {Error} error what happened
 * @param {number} written how many rows made it out
 * @returns {Express.Response} the response
 */
function interrupted(henri, req, res, error, written) {
  const quiet = error && error.code === 'HENRI_CSV_INTERRUPTED';

  henri.pen &&
    henri.pen.error &&
    henri.pen.error(
      'api',
      `csv export stopped after ${written} rows`,
      error.message
    );

  if (!quiet && henri.reporter && typeof henri.reporter.report === 'function') {
    henri.reporter.report(error, { req, source: 'csv' });
  }

  if (!res.destroyed) {
    res.destroy();
  }

  return res;
}

// Required late: base/hateoas.js requires base/embeds.js, which requires
// base/filters.js -- the cycle is broken by asking for the gate when it is
// used rather than when this file loads
/**
 * The publish-then-strip pass every answer leaves through
 *
 * @param {Henri} henri the henri instance
 * @param {Array} records the page
 * @param {Array<string>} include the personal fields this file may carry
 * @returns {Promise<Array>} the published page
 */
function toPublic(henri, records, include) {
  return require('./hateoas').toPublic(henri, records, include);
}

module.exports = {
  CHUNK,
  DEFAULTS,
  DELIMITER,
  FORMULA,
  NEWLINE,
  cell,
  csv,
  cursorOf,
  drained,
  filenameOf,
  headerOf,
  interrupted,
  line,
  numeric,
  pageWhere,
  pages,
  push,
  settings,
  textOf,
};
