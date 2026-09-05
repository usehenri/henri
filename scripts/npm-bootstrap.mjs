#!/usr/bin/env node
/**
 * Creates a package on npm so that trusted publishing can take over.
 *
 * npm cannot create a package through OIDC (the trusted publisher of a
 * package is configured on npmjs.com, which needs the package to exist), so
 * the first release of a new @usehenri package is bootstrapped by hand:
 *
 *   npm login                                   # once, as a maintainer
 *   node scripts/npm-bootstrap.mjs @usehenri/foo   # publishes 0.0.0
 *
 * then register the trusted publisher of the package on npmjs.com
 * (repository usehenri/henri, workflow release.yml, environment npm) and
 * let the release workflow publish the real version. 0.0.0 is a placeholder
 * with no code: `changeset publish` never picks it and a version range like
 * ^1.1.0 never resolves to it.
 *
 *   --dry-run   print what would be published
 */
/* eslint-disable no-console */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const name = args.find((arg) => !arg.startsWith('--'));

if (!name || !/^@usehenri\/[a-z0-9-]+$/.test(name)) {
  console.error(
    'usage: node scripts/npm-bootstrap.mjs [--dry-run] @usehenri/<name>'
  );
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), 'henri-npm-bootstrap-'));
const manifest = {
  description: `Placeholder creating ${name} on npm; the first real version is published by the henri release workflow`,
  homepage: 'https://usehenri.io',
  license: 'MIT',
  name,
  publishConfig: { access: 'public' },
  repository: {
    directory: `packages/${name.slice('@usehenri/'.length)}`,
    type: 'git',
    url: 'git+https://github.com/usehenri/henri.git',
  },
  version: '0.0.0',
};

writeFileSync(
  join(dir, 'package.json'),
  `${JSON.stringify(manifest, null, 2)}\n`
);
writeFileSync(
  join(dir, 'README.md'),
  `# ${name}\n\nPlaceholder release. Install a real version: see https://usehenri.io.\n`
);

console.log(
  `${dryRun ? 'would publish' : 'publishing'} ${name}@0.0.0 from ${dir}`
);

execFileSync(
  'npm',
  ['publish', '--access', 'public', ...(dryRun ? ['--dry-run'] : [])],
  { cwd: dir, stdio: 'inherit' }
);
