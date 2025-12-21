import nextVitalsConfig from 'eslint-config-next/core-web-vitals';
import prettierConfig from 'eslint-config-prettier';

/** @type {import('eslint').Linter.Config[]} */
const config = [
  ...nextVitalsConfig,
  {
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  prettierConfig,
];

export default config;

