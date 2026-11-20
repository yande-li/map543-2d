import { copyFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { rolldown } from 'rolldown';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

async function bundleEntry(input, outFile, external = []) {
  const bundle = await rolldown({
    input: resolve(rootDir, input),
    external,
    treeshake: true,
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
copyFileSync(wasmSrc, resolve(rootDir, 'dist/kernels.wasm'));

for (const rel of ['dist/index.js', 'dist/core.js', 'dist/kernels.wasm']) {
  const buf = readFileSync(resolve(rootDir, rel));
  const gz = gzipSync(buf);
  console.log(
    `[build-bundle] ${rel}: ${buf.byteLength} B (gzip: ${gz.byteLength} B)`
  );
}
