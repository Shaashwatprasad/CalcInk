import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const results = await Promise.all(
    entries.map((e) =>
      e.isDirectory() ? walk(`${path}/${e.name}`) : `${path}/${e.name}`,
    ),
  );
  return results.flat();
}
const files = (await walk('dist'))
  .filter((f) => !f.endsWith('/sw.js') && !f.endsWith('/offline-manifest.json'))
  .sort();
const hash = createHash('sha256');
const entries = [];
for (const file of files) {
  const content = await readFile(file);
  const digest = createHash('sha256').update(content).digest('hex');
  hash.update(`${file}:${digest}`);
  entries.push({ path: file.slice(5), sha256: digest, bytes: content.length });
}
const version = hash.digest('hex').slice(0, 16);
await writeFile(
  'dist/offline-manifest.json',
  JSON.stringify({ version, entries }, null, 2),
);
await writeFile(
  'dist/sw.js',
  `const CACHE = 'calcink-${version}';
const FILES = ${JSON.stringify(entries.map((e) => e.path))};
const base = self.registration.scope;
const urls = FILES.map(p => new URL(p, base).href);
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  try { await cache.addAll(urls); } catch (error) { await caches.delete(CACHE); throw error; }
})()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(base)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const exact = await cache.match(event.request, { ignoreSearch: true });
    if (exact) return exact;
    if (event.request.mode === 'navigate') return (await cache.match(new URL('index.html', base).href)) || fetch(event.request);
    return fetch(event.request);
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'VERIFY_CACHE') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const matches = await Promise.all(urls.map(url => cache.match(url)));
    event.ports[0]?.postMessage({ type: 'CACHE_VERIFIED', complete: matches.every(Boolean), version: CACHE });
  })());
});
`,
);
console.log(`Offline cache ${version}: ${entries.length} same-origin assets`);
