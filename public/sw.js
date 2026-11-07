/* Daybook service worker: makes the app installable and shows an offline page when there is no network.
   It deliberately caches nothing else. Next.js files under /_next/static are content-hashed and the browser's own
   HTTP cache already keeps them; an extra cache here only added a way to get stuck on a failed copy.
   v4: earlier versions cached /_next/static cache-first and could serve a broken stylesheet forever.
   Activating this version deletes every one of those caches. */
const CACHE = "daybook-offline-v4";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(OFFLINE_URL))
      .catch(() => {}) // never let a missing offline page block the update
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // only page loads; everything else (CSS, JS, images, API) goes straight to the network untouched
  if (req.method !== "GET" || req.mode !== "navigate") return;
  event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error())));
});
