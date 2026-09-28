import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const FAKE_MIC_WAV = path.resolve(import.meta.dirname, 'tests/fixtures/speech.wav');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'qa/playwright-report.json' }]],
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:4321',
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: '/opt/pw-browsers/chromium',
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--auto-select-desktop-capture-source=Entire screen',
            `--use-file-for-fake-audio-capture=${FAKE_MIC_WAV}`,
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
  ],
});
