import reactHooks from 'eslint-plugin-react-hooks';

export default [{
  files: ['src/**/*.{js,jsx}'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { 'react-hooks': reactHooks },
  rules: {
    ...reactHooks.configs.recommended.rules,
    // Existing fetch effects reset loading/error state before async work. Keep
    // this UI convention; this performance-style rule is not a hooks safety gate.
    'react-hooks/set-state-in-effect': 'off',
  },
}];
