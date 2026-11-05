/**
 * 文件用途：应用启动与生命周期。
 * 恢复本地数据和草稿后绑定界面、渲染首屏；连接数据文件完成后启用 Apple 同步，并注册离开页面保护。
 */
import { runtime } from './runtime.js';
import { bindEvents } from './events.js';
import { render } from '../ui/render.js';
import { initializeDataFileConnection, renderFileConnectionStatus } from '../platform/files.js';
import { runAppleCalendarSync, scheduleAppleCalendarSync } from '../ui/apple-sync.js';
import { captureEditorDraft, hasEditorDraft, loadEditorDrafts } from '../ui/drafts.js';
import { startNowLineUpdates } from '../ui/clock.js';
import { registerServiceWorker } from './service-worker.js';
import { applyUiPrefs, loadState, normalizeState } from './persistence.js';
import { initializeWindowControls } from '../platform/window.js';

/** 原生端按请求 ID 回传结果：先移除待处理请求并清理超时，再兑现或拒绝对应 Promise，迟到回执直接忽略。 */
window.__plannerFileBridgeResolve = (id, response = {}) => {
  const pending = runtime.nativeFileRequests.get(id);
  if (!pending) return;
  runtime.nativeFileRequests.delete(id);
  window.clearTimeout(pending.timer);
  if (response.ok === false)
    pending.reject(
      Object.assign(new Error(response.error || '文件操作失败'), {
        code: response.errorCode || '',
      }),
    );
  else pending.resolve(response);
};

window.__syncPlannerToAppleCalendar = () => runAppleCalendarSync(true);

/** 先恢复正式状态和界面偏好，再恢复独立草稿；这些数据准备完成后才绑定事件并渲染。 */
runtime.state = normalizeState(applyUiPrefs(loadState()));
runtime.eventDrafts = loadEditorDrafts();

runtime.state.archivedOpen = false;
bindEvents();
render();
initializeWindowControls(runtime.state.theme);

/** 等待主数据文件恢复后再允许 Apple 同步，避免用尚未加载的默认文档参与远端合并。 */
initializeDataFileConnection()
  .then(() => {
    runtime.appleSyncReady = true;
    scheduleAppleCalendarSync();
  })
  .catch((error) => renderFileConnectionStatus(`初始化失败：${error.message}`));

window.setInterval(() => runAppleCalendarSync(), 30000);

window.addEventListener('focus', () => runAppleCalendarSync());

window.addEventListener('beforeunload', (event) => {
  captureEditorDraft();
  if (
    hasEditorDraft() ||
    runtime.draftStorageError ||
    runtime.persistenceError ||
    runtime.autoSaveInFlight ||
    runtime.autoSaveTimer ||
    runtime.appleSyncInFlight
  ) {
    event.preventDefault();
    event.returnValue = '';
  }
});

startNowLineUpdates();
registerServiceWorker();
