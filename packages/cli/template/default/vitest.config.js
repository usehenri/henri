// `henri test` runs vitest with this configuration. The setup file boots
// henri (NODE_ENV=test) before each test file, so `henri`, the models and
// request() from @usehenri/testing are available in your tests.
const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    globals: true,
    include: ['test/**/*.{spec,test}.js'],
    setupFiles: ['@usehenri/testing/setup-file'],
  },
});
