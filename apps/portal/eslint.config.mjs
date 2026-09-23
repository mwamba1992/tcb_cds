import vue from 'eslint-plugin-vue';
import typescript from '@typescript-eslint/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    // The workspace baseline applies `@typescript-eslint/*` rules to .vue files, but
    // Nx's TypeScript preset registers the plugin for .ts only.
    plugins: { '@typescript-eslint': typescript },
    languageOptions: {
      parserOptions: { parser: await import('@typescript-eslint/parser') },
    },
  },
  {
    files: ['**/*.ts', '**/*.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',
      // Prettier owns formatting; these stylistic rules only fight it.
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
    },
  },
];
