// Service worker: makes the app installable and usable offline. Pages are
// fetched from the network first (so an update is picked up at the next
// visit) with the cached copy as fallback; hashed assets, fonts and the
// SoundFont are served from the cache once seen. Only same-origin GET
// requests are handled: Google, TinyURL and mailto are never touched.
const CACHE = "gms-v1";
const SHELL = ["./", "./manifest.webmanifest", "./favicon.svg", "./llms.txt"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

const isAsset = url => /\/(assets|font|soundfont)\//.test(url.pathname) || /\.(png|svg|woff2?|css|js|sf2|sf3)$/.test(url.pathname);

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put("./", copy));
      return response;
    }).catch(() => caches.match("./")));
    return;
  }
  if (!isAsset(url)) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  })));
});
