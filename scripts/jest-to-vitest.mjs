#!/usr/bin/env node
/**
 * Mechanical Jest -> Vitest migration for test files (jest-to-vitest).
 *
 * Usage:
 *   node scripts/jest-to-vitest.mjs [--dry-run] <file|dir>...
 *
 *   <file>       a test file to rewrite in place
 *   <dir>        scanned recursively for *.spec.js / *.test.js (node_modules,
 *                dist, template and .claude are skipped)
 *   --dry-run    print what would change, write nothing
 *
 * Typical use on another branch, from the repo root:
 *   git diff --name-only master...HEAD -- '*.spec.js' '*.test.js' \
 *     | xargs node scripts/jest-to-vitest.mjs
 *   node scripts/jest-to-vitest.mjs packages/core packages/cli
 *
 * What it rewrites:
 *   - jest.fn/spyOn/mock/... -> vi.*   (see MOCK_API for the mapping)
 *   - jest.setTimeout(n)       -> vi.setConfig({ testTimeout: n })
 *   - jest.requireActual(m)    -> require(m)  (CommonJS, no mocking involved)
 *   - xtest/xit/xdescribe/fit/fdescribe -> .skip / .only forms
 *   - require('@jest/globals') -> removed (Vitest cannot be require()d from
 *     CommonJS: `vi`, `describe`, `expect`... come from `test.globals: true`,
 *     which the monorepo config enables)
 *   - from '@jest/globals' -> from 'vitest' (jest -> vi) in ES module files;
 *     `import { vi } from 'vitest'` is added when an ES module uses `vi.`
 *   - @jest-environment docblocks -> @vitest-environment
 *
 * What it only reports (needs a human):
 *   - `this.<name>` inside describe/test closures: Vitest runs test files as
 *     ES modules where `this` is undefined. Replace with a `let <name>` in
 *     the describe scope.
 *   - `done` callbacks: Vitest has no done(); return a promise instead.
 *   - jest.mock factories referencing outer variables (vi.mock is hoisted and
 *     its factory cannot close over module-level variables; use vi.hoisted).
 *   - jest.genMockFromModule / createMockFromModule, JEST_WORKER_ID.
 *
 * No dependencies; Node 22+.
 */

import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'template',
  '.claude',
  '.tmp',
  'coverage',
  '.next',
]);
const TEST_FILE = /\.(spec|test)\.[cm]?js$/;

// Jest API member -> Vitest API member. Members not listed are rewritten
// 1:1 (jest.foo -> vi.foo) and reported, since the name may not exist.
const MOCK_API = {
  advanceTimersByTime: 'advanceTimersByTime',
  advanceTimersByTimeAsync: 'advanceTimersByTimeAsync',
  advanceTimersToNextTimer: 'advanceTimersToNextTimer',
  clearAllMocks: 'clearAllMocks',
  clearAllTimers: 'clearAllTimers',
  doMock: 'doMock',
  doUnmock: 'doUnmock',
  fn: 'fn',
  getRealSystemTime: 'getRealSystemTime',
  getTimerCount: 'getTimerCount',
  isMockFunction: 'isMockFunction',
  mock: 'mock',
  mocked: 'mocked',
  resetAllMocks: 'resetAllMocks',
  resetModules: 'resetModules',
  restoreAllMocks: 'restoreAllMocks',
  runAllTicks: 'runAllTicks',
  runAllTimers: 'runAllTimers',
  runAllTimersAsync: 'runAllTimersAsync',
  runOnlyPendingTimers: 'runOnlyPendingTimers',
  runOnlyPendingTimersAsync: 'runOnlyPendingTimersAsync',
  setSystemTime: 'setSystemTime',
  spyOn: 'spyOn',
  unmock: 'unmock',
  useFakeTimers: 'useFakeTimers',
  useRealTimers: 'useRealTimers',
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targets = args.filter((arg) => !arg.startsWith('--'));

if (targets.length === 0) {
  process.stderr.write(
    'usage: node scripts/jest-to-vitest.mjs [--dry-run] <file|dir>...\n'
  );
  process.exit(2);
}

/**
 * Collect test files from files and directories
 *
 * @param {string} target file or directory
 * @param {string[]} [out=[]] accumulator
 * @returns {string[]} absolute test file paths
 */
function collect(target, out = []) {
  const abs = path.resolve(target);
  const stat = fs.statSync(abs);

  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          collect(path.join(abs, entry.name), out);
        }
      } else if (TEST_FILE.test(entry.name)) {
        out.push(path.join(abs, entry.name));
      }
    }
  } else {
    out.push(abs);
  }

  return out;
}

/**
 * Line number (1-based) of an offset in source
 *
 * @param {string} source file content
 * @param {number} offset character offset
 * @returns {number} line number
 */
const lineOf = (source, offset) => source.slice(0, offset).split('\n').length;

/**
 * Apply the mechanical transforms to one file's source
 *
 * @param {string} source original content
 * @returns {{ output: string, changes: string[], warnings: string[] }} result
 */
function transform(source) {
  const changes = [];
  const warnings = [];
  let output = source;

  /**
   * Replace with a change note when something matched
   *
   * @param {RegExp} regexp pattern
   * @param {string|Function} replacement replacement
   * @param {string} note change description
   * @returns {void}
   */
  const replace = (regexp, replacement, note) => {
    let count = 0;
    const next = output.replace(regexp, (...match) => {
      count++;

      return typeof replacement === 'function'
        ? replacement(...match)
        : match[0].replace(regexp, replacement);
    });

    if (count > 0) {
      output = next;
      changes.push(`${note} (${count})`);
    }
  };

  // A require('@jest/globals') cannot become require('vitest'): drop it, the
  // names are globals. `import ... from '@jest/globals'` becomes vitest.
  replace(
    /^[ \t]*(?:const|let|var)\s*\{[^}]*\}\s*=\s*require\(\s*['"]@jest\/globals['"]\s*\);?[ \t]*\n/gm,
    '',
    "require('@jest/globals') removed (globals)"
  );
  replace(
    /(import\s*\{[^}]*)\bjest\b([^}]*\}\s*from\s*['"])@jest\/globals(['"])/g,
    '$1vi$2vitest$3',
    "import from '@jest/globals' -> 'vitest'"
  );
  replace(
    /(['"])@jest\/globals\1/g,
    (match, quote) => `${quote}vitest${quote}`,
    "'@jest/globals' -> 'vitest'"
  );

  // Docblock environment
  replace(
    /@jest-environment\b/g,
    '@vitest-environment',
    '@jest-environment -> @vitest-environment'
  );

  // Timeouts: jest.setTimeout(n) -> vi.setConfig({ testTimeout: n })
  replace(
    /\bjest\.setTimeout\(\s*([^)]+?)\s*\)/g,
    (match, value) => `vi.setConfig({ testTimeout: ${value} })`,
    'jest.setTimeout -> vi.setConfig'
  );

  // Modules: jest.requireActual(m) -> require(m)
  replace(
    /\bjest\.requireActual\(/g,
    'require(',
    'jest.requireActual -> require'
  );

  // Mocks and timers: jest.<member> -> vi.<member>
  replace(
    /\bjest\.([A-Za-z_$][\w$]*)/g,
    (match, member, offset) => {
      if (!MOCK_API[member]) {
        warnings.push(
          `line ${lineOf(source, offset)}: jest.${member} has no known vi equivalent, rewritten as vi.${member}; verify`
        );

        return `vi.${member}`;
      }

      return `vi.${MOCK_API[member]}`;
    },
    'jest.* -> vi.*'
  );

  // Focused / skipped aliases that Vitest does not export
  replace(/\bxtest\(/g, 'test.skip(', 'xtest -> test.skip');
  replace(/\bxit\(/g, 'it.skip(', 'xit -> it.skip');
  replace(/\bxdescribe\(/g, 'describe.skip(', 'xdescribe -> describe.skip');
  replace(/\bfit\(/g, 'it.only(', 'fit -> it.only');
  replace(/\bfdescribe\(/g, 'describe.only(', 'fdescribe -> describe.only');

  // ES modules import `vi`; CommonJS files get it from test.globals
  const usesVi = /\bvi\./.test(output);
  const usesEsm = /^\s*import\s.+from\s/m.test(output);
  const esmImport = output.match(
    /import\s*\{([^}]*)\}\s*from\s*['"]vitest['"]/
  );

  if (usesVi && usesEsm && esmImport && !/\bvi\b/.test(esmImport[1])) {
    output = output.replace(esmImport[0], esmImport[0].replace('{', '{ vi,'));
    changes.push('added vi to the existing vitest import');
  } else if (usesVi && usesEsm && !esmImport) {
    const statement = "import { vi } from 'vitest';\n";

    // Insert after a leading docblock / directive / eslint comments
    const head = output.match(
      /^(?:\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*|['"]use strict['"];?)\s*)*/
    );
    const at = head ? head[0].length : 0;

    output = `${output.slice(0, at)}${statement}${output.slice(at)}`;
    changes.push(`added ${statement.trim()}`);
  }

  if (/require\(\s*['"]vitest['"]\s*\)/.test(output)) {
    warnings.push(
      "require('vitest') is not supported by Vitest; use the globals (test.globals: true) or an ES module"
    );
  }

  // Reports: `this.<x>` outside class bodies
  const classBodies = [];

  for (const match of output.matchAll(/\bclass\s+[^{]*\{/g)) {
    let depth = 1;
    let end = match.index + match[0].length;

    while (end < output.length && depth > 0) {
      if (output[end] === '{') {
        depth++;
      } else if (output[end] === '}') {
        depth--;
      }
      end++;
    }
    classBodies.push([match.index, end]);
  }

  for (const match of output.matchAll(/\bthis\.[A-Za-z_$][\w$]*/g)) {
    const inClass = classBodies.some(
      ([start, end]) => match.index >= start && match.index < end
    );

    if (!inClass) {
      warnings.push(
        `line ${lineOf(output, match.index)}: ${match[0]} - \`this\` is undefined in Vitest test modules; use a variable in the describe scope`
      );
    }
  }
  for (const match of output.matchAll(
    /\b(?:test|it|beforeAll|beforeEach|afterAll|afterEach)(?:\.\w+)*\((?:[^()]*,)?\s*(?:async\s*)?\(\s*done\s*\)/g
  )) {
    warnings.push(
      `line ${lineOf(output, match.index)}: done() callback is not supported by Vitest; return a promise`
    );
  }
  for (const match of output.matchAll(/\bvi\.mock\(/g)) {
    warnings.push(
      `line ${lineOf(output, match.index)}: vi.mock is hoisted; its factory must not reference outer variables (use vi.hoisted)`
    );
  }
  for (const match of output.matchAll(
    /\b(?:genMockFromModule|createMockFromModule|JEST_WORKER_ID)\b/g
  )) {
    warnings.push(
      `line ${lineOf(output, match.index)}: ${match[0]} has no Vitest equivalent`
    );
  }

  return { changes, output, warnings };
}

const files = [...new Set(targets.flatMap((target) => collect(target)))];
let touched = 0;
let flagged = 0;

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const { changes, output, warnings } = transform(source);
  const rel = path.relative(process.cwd(), file);

  if (output !== source) {
    touched++;
    if (!dryRun) {
      fs.writeFileSync(file, output);
    }
    process.stdout.write(`${dryRun ? 'would rewrite' : 'rewrote'} ${rel}\n`);
    for (const change of changes) {
      process.stdout.write(`  - ${change}\n`);
    }
  }

  if (warnings.length > 0) {
    flagged++;
    process.stdout.write(`review ${rel}\n`);
    for (const warning of warnings) {
      process.stdout.write(`  ! ${warning}\n`);
    }
  }
}

process.stdout.write(
  `\n${files.length} file(s) scanned, ${touched} rewritten, ${flagged} need review${dryRun ? ' (dry run)' : ''}\n`
);
