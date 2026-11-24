import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { rolldown } from 'rolldown';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const wasmBuf = readFileSync(resolve(rootDir, 'wasm/kernels.wasm'));
const define = { __WASM_BASE64__: JSON.stringify(wasmBuf.toString('base64')) };

async function bundleEntry(input, outFile, external) {
  const bundle = await rolldown({
    input: resolve(rootDir, input),
    external,
    treeshake: true,
    transform: { define },
  });
  const { output } = await bundle.write({
    file: resolve(rootDir, outFile),
    format: 'esm',
    minify: true,
  });
  await bundle.close();
  const buf = Buffer.from(output[0].code);
  return { outFile, raw: buf.byteLength, gz: gzipSync(buf).byteLength };
}

const REACT_EXTERNALS = [/^react($|\/)/, /^react-dom($|\/)/];

const results = await Promise.all([
  bundleEntry('index.ts', 'dist/index.js', REACT_EXTERNALS),
  bundleEntry('core.ts', 'dist/core.js', []),
  bundleEntry('cruise.ts', 'dist/cruise.js', []),
  bundleEntry('cruise-react.ts', 'dist/cruise-react.js', REACT_EXTERNALS),
]);

writeFileSync(resolve(rootDir, 'dist/kernels.wasm'), wasmBuf);
results.push({
  outFile: 'dist/kernels.wasm',
  raw: wasmBuf.byteLength,
  gz: gzipSync(wasmBuf).byteLength,
});

for (const { outFile, raw, gz } of results) {
  console.log(`[build-bundle] ${outFile}: ${raw} B (gzip: ${gz} B)`);
}
