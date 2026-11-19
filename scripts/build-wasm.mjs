import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import wabtFactory from 'wabt';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const inputWatPath = resolve(rootDir, 'wasm/kernels.wat');
const outWasmPath = resolve(rootDir, 'wasm/kernels.wasm');

mkdirSync(dirname(outWasmPath), { recursive: true });

const wabt = await wabtFactory();
const watSource = readFileSync(inputWatPath, 'utf8');
const parsed = wabt.parseWat(inputWatPath, watSource);
const { buffer } = parsed.toBinary({ log: false, write_debug_names: false });
parsed.destroy();

writeFileSync(outWasmPath, buffer);
console.log(
  `[build-wasm] Compiled ${inputWatPath} -> ${outWasmPath} (${buffer.byteLength} bytes)`
);
