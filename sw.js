// Offline fortress: cache-first same-origin GET, v2.
var CACHE = 'forge-v3';
var CORE = ['.', 'index.html', 'styles.css', 'app.js', 'favicon.svg', 'manifest.webmanifest',
  'engine/compiler.js', 'engine/forge.js', 'engine/warroom.js', 'engine/core.wasm.b64',
  'assets/glitch-name.svg', 'assets/hellfire.svg'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then(function (hit) {
    return hit || fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () { return caches.match('index.html'); });
  }));
});
