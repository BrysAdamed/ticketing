// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = defineConfig([
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'tk', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'tk', style: 'kebab-case' },
      ],
      '@angular-eslint/component-class-suffix': [
        'error',
        { suffixes: ['Component', 'View', 'Dialog', 'App'] },
      ],
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/app/core/**/*.ts', 'src/app/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@features/*', '**/features/**'],
              message: 'core/ and shared/ must not depend on features.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/app/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@features/*', '**/features/**'],
              message: 'shared/ must not depend on features.',
            },
            {
              group: ['@core/*', '**/core/**', '!@angular/**'],
              message: 'shared/ is a leaf UI kit; it must not depend on core/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/app/features/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@features/*'],
              message:
                'Features must not import each other statically. Use relative imports inside your feature; reach other features only through lazy routes, the view registry or core/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/print/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@angular/*',
                '@core/*',
                '@features/*',
                '**/app/core/**',
                '**/app/features/**',
                'react',
                'react-dom',
                '@excalidraw/*',
              ],
              message:
                'The PDF print bundle (D-111) stays framework-free: import only Angular-free code from @shared, never Excalidraw.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/app/shared/markdown/markdown-viewer.component.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name=/^bypassSecurityTrust/]',
          message:
            'Only tk-markdown may bypass Angular sanitization; render user text with <tk-markdown>.',
        },
        {
          selector: "Property[key.value='[innerHTML]']",
          message: 'Render user text with <tk-markdown>, which sanitizes it and strips app links.',
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "BoundAttribute[name='innerHTML']",
          message: 'Render user text with <tk-markdown>, which sanitizes it and strips app links.',
        },
      ],
    },
  },
]);
