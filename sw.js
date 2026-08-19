// CET-6 Quiz Service Worker — offline support (PWA)
// v4: 例句切分修复(英文撇号 U+2019 被误当中文引号边界)+7条截断例句数据修正;升级版本号强制旧缓存失效
var CACHE_NAME = 'cet6-cihui-shuati-v4';
var ASSETS = [
  './cet6_quiz.html',
  './manifest.json',
  './data/full-words.js',
  './data/unit-maps.js',
  './data/core-words.js',
  './word-maps-viewer.html',
  './word-maps-viewer-offline.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  var url = e.request.url;
  var isDoc = e.request.destination === 'document';
  // 文档与词库数据（data/*.js）走 network-first：保证拿到最新版，离线时回退缓存
  // 词库数据更新频繁（发音/词表修正），避免用户刷新后仍命中旧缓存
  var isData = url.indexOf('/data/') !== -1;
  if (isDoc || isData) {
    e.respondWith(
      fetch(e.request).then(function(response) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone); });
        return response;
      }).catch(function() {
        return caches.match(e.request).then(function(cached) {
          if (cached) return cached;
          if (isDoc) return caches.match('./cet6_quiz.html');
          return Response.error();
        });
      })
    );
    return;
  }
  // 其他静态资源走 cache-first
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request).then(function(response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone); });
        }
        return response;
      });
    })
  );
});
