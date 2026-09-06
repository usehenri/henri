import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

// Fixtures and generated output are never test roots
const fixtures = ['demo'];

const ignored = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '.tmp/**',
  '.claude/**',
  'website/**',
  'packages/cli/template/**',
  'packages/demo/**',
  'packages/react/dist/**',
  // The showcase application runs its own suite against PostgreSQL:
  // `pnpm --filter @usehenri/showcase test`, never `pnpm test`
  'showcase/**',
];

const testFiles = (pkg) => [
  `packages/${pkg}/**/__tests__/**/*.{spec,test}.js`,
  `packages/${pkg}/**/tests/**/*.{spec,test}.js`,
];

/**
 * One Vitest project per workspace package that has tests.
 *
 * Every project runs its files at the same time, core included. That was not
 * always true: core's 46 files each boot the demo application, and when they
 * ran together the boots fought over ports -- the server's, and the one
 * mongodb-memory-server picks by probing. Three changes ended that: the
 * server asks for port 0 instead of probing and then binding (#324), every
 * host-less `listen()` binds 127.0.0.1 so the reservation is exact
 * (vitest.setup.js), and @usehenri/disk gives each process a starting port of
 * its own (packages/disk/port.js). What is left is a mongod and an in-memory
 * database per file, which is isolation rather than sharing. Measured on 16
 * cores: the core project went from 58s to 14s, the whole run from 74s to
 * 25s.
 *
 * The one thing these files do share is the demo application's directory
 * (`packages/demo/.tmp`), so anything written there has to be named per
 * record or per process: a boot that swept it clean is what made this flaky
 * at one run in ten, until `@usehenri/uploads` learned to leave a part
 * younger than an hour alone.
 *
 * An application's own suite is the other case, and keeps
 * `fileParallelism: false`: a store with a url in `config/test.json` is one
 * database however many files run against it.
 *
 * @returns {object[]} project configurations
 */
const projects = () =>
  fs
    .readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !fixtures.includes(entry.name))
    .map((entry) => entry.name)
    .filter(
      (pkg) =>
        fs.existsSync(path.join(root, 'packages', pkg, '__tests__')) ||
        fs.existsSync(path.join(root, 'packages', pkg, 'tests')) ||
        fs.existsSync(path.join(root, 'packages', pkg, 'src', '__tests__'))
    )
    .map((pkg) => ({
      extends: true,
      test: {
        include: testFiles(pkg),
        name: pkg,
      },
    }));

export default defineConfig({
  test: {
    // Vitest 5 clears mock history before every test; keep jest's behaviour
    // (tests assert on calls recorded in beforeAll)
    clearMocks: false,
    coverage: {
      exclude: [
        ...ignored,
        '**/__tests__/**',
        '**/tests/**',
        '**/bin/**',
        '**/*.config.{js,mjs}',
        'packages/cli/scripts/generate/**',
      ],
      include: ['packages/*/**/*.js'],
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
    env: {
      NODE_ENV: 'test',
    },
    environment: 'node',
    exclude: ignored,
    globals: true,
    // Boots (mongodb-memory-server) happen in beforeAll hooks
    hookTimeout: 60000,
    // And a test is not a latency assertion either. The slowest here spawns
    // the henri binary, scaffolds an application and runs two job workers
    // against it (7s on an idle machine); with every core busy running the
    // other files, the 5 second default failed a handful of those with a
    // timeout that said nothing about the code. A test that really hangs
    // still fails, half a minute later. What needs longer than this says so
    // itself, as `henri db:seed` and the SIGTERM tests already do
    testTimeout: 30000,
    // `include` lives in the projects only: with `extends: true` the arrays
    // would be merged and every project would run every file
    // Forks: core tests chdir into packages/demo, impossible in worker threads
    pool: 'forks',
    projects: projects(),
    // Test servers bind the loopback address, never the wildcard: see the
    // file for why a wildcard bind lets another process answer our requests
    setupFiles: [path.join(root, 'vitest.setup.js')],
  },
});
