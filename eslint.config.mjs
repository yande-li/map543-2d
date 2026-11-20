import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'data/**', 'wasm/*.wasm'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['react/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: [
      'index.ts',
      'core.ts',
      'core/**/*.ts',
      'formats/**/*.ts',
      'react/**/*.{ts,tsx}',
      'wasm/**/*.ts',
    ],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.build.json',
      },
    },
    rules: {
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      complexity: ['warn', 25],
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['__tests__/**/*.ts', 'formats/**/*.test.ts'],
    rules: {
      '@typescript-eslint/triple-slash-reference': 'off',
    },
  }
);
