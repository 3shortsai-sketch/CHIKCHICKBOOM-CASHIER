import { readdirSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Writes dist/sw.js with the exact list of built files, so that after the
 * first visit every screen opens with no internet.
 */
/** Food photos in public/menu, saved for offline use with everything else. */
const MENU_PHOTOS = readdirSync(new URL('./public/menu', import.meta.url), { withFileTypes: true }).filter((f) => f.isFile()).map((f) => f.name).filter((f) => /\.(webp|jpe?g|png)$/i.test(f)).map((f) => './menu/' + f);

/** This build's id: baked into the app and written to version.json, so open devices can tell a newer version is live. */
const BUILD_ID = Date.now().toString(36);

function offlineServiceWorker(): Plugin {
  return {
    name: 'ccb-offline-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const precache = ['./', ...files.map((f) => './' + f), './manifest.webmanifest', './icon-192.png', './logo.png', './logo-small.png', './gcash-qr.jpg', './track-qr.png', ...MENU_PHOTOS];
      const version = BUILD_ID;
      const source = `// Generated at build time. Do not edit.
const CACHE = 'ccb-pos-${version}';
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ccb-pos-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Fresh page when online, saved page when offline or when the wifi is
    // connected but dead (no answer in 4 seconds). The saved page is the one
    // installed together with this version's files, so they always match.
    const saved = () => caches.match('./', { ignoreVary: true });
    event.respondWith(
      new Promise((resolve) => {
        const timer = setTimeout(() => saved().then((hit) => hit && resolve(hit)), 4000);
        fetch(req)
          .then((res) => { clearTimeout(timer); if (res.ok) resolve(res); else saved().then((hit) => resolve(hit || res)); })
          .catch(() => { clearTimeout(timer); saved().then((hit) => resolve(hit || Response.error())); });
      })
    );
    return;
  }
  // ignoreVary: servers often add 'Vary: Origin', which would stop the saved files matching.
  event.respondWith(caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req)));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), offlineServiceWorker()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  test: {
    environment: 'node',
  },
});
