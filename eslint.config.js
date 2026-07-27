// https://docs.expo.dev/guides/using-eslint/
// Flat config. `eslint-config-prettier` is applied last to switch off any ESLint rules
// that would conflict with Prettier — Prettier owns formatting, ESLint owns correctness.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettier,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*', 'expo-env.d.ts'],
  },
]);
