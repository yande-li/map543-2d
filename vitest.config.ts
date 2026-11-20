/// <reference types="vitest" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const wasmBase64 = readFileSync(
  path.resolve(import.meta.dirname, './wasm/kernels.wasm')
).toString('base64');

export default defineConfig({
  define: {
    __WASM_BASE64__: JSON.stringify(wasmBase64),
  },
  resolve: {
    alias: {
      'map543-2d/core': path.resolve(import.meta.dirname, './core.ts'),
      'map543-2d': path.resolve(import.meta.dirname, './index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['**/*.test.{ts,tsx}'],
  },
});
