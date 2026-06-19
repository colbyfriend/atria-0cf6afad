/* Atria Analytics — service worker
   - App shell (HTML, Chart.js, icons) is cached for offline + instant launch.
   - data.json is network-first: fresh data when online, last snapshot when offline. */
const CACHE = "atria-v1";
const SHELL = [
  "./",
  "index.html",
  "chart.umd.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon-512-maskable.png",
  "apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Network-first for the HTML shell and the data snapshot, so code + data updates
  // appear as soon as the device is online; fall back to cache when offline.
  const isData = url.pathname.endsWith("data.json");
  const isHTML = req.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".html");
  if (isData || isHTML) {
    e.respondWith(
      fetch(req)
        .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return r; })
        .catch(() => caches.match(req).then(c => c || caches.match("index.html")))
    );
    return;
  }

  // Cache-first for the static shell (Chart.js, icons, manifest).
  e.respondWith(caches.match(req).then(c => c || fetch(req)));
});
