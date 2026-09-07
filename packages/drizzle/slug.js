/**
 * The third identifier, and the only one a person reads.
 *
 * `/articles/how-we-ship` rather than
 * `/articles/01a07d06-e6c4-73cd-9021-31eb06befdd7`. A model asks for one in
 * its options:
 *
 * ```js
 * module.exports = {
 *   schema: { body: { type: 'text' }, title: { type: 'string' } },
 *   options: { slug: 'title' },
 * };
 * ```
 *
 * and henri adds a `slug` column -- unique, indexed, not null -- fills it
 * on insert, resolves it in `findById()` and prints it in every url that
 * names the record.
 *
 * ## Where a slug is allowed to appear, and where it is not
 *
 * henri has two identifiers and exactly one of them is public
 * (`base/references.js`): `externalId`, a uuid v7, leaves the server; the
 * primary key never does. A slug is a **third**, and almost everything
 * below is about not spending the guarantee that buys.
 *
 * The rule is two lines long:
 *
 * - a slug appears in the record's own `slug` field, and in the **url** of
 *   that record (`_links`, the route helpers, the `Location` of a 201);
 * - it appears **nowhere else**. A foreign key is still published as the
 *   `externalId` of the row it names, never as that row's slug. The
 *   versions table, the access trail, the flags actor, the erasure receipt
 *   and the webhook payloads all keep reading `externalId` and none of them
 *   learned a second spelling.
 *
 * So the uuid is what an API client stores and what henri writes down; the
 * slug is what a person reads and types. A record answers to both and they
 * are both public: this is a second **name**, not a second identity.
 *
 * ## Why a lookup cannot be talked into a primary key
 *
 * `Model.findById()` is the door for what arrived from outside, and it
 * grew a branch:
 *
 * 1. a uuid resolves the `externalId`, exactly as before;
 * 2. anything else resolves the **slug column**, on a model that has one;
 * 3. and that is the end of it -- `null`, the same `null` an unknown uuid
 *    answers.
 *
 * Step 2 is a `WHERE slug = ?`, not a fallthrough, which is the whole
 * safety argument. `findById('4812')` asks the slug column for `'4812'`; it
 * does not ask the primary key anything, so it cannot say whether row 4812
 * exists. If some record's slug really is `4812`, that record comes back --
 * and that is a public fact about a public name, not the number. The
 * primary key keeps its own door, `findByKey()`, and nothing here reaches
 * for it.
 *
 * The one collision that would matter is a slug **shaped like a uuid**: it
 * would take branch 1 and quietly name nothing. `problemOf()` refuses one,
 * so the two identifier spaces never overlap.
 *
 * ## Uniqueness: what holds, and what henri will not pretend
 *
 * Two articles called "Getting started" is the normal case. henri does not
 * claim `unique` as a validation -- a `SELECT` before an `INSERT` answers a
 * question about a moment that has passed (`base/validations.js`) -- and it
 * does not make an exception for itself here. So there is no lookup before
 * the write, no counter, and no `-2`:
 *
 * - **`suffix: true`, the default.** The slug is the slugified source plus
 *   a discriminator taken from the record's own `externalId`:
 *   `getting-started-k3f9pq`. Unique because the uuid is, stable because
 *   the uuid never changes, and free because nothing is read. The cost,
 *   said out loud: every url carries six extra characters even when nothing
 *   would have collided.
 * - **`suffix: false`.** The slug is exactly the slugified source:
 *   `getting-started`. The **unique index is what holds**, so the second
 *   "Getting started" is refused by the database, and
 *   `henri.model.errors()` turns that into `{ slug: 'must be unique' }` --
 *   the same sentence any other unique column gives. The cost is that
 *   refusal, and it lands on a title the author had every reason to think
 *   was fine.
 *
 * Neither is scoped: a slug is unique across the table, not per tenant or
 * per parent. A scope is a composite index henri would have to write into
 * a migration it does not own, and it is not here.
 *
 * ## What happens when the title changes
 *
 * By default, nothing. `on: 'create'` is the default and it is the honest
 * one: a slug is generated once and never moves, so the url minted the day
 * the record was written keeps working forever, whatever the title becomes.
 * An identifier that follows a display string is an identifier that stops
 * being one.
 *
 * `on: 'change'` regenerates whenever the source field is written, and the
 * old url **stops working that instant**. There is no history table in
 * henri: friendly_id keeps every retired slug in one and answers a 301 from
 * it, and that is a table on four adapters, a redirect, a retention rule
 * and a reach for the erasure -- a tranche of its own. Until it exists,
 * `on: 'change'` means the old url 404s, and the guide says so in those
 * words.
 *
 * A mass update that names the source field on such a model is **refused**
 * (`HENRI_MODEL_SLUG_MASS_WRITE`): the hook runs once, without records, so
 * either every row would get the same slug or none would get a new one, and
 * both are worse than the refusal. It is the answer
 * `HENRI_MODEL_VALIDATION_MASS_WRITE` and `HENRI_VERSION_MASS_WRITE`
 * already give to the same shape of problem, and it names the loop.
 *
 * ## A title that is not in English
 *
 * `slugify()` lowercases, decomposes (NFKD) and keeps `a-z0-9`. That makes
 * `Café Crème` into `cafe-creme` without a transliteration table, because
 * Unicode already knows that `é` is `e` with a mark on it and
 * `String#normalize` ships in Node.
 *
 * What Unicode does **not** decompose is a short list of Latin letters that
 * are letters in their own right -- `ß`, `ø`, `ł`, `æ`, `þ` -- and `FOLDED`
 * is a line each for them, eleven in total. That is the whole table and it
 * is deliberately not the first entry of one per script: a Japanese,
 * Arabic, Hebrew, Greek or Cyrillic title has no ASCII to fold to, and
 * shipping the tables that would invent some is how a framework ends up
 * choosing romanizations on a reader's behalf.
 *
 * So a title in one of those scripts **slugifies to nothing**, and that
 * needed a real answer rather than a shrug. It has two:
 *
 * - With `suffix: true` the record still gets a slug -- the discriminator
 *   alone, `k3f9pq` -- so the write never fails and the url always works.
 *   With `suffix: false` there is nothing to fall back to and the write is
 *   refused (`HENRI_MODEL_SLUG_EMPTY`), naming the field and the title.
 * - **A slug the application writes itself always wins and may be any
 *   Unicode henri can carry in a path segment.** `slug: 'こんにちは'` is
 *   accepted, stored, matched by the route and carried percent-encoded on
 *   the wire, which every browser renders back as the characters. So the
 *   choice between transliteration and percent-encoding is not made here:
 *   henri's generator folds to ASCII and ships no romanization, and an
 *   application that wants its own script in the url writes the slug and
 *   gets it, byte for byte.
 *
 * `problemOf()` is what a supplied slug is measured against, and it is a
 * list of the structural characters rather than a definition of a letter:
 * nothing below `!`, none of `"#%/:?@[\]^`{|}<>`, not `.` or `..`, not a
 * uuid, not a reserved word, not longer than the column. A deny list is the
 * right shape here precisely because henri is not the one deciding what
 * counts as a word.
 *
 * ## Reserved words
 *
 * `resources articles` mounts `GET /articles/new` before `GET /articles/:id`
 * (`base/routes.js`), so a record slugged `new` is a record with no show
 * page. henri reserves that one word by default and `reserved` adds more --
 * which is the honest bound, because a `collection` route an application
 * declared is a segment henri cannot know when the slug is generated. The
 * guide says to add it.
 *
 * ## No regular expression touches a title
 *
 * A title arrives through `req.permit()`, and a slugifier is exactly the
 * shape that turns into a quadratic match. Everything here walks: one pass
 * over the code points with a `Set` and a `Map`, no `RegExp` anywhere in
 * the file, and the length bound applied while walking rather than after.
 *
 * ## A copy per adapter
 *
 * This file is held four times -- here and in `@usehenri/drizzle`,
 * `@usehenri/mongoose` and `@usehenri/sequelize` -- byte for byte, the way
 * `exact.js`, `external-id.js` and `validations.js` are, because an adapter
 * depends on no part of core at runtime.
 * `src/__tests__/slug.spec.js` is what keeps them the same file. It
 * requires nothing at all, and raises its codes through a `coded()` of its
 * own for the same reason.
 */

/** The field a slug lives in, and the column it becomes */
const SLUG = 'slug';

/** The failure a `slug` declaration henri cannot carry out gets */
const DECLARATION = 'HENRI_MODEL_SLUG_DECLARATION_INVALID';

/** The failure a source that slugifies to nothing gets */
const EMPTY = 'HENRI_MODEL_SLUG_EMPTY';

/** The failure a mass write that would regenerate many slugs gets */
const MASS_WRITE = 'HENRI_MODEL_SLUG_MASS_WRITE';

/** How long the slugified source may be, before the discriminator */
const MAX_LENGTH = 80;

/** How many characters the discriminator adds, plus its separator */
const SUFFIX_LENGTH = 6;

/** The keys a `slug` declaration may hold */
const KEYS = ['from', 'maxLength', 'on', 'reserved', 'suffix'];

/** What `on` takes: generate once, or follow the source */
const EVENTS = ['create', 'change'];

/**
 * The characters a slug may never carry, whoever wrote it.
 *
 * Not "everything but a letter": henri is not the one deciding what counts
 * as a letter in a script it does not read. These are the ones that end a
 * path segment, start a query, escape an encoding or name a directory.
 */
const REFUSED = new Set([
  '"',
  '#',
  '%',
  '/',
  ':',
  '<',
  '>',
  '?',
  '@',
  '[',
  '\\',
  ']',
  '^',
  '`',
  '{',
  '|',
  '}',
]);

/** The path segments a slug would shadow */
const RESERVED = ['.', '..', 'new'];

/**
 * The Latin letters Unicode does not decompose, which is why each needs a
 * line. This is the whole table and it is deliberately not one per script:
 * see the header.
 */
const FOLDED = new Map([
  ['æ', 'ae'],
  ['đ', 'd'],
  ['ð', 'd'],
  ['ħ', 'h'],
  ['ı', 'i'],
  ['ł', 'l'],
  ['ø', 'o'],
  ['œ', 'oe'],
  ['ß', 'ss'],
  ['þ', 'th'],
  ['ŧ', 't'],
]);

/**
 * The alphabet of the discriminator: base 32 without the characters a
 * person mistakes for another when reading a url out loud (`0`/`o`,
 * `1`/`l`/`i`).
 */
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

/** The separator between words, and before the discriminator */
const DASH = '-';

/**
 * An error carrying a henri code, without depending on core
 *
 * @param {string} code the henri error code
 * @param {string} message what is wrong
 * @returns {Error} the error to throw
 */
const coded = (code, message) => Object.assign(new Error(message), { code });

/**
 * Is the value a plain object?
 *
 * @param {*} value any value
 * @returns {boolean} true for a plain object
 */
const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

/**
 * Is this string a uuid, and therefore an `externalId` rather than a name?
 *
 * The shape is checked by walking it: eight hex, a dash, four, a dash,
 * four, a dash, four, a dash, twelve. The same answer
 * `base/external-id.js` gives, without the pattern, because this one is
 * asked about a value that came from a request.
 *
 * @param {string} value the candidate
 * @returns {boolean} true when it is shaped like a uuid
 */
const looksLikeUuid = (value) => {
  const groups = [8, 4, 4, 4, 12];
  let at = 0;

  for (let group = 0; group < groups.length; group += 1) {
    if (group > 0) {
      if (value[at] !== DASH) {
        return false;
      }

      at += 1;
    }

    for (let taken = 0; taken < groups[group]; taken += 1) {
      const code = value.charCodeAt(at);

      // 0-9, a-f, A-F
      if (
        !(code >= 48 && code <= 57) &&
        !(code >= 97 && code <= 102) &&
        !(code >= 65 && code <= 70)
      ) {
        return false;
      }

      at += 1;
    }
  }

  return at === value.length;
};

/**
 * Is this code point a combining mark NFKD left behind?
 *
 * The three blocks a decomposed Latin, Greek or Cyrillic letter puts its
 * accent in. They are dropped rather than turned into a separator, so
 * `é` is `e` and not `e-`.
 *
 * @param {number} code the code point
 * @returns {boolean} true for a combining mark
 */
const isMark = (code) =>
  (code >= 0x0300 && code <= 0x036f) ||
  (code >= 0x1ab0 && code <= 0x1aff) ||
  (code >= 0x20d0 && code <= 0x20f0);

/**
 * The slug of a value: lowercase, decomposed, `a-z0-9` joined by dashes.
 *
 * One walk over the code points, no pattern, and the bound applied as it
 * goes rather than by cutting at the end -- so a title of any length costs
 * what the bound costs and not what the title costs.
 *
 * @param {*} value what the source field holds
 * @param {number} [maxLength=MAX_LENGTH] how long the answer may be
 * @returns {string} the slug, possibly empty
 */
const slugify = (value, maxLength = MAX_LENGTH) => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return '';
  }

  const source = String(value).toLowerCase().normalize('NFKD');
  const out = [];
  let pending = false;

  for (const character of source) {
    if (out.length >= maxLength) {
      break;
    }

    const code = character.codePointAt(0);

    if (isMark(code)) {
      continue;
    }

    // The ranges `a-z` and `0-9`, the only two that come out of this file
    if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) {
      if (pending && out.length > 0) {
        out.push(DASH);
      }

      pending = false;

      if (out.length < maxLength) {
        out.push(character);
      }

      continue;
    }

    const folded = FOLDED.get(character);

    if (folded) {
      if (pending && out.length > 0) {
        out.push(DASH);
      }

      pending = false;

      for (const letter of folded) {
        if (out.length < maxLength) {
          out.push(letter);
        }
      }

      continue;
    }

    // Anything else -- a space, a comma, an emoji, a kanji -- ends the run
    // rather than being carried, and a run of them is one dash
    pending = true;
  }

  return out.join('');
};

/**
 * Six characters of the record's own public identifier, so the
 * discriminator is unique because the uuid is and stable because the uuid
 * never changes.
 *
 * A model that opted out of `externalId` has no such seed, and neither
 * does a mass insert on an ORM that fills the column after the hook; both
 * fall back to `Math.random()`, which is enough because a discriminator is
 * not a secret -- a slug is a public name, nothing is protected by knowing
 * one, and a duplicate is caught by the unique index the column carries.
 *
 * @param {*} seed the record's `externalId`, when there is one
 * @returns {string} six characters of the alphabet
 */
const discriminate = (seed) => {
  const out = [];

  if (typeof seed === 'string' && seed.length >= SUFFIX_LENGTH * 2) {
    // The tail of a uuid v7 is its random half; the head is the clock, and
    // every record written in the same millisecond shares it
    const tail = seed
      .slice(-SUFFIX_LENGTH * 2)
      .split(DASH)
      .join('');

    for (
      let at = 0;
      at + 1 < tail.length && out.length < SUFFIX_LENGTH;
      at += 2
    ) {
      const pair = parseInt(tail.slice(at, at + 2), 16);

      if (Number.isNaN(pair)) {
        break;
      }

      out.push(ALPHABET[pair % ALPHABET.length]);
    }
  }

  while (out.length < SUFFIX_LENGTH) {
    out.push(ALPHABET[Math.floor(Math.random() * ALPHABET.length)]);
  }

  return out.join('');
};

/**
 * Refuses a declaration, naming the model
 *
 * @param {string} model the model's global id
 * @param {string} what what is wrong with it
 * @returns {void} never returns
 * @throws {Error} always, HENRI_MODEL_SLUG_DECLARATION_INVALID
 */
const refuse = (model, what) => {
  throw coded(DECLARATION, `${model} declares \`options.slug\` with ${what}`);
};

/**
 * The `slug` declaration of a model file, compiled, or null when it wants
 * no slug.
 *
 * `slug: 'title'` is the shorthand every application writes; the object
 * form takes `from`, `on`, `suffix`, `reserved` and `maxLength`.
 *
 * @param {object} model the model file (`schema`, `options`, `globalId`)
 * @returns {?object} `{ from, maxLength, on, reserved, suffix }` or null
 * @throws {Error} HENRI_MODEL_SLUG_DECLARATION_INVALID on anything unusable
 */
const slugOf = (model) => {
  const options = (model && model.options) || {};
  const written = options.slug;
  const name = (model && (model.globalId || model.identity)) || 'model';

  if (typeof written === 'undefined' || written === null || written === false) {
    return null;
  }

  if (typeof written !== 'string' && !isPlainObject(written)) {
    refuse(
      name,
      `${typeof written}: it is the name of the field to build the slug from, or an object of ${KEYS.join(', ')}`
    );
  }

  const declared =
    typeof written === 'string' ? { from: written } : { ...written };

  for (const key of Object.keys(declared)) {
    if (!KEYS.includes(key)) {
      refuse(name, `the unknown key "${key}": it takes ${KEYS.join(', ')}`);
    }
  }

  const schema = (model && model.schema) || {};
  const { from } = declared;

  if (typeof from !== 'string' || from === '') {
    refuse(name, 'no "from": a slug is built from a field of the model');
  }

  if (from === SLUG) {
    refuse(name, 'a "from" of "slug": the slug cannot be built from itself');
  }

  if (!Object.prototype.hasOwnProperty.call(schema, from)) {
    refuse(name, `a "from" of "${from}", which the schema does not declare`);
  }

  if (Object.prototype.hasOwnProperty.call(schema, SLUG)) {
    refuse(
      name,
      'a "slug" field of its own in the schema: henri adds the column, so declaring it twice would mean two different things'
    );
  }

  const definition = schema[from];
  const type = isPlainObject(definition) ? definition.type : definition;

  if (type !== 'string' && type !== 'text' && type !== String) {
    refuse(
      name,
      `a "from" of "${from}", which is not a string or a text: a slug is built from words`
    );
  }

  if (isPlainObject(definition) && definition.encrypted) {
    refuse(
      name,
      `a "from" of "${from}", which is encrypted: a slug is public and the column it came from is not`
    );
  }

  const marked = isPlainObject(definition) ? definition.personal : null;

  if (isPlainObject(marked) && marked.expose === false) {
    refuse(
      name,
      `a "from" of "${from}", which is marked \`personal: { expose: false }\`: that field is dropped from every answer henri builds, and a slug is in every url of the record`
    );
  }

  const compiled = {
    from,
    maxLength: MAX_LENGTH,
    on: 'create',
    reserved: new Set(RESERVED),
    suffix: true,
  };

  if ('on' in declared) {
    if (!EVENTS.includes(declared.on)) {
      refuse(name, `an "on" of "${declared.on}": it is ${EVENTS.join(' or ')}`);
    }

    compiled.on = declared.on;
  }

  if ('suffix' in declared) {
    if (typeof declared.suffix !== 'boolean') {
      refuse(name, 'a "suffix" that is not true or false');
    }

    compiled.suffix = declared.suffix;
  }

  if ('maxLength' in declared) {
    if (
      typeof declared.maxLength !== 'number' ||
      !Number.isInteger(declared.maxLength) ||
      declared.maxLength < 1
    ) {
      refuse(name, 'a "maxLength" that is not a whole number of characters');
    }

    compiled.maxLength = declared.maxLength;
  }

  if ('reserved' in declared) {
    if (
      !Array.isArray(declared.reserved) ||
      declared.reserved.some((word) => typeof word !== 'string')
    ) {
      refuse(name, 'a "reserved" that is not a list of words');
    }

    for (const word of declared.reserved) {
      compiled.reserved.add(word.toLowerCase());
    }
  }

  return compiled;
};

/**
 * How long the column has to be: the slugified source, the separator and
 * the discriminator
 *
 * @param {object} declaration the compiled declaration
 * @returns {number} the column length
 */
const lengthOf = (declaration) =>
  declaration.maxLength + (declaration.suffix ? SUFFIX_LENGTH + 1 : 0);

/**
 * Everything wrong with a slug an application wrote itself.
 *
 * A deny list rather than a definition of a word: any script may name a
 * record, and what may not is what would stop being one path segment.
 *
 * @param {*} value the slug
 * @param {object} declaration the compiled declaration
 * @returns {?string} the message, or null when it can be a url segment
 */
const problemOf = (value, declaration) => {
  if (typeof value !== 'string') {
    return 'must be a string';
  }

  if (value === '') {
    return 'is required';
  }

  if ([...value].length > lengthOf(declaration)) {
    return `must be at most ${lengthOf(declaration)} characters`;
  }

  for (const character of value) {
    const code = character.codePointAt(0);

    if (code < 0x21 || code === 0x7f) {
      return 'must not hold a space or a control character';
    }

    if (REFUSED.has(character)) {
      return `must not hold "${character}"`;
    }
  }

  if (looksLikeUuid(value)) {
    return 'must not be shaped like a public identifier';
  }

  if (declaration.reserved.has(value.toLowerCase())) {
    return `must not be "${value}", which is a path henri already mounts`;
  }

  return null;
};

/**
 * The slug of a record about to be written.
 *
 * @param {object} declaration the compiled declaration
 * @param {*} source what the source field holds
 * @param {*} seed the record's `externalId`, for the discriminator
 * @returns {string} the slug, or an empty string when there is nothing to
 *   build one from and no discriminator to fall back to
 */
const slugFor = (declaration, source, seed) => {
  const base = slugify(source, declaration.maxLength);

  if (!declaration.suffix) {
    return base;
  }

  const suffix = discriminate(seed);

  return base === '' ? suffix : `${base}${DASH}${suffix}`;
};

/**
 * Does this write name the field the slug is built from?
 *
 * @param {object} declaration the compiled declaration
 * @param {*} attrs the attributes being written
 * @returns {boolean} true when the source field is one of them
 */
const writesSource = (declaration, attrs) =>
  Boolean(declaration) &&
  isPlainObject(attrs) &&
  Object.prototype.hasOwnProperty.call(attrs, declaration.from);

/**
 * The refusal a source that slugified to nothing gets
 *
 * @param {string} model the model's global id
 * @param {object} declaration the compiled declaration
 * @param {*} source what the source field held
 * @returns {Error} the error to throw
 */
const emptySlug = (model, declaration, source) =>
  coded(
    EMPTY,
    `${model}.${declaration.from} is ${
      typeof source === 'string' && source !== ''
        ? `"${source}", which has no letters or digits henri can fold to ASCII`
        : 'empty'
    }, and the model declares \`slug: { suffix: false }\`, so there is nothing to build a slug from. ` +
      'Write the slug yourself, or let henri add its discriminator (`suffix: true`, the default), which always answers something.'
  );

/**
 * The refusal a mass write that would regenerate many slugs gets
 *
 * @param {string} model the model's global id
 * @param {object} declaration the compiled declaration
 * @param {string} what the call that was made (`update`, `updateMany`)
 * @param {string} instead the single-record call to loop over
 * @returns {Error} the error to throw
 */
const massWrite = (model, declaration, what, instead) =>
  coded(
    MASS_WRITE,
    `${model}.${what}() writes many rows at once and names ${declaration.from}, which ${model} regenerates its slug from (\`slug: { on: 'change' }\`). ` +
      'One hook runs for the whole write, with no records in it, so every row would get one slug or none would get a new one. henri refuses rather than doing either. ' +
      `Loop instead: for (const record of await ${model}.find(where)) await record.${instead}`
  );

module.exports = {
  ALPHABET,
  DECLARATION,
  EMPTY,
  EVENTS,
  KEYS,
  MASS_WRITE,
  MAX_LENGTH,
  RESERVED,
  SLUG,
  SUFFIX_LENGTH,
  coded,
  discriminate,
  emptySlug,
  lengthOf,
  looksLikeUuid,
  massWrite,
  problemOf,
  slugFor,
  slugOf,
  slugify,
  writesSource,
};
