import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ESLint flat config (ESLint 9 + typescript-eslint). Keeps the codebase
 * consistent with sensible, low-friction rules that catch real bugs.
 */
export default tseslint.config(
  {
    ignores: ['node_modules/', 'dist/', 'logs/', 'config.json'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'warn',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
);
