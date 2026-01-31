module.exports = {
  root: true,
  env: {
    es2022: true
  },
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier'
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_' }
    ]
  },
  overrides: [
    {
      files: ['src/**/*.ts'],
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: __dirname
      },
      extends: [
        'plugin:@typescript-eslint/recommended-requiring-type-checking'
      ],
      rules: {
        '@typescript-eslint/explicit-module-boundary-types': 'error',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports' }
        ],
        '@typescript-eslint/no-unnecessary-type-assertion': 'off'
      }
    }
  ]
};
