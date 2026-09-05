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
];

const testFiles = (pkg) => [
  `packages/${pkg}/**/__tests__/**/*.{spec,test}.js`,
  `packages/${pkg}/**/tests/**/*.{spec,test}.js`,
];

/**
 * One Vitest project per workspace package that has tests
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
        // Core boots the demo app on one port and one MongoDB per file
        ...(pkg === 'core' ? { fileParallelism: false } : {}),
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
