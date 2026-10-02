import { mkdir, readdir, copyFile } from 'node:fs/promises';
await mkdir('public/runtime', { recursive: true });
const source = 'node_modules/onnxruntime-web/dist';
for (const name of await readdir(source)) {
  if (/^ort-wasm-simd-threaded\.(wasm|mjs)$/.test(name))
    await copyFile(`${source}/${name}`, `public/runtime/${name}`);
}
