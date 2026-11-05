/**
 * 文件用途：浏览器与 Mac 数据文件适配。
 * 统一新建、打开、保存、备份及自动保存；在原生消息桥和浏览器文件接口之间选择可用实现，并维护文件句柄。
 */
import type { AppleSnapshot } from '../types/model.js';
import type { NativeResponse } from '../types/platform.js';
import { closeFloatingMenus, positionViewportMenu } from '../ui/menus.js';
import { runtime } from '../app/runtime.js';
import {
  DATA_FILE_NAME,
  FILE_HANDLE_DB_NAME,
  FILE_HANDLE_KEY,
  FILE_HANDLE_STORE,
  STORAGE_KEY,
} from '../app/config.js';
import { defaultState } from '../app/default-state.js';
import {
  applyUiPrefs,
  createSafetyBackup,
  normalizeState,
  persistLocalState,
  saveAndRender,
} from '../app/persistence.js';
import { refreshStatusSummary, userErrorMessage } from '../ui/status.js';
import { structuredCloneSafe } from '../domain/clone.js';
import { captureEditorDraft } from '../ui/drafts.js';
import { render } from '../ui/render.js';

export function openFileContextMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  closeFloatingMenus();
  renderFileConnectionStatus();
  document.body.append(runtime.els.fileContextMenu);
  const rect = runtime.els.filePanelButton.getBoundingClientRect();
  runtime.els.fileContextMenu.hidden = false;
  positionViewportMenu(runtime.els.fileContextMenu, rect.right + 8, rect.top);
}

export function hasNativeFileBridge() {
  return !!window.webkit?.messageHandlers?.plannerFile;
}

export function callNativeFile(
  action: 'readAppleChanges' | 'applyAppleChanges',
  payload?: Record<string, unknown>,
): Promise<NativeResponse & AppleSnapshot>;
export function callNativeFile(
  action: string,
  payload?: Record<string, unknown>,
): Promise<NativeResponse>;
export function callNativeFile(action: string, payload: Record<string, unknown> = {}) {
  return new Promise<NativeResponse>((resolve, reject) => {
    if (!hasNativeFileBridge()) {
      reject(new Error('原生文件桥不可用'));
      return;
    }
    const id = `file-${Date.now()}-${(runtime.nativeFileRequestId += 1)}`;
    const timer = window.setTimeout(() => {
      if (!runtime.nativeFileRequests.has(id)) return;
      runtime.nativeFileRequests.delete(id);
      reject(new Error('系统操作超时，请检查权限窗口后重试'));
    }, 120000);
    runtime.nativeFileRequests.set(id, { resolve, reject, timer });
    window.webkit.messageHandlers.plannerFile.postMessage({ id, action, ...payload });
  });
}

export async function initializeDataFileConnection() {
  renderFileConnectionStatus('正在连接数据文件...');
  if (hasNativeFileBridge()) {
    try {
      const result = await callNativeFile('restore');
      if (result?.text) {
        const fileState = JSON.parse(result.text);
        if (
          runtime.state.dataUpdatedAt &&
          runtime.state.dataUpdatedAt > (fileState.dataUpdatedAt || '') &&
          runtime.state.dataFileIdentity === result.path
        ) {
          runtime.nativeDataFilePath = result.path;
          runtime.nativeDataFileName = result.name || DATA_FILE_NAME;
          await callNativeFile('backup', { text: result.text });
          scheduleAutoSaveDataFile();
          return;
        }
        await loadDataFileText(result.text, result.name || DATA_FILE_NAME, null, {
          pushUndo: false,
          nativePath: result.path || '',
        });
        return;
      }
    } catch (error) {
      renderFileConnectionStatus(`数据文件恢复失败：${error.message}，同步已暂停`);
      throw error;
    }
    renderFileConnectionStatus();
    return;
  }
  await restoreDataFileHandle();
  renderFileConnectionStatus();
}

export async function newDataFile() {
  if (runtime.appleSyncInFlight) {
    alert('正在同步，请稍后新建文件');
    return;
  }
  closeFloatingMenus();
  if (!confirm('新建日程文件会替换当前列表，原来的日程会先备份。继续吗？')) return;
  try {
    await createSafetyBackup();
  } catch (error) {
    alert(userErrorMessage(error, '备份暂未完成，原来的日程已保留'));
    return;
  }
  if (runtime.appleSyncInFlight) {
    alert('正在同步，请稍后新建文件');
    return;
  }
  runtime.undoStack.length = 0;
  runtime.dataFileHandle = null;
  runtime.dataFileName = DATA_FILE_NAME;
  runtime.nativeDataFileName = '';
  runtime.nativeDataFilePath = '';
  rememberDataFileHandle(null);
  renderFileConnectionStatus();
  runtime.state = normalizeState(
    applyUiPrefs({
      ...defaultState,
      events: [],
      sources: structuredCloneSafe(defaultState.sources),
      tags: [],
    }),
  );
  runtime.selectedEventIds.clear();
  saveAndRender({ preserveScroll: true });
  saveDataFile();
}

export async function openDataFile() {
  if (runtime.appleSyncInFlight) {
    alert('正在同步，请稍后打开文件');
    return;
  }
  closeFloatingMenus();
  if (hasNativeFileBridge()) {
    try {
      const result = await callNativeFile('open');
      if (!result?.text) return;
      await loadDataFileText(result.text, result.name || DATA_FILE_NAME, null, {
        nativePath: result.path || '',
      });
      return;
    } catch (error) {
      alert(userErrorMessage(error, '文件未能打开，请重新选择'));
      return;
    }
  }
  if ('showOpenFilePicker' in window) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: '日历数据', accept: { 'application/json': ['.json'] } }],
        multiple: false,
      });
      const file = await handle.getFile();
      await loadDataFileText(await file.text(), file.name, handle);
      return;
    } catch (error) {
      if (error?.name !== 'AbortError') alert(userErrorMessage(error, '文件未能打开，请重新选择'));
      return;
    }
  }
  runtime.els.dataFileInput.value = '';
  runtime.els.dataFileInput.click();
}

export async function handleDataFileInput(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await loadDataFileText(await file.text(), file.name, null);
  } catch (error) {
    alert(userErrorMessage(error, '文件未能打开，请选择日程备份'));
  } finally {
    event.target.value = '';
  }
}

/** 解析并校验文件内容后切换当前文档；切换文档同时处理草稿、撤销历史及同步状态，避免把旧文件的操作带到新文件。 */
export async function loadDataFileText(
  text,
  name = DATA_FILE_NAME,
  handle: FileSystemFileHandle | null = null,
  options: { pushUndo?: boolean; nativePath?: string } = {},
) {
  if (runtime.appleSyncInFlight) throw new Error('正在同步，请稍后再打开文件');
  captureEditorDraft();
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.events) || !Array.isArray(parsed.sources))
    throw new Error('缺少有效的日程或日历列表');
  if (localStorage.getItem(STORAGE_KEY)) await createSafetyBackup();
  // 不同文档不共享撤销历史；整份文件的恢复通过备份完成。
  runtime.undoStack.length = 0;
  runtime.isLoadingDataFile = true;
  runtime.state = normalizeState(applyUiPrefs(parsed));
  if (options.pushUndo !== false) {
    // 主动恢复备份后将远端差异交给冲突确认，避免同步静默抵消恢复操作。
    runtime.state.appleSync = {
      baseline: {},
      conflicts: [],
      trash: runtime.state.appleSync?.trash || [],
    };
    runtime.state.dataUpdatedAt = new Date().toISOString();
  }
  runtime.dataFileHandle = handle;
  runtime.dataFileName = name || DATA_FILE_NAME;
  runtime.nativeDataFileName = options.nativePath ? runtime.dataFileName : '';
  runtime.nativeDataFilePath = options.nativePath || '';
  runtime.state.dataFileIdentity = runtime.nativeDataFilePath;
  runtime.stateRevision += 1;
  if (handle) await rememberDataFileHandle(handle);
  runtime.selectedEventIds.clear();
  persistLocalState();
  render({ preserveScroll: true });
  renderFileConnectionStatus();
  runtime.isLoadingDataFile = false;
}

/** 按可用能力选择原生保存、浏览器文件句柄或下载。silent 用于自动保存，keepMenus 控制交互菜单是否保留。 */
export async function saveDataFile(options: { silent?: boolean; keepMenus?: boolean } = {}) {
  const { silent = false, keepMenus = false } = options;
  if (!keepMenus) closeFloatingMenus();
  const text = serializeDataFile();
  if (hasNativeFileBridge()) {
    if (silent && !runtime.nativeDataFilePath) return;
    try {
      const result = await callNativeFile('save', {
        text,
        path: runtime.nativeDataFilePath,
        suggestedName: runtime.nativeDataFileName || runtime.dataFileName || DATA_FILE_NAME,
      });
      if (result?.name || result?.path) {
        runtime.dataFileHandle = null;
        runtime.dataFileName = result.name || runtime.dataFileName || DATA_FILE_NAME;
        runtime.nativeDataFileName = runtime.dataFileName;
        runtime.nativeDataFilePath = result.path || runtime.nativeDataFilePath;
        runtime.state.dataFileIdentity = runtime.nativeDataFilePath;
        persistLocalState();
        renderFileConnectionStatus();
      }
      return;
    } catch (error) {
      if (silent) throw error;
      alert(userErrorMessage(error, '暂时未能保存，请重新选择保存位置'));
      return;
    }
  }
  if (
    runtime.dataFileHandle &&
    (await verifyFilePermission(runtime.dataFileHandle, true, !silent))
  ) {
    try {
      await writeDataFileHandle(runtime.dataFileHandle, text);
      await rememberDataFileHandle(runtime.dataFileHandle);
      renderFileConnectionStatus();
      return;
    } catch (error) {
      if (silent) throw error;
      alert('暂时无法保存到原位置，将为你下载一份备份');
    }
  }
  if (silent) throw new Error('文件写入权限不可用，请重新打开数据文件');
  if ('showSaveFilePicker' in window) {
    try {
      runtime.dataFileHandle = await window.showSaveFilePicker({
        suggestedName: runtime.dataFileName || DATA_FILE_NAME,
        types: [{ description: '日历数据', accept: { 'application/json': ['.json'] } }],
      });
      runtime.dataFileName = runtime.dataFileHandle.name || DATA_FILE_NAME;
      await writeDataFileHandle(runtime.dataFileHandle, text);
      await rememberDataFileHandle(runtime.dataFileHandle);
      renderFileConnectionStatus();
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
      alert('暂时无法保存到原位置，将为你下载一份备份');
    }
  }
  downloadDataFile(text);
  renderFileConnectionStatus('已下载备份，未连接自动保存文件');
}

export function serializeDataFile() {
  return `${JSON.stringify(normalizeState(runtime.state), null, 2)}\n`;
}

export async function writeDataFileHandle(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

export async function rememberDataFileHandle(handle) {
  if (!('indexedDB' in window)) return;
  try {
    const db = await openFileHandleDb();
    const tx = db.transaction(FILE_HANDLE_STORE, 'readwrite');
    const done = waitForTransaction(tx);
    if (handle)
      tx.objectStore(FILE_HANDLE_STORE).put(
        { handle, name: handle.name || DATA_FILE_NAME },
        FILE_HANDLE_KEY,
      );
    else tx.objectStore(FILE_HANDLE_STORE).delete(FILE_HANDLE_KEY);
    await done;
    db.close();
  } catch {
    // 文件句柄仅用于恢复连接；记忆句柄失败时仍保留 localStorage 中的日程数据。
  }
}

export async function restoreDataFileHandle() {
  if (!('indexedDB' in window)) return;
  try {
    const db = await openFileHandleDb();
    const tx = db.transaction(FILE_HANDLE_STORE, 'readonly');
    const done = waitForTransaction(tx);
    const record = await idbRequest(tx.objectStore(FILE_HANDLE_STORE).get(FILE_HANDLE_KEY));
    await done;
    db.close();
    if (!record?.handle) return;
    runtime.dataFileHandle = record.handle;
    runtime.dataFileName = record.name || record.handle.name || DATA_FILE_NAME;
    if (!(await verifyFilePermission(runtime.dataFileHandle, false, false))) {
      renderFileConnectionStatus(`需要重新打开：${runtime.dataFileName}`);
      return;
    }
    const file = await runtime.dataFileHandle.getFile();
    await loadDataFileText(await file.text(), file.name, runtime.dataFileHandle, {
      pushUndo: false,
    });
  } catch {
    runtime.dataFileHandle = null;
    renderFileConnectionStatus('未连接文件');
  }
}

export function renderFileConnectionStatus(message = '') {
  if (!runtime.els.fileStatus) return;
  const text = message || runtime.persistenceError;
  let label = '仅保存在此设备',
    tone = 'quiet';
  if (/失败|权限|重新打开/.test(text)) {
    label = '保存需要处理，请重新打开日程文件';
    tone = 'attention';
  } else if (/下载/.test(text)) label = '备份已下载';
  else if (/正在|等待/.test(text)) {
    label = '正在保存…';
    tone = 'busy';
  } else if (/已保存/.test(text)) {
    label = '更改已保存';
    tone = 'ready';
  } else if (runtime.nativeDataFileName || runtime.dataFileHandle) {
    label = '自动保存已开启';
    tone = 'ready';
  }
  runtime.els.fileStatus.textContent = label;
  runtime.els.fileStatus.dataset.tone = tone;
  refreshStatusSummary();
}

export function openFileHandleDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(FILE_HANDLE_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(FILE_HANDLE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function waitForTransaction(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function scheduleAutoSaveDataFile() {
  if (runtime.isLoadingDataFile || !hasConnectedDataFile()) return;
  window.clearTimeout(runtime.autoSaveTimer);
  renderFileConnectionStatus('等待保存…');
  runtime.autoSaveTimer = window.setTimeout(() => {
    runtime.autoSaveTimer = null;
    flushAutoSaveDataFile();
  }, 650);
}

/** 同一时刻只允许一次自动保存；保存期间的新请求标记为待处理，在本轮结束后继续调度，避免并发写入同一文件。 */
export async function flushAutoSaveDataFile() {
  if (!hasConnectedDataFile()) return;
  if (runtime.autoSaveInFlight) {
    runtime.pendingAutoSave = true;
    return;
  }
  runtime.autoSaveInFlight = true;
  runtime.pendingAutoSave = false;
  try {
    renderFileConnectionStatus('正在保存…');
    await saveDataFile({ silent: true, keepMenus: true });
    runtime.persistenceError = '';
    renderFileConnectionStatus(`已保存 · ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    runtime.persistenceError = `保存失败：${error.message}（本地修改待保存）`;
    renderFileConnectionStatus();
    runtime.autoSaveTimer = window.setTimeout(() => {
      runtime.autoSaveTimer = null;
      flushAutoSaveDataFile();
    }, 10000);
  } finally {
    runtime.autoSaveInFlight = false;
    if (runtime.pendingAutoSave) scheduleAutoSaveDataFile();
  }
}

export function hasConnectedDataFile() {
  return !!runtime.dataFileHandle || !!runtime.nativeDataFilePath;
}

export async function verifyFilePermission(handle, write = false, request = true) {
  const options = { mode: write ? 'readwrite' : 'read' };
  if ((await handle.queryPermission(options)) === 'granted') return true;
  if (!request) return false;
  return (await handle.requestPermission(options)) === 'granted';
}

export function downloadDataFile(text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = runtime.dataFileName || DATA_FILE_NAME;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
