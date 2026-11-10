import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    ignores: ['api/**', 'scripts/**', 'tests/**'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Server-side code (OAuth backend, dev API server, tests) runs on Node.
    files: ['api/**/*.js', 'scripts/**/*.mjs', 'tests/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
      sourceType: 'module',
      ecmaVersion: 'latest',
    },
  },
  {
    // The runtime-config test simulates a browser by assigning globalThis.window.
    files: ['tests/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, window: 'writable' },
    },
  },
  {
    // Provider modules export both the component and its hook by design.
    files: ['src/context/*.jsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
