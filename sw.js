// Service worker minimo: serve solo a rendere il sito installabile come app sul telefono.
// Non mette niente in cache, così allerte e livelli dei fiumi arrivano sempre freschi dalla rete.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  if (e.request.mode === "navigate") e.respondWith(fetch(e.request));
});
