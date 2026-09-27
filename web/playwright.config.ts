import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', timeout: 45000, fullyParallel: false, workers: 1,
  reporter: [['list']], outputDir: './test-results',
  use: { baseURL: 'http://127.0.0.1:4173', headless: true, launchOptions: { executablePath: process.env.CHROMIUM_PATH, args: process.env.CI_LOW_THREADS ? ['--single-process', '--no-zygote', '--disable-gpu'] : [] } },
  webServer: { command: 'python3 -m http.server 4173 --bind 127.0.0.1 --directory ../dist', url: 'http://127.0.0.1:4173', reuseExistingServer: true, stdout: 'ignore', stderr: 'ignore' },
});
