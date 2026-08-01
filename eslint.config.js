module.exports = [
  {
    ignores: ['node_modules/**', 'test-results/**', 'playwright-report/**']
  },
  {
    files: [
      'server.js',
      'scripts/*.js',
      'test/**/*.js',
      'playwright.config.js',
      'playwright.docs.config.js',
      'eslint.config.js'
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        Buffer: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        module: 'readonly',
        process: 'readonly',
        require: 'readonly',
        sessionStorage: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        __dirname: 'readonly'
      }
    },
    rules: {
      'no-dupe-keys': 'error',
      'no-redeclare': 'error',
      'no-undef': 'error',
      'no-unreachable': 'error'
    }
  },
  {
    files: ['script.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        Blob: 'readonly',
        Event: 'readonly',
        FileReader: 'readonly',
        Map: 'readonly',
        ResizeObserver: 'readonly',
        Set: 'readonly',
        URL: 'readonly',
        alert: 'readonly',
        cancelAnimationFrame: 'readonly',
        confirm: 'readonly',
        console: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        prompt: 'readonly',
        requestAnimationFrame: 'readonly',
        sessionStorage: 'readonly',
        setTimeout: 'readonly',
        window: 'readonly'
      }
    },
    rules: {
      'no-dupe-keys': 'error',
      'no-redeclare': 'error',
      'no-undef': 'error',
      'no-unreachable': 'error'
    }
  }
];
