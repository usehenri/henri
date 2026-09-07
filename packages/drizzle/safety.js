const { createHash } = require('crypto');
const { coded } = require('./utils');

/**
 * What a migration would do to a database that has rows in it.
 *
 * `henri db:generate` writes the difference between the models and the last
 * snapshot, and drizzle-kit is happy to write a statement that takes a
 * production database down. This reads the SQL back -- the SQL, not the
 * model diff, because the SQL is what runs -- and says which statements are
 * the ones that bite, on this dialect, with the safe path named.
 *
 * ## How it reads the SQL
 *
 * **It walks, it does not match.** A regular expression over a whole file is
 * how this repository has shipped the same defect several times, and here it
 * would also be wrong rather than merely slow: `INSERT INTO notes (body)
 * VALUES ('run DROP COLUMN before the deploy')` is a safe statement that
 * contains the text of a dangerous one, and refusing it is worse than not
 * checking at all. So `lex()` is a hand-written scanner that walks the file
 * once, character by character, and knows the four things that are not code:
 *
 * - `-- line comments`, `/* block comments *\/` (nested on postgres, which
 *   nests them, flat on sqlite and mysql, which do not),
 * - `'string literals'` with their `''` escape, plus mysql's backslash
 *   escapes, mysql's `"double quoted"` strings, postgres's `E'\n'` and its
 *   `$tag$ dollar quoting $tag$` -- which is how a function body carrying a
 *   whole `DROP TABLE` stays one token,
 * - `"quoted"`, `` `quoted` `` and `[quoted]` identifiers, each with the
 *   escape its dialect uses,
 * - the statement separators: `;`, and the `--> statement-breakpoint` line
 *   drizzle-kit writes between statements.
 *
 * **A string's content is thrown away.** The token a literal produces holds
 * the empty string, never its text, so no check downstream is able to read
 * a string as SQL even by accident. A comment produces no token at all.
 * What is left is a token stream -- keywords, identifiers, punctuation --
 * and every check below is a small recognizer over that stream, matching
 * token by token from the front of a statement rather than searching it.
 *
 * ## What it looks at, and what it lets through
 *
 * A false refusal is the failure that gets a checker turned off, so the
 * rules are narrow on purpose and two of them exist only to avoid one:
 *
 * - **A table created by this same migration has no rows**, so nothing done
 *   to it is reported. Without this every first migration would warn about
 *   the indexes it creates next to the tables, which is the fastest way to
 *   teach somebody to ignore the output.
 * - **sqlite has no `ALTER COLUMN`**, and drizzle-kit's answer is to build
 *   `__new_tasks`, copy every row into it, `DROP TABLE tasks` and rename.
 *   Read one statement at a time that is a dropped table and a renamed
 *   table; read as a migration it is one table being rebuilt. The pattern is
 *   recognized by its shape -- a table created here, later renamed onto a
 *   table dropped here -- and not by drizzle-kit's `__new_` prefix, and it
 *   is reported once, as what it is.
 *
 * @module safety
 */

/**
 * The catalogue: every check, what it means, and where it bites.
 *
 * `dialects` is the measured answer rather than a Postgres-shaped list
 * copied wholesale -- `__tests__/safety.spec.js` runs the statements of
 * each entry against sqlite, and against a live PostgreSQL and MySQL when
 * the environment names one. A check is listed for a dialect only when
 * there is a safe path to name on it: an index build blocks writes on
 * postgres and there is `CONCURRENTLY` to point at, while mysql builds one
 * online and sqlite has no concurrent form at all, so neither is told to
 * do something about a problem it does not have.
 */
const CHECKS = [
  {
    check: 'column.drop',
    dialects: ['sqlite', 'postgres', 'mysql'],
    fix: 'Ship the code that stops reading the column first and deploy it, then drop the column in a later migration. The database is not the slow part here: postgres takes the column out of the catalogue without touching the rows and mysql 8 does it instantly, and the window that hurts is the one where the old process is still selecting it.',
    what: 'drops a column the running code may still be reading',
  },
  {
    check: 'column.not-null',
    dialects: ['sqlite', 'postgres', 'mysql'],
    fix: 'Add the column without the constraint, backfill it, then add NOT NULL in a later migration -- or give this one a DEFAULT, which every dialect accepts. Note that the three do not even fail the same way: sqlite and postgres refuse the statement outright once the table has a row, and mysql accepts it and writes an empty string or a zero into every one of them without a warning.',
    what: 'adds a NOT NULL column with no default to a table that may have rows',
  },
  {
    check: 'column.rename',
    dialects: ['sqlite', 'postgres', 'mysql'],
    fix: 'A rename breaks both halves of a deploy: the old code reads a column that is gone and the new code reads one that is not there yet. Add the new column, write to both, backfill, move the readers, then drop the old one. Note also that drizzle-kit does not write a rename on its own -- it sees a column removed and a column added -- so a rename in a migration is one somebody edited in by hand.',
    what: 'renames a column, which breaks the old code and the new code at once',
  },
  {
    check: 'column.type',
    dialects: ['sqlite', 'postgres', 'mysql'],
    fix: 'Add a column of the new type, backfill it, move the readers and drop the old one. Widening in place is the cheap case and worth checking for first: postgres rewrites nothing for varchar(255) to varchar(500) or to text, and mysql does that one online, while an integer growing to a bigint rewrites the table on both.',
    what: 'changes the type of a column, which rewrites the table on most engines',
  },
  {
    check: 'data.unbounded',
    dialects: ['sqlite', 'postgres', 'mysql'],
    fix: 'Give it a WHERE that names the rows you mean. A statement that has to touch every row belongs in a job that walks the table in batches, not in a migration holding a lock while the deploy waits on it.',
    what: 'deletes or updates every row of a table',
  },
  {
    check: 'index.build',
    dialects: ['postgres'],
    fix: 'CREATE INDEX holds a ShareLock on postgres, so every INSERT, UPDATE and DELETE on that table waits for the build. CONCURRENTLY is the answer and it cannot go in this file: drizzle applies the pending migrations inside one transaction and postgres refuses CONCURRENTLY in a transaction block. So build it against the database yourself, outside the migration, and henri db:generate will see it is already there. On a table small enough that the lock does not matter, approve this migration and move on.',
    what: 'builds an index in the migration, which blocks writes to the table while it runs',
  },
  {
    check: 'table.drop',
    dialects: ['sqlite', 'postgres', 'mysql'],
    fix: 'Ship the code that stops using the table first and deploy it, then drop the table in a later migration. Once it is gone the rows are gone with it, so this is also the statement to be surest about: a restore from a backup is the only way back.',
    what: 'drops a table the running code may still be reading',
  },
  {
    check: 'table.recreate',
    dialects: ['sqlite'],
    fix: 'This is what sqlite does instead of ALTER COLUMN, and it copies the table: the cost is the number of rows, and any row the new schema refuses fails the copy with the old table already dropped. Look at what the new table declares that the old one did not -- a tightened NOT NULL or a narrowed type is the half that fails -- and make the rows fit before this runs.',
    what: 'rebuilds a table by copying every row into a new one',
  },
  {
    check: 'table.rename',
    dialects: ['sqlite', 'postgres', 'mysql'],
    fix: 'A rename breaks both halves of a deploy at once. Create the new table, write to both, backfill, move the readers, then drop the old one. drizzle-kit writes a drop and a create rather than a rename, so a rename here is one somebody edited in by hand.',
    what: 'renames a table, which breaks the old code and the new code at once',
  },
];

const CATALOGUE = new Map(CHECKS.map((entry) => [entry.check, entry]));

// The keywords that can never be an identifier where one is expected. Kept
// short on purpose: this only has to stop a clause keyword being read as a
// table name, and a longer list would start refusing legal column names
const RESERVED = new Set([
  'ADD',
  'ALTER',
  'AND',
  'AS',
  'COLUMN',
  'CONSTRAINT',
  'DROP',
  'EXISTS',
  'FROM',
  'IF',
  'INDEX',
  'INTO',
  'KEY',
  'NOT',
  'ON',
  'ONLY',
  'OR',
  'RENAME',
  'REPLACE',
  'SELECT',
  'SET',
  'TABLE',
  'TO',
  'UNIQUE',
  'USING',
  'WHERE',
]);

// A column definition that carries one of these has a value for the rows
// that are already there, whatever else it says
const DEFAULTED = new Set([
  'AUTOINCREMENT',
  'AUTO_INCREMENT',
  'BIGSERIAL',
  'DEFAULT',
  'GENERATED',
  'IDENTITY',
  'SERIAL',
  'SMALLSERIAL',
]);

/** The line drizzle-kit writes between two statements */
const BREAKPOINT = '--> statement-breakpoint';

/**
 * The keyword a token is, or null when it is not a bare word
 *
 * @param {?object} token A token
 * @returns {?string} The word, uppercased, or null
 */
const kw = (token) =>
  token && token.kind === 'word' ? token.value.toUpperCase() : null;

/**
 * Do the tokens from `index` read as these keywords, in order?
 *
 * @param {Array<object>} tokens The tokens of a statement
 * @param {number} index Where to start
 * @param {...string} words The keywords, uppercased
 * @returns {boolean} true when every one of them matches
 */
const reads = (tokens, index, ...words) =>
  words.every((word, offset) => kw(tokens[index + offset]) === word);

/**
 * The identifier at `index`, if there is one there.
 *
 * A quoted name is always an identifier; a bare word is one unless it is a
 * keyword that could only be a clause. A qualified name (`"public"."tasks"`,
 * `db.tasks`) answers its last segment, which is the name the database calls
 * the table.
 *
 * @param {Array<object>} tokens The tokens of a statement
 * @param {number} index Where to look
 * @returns {?{ at: number, name: string }} The name and the index after it
 */
const identifier = (tokens, index) => {
  const token = tokens[index];

  if (!token) {
    return null;
  }

  if (
    token.kind !== 'name' &&
    (token.kind !== 'word' || RESERVED.has(kw(token)))
  ) {
    return null;
  }

  let at = index + 1;
  let name = token.value;

  // A qualified name: keep walking while the next two tokens are `.` and
  // another identifier, and answer the last segment
  while (
    tokens[at] &&
    tokens[at].kind === 'punct' &&
    tokens[at].value === '.' &&
    tokens[at + 1] &&
    (tokens[at + 1].kind === 'name' || tokens[at + 1].kind === 'word')
  ) {
    name = tokens[at + 1].value;
    at += 2;
  }

  return { at, name };
};

/**
 * Walks past `IF EXISTS`, `IF NOT EXISTS`, `ONLY` and `CONCURRENTLY`
 *
 * @param {Array<object>} tokens The tokens of a statement
 * @param {number} index Where to start
 * @returns {number} The index of the first token that is none of those
 */
const skipNoise = (tokens, index) => {
  let at = index;

  for (;;) {
    if (reads(tokens, at, 'IF', 'NOT', 'EXISTS')) {
      at += 3;
    } else if (reads(tokens, at, 'IF', 'EXISTS')) {
      at += 2;
    } else if (kw(tokens[at]) === 'ONLY' || kw(tokens[at]) === 'CONCURRENTLY') {
      at += 1;
    } else {
      return at;
    }
  }
};

/**
 * Splits a run of tokens on the commas that are not inside parentheses
 *
 * `ALTER TABLE t ADD a int, ADD b int` is two actions; the comma inside
 * `UNIQUE(a, b)` is not a separator.
 *
 * @param {Array<object>} tokens The tokens
 * @returns {Array<Array<object>>} The pieces
 */
const pieces = (tokens) => {
  const out = [[]];
  let depth = 0;

  for (const token of tokens) {
    if (
      token.kind === 'punct' &&
      (token.value === '(' || token.value === ')')
    ) {
      depth += token.value === '(' ? 1 : -1;
    }

    if (depth === 0 && token.kind === 'punct' && token.value === ',') {
      out.push([]);
      continue;
    }

    out[out.length - 1].push(token);
  }

  return out.filter((piece) => piece.length > 0);
};

/**
 * Does this run of tokens hold that keyword outside any parentheses?
 *
 * The depth is what keeps the `WHERE` of a subquery from answering for the
 * statement that contains it.
 *
 * @param {Array<object>} tokens The tokens
 * @param {string} word The keyword, uppercased
 * @returns {boolean} true when it is there at depth zero
 */
const holds = (tokens, word) => {
  let depth = 0;

  for (const token of tokens) {
    if (
      token.kind === 'punct' &&
      (token.value === '(' || token.value === ')')
    ) {
      depth += token.value === '(' ? 1 : -1;
    } else if (depth === 0 && kw(token) === word) {
      return true;
    }
  }

  return false;
};

/**
 * Turns SQL into statements of tokens.
 *
 * The scanner walks the text once. Comments produce nothing; a string
 * literal produces one token holding the empty string, so that no caller
 * is able to read what was inside it.
 *
 * @param {string} sql The text of a migration
 * @param {string} [dialect='postgres'] sqlite, postgres or mysql -- which
 *   decides what quotes a string, what quotes a name, and whether a block
 *   comment nests
 * @returns {Array<{ text: string, tokens: Array<object> }>} The statements,
 *   in order, each with the slice of the file it came from
 */
const lex = (sql, dialect = 'postgres') => {
  const source = String(sql);
  const nests = dialect === 'postgres';
  const backslashes = dialect === 'mysql';
  // MySQL quotes a name with a backtick and reads "..." as a string;
  // postgres and sqlite read "..." as a name
  const doubleIsString = dialect === 'mysql';
  const statements = [];
  let tokens = [];
  let start = 0;
  let at = 0;

  /** Closes the statement that ends at `at` */
  const end = () => {
    if (tokens.length > 0) {
      statements.push({ text: source.slice(start, at).trim(), tokens });
    }

    tokens = [];
    start = at + 1;
  };

  /**
   * Reads to the closing quote, honouring the doubling escape
   *
   * @param {string} quote The closing character
   * @param {boolean} escapes Whether a backslash escapes the next character
   * @returns {string} What was between the quotes
   */
  const quoted = (quote, escapes) => {
    let out = '';

    at += 1;

    while (at < source.length) {
      const char = source[at];

      if (escapes && char === '\\' && at + 1 < source.length) {
        out += source[at + 1];
        at += 2;
        continue;
      }

      if (char === quote) {
        // A doubled quote is the quote itself, not the end
        if (source[at + 1] === quote) {
          out += quote;
          at += 2;
          continue;
        }

        at += 1;

        return out;
      }

      out += char;
      at += 1;
    }

    return out;
  };

  while (at < source.length) {
    const char = source[at];

    // --- what is not code ---------------------------------------------
    if (char === '-' && source[at + 1] === '-') {
      // The breakpoint is drizzle-kit's separator, and it is written as a
      // comment: read it before the comment rule eats it
      if (source.startsWith(BREAKPOINT, at)) {
        end();
        at += BREAKPOINT.length;
        start = at;
        continue;
      }

      const line = source.indexOf('\n', at);

      at = line === -1 ? source.length : line + 1;
      continue;
    }

    if (char === '/' && source[at + 1] === '*') {
      let depth = 1;

      at += 2;

      while (at < source.length && depth > 0) {
        if (nests && source[at] === '/' && source[at + 1] === '*') {
          depth += 1;
          at += 2;
        } else if (source[at] === '*' && source[at + 1] === '/') {
          depth -= 1;
          at += 2;
        } else {
          at += 1;
        }
      }

      continue;
    }

    if (/\s/u.test(char)) {
      at += 1;
      continue;
    }

    // --- strings, whose content is thrown away ------------------------
    // postgres writes an escaping literal as E'...' and a long one as
    // $tag$...$tag$; the tag form is what keeps a function body holding a
    // whole statement down to one token
    if (
      !backslashes &&
      (char === 'E' || char === 'e') &&
      source[at + 1] === "'"
    ) {
      at += 1;
      quoted("'", true);
      tokens.push({ at, kind: 'string', value: '' });
      continue;
    }

    if (char === "'") {
      quoted("'", backslashes);
      tokens.push({ at, kind: 'string', value: '' });
      continue;
    }

    if (char === '$' && nests) {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(source.slice(at));

      if (tag) {
        const close = source.indexOf(tag[0], at + tag[0].length);

        at = close === -1 ? source.length : close + tag[0].length;
        tokens.push({ at, kind: 'string', value: '' });
        continue;
      }
    }

    if (char === '"') {
      const value = quoted('"', doubleIsString && backslashes);

      tokens.push({
        at,
        kind: doubleIsString ? 'string' : 'name',
        value: doubleIsString ? '' : value,
      });
      continue;
    }

    // --- quoted names -------------------------------------------------
    if (char === '`') {
      tokens.push({ at, kind: 'name', value: quoted('`', false) });
      continue;
    }

    if (char === '[' && dialect !== 'postgres') {
      const close = source.indexOf(']', at);
      const value = close === -1 ? '' : source.slice(at + 1, close);

      at = close === -1 ? source.length : close + 1;
      tokens.push({ at, kind: 'name', value });
      continue;
    }

    // --- words and numbers --------------------------------------------
    if (/[A-Za-z_-￿]/u.test(char)) {
      const word = /^[A-Za-z0-9_$-￿]+/u.exec(source.slice(at))[0];

      at += word.length;
      tokens.push({ at, kind: 'word', value: word });
      continue;
    }

    if (/[0-9]/u.test(char)) {
      const number = /^[0-9][0-9a-fA-FxX.]*/u.exec(source.slice(at))[0];

      at += number.length;
      tokens.push({ at, kind: 'number', value: number });
      continue;
    }

    // --- punctuation and the separator --------------------------------
    if (char === ';') {
      end();
      at += 1;
      start = at;
      continue;
    }

    tokens.push({ at, kind: 'punct', value: char });
    at += 1;
  }

  end();

  return statements;
};

/**
 * Every action of an `ALTER TABLE`, read one at a time
 *
 * @param {Array<object>} tokens The tokens after the table name
 * @param {string} table The table
 * @param {object} state What the migration has done so far
 * @returns {Array<object>} The raw findings of this statement
 */
const alterations = (tokens, table, state) => {
  const found = [];
  const say = (check, column = null) => found.push({ check, column, table });

  for (const action of pieces(tokens)) {
    const verb = kw(action[0]);

    if (verb === 'DROP') {
      const at = skipNoise(action, kw(action[1]) === 'COLUMN' ? 2 : 1);
      const name = identifier(action, at);

      // `DROP CONSTRAINT`, `DROP INDEX` and the rest take nothing away
      // from a row, so only a column is worth a word
      if (
        kw(action[1]) === 'COLUMN' ||
        (name && !RESERVED.has(kw(action[1])))
      ) {
        say('column.drop', name ? name.name : null);
      }

      continue;
    }

    if (verb === 'RENAME') {
      if (kw(action[1]) === 'TO') {
        const to = identifier(action, 2);

        state.renames.push({ from: table, to: to ? to.name : null });
        say('table.rename');
        continue;
      }

      const at = kw(action[1]) === 'COLUMN' ? 2 : 1;
      const name = identifier(action, at);

      say('column.rename', name ? name.name : null);
      continue;
    }

    if (verb === 'ADD') {
      const at = skipNoise(action, kw(action[1]) === 'COLUMN' ? 2 : 1);
      const head = kw(action[at]);

      // A constraint, an index or a key is an index build, not a column
      if (
        head === 'CONSTRAINT' ||
        head === 'UNIQUE' ||
        head === 'INDEX' ||
        head === 'KEY' ||
        head === 'PRIMARY'
      ) {
        if (holds(action, 'UNIQUE') || head === 'INDEX' || head === 'KEY') {
          say('index.build');
        }

        continue;
      }

      const name = identifier(action, at);

      if (!name) {
        continue;
      }

      const rest = action.slice(name.at);

      if (
        holds(rest, 'NOT') &&
        reads(
          rest,
          rest.findIndex((token) => kw(token) === 'NOT'),
          'NOT',
          'NULL'
        ) &&
        !rest.some((token) => DEFAULTED.has(kw(token)))
      ) {
        say('column.not-null', name.name);
      }

      continue;
    }

    // Postgres: ALTER COLUMN c SET DATA TYPE t / TYPE t / SET NOT NULL
    if (verb === 'ALTER') {
      const at = kw(action[1]) === 'COLUMN' ? 2 : 1;
      const name = identifier(action, at);
      const rest = name ? action.slice(name.at) : [];

      if (reads(rest, 0, 'SET', 'DATA', 'TYPE') || reads(rest, 0, 'TYPE')) {
        say('column.type', name.name);
      } else if (reads(rest, 0, 'SET', 'NOT', 'NULL')) {
        say('column.not-null', name.name);
      }

      continue;
    }

    // MySQL: MODIFY [COLUMN] c <type> ... and CHANGE [COLUMN] old new <type>
    if (verb === 'MODIFY' || verb === 'CHANGE') {
      const at = kw(action[1]) === 'COLUMN' ? 2 : 1;
      const name = identifier(action, at);

      if (!name) {
        continue;
      }

      if (verb === 'CHANGE') {
        const to = identifier(action, name.at);

        // A CHANGE that gives the column the name it already had is a type
        // change and nothing more
        if (to && to.name !== name.name) {
          say('column.rename', name.name);
        }
      }

      say('column.type', name.name);
      continue;
    }
  }

  return found;
};

/**
 * Reads one statement
 *
 * @param {Array<object>} tokens Its tokens
 * @param {object} state What the migration has done so far
 * @returns {Array<object>} The raw findings
 */
const statement = (tokens, state) => {
  const verb = kw(tokens[0]);

  if (verb === 'CREATE') {
    let at = 1;

    // CREATE [OR REPLACE] [UNIQUE] [TEMP|TEMPORARY] TABLE|INDEX ...
    while (
      ['OR', 'REPLACE', 'UNIQUE', 'TEMP', 'TEMPORARY'].includes(kw(tokens[at]))
    ) {
      at += 1;
    }

    if (kw(tokens[at]) === 'TABLE') {
      const name = identifier(tokens, skipNoise(tokens, at + 1));

      if (name) {
        state.created.add(name.name);
      }

      return [];
    }

    if (kw(tokens[at]) === 'INDEX') {
      const after = skipNoise(tokens, at + 1);
      const name = identifier(tokens, after);
      const on = name ? name.at : after;

      if (kw(tokens[on]) !== 'ON') {
        return [];
      }

      const table = identifier(tokens, skipNoise(tokens, on + 1));

      // CONCURRENTLY is the safe form and skipNoise walked past it, so
      // look for it where it can be: between INDEX and the name
      const concurrent = tokens
        .slice(at, on)
        .some((token) => kw(token) === 'CONCURRENTLY');

      return concurrent
        ? []
        : [
            {
              check: 'index.build',
              column: null,
              table: table ? table.name : null,
            },
          ];
    }

    return [];
  }

  if (verb === 'DROP' && kw(tokens[1]) === 'TABLE') {
    const name = identifier(tokens, skipNoise(tokens, 2));

    return name
      ? [{ check: 'table.drop', column: null, table: name.name }]
      : [];
  }

  if (verb === 'ALTER' && kw(tokens[1]) === 'TABLE') {
    const at = skipNoise(tokens, 2);
    const name = identifier(tokens, at);

    return name ? alterations(tokens.slice(name.at), name.name, state) : [];
  }

  if (verb === 'DELETE' && kw(tokens[1]) === 'FROM') {
    const name = identifier(tokens, 2);

    return holds(tokens, 'WHERE')
      ? []
      : [
          {
            check: 'data.unbounded',
            column: null,
            table: name ? name.name : null,
          },
        ];
  }

  if (verb === 'UPDATE') {
    const name = identifier(tokens, 1);

    // An UPDATE with no SET is not one henri can read; leave it alone
    if (!name || !holds(tokens, 'SET') || holds(tokens, 'WHERE')) {
      return [];
    }

    return [{ check: 'data.unbounded', column: null, table: name.name }];
  }

  return [];
};

/**
 * Collapses sqlite's table rebuild into the one thing it is.
 *
 * A table created by this migration and later renamed onto a table this
 * migration dropped is not a drop and a rename: it is sqlite's answer to
 * `ALTER COLUMN`, and the rows were copied across in between.
 *
 * @param {Array<object>} found The raw findings, in order
 * @param {object} state What the migration did
 * @returns {Array<object>} The findings with each rebuild folded into one
 */
const collapse = (found, state) => {
  const rebuilt = new Set();

  for (const { from, to } of state.renames) {
    if (state.created.has(from) && state.dropped.has(to)) {
      rebuilt.add(to);
    }
  }

  if (rebuilt.size === 0) {
    return found;
  }

  // Only the drop needs taking out here. The other half -- the rename of
  // the scaffold table over it -- is a rename of a table this migration
  // created, which review() already leaves alone for having no rows
  const out = found.filter(
    (entry) => !(entry.check === 'table.drop' && rebuilt.has(entry.table))
  );

  for (const table of [...rebuilt].sort()) {
    out.push({ check: 'table.recreate', column: null, table });
  }

  return out;
};

/**
 * Reads a migration and says what in it would hurt a database with rows.
 *
 * @param {string} sql The text of the migration
 * @param {object} [options={}] `dialect` (sqlite, postgres or mysql, which
 *   decides both how the SQL is read and which checks apply)
 * @returns {Array<{ check: string, column: ?string, fix: string, table: ?string, what: string }>}
 *   The findings, sorted, empty when there is nothing to say
 */
const review = (sql, { dialect = 'postgres' } = {}) => {
  const state = { created: new Set(), dropped: new Set(), renames: [] };
  const raw = [];

  for (const { tokens } of lex(sql, dialect)) {
    const found = statement(tokens, state);

    for (const entry of found) {
      if (entry.check === 'table.drop' && entry.table) {
        state.dropped.add(entry.table);
      }
    }

    raw.push(...found);
  }

  const found = collapse(raw, state).filter((entry) => {
    const known = CATALOGUE.get(entry.check);

    return (
      known &&
      known.dialects.includes(dialect) &&
      // A table this migration created has no rows in it
      !(entry.table && state.created.has(entry.table))
    );
  });

  // One line per thing, however many statements said it
  const seen = new Map();

  for (const entry of found) {
    const key = `${entry.check} ${entry.table || ''} ${entry.column || ''}`;
    const known = CATALOGUE.get(entry.check);

    seen.set(key, { ...entry, fix: known.fix, what: known.what });
  }

  return [...seen.values()].sort(
    (one, two) =>
      one.check.localeCompare(two.check) ||
      String(one.table).localeCompare(String(two.table)) ||
      String(one.column).localeCompare(String(two.column))
  );
};

/**
 * The token of a migration: what `config.migrations.approved` holds.
 *
 * It names the migration and what was found in it, not the file: adding a
 * comment or a safe statement leaves the token alone, and a tenth dangerous
 * statement edited in afterwards makes a new one, which is pending again.
 * That is the same bargain `config.retention.approved` strikes, and the
 * digest is plain rather than keyed for the same reason: a token is
 * committed to the configuration of every environment, and `config.secret`
 * does not travel with it.
 *
 * @param {string} tag The migration tag (`0002_add_priority`)
 * @param {Array<object>} found What `review()` answered
 * @returns {string} The token (`0002_add_priority:9f3c1a2b4d5e`)
 */
const tokenOf = (tag, found) => {
  const terms = found
    .map((entry) => `${entry.check}:${entry.table || ''}:${entry.column || ''}`)
    .sort()
    .join('|');

  return `${tag}:${createHash('sha256').update(terms).digest('hex').slice(0, 12)}`;
};

/**
 * One line per finding, for a log or a terminal
 *
 * @param {object} entry A finding
 * @returns {string} `column.drop tasks.done -- drops a column ...`
 */
const describe = (entry) =>
  `${entry.check} ${entry.table || '?'}${entry.column ? `.${entry.column}` : ''}: ${entry.what}`;

/**
 * The error a production migrate refuses with.
 *
 * `problems` is the seam the command line already prints one line and one
 * instruction at a time, so the refusal names every finding and its safe
 * path rather than only the count.
 *
 * @param {string} tag The migration tag
 * @param {Array<object>} found What `review()` answered
 * @param {string} token Its token
 * @returns {Error} HENRI_MIGRATION_UNREVIEWED
 */
const unreviewed = (tag, found, token) =>
  Object.assign(
    coded(
      'HENRI_MIGRATION_UNREVIEWED',
      `drizzle: ${tag} would change a database that has rows in it, and nobody has said they read it`,
      `Read what it does with "henri db:status", then put "${token}" in migrations.approved. The token names this migration and what was found in it, so it stays right when the file is only reformatted and goes stale when another one of these is edited in`
    ),
    {
      found,
      problems: found.map((entry) => ({
        hint: entry.fix,
        message: describe(entry),
      })),
      tag,
      token,
    }
  );

module.exports = {
  CHECKS,
  describe,
  lex,
  review,
  tokenOf,
  unreviewed,
};
