import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const BUDGETS = [
  ['dist/index.js', 90 * 1024],
  ['dist/core.js', 70 * 1024],
  ['dist/cruise.js', 5 * 1024],
  ['dist/cruise-react.js', 6 * 1024],
  ['dist/kernels.wasm', 4096],
];

let failed = false;

if (existsSync(resolve(rootDir, 'dist/wasm/kernels.wasm'))) {
  console.error(
    '[size-check] FAIL: duplicate asset still exists: dist/wasm/kernels.wasm'
  );
  failed = true;
}

for (const [file, maxRawBytes] of BUDGETS) {
  let buf;
  try {
    buf = readFileSync(resolve(rootDir, file));
  } catch {
    console.error(`[size-check] FAIL: missing build artifact: ${file}`);
    failed = true;
    continue;
  }
  const rawBytes = buf.byteLength;
  const gzipBytes = gzipSync(buf).byteLength;
  const ok = rawBytes <= maxRawBytes;
  if (!ok) failed = true;
  console.log(
    `[size-check] ${ok ? 'PASS' : 'FAIL'} ${file}: ${(rawBytes / 1024).toFixed(2)} kB (${rawBytes} B) | gzip: ${(gzipBytes / 1024).toFixed(2)} kB | budget: ${(maxRawBytes / 1024).toFixed(2)} kB`
  );
}

if (failed) process.exit(1);
