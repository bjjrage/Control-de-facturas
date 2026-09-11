import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['lib/**/*.spec.ts', 'lib/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './'),
    },
  },
});
