import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { renderServiceWorker } from './pwa-service-worker.mjs';

const dist = new URL('../dist/', import.meta.url);
const allowedExtensions = /\.(?:js|css|png|svg|webp|woff2?)$/i;

async function list(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) files.push(...await list(new URL(`${relative}/`, dist), `${relative}/`));
    else if (allowedExtensions.test(entry.name)) files.push(`/${relative.replaceAll('\\', '/')}`);
  }
  return files;
}

const resources = ['/index.html', '/manifest.webmanifest', ...await list(new URL('assets/', dist), 'assets/'), ...await list(new URL('icons/', dist), 'icons/')];
const hash = createHash('sha256');
for (const resource of resources.sort()) {
  hash.update(resource);
  hash.update(await readFile(new URL(resource.slice(1), dist)));
}
const version = hash.digest('hex').slice(0, 16);
await writeFile(new URL('sw.js', dist), renderServiceWorker({ version, resources }), 'utf8');
console.log(`Service worker generado: ${version} · ${resources.length} recursos seguros`);
