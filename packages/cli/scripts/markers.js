const crypto = require('crypto');

/**
 * A generated region inside a file somebody else also writes in.
 *
 * `AGENTS.md` solved this once and `henri skills` needs exactly the same
 * thing, so the mechanism lives here and both call it rather than each
 * carrying a copy that drifts. What it is: everything henri writes sits
 * between two markers, nothing else in the file is ever read let alone
 * rewritten, and the opening marker carries two digests -- one of the
 * application the region was written from (which is how `henri doctor`
 * tells a stale file from a current one) and one of the region itself
 * (which is how the generator tells its own text from a hand edit inside
 * it). A file with no markers at all is somebody's own file and is left
 * alone. Both refusals are the ordinary generator `skipped`, and `--force`
 * is the only way past them, which makes the failure mode "your text is
 * kept" rather than "your text was kept unless".
 *
 * The `prefix` is the one thing `AGENTS.md` did not need. A `SKILL.md` has
 * to open with its YAML frontmatter on the very first line or Claude Code
 * reads the whole file as body, so the region cannot start there: the
 * frontmatter is written once, above the opening marker, and from then on
 * it is *outside* the region and survives regeneration untouched. That is
 * the right way round -- the `description` is what decides when a skill
 * loads, so it is the line a team is most likely to retune, and henri must
 * not take it back.
 */

/**
 * A short digest of a string. Twelve hex characters: this tells a hand edit
 * from henri's own text, which is not a place an attacker sits.
 *
 * @param {string} value The text
 * @returns {string} The digest
 */
const digest = (value) =>
  crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);

/**
 * The marker machinery for one kind of generated region.
 *
 * @param {object} options The region
 * @param {string} options.footer What a freshly written file says below it
 * @param {number} options.format The format of the region, carried in the marker
 * @param {string} options.kind The name in the marker (`agents`, `skills`)
 * @param {string} options.notice The comment written inside the region
 * @param {string} options.subject What a file with no region is called
 * @returns {object} `open`, `read`, `markerOf`, `region` and `merge`
 */
const markers = ({ footer, format, kind, notice, subject }) => {
  const OPEN = `<!-- henri:${kind}`;
  const CLOSE = `<!-- /henri:${kind} -->`;
  const LINE = new RegExp(
    `^<!-- henri:${kind} (\\d+) app=([0-9a-f]+) gen=([0-9a-f]+) -->`,
    'u'
  );

  /**
   * The marker line that opens a region, carrying the format, a digest of
   * the facts and a digest of the body
   *
   * @param {object} facts What describe() read
   * @param {string} body The region
   * @returns {string} The line
   */
  const open = (facts, body) =>
    `${OPEN} ${format} app=${digest(JSON.stringify(facts))} gen=${digest(
      body
    )} -->`;

  /**
   * Read a marker line back
   *
   * @param {string} line The line
   * @returns {?{app: string, format: number, gen: string}} What it says
   */
  const read = (line) => {
    const match = LINE.exec(line);

    return match
      ? { app: match[2], format: Number(match[1]), gen: match[3] }
      : null;
  };

  /**
   * What the generated region of a file claims the application was, for
   * `henri doctor` to compare with what it is now
   *
   * @param {string} source The file content
   * @returns {?{app: string, format: number, gen: string}} The claim, or null
   */
  const markerOf = (source) => {
    const start = source.indexOf(OPEN);

    if (start === -1) {
      return null;
    }

    const lineEnd = source.indexOf('\n', start);

    return read(source.slice(start, lineEnd === -1 ? undefined : lineEnd));
  };

  /**
   * The whole generated region, markers included
   *
   * @param {object} facts What describe() read
   * @param {string} rendered The markdown of the region
   * @returns {string} The region
   */
  const region = (facts, rendered) => {
    const body = `${notice}\n\n${rendered}`;

    return `${open(facts, body)}\n${body}\n${CLOSE}`;
  };

  /**
   * Put a freshly generated region into whatever the file already is,
   * without ever rewriting a byte henri did not write.
   *
   * @param {?string} existing The current file, or null when there is none
   * @param {object} options What to write
   * @param {object} options.facts What describe() read
   * @param {boolean} [options.force=false] Overwrite what would be kept
   * @param {string} [options.prefix=''] What a fresh file carries above the region
   * @param {string} options.rendered The markdown of the region
   * @returns {{action: string, content: ?string, reason: ?string}} What to do
   */
  const merge = (existing, { facts, force = false, prefix = '', rendered }) => {
    const built = region(facts, rendered);
    const fresh = `${prefix}${built}\n\n${footer}\n`;

    if (existing === null) {
      return { action: 'created', content: fresh, reason: null };
    }

    const start = existing.indexOf(OPEN);
    const end = existing.indexOf(CLOSE);

    if (start === -1 || end === -1 || end < start) {
      if (!force) {
        return {
          action: 'skipped',
          content: null,
          reason: `it has no generated section, so it is somebody's own ${subject} and nothing here was written by henri`,
        };
      }

      return { action: 'updated', content: fresh, reason: null };
    }

    const before = existing.slice(0, start);
    const after = existing.slice(end + CLOSE.length);
    const lineEnd = existing.indexOf('\n', start);
    const marker = read(existing.slice(start, lineEnd === -1 ? end : lineEnd));
    const body = existing.slice(
      lineEnd === -1 ? start : lineEnd + 1,
      end > 0 && existing[end - 1] === '\n' ? end - 1 : end
    );

    if (!force && (!marker || marker.gen !== digest(body))) {
      return {
        action: 'skipped',
        content: null,
        reason:
          'the generated section was edited by hand, and rewriting it would throw that away',
      };
    }

    return {
      action: 'updated',
      content: `${before}${built}${after}`,
      reason: null,
    };
  };

  return { CLOSE, OPEN, markerOf, merge, open, read, region };
};

module.exports = { digest, markers };
