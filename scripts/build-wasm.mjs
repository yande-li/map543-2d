import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import wabtFactory from 'wabt';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const inputWatPath = resolve(rootDir, 'wasm/kernels.wat');
const outWasmPath = resolve(rootDir, 'wasm/kernels.wasm');

const wabt = await wabtFactory();
const parsed = wabt.parseWat(inputWatPath, readFileSync(inputWatPath, 'utf8'));
const { buffer } = parsed.toBinary({ log: false, write_debug_names: false });
parsed.destroy();

writeFileSync(outWasmPath, buffer);
console.log(
  `[build-wasm] Compiled ${inputWatPath} -> ${outWasmPath} (${buffer.byteLength} bytes)`
);
