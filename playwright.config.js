const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:43210',
    headless: true
  },
  webServer: {
    command: 'node test/e2e-server.js',
    url: 'http://127.0.0.1:43210',
    reuseExistingServer: false,
    timeout: 15_000
  }
});
