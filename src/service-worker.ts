/// <reference lib="webworker" />
/**
 * 文件用途：离线应用资源缓存。
 * 安装时缓存应用外壳，激活时清理旧缓存；同源 GET 请求优先联网，失败时尝试缓存与首页回退。
 */
const worker = self as unknown as ServiceWorkerGlobalScope;
declare const __BUILD_VERSION__: string;
const CACHE_NAME = `daily-planner-${__BUILD_VERSION__}`;
const APP_SHELL = [
  './',
  './index.html',
  './build/app.css',
  './build/app.js',
  './manifest.webmanifest',
  './assets/icons/AppIcon.png',
];

worker.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  worker.skipWaiting();
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => worker.clients.claim()),
  );
});

worker.addEventListener('fetch', (event) => {
  if (
    event.request.method !== 'GET' ||
    new URL(event.request.url).origin !== worker.location.origin
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match('./index.html')),
      ),
  );
});
