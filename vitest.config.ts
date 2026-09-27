import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@gen': path.resolve(__dirname, './types/python-generated'),
    },
  },
  test: {
    environment: 'happy-dom',
    // Budgets for a BUSY machine, not an idle one. The release runs this suite while
    // ship-all builds several repos at once; at Vitest's 5s default, tests that render
    // the whole app or spawn a process timed out, and their leftover timers then failed
    // the next test in the file. A hung test still fails; it just gets 30s to prove it.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
    exclude: ['tests/e2e/**', 'node_modules', '.output', '.wxt'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/components/ui/**'],
    },
  },
});
