import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // runs once before the tests, so they see the same settings as the app
    setupFiles: ['test/setup.ts'],
  },
});
