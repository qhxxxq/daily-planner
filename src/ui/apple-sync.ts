/**
 * 文件用途：Apple 同步界面与调度。
 * 检查编辑和文件状态后调用原生快照及写入接口，交由核心模块合并；更新同步状态提示并保护请求期间的新修改。
 */
import { recordSyncFailure, refreshStatusSummary, syncFailureReason } from './status.js';
import {
  callNativeFile,
  hasNativeFileBridge,
  scheduleAutoSaveDataFile,
  serializeDataFile,
} from '../platform/files.js';
import { runtime } from '../app/runtime.js';
import { captureEditorDraft } from './drafts.js';
import * as PlannerAppleSync from '../sync/apple-sync.js';
import { createSafetyBackup, persistLocalState } from '../app/persistence.js';
import { render } from './render.js';
import { renderReminderFields } from './reminders.js';

export function renderAppleSyncStatus(message) {
  const status = document.querySelector<HTMLElement>('#appleSyncStatus');
  if (!status) return;
  let summary = '日历已检查',
    tone = 'ready',
    detail = '已检查电脑日历，其他设备可能稍晚更新。';
  if (/未完成|失败/.test(message)) {
    summary = '同步需要处理';
    tone = 'attention';
    detail = syncFailureReason(
      message.replace(/^Apple 同步未完成：/, '').replace(/（稍后重试）$/, ''),
    );
  } else if (/正在/.test(message)) {
    summary = '正在同步…';
    tone = 'busy';
    detail = '正在检查日历更新…';
  } else if (/操作结束/.test(message)) {
    summary = '等待操作完成';
    detail = '操作完成后会继续同步。';
  } else {
    const time = message.match(/已检查 · ([^\n]+)/)?.[1];
    if (time) detail = `上次检查 ${time}。其他设备可能稍晚更新。`;
    const drafts = message.match(/(\d+) 项草稿/)?.[1];
    const conflicts = message.match(/(\d+) 项冲突/)?.[1];
    const duplicates = message.match(/(\d+) 项重复日程待处理/)?.[1];
    const skipped = message.match(/(\d+) 项日程暂缓同步/)?.[1];
    if (drafts) detail += `\n${drafts} 份草稿将在保存后同步。`;
    if (conflicts) {
      summary = `${conflicts} 项更新待确认`;
      tone = 'attention';
      detail += '\n请在“备份与恢复”中选择要保留的版本。';
    }
    if (duplicates) {
      summary = `${duplicates} 项重复日程待处理`;
      tone = 'attention';
      detail += `\n${duplicates} 项日程存在重复同步标识，已暂停它们的写入和删除。请在系统日历中处理重复项。`;
    }
    if (skipped) {
      tone = 'attention';
      detail += `\n${skipped} 项日程需要在系统日历中处理。`;
    }
  }
  status.textContent = detail;
  status.dataset.summary = summary;
  status.dataset.tone = tone;
  refreshStatusSummary();
}

export function scheduleAppleCalendarSync() {
  if (!hasNativeFileBridge() || !runtime.appleSyncReady) return;
  const signature = JSON.stringify([
    runtime.state.sources,
    runtime.state.events,
    runtime.state.appleSync,
  ]);
  if (signature === runtime.lastAppleSyncSignature) return;
  window.clearTimeout(runtime.appleCalendarSyncTimer);
  runtime.appleCalendarSyncTimer = window.setTimeout(() => runAppleCalendarSync(), 700);
}

/** 读取原生快照并执行三方合并；需要写入时先备份，再提交原生操作并核验回执。同步标志用于阻止重入，编辑或保存尚未稳定时推迟同步。 */
export async function runAppleCalendarSync(manual = false) {
  if (
    !hasNativeFileBridge() ||
    !runtime.appleSyncReady ||
    runtime.appleSyncInFlight ||
    runtime.isLoadingDataFile
  )
    return;
  captureEditorDraft();
  if (
    runtime.eventDragState ||
    runtime.dragCreateState ||
    runtime.rightSelectState ||
    runtime.eventFormCompositionActive
  ) {
    renderAppleSyncStatus('操作结束后检查 Apple 日历');
    return;
  }
  runtime.appleSyncInFlight = true;
  let phase = '读取 Apple 日历';
  renderAppleSyncStatus('正在检查 Apple 日历…');
  try {
    const revision = runtime.stateRevision;
    const editingRevision = runtime.draftRevision;
    const text = serializeDataFile();
    const snapshot = await callNativeFile('readAppleChanges', { text });
    if (
      revision !== runtime.stateRevision ||
      editingRevision !== runtime.draftRevision ||
      runtime.eventFormCompositionActive
    )
      return;
    const protectedIds = Object.keys(runtime.eventDrafts);
    const result = PlannerAppleSync.reconcile(runtime.state, {
      ...snapshot,
      unsupportedIds: [...(snapshot.unsupportedIds || []), ...protectedIds],
    });
    const sourceSignature = JSON.stringify(
      runtime.state.sources
        .filter((source) => !source.archived && source.appleSyncEnabled !== false)
        .map((source) => [source.id, source.name, source.color]),
    );
    const updateCalendars = runtime.state.appleSync?.sourceSignature !== sourceSignature;
    const changed = JSON.stringify(result.state) !== JSON.stringify(runtime.state);
    if (changed || result.operations.length || updateCalendars) {
      phase = '保存同步前备份';
      await createSafetyBackup();
      if (
        revision !== runtime.stateRevision ||
        editingRevision !== runtime.draftRevision ||
        runtime.eventFormCompositionActive
      )
        return;
      runtime.state = result.state;
      runtime.stateRevision += 1;
      runtime.state.dataUpdatedAt = new Date().toISOString();
      if (!persistLocalState()) throw new Error('本地保存失败，已停止 Apple 日历写入');
      scheduleAutoSaveDataFile();
      render({ preserveScroll: true });
    }
    if (result.operations.length || updateCalendars) {
      phase = '写入 Apple 日历';
      const response = await callNativeFile('applyAppleChanges', {
        text,
        token: snapshot.token,
        operations: result.operations,
      });
      // 只更新已确认的同步基线，保留原生请求等待期间用户产生的新编辑。
      phase = '核对写入结果';
      PlannerAppleSync.acknowledge(runtime.state, result.operations, response);
      runtime.state.appleSync.sourceSignature = sourceSignature;
      runtime.state.dataUpdatedAt = new Date().toISOString();
      if (!persistLocalState()) throw new Error('同步基线保存失败，请导出备份');
      scheduleAutoSaveDataFile();
    }
    const conflicts = runtime.state.appleSync?.conflicts?.length || 0;
    const duplicates = new Set(result.duplicateIds);
    const skipped = new Set((snapshot.unsupportedIds || []).filter((id) => !duplicates.has(id)))
      .size;
    const deferred = runtime.state.events.filter((event) => runtime.eventDrafts[event.id]).length;
    const time = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    renderAppleSyncStatus(
      [
        `本机 Apple 日历已检查 · ${time}`,
        result.operations.length ? `已向本机日历写入 ${result.operations.length} 项变化` : '',
        deferred ? `${deferred} 项草稿暂缓同步，其他日程正常同步` : '',
        conflicts ? `${conflicts} 项冲突待处理，请打开“恢复与冲突”` : '',
        duplicates.size ? `${duplicates.size} 项重复日程待处理，已暂停相关写入和删除` : '',
        skipped ? `${skipped} 项日程暂缓同步：重复规则或跨日历移动需手动处理` : '',
        '手机到达时间取决于 iCloud',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    if (typeof renderReminderFields === 'function') renderReminderFields();
    runtime.lastAppleSyncSignature = JSON.stringify([
      runtime.state.sources,
      runtime.state.events,
      runtime.state.appleSync,
    ]);
  } catch (error) {
    recordSyncFailure(error, phase);
    renderAppleSyncStatus(`Apple 同步未完成：${error.message}（稍后重试）`);
  } finally {
    runtime.appleSyncInFlight = false;
  }
}
