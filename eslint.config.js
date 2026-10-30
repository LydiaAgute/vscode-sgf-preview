const { defineConfig } = require('eslint/config');
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = defineConfig(
  { ignores: ['**/dist/', 'node_modules/', 'sgf/', '**/*.d.ts'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
    },
  },
  {
    // 构建脚本和配置文件是 CommonJS
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['webview/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  prettier,
);
