/**
 * 文件用途：Apple 同步冲突与回收恢复。
 * 展示冲突、历史删除及可恢复内容；处理版本选择前备份并复核状态，防止异步等待后应用过期选择。
 */
import type { AppleConflict } from '../types/model.js';
import { captureEditorDraft } from './drafts.js';
import { userErrorMessage } from './status.js';
import { callNativeFile, downloadDataFile, hasNativeFileBridge } from '../platform/files.js';
import { STORAGE_KEY } from '../app/config.js';
import { runtime } from '../app/runtime.js';
import { describeReminders } from './reminders.js';
import { createSafetyBackup, saveAndRender } from '../app/persistence.js';
import * as PlannerAppleSync from '../sync/apple-sync.js';

/** 先保存编辑器草稿并检查冲突仍存在，再等待安全备份。等待后复核文档引用、数据/草稿修订号与冲突内容，防止过期确认覆盖新编辑。 */
export async function chooseAppleConflict(conflict: AppleConflict, choice: 'local' | 'remote') {
  captureEditorDraft();
  if (runtime.appleSyncInFlight) throw new Error('正在同步，请稍后重试');
  if (runtime.eventDrafts[conflict.id]) throw new Error('请先保存或放弃这条日程的草稿');
  const state = runtime.state;
  const revision = runtime.stateRevision;
  const draftRevision = runtime.draftRevision;
  const expected = JSON.stringify(conflict);
  const isCurrent = () =>
    JSON.stringify(runtime.state.appleSync?.conflicts.find((item) => item.id === conflict.id)) ===
    expected;
  if (!isCurrent()) {
    openRecoveryDialog();
    throw new Error('日程已更新，请重新选择版本');
  }
  await createSafetyBackup();
  captureEditorDraft();
  if (
    runtime.appleSyncInFlight ||
    runtime.state !== state ||
    runtime.stateRevision !== revision ||
    runtime.draftRevision !== draftRevision ||
    runtime.eventDrafts[conflict.id] ||
    !isCurrent()
  ) {
    openRecoveryDialog();
    throw new Error('日程已更新，请重新选择版本');
  }
  PlannerAppleSync.resolve(runtime.state, conflict.id, choice);
  saveAndRender({ preserveScroll: true });
  openRecoveryDialog();
}

export function openRecoveryDialog() {
  let dialog = document.querySelector<HTMLDialogElement>('#recoveryDialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'recoveryDialog';
    dialog.className = 'sync-dialog';
    document.body.append(dialog);
  }
  dialog.replaceChildren();
  const panel = document.createElement('div');
  panel.className = 'sync-card';
  dialog.append(panel);
  const heading = document.createElement('h2');
  heading.textContent = '备份与恢复';
  panel.append(heading);
  const addButton = (parent, label, action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button';
    button.textContent = label;
    button.onclick = async () => {
      button.disabled = true;
      try {
        await action();
      } catch (error) {
        alert(userErrorMessage(error));
      } finally {
        button.disabled = false;
      }
    };
    parent.append(button);
  };
  addButton(panel, '关闭', () => dialog.close());
  panel.lastElementChild.classList.add('dialog-close');
  const errorDetails = document.createElement('details');
  const errorSummary = document.createElement('summary');
  errorSummary.textContent = '同步错误记录';
  errorDetails.append(errorSummary);
  let errors = [];
  try {
    errors = JSON.parse(localStorage.getItem('daily-planner-sync-errors') || '[]');
  } catch {}
  const log = document.createElement('pre');
  log.style.cssText =
    'white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;font:inherit;font-size:12px';
  log.textContent = errors.length
    ? errors
        .map(
          (item) =>
            `${new Date(item.time).toLocaleString()} · ${item.phase}\n${item.reason}\n${item.code} ${item.message}`,
        )
        .join('\n\n')
    : '暂无同步错误记录';
  errorDetails.append(log);
  panel.append(errorDetails);
  if (hasNativeFileBridge()) addButton(panel, '查看历史备份', () => callNativeFile('showBackups'));
  else {
    const backups = JSON.parse(localStorage.getItem(`${STORAGE_KEY}-backups`) || '[]');
    backups.forEach((backup) =>
      addButton(panel, `下载备份 · ${backup.createdAt}`, () => downloadDataFile(backup.text)),
    );
  }
  const note = document.createElement('p');
  note.className = 'recovery-help';
  note.textContent = '从日程文件菜单打开历史备份，即可恢复。恢复前会保留当前版本。';
  panel.append(note);
  if (!runtime.state.appleSync?.conflicts?.length && !runtime.state.appleSync?.trash?.length) {
    const empty = document.createElement('div');
    empty.className = 'recovery-empty';
    empty.textContent = '暂无待确认或已删除的日程';
    panel.append(empty);
  }
  const describe = (event) =>
    event
      ? `${event.title} · ${event.date} ${event.start} → ${event.endDate} ${event.end}\n备注：${event.notes || '无'}\n提醒：${describeReminders(event.reminders)}`
      : '已删除';
  for (const conflict of runtime.state.appleSync?.conflicts || []) {
    const item = document.createElement('section');
    const info = document.createElement('p');
    item.className = 'recovery-item';
    info.style.whiteSpace = 'pre-wrap';
    info.textContent = `此处的版本\n${describe(runtime.state.events.find((event) => event.id === conflict.id))}\n\n日历中的版本\n${describe(conflict.remote)}`;
    item.append(info);
    for (const [choice, label] of [
      ['local', '保留此处版本'],
      ['remote', '采用日历版本'],
    ] as const) {
      addButton(item, label, () => chooseAppleConflict(conflict, choice));
    }
    panel.append(item);
  }
  for (const entry of [...(runtime.state.appleSync?.trash || [])].reverse()) {
    if (!entry.event) continue;
    const item = document.createElement('section');
    const info = document.createElement('p');
    info.textContent = `${entry.reason} · ${describe(entry.event)}`;
    item.append(info);
    addButton(item, '恢复为新日程', async () => {
      await createSafetyBackup();
      const event = { ...entry.event, id: crypto.randomUUID() };
      if (!runtime.state.sources.some((source) => source.id === event.sourceId && !source.archived))
        event.sourceId = runtime.state.selectedSourceId;
      runtime.state.events.push(event);
      runtime.state.appleSync.trash = runtime.state.appleSync.trash.filter(
        (item) => item.id !== entry.id,
      );
      saveAndRender({ preserveScroll: true });
      openRecoveryDialog();
    });
    panel.append(item);
  }
  if (!dialog.open) dialog.showModal();
}
