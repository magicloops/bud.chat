import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';

export default [
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        Buffer: 'readonly',
        
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        crypto: 'readonly',
        
        // Next.js globals
        React: 'readonly',
        JSX: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
    },
    rules: {
      // Semicolon rules - main focus
      'semi': ['error', 'always'],
      'semi-spacing': ['error', { before: false, after: true }],
      'no-extra-semi': 'error',
      
      // Minimal rules to avoid overwhelming errors
      'no-unused-vars': 'off',
      'no-undef': 'off', // TypeScript handles this
      'no-console': 'off', // Allow console.log
      'no-debugger': 'warn',
      
      // Basic syntax
      'no-case-declarations': 'warn',
      'comma-dangle': ['warn', 'only-multiline'],
    },
  },
  {
    // Ignore patterns
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'dist/**',
      'build/**',
      '*.config.js',
      '*.config.mjs',
      'test-*/**',
      'scripts/**',
      'add-test-mcp-server.js',
      'supabase/**',
    ],
  },
];