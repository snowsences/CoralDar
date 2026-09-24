'use strict';

// App-shell cache only. Private reef data lives in Firestore's IndexedDB cache, never here.
const SHELL_CACHE = 'coraldar-shell-v10';
const FONT_CACHE = 'coraldar-fonts-v1';
const SHELL = ['./','index.html','styles.css','app.js','manifest.webmanifest','app-icon.png','app-icon-maskable.png',
  'vendor/firebase/12.18.0/firebase-app.js','vendor/firebase/12.18.0/firebase-auth.js','vendor/firebase/12.18.0/firebase-firestore.js'];
const NETWORK_TIMEOUT = 4000;
// Cloudinary photo URLs never change content, so they're cached on first view (cleared on sign-out by the app).
const PHOTO_CACHE = 'coraldar-photos-v1';
const PHOTO_CACHE_MAX = 400;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, {cache:'reload'})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('coraldar-') && k !== SHELL_CACHE && k !== FONT_CACHE && k !== PHOTO_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
        // Cache keys drop query strings so each file has exactly one cache entry.
    const key = url.origin + url.pathname;
    if (url.pathname.includes('/vendor/')) return e.respondWith(cacheFirst(req, key));
    return e.respondWith(networkFirst(req, key));
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') e.respondWith(staleWhileRevalidate(req));
  if (url.hostname === 'res.cloudinary.com') e.respondWith(photoCacheFirst(req));
});

async function cacheFirst(req, key) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(key, res.clone());
  return res;
}

async function networkFirst(req, key) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = () => cache.match(key).then(hit => hit || (req.mode === 'navigate' ? cache.match(new URL('./', self.registration.scope).href) : undefined));
  // no-cache revalidates with the server (cheap 304s) so a deploy shows up on the next load.
  const network = fetch(req, {cache:'no-cache'}).then(res => {
    if (res.ok && res.type === 'basic') cache.put(key, res.clone());
    return res;
  });
  // On a slow connection fall back to the cached copy after a few seconds; with no cached copy, keep waiting.
  const timeout = new Promise(resolve => setTimeout(() => cached().then(hit => hit && resolve(hit)), NETWORK_TIMEOUT));
  try {
    return await Promise.race([network, timeout]);
  } catch (err) {
    const hit = await cached();
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(FONT_CACHE);
  const hit = await cache.match(req);
  // no-cache revalidates with the server (cheap 304s) so a deploy shows up on the next load.
  const network = fetch(req, {cache:'no-cache'}).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; });
  if (hit) { network.catch(() => {}); return hit; }
  return network;
}

async function photoCacheFirst(req) {
  const cache = await caches.open(PHOTO_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - PHOTO_CACHE_MAX))) await cache.delete(old);
  }
  return res;
}
