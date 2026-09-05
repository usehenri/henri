const js = require('@eslint/js');
const vitest = require('@vitest/eslint-plugin');
const globals = require('globals');

// Rules ported from the previous .eslintrc. Formatting rules are left to
// prettier. Rules that existing code does not fully satisfy are warnings so
// they show up without blocking CI.
const projectRules = {
  'accessor-pairs': 'error',
  camelcase: 'warn',
  'capitalized-comments': [
    'warn',
    'always',
    { ignoreConsecutiveComments: true },
  ],
  'class-methods-use-this': 'warn',
  eqeqeq: 'error',
  'guard-for-in': 'error',
  'id-length': ['warn', { exceptions: ['_', 'i', 'j'] }],
  'no-console': 'warn',
  'no-extra-bind': 'error',
  'no-nested-ternary': 'error',
  'no-prototype-builtins': 'warn',
  'no-unused-vars': [
    'error',
    { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true },
  ],
  'no-useless-assignment': 'warn',
  'no-var': 'error',
  'prefer-promise-reject-errors': 'error',
  'prefer-template': 'warn',
  'preserve-caught-error': 'warn',
  'sort-keys': 'warn',
  'sort-vars': 'warn',
  'vars-on-top': 'warn',
};

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '.claude/**',
      '.tmp/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.henri/**',
      'packages/cli/template/**',
      'packages/react/dist/**',
      'packages/demo/app/views/**',
      'website/dist/**',
      'website/.astro/**',
    ],
  },
  js.configs.recommended,
  {
    // CommonJS source across the monorepo
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        henri: 'writable',
      },
    },
    rules: projectRules,
  },
  {
    // React components compiled by rollup (ESM + JSX)
    files: ['packages/react/src/**/*.js', 'packages/react/rollup.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      ...projectRules,
      'no-unused-vars': [
        'warn',
        { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^React$' },
      ],
    },
  },
  {
    // Demo app: models are exposed as globals by henri
    files: ['packages/demo/**/*.js'],
    languageOptions: {
      globals: {
        Artwork: 'readonly',
        User: 'readonly',
      },
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: projectRules,
  },
  {
    // Test files
    files: [
      '**/__tests__/**/*.js',
      '**/tests/**/*.js',
      '**/*.spec.js',
      '**/*.test.js',
    ],
    ...vitest.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...vitest.environments.env.globals,
        henri: 'writable',
      },
    },
    rules: {
      ...vitest.configs.recommended.rules,
      // Same severity as eslint-plugin-jest's recommended preset
      'vitest/expect-expect': 'warn',
      'vitest/no-disabled-tests': 'warn',
      'vitest/no-focused-tests': 'error',
      'vitest/no-identical-title': 'error',
      'vitest/no-test-prefixes': 'warn',
      'vitest/valid-expect': 'error',
    },
  },
  {
    // Key order is deliberate in configuration files and type maps
    files: ['**/*.config.{js,mjs}', 'eslint.config.js', '**/types.js'],
    rules: {
      'sort-keys': 'off',
    },
  },
  {
    // CLI output, maintenance scripts and tests print on purpose
    files: [
      'packages/cli/scripts/**/*.js',
      'scripts/**/*.js',
      '**/__tests__/**/*.js',
      '**/tests/**/*.js',
      '**/*.spec.js',
      '**/*.test.js',
    ],
    rules: {
      'no-console': 'off',
    },
  },
];
