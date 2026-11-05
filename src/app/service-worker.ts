/**
 * 文件用途：离线服务注册入口。
 * 在支持条件满足时注册生成的 sw.js；缓存安装、更新与离线响应策略由 src/service-worker.ts 实现。
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(window.location.protocol)) return;
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('./sw.js').catch(() => {}),
  );
}
