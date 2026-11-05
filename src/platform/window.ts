/** Mac 窗口拖动区域和全屏状态；区域随网页布局更新，避开所有可交互控件。 */
import { closeFloatingMenus } from '../ui/menus.js';

let nativeFullScreen = false;
let lastDragPayload = '';

function windowBridge() {
  return window.webkit?.messageHandlers?.plannerWindow;
}

export function updateNativeWindowAppearance(theme: string) {
  windowBridge()?.postMessage({ action: 'setAppearance', dark: theme === 'dark' });
}

function renderFullScreenButton() {
  const button = document.querySelector<HTMLButtonElement>('#settingsFullScreenButton');
  if (!button) return;
  button.hidden = !windowBridge() && !document.fullscreenEnabled;
  const active = windowBridge() ? nativeFullScreen : !!document.fullscreenElement;
  button.textContent = active ? '退出全屏' : '进入全屏';
  button.setAttribute('aria-pressed', String(active));
}

export function updateWindowDragRegions() {
  const bridge = windowBridge();
  if (!bridge) return;
  const rectOf = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  };
  const regions = [];
  for (const selector of ['.planner-header', '.window-toolbar']) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const rect = rectOf(element);
    // 从窗口上边缘到顶栏底部，包括日期标题及顶栏的上下留白。
    regions.push({
      x: selector === '.planner-header' ? 0 : rect.x,
      y: 0,
      width: selector === '.planner-header' ? window.innerWidth : rect.width,
      height: rect.y + rect.height,
    });
  }
  const blocked = Array.from(
    document.querySelectorAll(
      'button, input, select, textarea, a, summary, [role="button"], [role="separator"], [contenteditable="true"], .context-menu, .theme-menu, .search-results, dialog[open]',
    ),
  )
    .filter((element) => !element.closest('[hidden]'))
    .map(rectOf)
    .filter((rect) => rect.width > 0 && rect.height > 0);
  const detailPanel = document.querySelector('.detail-panel');
  if (detailPanel && getComputedStyle(detailPanel).position === 'fixed') {
    const rect = rectOf(detailPanel);
    if (rect.width > 0 && rect.height > 0) blocked.push(rect);
  }
  if (document.querySelector('dialog[open]')) {
    blocked.push({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
  }
  const payload = { action: 'updateDragRegions', regions, blocked };
  const serialized = JSON.stringify(payload);
  if (serialized === lastDragPayload) return;
  lastDragPayload = serialized;
  bridge.postMessage(payload);
}

export function initializeWindowControls(theme: string) {
  document.querySelector('#settingsFullScreenButton')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    closeFloatingMenus();
    try {
      const bridge = windowBridge();
      if (bridge) bridge.postMessage({ action: 'toggleFullScreen' });
      else if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      alert('暂时无法切换全屏，请重试');
    }
    document.querySelector<HTMLButtonElement>('#settingsButton')?.focus();
  });
  window.addEventListener('planner-window-state', (event: CustomEvent<{ fullScreen: boolean }>) => {
    nativeFullScreen = event.detail.fullScreen;
    document.body.classList.toggle('macos-fullscreen', nativeFullScreen);
    renderFullScreenButton();
  });
  document.addEventListener('fullscreenchange', renderFullScreenButton);
  renderFullScreenButton();

  const bridge = windowBridge();
  if (!bridge) return;
  document.body.classList.add('macos-app');
  updateNativeWindowAppearance(theme);
  bridge.postMessage({ action: 'getState' });
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      updateWindowDragRegions();
    });
  };
  const resize = new ResizeObserver(schedule);
  for (const selector of ['.app-shell', '.planner-header', '.window-toolbar']) {
    const element = document.querySelector(selector);
    if (element) resize.observe(element);
  }
  new MutationObserver(schedule).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'open'],
  });
  window.addEventListener('resize', schedule);
  document.addEventListener('scroll', schedule, true);
  updateWindowDragRegions();
}
