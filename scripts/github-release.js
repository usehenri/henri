/**
 * Creates the GitHub release of the version that was just published.
 *
 * All public packages share one version (a changesets "fixed" group), so one
 * `v<version>` release is created instead of one per package. The notes are
 * the top section of each package changelog, henri first, skipping the
 * packages whose only entry is "Updated dependencies". Idempotent: nothing
 * happens when the release already exists.
 *
 * Needs the gh CLI (GH_TOKEN in CI). The release workflow runs it after
 * `changeset publish`; locally:
 *
 *   node scripts/github-release.js --dry-run   # print the notes
 *   node scripts/github-release.js             # create the release
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');
const { version } = require('../packages/henri/package.json');
const tag = `v${version}`;

/**
 * The public packages of the workspace, henri first then alphabetical
 *
 * @returns {{ dir: string, name: string }[]} package directories and names
 */
const publicPackages = () =>
  fs
    .readdirSync(path.join(root, 'packages'))
    .map((entry) => path.join(root, 'packages', entry))
    .filter((dir) => fs.existsSync(path.join(dir, 'package.json')))
    .map((dir) => ({ dir, ...require(path.join(dir, 'package.json')) }))
    .filter((pkg) => !pkg.private)
    .sort((left, right) => {
      if (left.name === 'henri') {
        return -1;
      }
      if (right.name === 'henri') {
        return 1;
      }

      return left.name.localeCompare(right.name);
    });

/**
 * The `## <version>` section of a changeset changelog
 *
 * @param {string} file CHANGELOG.md path
 * @returns {string} the section body, '' when absent
 */
const section = (file) => {
  if (!fs.existsSync(file)) {
    return '';
  }

  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);

  if (start < 0) {
    return '';
  }

  const next = lines.findIndex(
    (line, index) => index > start && line.startsWith('## ')
  );

  return lines.slice(start + 1, next < 0 ? lines.length : next).join('\n');
};

/**
 * Whether a section only lists "Updated dependencies" bumps (or says "No
 * changes in this release")
 *
 * @param {string} text section body
 * @returns {boolean} true when there is nothing worth repeating
 */
const dependencyBumpsOnly = (text) =>
  text
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .every(
      (line) =>
        /^\s*- Updated dependencies/.test(line) ||
        /^\s+- \S+@\d/.test(line) ||
        /^\s*No changes in this release/i.test(line)
    );

const notes = publicPackages()
  .map((pkg) => ({ pkg, text: section(path.join(pkg.dir, 'CHANGELOG.md')) }))
  .filter(({ text }) => text.trim() && !dependencyBumpsOnly(text))
  .map(
    ({ pkg, text }) =>
      // Demote the changeset headings (### Major Changes) under the package name
      `## ${pkg.name}\n${text.replace(/^###/gm, '####').trimEnd()}`
  );

const published = publicPackages()
  .map(
    (pkg) =>
      `[${pkg.name}@${version}](https://www.npmjs.com/package/${pkg.name}/v/${version})`
  )
  .join(', ');

const body = `${
  notes.length > 0
    ? notes.join('\n\n')
    : 'Dependency updates only; see the package changelogs.'
}\n\nPublished: ${published}\n`;

if (dryRun) {
  process.stdout.write(`# ${tag}\n\n${body}`);
  process.exit(0);
}

const exists = spawnSync('gh', ['release', 'view', tag], { stdio: 'ignore' });

if (exists.status === 0) {
  console.log(`release ${tag} already exists, nothing to do`);
  process.exit(0);
}

const notesFile = path.join(os.tmpdir(), `henri-release-${version}.md`);

fs.writeFileSync(notesFile, body);

const args = [
  'release',
  'create',
  tag,
  '--title',
  tag,
  '--notes-file',
  notesFile,
];

// In the workflow, tag the commit that was published rather than the branch tip
if (process.env.GITHUB_SHA) {
  args.push('--target', process.env.GITHUB_SHA);
}

const created = spawnSync('gh', args, { stdio: 'inherit' });

process.exit(created.status === null ? 1 : created.status);
