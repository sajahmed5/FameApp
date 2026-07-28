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
    // supabase/functions + scripts are Deno (Deno.serve, npm: specifiers) — linted
    // by `deno lint`, not the RN/Expo ESLint config.
    ignores: ['dist/*', '.expo/*', 'node_modules/*', 'expo-env.d.ts', 'supabase/functions/**', 'scripts/**'],
  },
]);
