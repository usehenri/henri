#!/usr/bin/env node
/**
 * Writes the error code reference page from the catalogue.
 *
 * `packages/core/error-codes.json` is the source of truth; this turns it
 * into `website/src/content/docs/reference/errors.md`. Run it after adding
 * a code -- `packages/core/src/__tests__/error-codes.spec.js` compares the
 * two and fails when they drift.
 *
 *   node scripts/error-codes-page.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogue = JSON.parse(
  fs.readFileSync(path.join(root, 'packages/core/error-codes.json'), 'utf8')
);
const page = path.join(root, 'website/src/content/docs/reference/errors.md');

const header = `---
title: Error codes
description: Every failure henri raises on its own behalf carries a code. This is what each of them means, what usually causes it and how to fix it.
---

<!-- Generated from packages/core/error-codes.json by scripts/error-codes-page.mjs. Edit the catalogue, then run it again. -->

Every failure henri raises on its own behalf carries a code:
\`HENRI_MODEL_UNKNOWN_TYPE\`, \`HENRI_BOOT_CIRCULAR_DEPENDENCY\`. It is a
stable name -- it never changes meaning between versions -- so it can be
searched for, and an agent can look it up here instead of matching a message
that may be reworded.

The shape is \`HENRI_<AREA>_<REASON>\`: the prefix makes the whole code unique
enough to search the web with, the area says which part of the framework
raised it, and the reason reads without a lookup, the way node's own \`ERR_*\`
codes do. The catalogue is \`packages/core/error-codes.json\` and it is data:
one entry per code, and a test that fails when the source raises a code the
catalogue does not hold, or holds one nothing raises.

## Where a code shows up

- **The boot log.** \`pen.fatal()\` prints the code before the message.
- **The JSON API.** The error body gains a \`code\` next to the
  \`statusCode\`, \`error\` and \`message\` it already answers with:
  \`{ "statusCode": 500, "error": "Internal Server Error", "code": "HENRI_STORE_NOT_STARTED", "message": "..." }\`.
- **The command line.** \`henri <command> --json\` prints
  \`{ "error": { "command", "message", "hint", "code", "exitCode" } }\`, whose
  \`code\` is one of these. The \`exitCode\` stays the coarse number a shell
  branches on (see [the CLI reference](/reference/cli/#exit-codes)).
- **\`henri mcp\`.** A failed tool call answers \`{ "error": { "code", "message", "hint" } }\`.

## Linking a code to a page

henri ships no address. Set \`errors.url\` to a template holding \`{code}\` and
every code printed by \`pen\` is followed by the link it resolves to:

\`\`\`json
{ "errors": { "url": "https://example.com/e/{code}" } }
\`\`\`

Unset -- which is the default -- nothing prints a link.

## Raising one

A code is a string, so nothing has to be imported to raise one. Inside core,
\`base/errors.js\` is the helper:

\`\`\`js
const { fail, stamp } = require('@usehenri/core/errors');

throw fail('HENRI_JOB_UNKNOWN', \`No job named "\${name}"\`);
throw stamp(error, 'HENRI_STORE_START_FAILED');
\`\`\`

\`pen.fatal(name, summary, full, obj, code)\` takes the code as its last
argument and stamps it on the error it returns.
`;

const list = (items) => items.map((item) => `- ${item}`).join('\n');

const areas = catalogue.areas
  .map((area) => {
    const codes = catalogue.codes
      .filter((code) => code.area === area.area)
      .map(
        (code) => `### \`${code.code}\`

${code.what}

Usually:

${list(code.causes)}

**Fix.** ${code.fix}`
      )
      .join('\n\n');

    return `## ${area.area}

${area.what[0].toUpperCase()}${area.what.slice(1)}.

${codes}`;
  })
  .join('\n\n');

fs.writeFileSync(page, `${header}\n${areas}\n`);
process.stdout.write(
  `${path.relative(root, page)}: ${catalogue.codes.length} codes in ${catalogue.areas.length} areas\n`
);
