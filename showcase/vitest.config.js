// `henri test` runs vitest with this configuration. The setup file boots
// henri (NODE_ENV=test) before each test file, so `henri`, the models and
// request() from @usehenri/testing are available in the tests.
//
// These tests need the PostgreSQL of compose.yaml, which is why they are not
// part of the monorepo's `pnpm test`: run them with
// `pnpm --filter @usehenri/showcase test`.
const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    // One server and one database at a time: every file boots henri
    fileParallelism: false,
    globals: true,
    // Each file boots the application, the view engine included
    hookTimeout: 120000,
    include: ['test/**/*.{spec,test}.js'],
    setupFiles: ['@usehenri/testing/setup-file'],
    testTimeout: 30000,
  },
});
