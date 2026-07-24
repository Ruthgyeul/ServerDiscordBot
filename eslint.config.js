import js from '@eslint/js';
import globals from 'globals';

/**
 * ESLint flat config (ESLint 9+). Keeps the codebase consistent with sensible,
 * low-friction rules that catch real bugs without being noisy.
 */
export default [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'warn',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    ignores: ['node_modules/', 'logs/', 'config/config.json'],
  },
];
