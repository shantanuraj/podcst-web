module.exports = {
  root: true,
  plugins: [
    '@typescript-eslint',
  ],
  extends: [
    'next/core-web-vitals',
    'prettier',
  ],
  rules: {
    '@typescript-eslint/explicit-module-boundary-types': 'off'
  },
};
