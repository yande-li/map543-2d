import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

async function bundleEntry(input, outFile, external = []) {
  const bundle = await rolldown({
    input: resolve(rootDir, input),
    external,
  });
  await bundle.write({
    file: resolve(rootDir, outFile),
    format: 'esm',
    minify: true,
  });
  await bundle.close();
}

await bundleEntry('index.ts', 'dist/index.js', [/^react($|\/)/]);
await bundleEntry('core.ts', 'dist/core.js');

const wasmSrc = resolve(rootDir, 'wasm/kernels.wasm');
mkdirSync(resolve(rootDir, 'dist/wasm'), { recursive: true });
copyFileSync(wasmSrc, resolve(rootDir, 'dist/kernels.wasm'));
copyFileSync(wasmSrc, resolve(rootDir, 'dist/wasm/kernels.wasm'));

console.log('[build-bundle] Bundled dist/index.js and dist/core.js');
