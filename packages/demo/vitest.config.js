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
