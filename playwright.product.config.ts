import { defineConfig } from '@playwright/test';
import baseline from './playwright.config';
export default defineConfig({
  ...baseline,
  testDir: 'tests/product',
  grepInvert:
    process.env.CALCINK_PRODUCT_REQUIRED === '1' ? undefined : /@v2-required/,
  use: {
    ...baseline.use,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
