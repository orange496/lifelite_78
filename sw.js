/* ==========================================================================
   LifeLite 学习目标看板 — Service Worker
   --------------------------------------------------------------------------
   作用：让应用在 GitHub Pages 等 https 环境下可以离线打开。

   设计要点：
   1. 只缓存应用自身的静态资源（应用外壳），不缓存任何用户数据 ——
      用户数据全部在 localStorage 里，与 SW 无关。
   2. 导航请求用「网络优先」，拿到新版本就更新缓存，断网时回退到缓存的
      index.html；静态资源用「缓存优先」，命中后后台静默更新，刷新一次
      即可拿到新版本，不会出现白屏。
   3. 换了静态资源就要改 CACHE_VERSION，activate 时清理旧缓存。
   4. 本项目同时支持双击 index.html 打开（file://），那时浏览器不会注册
      Service Worker，app.js 做了守卫降级，属预期行为。
   ========================================================================== */

'use strict';

const CACHE_VERSION = 'lifelite-v4';
const CACHE_NAME = CACHE_VERSION;

/* 应用外壳：只要这些文件在，断网也能完整使用 */
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/storage.js',
  './js/profile.js',
  './js/goals.js',
  './js/tasks.js',
  './js/stats.js',
  './js/book.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

/* 安装：预缓存外壳；任何一个文件抓取失败就整体失败，避免留下半套缓存 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          APP_SHELL.map((url) =>
            fetch(url, { cache: 'reload' }).then((response) => {
              if (!response.ok) throw new Error('预缓存失败：' + url);
              return cache.put(url, response);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

/* 激活：清理旧版本缓存，立即接管页面 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('lifelite-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* 网络优先：用于页面导航，保证用户尽快看到新版本 */
function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() =>
      caches.match(request).then((cached) => cached || caches.match('./index.html'))
    );
}

/* 缓存优先 + 后台更新：用于 CSS/JS/图标等静态资源 */
function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) {
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, response));
          }
        })
        .catch(() => {
          /* 离线时后台更新失败是正常的，忽略 */
        });
      return cached;
    }
    return fetch(request).then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    });
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // 只处理同源的 GET 请求；跨域请求（本项目没有）直接放行
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先，断网回退缓存
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // 其余静态资源：缓存优先
  event.respondWith(cacheFirst(request));
});
