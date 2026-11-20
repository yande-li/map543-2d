import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const BUDGETS = [
  { file: 'dist/index.js', maxRawBytes: 75 * 1024 },
  { file: 'dist/core.js', maxRawBytes: 60 * 1024 },
  { file: 'dist/kernels.wasm', maxRawBytes: 4096 },
];

const FORBIDDEN_DUPLICATES = ['dist/wasm/kernels.wasm'];

let failed = false;

for (const dup of FORBIDDEN_DUPLICATES) {
  if (existsSync(resolve(rootDir, dup))) {
    console.error(`[size-check] FAIL: duplicate asset still exists: ${dup}`);
    failed = true;
  }
}

for (const { file, maxRawBytes } of BUDGETS) {
  const fullPath = resolve(rootDir, file);
  if (!existsSync(fullPath)) {
    console.error(`[size-check] FAIL: missing build artifact: ${file}`);
    failed = true;
    continue;
  }
  const buf = readFileSync(fullPath);
  const rawBytes = statSync(fullPath).size;
  const gzipBytes = gzipSync(buf).byteLength;
  const ok = rawBytes <= maxRawBytes;
  if (!ok) failed = true;
  const status = ok ? 'PASS' : 'FAIL';
  console.log(
    `[size-check] ${status} ${file}: ${(rawBytes / 1024).toFixed(2)} kB (${rawBytes} B) | gzip: ${(gzipBytes / 1024).toFixed(2)} kB | budget: ${(maxRawBytes / 1024).toFixed(2)} kB`
  );
}

if (failed) {
  process.exit(1);
}
