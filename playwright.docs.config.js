const path = require('node:path');
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test/docs',
  timeout: 60_000,
  workers: 1,
  reporter: 'line',
  outputDir: path.join(__dirname, 'test-results', 'docs'),
  use: {
    baseURL: 'http://127.0.0.1:43211',
    headless: true,
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    reducedMotion: 'reduce'
  },
  webServer: {
    command: 'PORT=43211 node test/e2e-server.js',
    url: 'http://127.0.0.1:43211',
    reuseExistingServer: false,
    timeout: 15_000
  }
});
