#!/usr/bin/env node
// `pnpm test:types`: the type test (website/src/content/docs/reference/types.md
// documents what the declarations cover).
//
// Two things are checked, in this order:
//
//  1. packaging -- every declaration a package points at exists and is listed
//     in `files`, so that `npm publish` ships it;
//  2. the declarations themselves -- `tsc --noEmit` over `types/`, whose
//     fixtures call the API the right way and, on the lines marked
//     `@ts-expect-error`, the wrong way. tsc reports an unused
//     `@ts-expect-error`, so a declaration that stops catching a mistake fails
//     the run just like a declaration that rejects correct code.
//
// `tsc --noEmit` was picked over tsd or expect-type because it needs no
// dependency besides typescript, checks the JavaScript-with-JSDoc an
// application actually writes (`types/app.js`, `checkJs`), and gets the
// negative cases from `@ts-expect-error` for free.

/* eslint-disable no-console */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Packages expected to ship declarations. */
const PACKAGES = ['core', 'inertia', 'react', 'testing'];

const problems = [];

/**
 * Every declaration file a package.json points at, as package-relative paths
 *
 * @param {object} pkg the parsed package.json
 * @returns {string[]} the paths
 */
const declarationsOf = (pkg) => {
  const found = new Set();
  const walk = (value) => {
    if (typeof value === 'string') {
      if (/\.d\.[cm]?ts$/.test(value)) {
        found.add(value.replace(/^\.\//, ''));
      }

      return;
    }

    if (value && typeof value === 'object') {
      Object.values(value).forEach(walk);
    }
  };

  walk(pkg.types);
  walk(pkg.exports);

  return [...found];
};

/**
 * Every declaration file in a package, as package-relative paths
 *
 * A subpath like `@usehenri/react/forms` resolves through the file system
 * rather than through `exports`, so its declarations are only found by
 * looking; unshipped, they would be missing for everyone but this repository.
 *
 * @param {string} dir the package directory
 * @param {string} [prefix=''] the path so far, when recursing
 * @returns {string[]} the paths
 */
const declarationsIn = (dir, prefix = '') =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.name !== 'node_modules' && entry.name !== 'dist')
    .flatMap((entry) => {
      const file = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        return declarationsIn(path.join(dir, entry.name), file);
      }

      return /\.d\.[cm]?ts$/.test(entry.name) ? [file] : [];
    });

/**
 * Is `file` shipped, given a `files` list? A directory entry covers what is
 * under it, the way npm reads it.
 *
 * @param {string} file a package-relative path
 * @param {string[]} files the `files` list
 * @returns {boolean} shipped or not
 */
const isShipped = (file, files) =>
  files.some((entry) => {
    const clean = entry.replace(/^\.\//, '').replace(/\/$/, '');

    return (
      !clean.startsWith('!') && (clean === file || file.startsWith(`${clean}/`))
    );
  });

for (const name of PACKAGES) {
  const dir = path.join(root, 'packages', name);
  const pkg = JSON.parse(
    fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
  );
  const declared = declarationsOf(pkg);

  if (declared.length === 0) {
    problems.push(`${pkg.name}: no types field and no types condition`);
    continue;
  }

  for (const file of new Set([...declared, ...declarationsIn(dir)])) {
    if (!fs.existsSync(path.join(dir, file))) {
      problems.push(`${pkg.name}: ${file} is declared but missing`);
    } else if (!isShipped(file, pkg.files || [])) {
      problems.push(
        `${pkg.name}: ${file} is not in "files", npm would skip it`
      );
    }
  }
}

if (problems.length > 0) {
  console.error('Packaging of the type declarations:');
  problems.forEach((problem) => console.error(`  - ${problem}`));
  process.exit(1);
}

console.log(`Declarations shipped by ${PACKAGES.length} packages: ok`);

const tsc = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit',
    '-p',
    path.join(root, 'types', 'tsconfig.json'),
  ],
  { cwd: root, stdio: 'inherit' }
);

if (tsc.error) {
  throw tsc.error;
}

if (tsc.status !== 0) {
  process.exit(tsc.status ?? 1);
}

console.log('Type test: ok');
