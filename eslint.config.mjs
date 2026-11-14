// @ts-check
import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'seed/data.js', 'openapi.json', '*.config.js', 'eslint.config.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Searches go through src/common/es.ts, which refuses partial results and rejects timed-out or shard-failed responses.
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    ignores: ['src/common/es.ts', '**/*.spec.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...["[object.name='es']", "[object.property.name='es']"].map((on) => ({
          selector: `CallExpression > MemberExpression.callee[property.name=/^(search|count|msearch|openPointInTime)$/]${on}`,
          message: 'Use search/count/msearch/readAll/searchAll from src/common/es.ts: they reject partial results.',
        })),
      ],
    },
  },
  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    // Tests poke at untyped JSON response bodies.
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
);
