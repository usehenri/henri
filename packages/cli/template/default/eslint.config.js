// ESLint 9 is pinned in package.json because eslint-plugin-react does not
// support ESLint 10 yet; bump both together when it does.
const fs = require('fs');
const path = require('path');
const js = require('@eslint/js');
const react = require('eslint-plugin-react');
const globals = require('globals');

// Models are globals (User, Task, ...). Their names come from the files in
// app/models, plus whatever henri recorded in .henri/globals.json on boot.
const modelGlobals = {};

try {
  for (const file of fs.readdirSync(path.join(__dirname, 'app', 'models'))) {
    if (file.endsWith('.js')) {
      modelGlobals[path.basename(file, '.js')] = true;
    }
  }
} catch {
  // No app/models directory yet
}

try {
  Object.assign(
    modelGlobals,
    JSON.parse(
      fs.readFileSync(path.join(__dirname, '.henri', 'globals.json'), 'utf8')
    )
  );
} catch {
  // Nothing recorded yet
}

const henriGlobals = Object.fromEntries(
  Object.keys(modelGlobals).map((name) => [name, 'readonly'])
);

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.henri/**',
      '**/.backup/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  {
    // Server side: controllers, models, workers, config, this file
    files: [
      'app/**/*.js',
      'config/**/*.js',
      'test/**/*.js',
      'eslint.config.js',
      'vitest.config.js',
    ],
    ignores: ['app/views/**'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...henriGlobals,
        henri: 'readonly',
      },
    },
  },
  {
    // Tests run by `henri test` (vitest globals: describe, test, expect, vi)
    files: ['test/**/*.js'],
    languageOptions: {
      globals: {
        ...(globals.vitest || globals.jest),
      },
    },
  },
  {
    // Views: React pages and components rendered by next.js
    files: ['app/views/**/*.{js,jsx}'],
    ...react.configs.flat.recommended,
    ...react.configs.flat['jsx-runtime'],
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
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      'react/prop-types': 'off',
    },
    settings: { react: { version: 'detect' } },
  },
];
