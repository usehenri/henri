const fs = require('fs');
const path = require('path');
const js = require('@eslint/js');
const react = require('eslint-plugin-react');
const globals = require('globals');

// henri writes the global model ids (User, Task, ...) to .henri/globals.json
// on boot so the linter knows about them.
let modelGlobals = {};

try {
  modelGlobals = JSON.parse(
    fs.readFileSync(path.join(__dirname, '.henri', 'globals.json'), 'utf8')
  );
} catch {
  // No models loaded yet, nothing to declare
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
