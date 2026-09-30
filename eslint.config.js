// ESLint flat config. The house rule is Allman braces: every opening brace
// goes on its own line. Single-line blocks are allowed so short guards such
// as `if (done) { return; }` do not have to be spread over four lines.
export default [
  { ignores: ['node_modules/**', 'dist/**', 'web/vendor/**'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    rules: {
      'brace-style': ['error', 'allman', { allowSingleLine: true }],
      'indent': ['error', 2, { SwitchCase: 1 }],
      'no-unused-vars': ['error', { args: 'none' }],
      'no-undef': 'off'
    }
  }
];
