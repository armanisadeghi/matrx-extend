import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@gen': path.resolve(__dirname, './types/python-generated'),
      // TEMPORARY (campaign lane W6-EXT) — see the note in wxt.config.ts.
      // THE SWAP: "@ai-matrx/records": "latest" in package.json, these gone.
      '@ai-matrx/records/core': path.resolve(
        __dirname,
        '../aidream/apps/shared/records/src/core/index.ts',
      ),
      '@ai-matrx/records': path.resolve(__dirname, '../aidream/apps/shared/records/src/index.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
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
