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
  // Framework modules implement an interface; many methods legitimately ignore `this`
  'class-methods-use-this': 'off',
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
      // Type declarations: hand-written TypeScript, checked by
      // `pnpm test:types` (tsc) and formatted by prettier, not linted here
      '**/*.d.ts',
      '**/*.d.mts',
      '**/*.d.cts',
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
    // The showcase application (showcase/): its models are globals, like in
    // every henri app. Its views are ESM + JSX bundled by Vite, so they get a
    // block of their own below.
    files: ['showcase/**/*.js'],
    ignores: ['showcase/app/views/**'],
    languageOptions: {
      globals: {
        Event: 'readonly',
        Proposal: 'readonly',
        Review: 'readonly',
        Track: 'readonly',
        User: 'readonly',
      },
    },
    rules: {
      // Route parameters and path helpers are snake_case by design
      // (`:proposal_id`, `index_admin/proposals_path`)
      camelcase: 'off',
    },
  },
  {
    // The Inertia pages and components of the showcase
    files: ['showcase/app/views/**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node,
        React: 'readonly',
      },
    },
    rules: {
      ...projectRules,
      // Route parameters are snake_case (`pathFor(name, { proposal_id })`)
      camelcase: 'off',
      // JSX identifiers are components, not variables
      'id-length': 'off',
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
      // Pending tests are part of the workflow (see CLAUDE.md); route helpers are snake_case by design
      'vitest/no-disabled-tests': 'off',
      camelcase: 'off',
      'id-length': 'off',
      'vitest/no-focused-tests': 'error',
      'vitest/no-identical-title': 'error',
      'vitest/no-test-prefixes': 'warn',
      'vitest/valid-expect': 'error',
    },
  },
  {
    // Key order is deliberate in configuration files and type maps, and in a
    // routes file it is load-bearing: henri registers the routes in file
    // order, so `get /proposals/mine` must come before `get /proposals/:id`
    files: [
      '**/*.config.{js,mjs}',
      'eslint.config.js',
      '**/config/routes.js',
      '**/types.js',
    ],
    rules: {
      'sort-keys': 'off',
    },
  },
  {
    // The type-test fixture is a henri application in miniature: type-checked
    // by `pnpm test:types`, never run. Its key order mirrors a routes file and
    // a controller, where the order is load-bearing rather than alphabetical.
    files: ['types/**/*.js'],
    rules: {
      'no-unused-vars': 'off',
      'sort-keys': 'off',
    },
  },
  {
    // The seed fixture is a henri application: its models are globals
    files: ['packages/cli/__tests__/fixtures/seed-app/**/*.js'],
    languageOptions: {
      globals: {
        Task: 'readonly',
      },
    },
  },
  {
    // CLI output, maintenance scripts and tests print on purpose
    files: [
      'packages/cli/scripts/**/*.js',
      'scripts/**/*.js',
      'showcase/db/*.js',
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
