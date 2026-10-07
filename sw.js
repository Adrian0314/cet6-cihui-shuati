// CET-6 Quiz Service Worker — offline support (PWA)
// v5: 安装阶段只缓存轻量资源；大词库和页面改为访问时按需缓存，避免微信内置浏览器首次打开长时间转圈
var CACHE_NAME = 'cet6-cihui-shuati-v38';
var ASSETS = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      // 单个轻量资源失败不应阻塞 Service Worker 安装
      return Promise.all(ASSETS.map(function(asset) {
        return cache.add(asset).catch(function() {});
      }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        // 版本升级时清理旧缓存，但要保留离线识别模型（cet6-vosk-*，约 39MB，
        // 否则每次发版用户都要重新下载一次模型）
        keys.filter(function(k) { return k !== CACHE_NAME && k.indexOf('cet6-vosk-') !== 0; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  var url = e.request.url;
  // 离线识别模型（约 39MB）由页面自己用 Cache Storage('cet6-vosk-model-*') 管理：
  // 这里直接放行，避免同一份 39MB 在两处各存一遍，也避免受 SW 版本升级影响。
  if (/vosk\/vosk-model-.*[.]tar[.]gz($|\?)/.test(url)) return;
  var isDoc = e.request.destination === 'document';
  // 文档与词库数据（full-words、core-words、unit-maps.js）走 network-first：保证拿到最新版，离线时回退缓存
  // 词库数据更新频繁（发音/词表修正），避免用户刷新后仍命中旧缓存
  var isData = /(full-words|core-words|unit-maps|pronunciation-audio)[.]js/.test(url);
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
