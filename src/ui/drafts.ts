/**
 * 文件用途：未保存编辑草稿管理。
 * 保存字段值、编辑基线和原始日程以便恢复；切换编辑对象前让退出流程处理保存、放弃或继续编辑。
 */
import { runtime } from '../app/runtime.js';
import { DRAFT_STORAGE_KEY } from '../app/config.js';
import * as PlannerEditor from '../editor/planner-editor.js';
import { saveEvent } from './event-save.js';
import { saveAndRender } from '../app/persistence.js';
import { openEventForm } from './editor.js';

export function loadEditorDrafts() {
  return runtime.plannerStorage.drafts(DRAFT_STORAGE_KEY);
}

export function readEditorFields() {
  return PlannerEditor.readFields(runtime.els, runtime.editorFieldNames);
}

export function writeEditorFields(values) {
  PlannerEditor.writeFields(runtime.els, runtime.editorFieldNames, values);
}

export function persistEditorDrafts() {
  try {
    runtime.plannerStorage.write(DRAFT_STORAGE_KEY, runtime.eventDrafts);
    runtime.draftStorageError = '';
  } catch {
    runtime.draftStorageError = '草稿未能保存，请先复制内容';
  }
  renderDraftStatus();
}

/** 仅在编辑器准备完成后读取表单，将字段与打开时基线比较；草稿单独持久化，尚未保存的编辑不会直接覆盖正式日程。 */
export function captureEditorDraft() {
  if (!runtime.editorReady || !runtime.editorId || runtime.els.eventForm.hidden) return;
  const values = readEditorFields();
  if (
    !PlannerEditor.updateDraft(
      runtime.eventDrafts,
      runtime.editorId,
      runtime.editorBase,
      values,
      runtime.editorOriginal,
    )
  )
    return;
  runtime.draftRevision += 1;
  persistEditorDrafts();
}

export function hasEditorDraft() {
  return !!(runtime.editorReady && runtime.editorId && runtime.eventDrafts[runtime.editorId]);
}

export function renderDraftStatus() {
  const status = document.querySelector<HTMLElement>('#draftStatus');
  if (status) {
    status.textContent = runtime.draftStorageError || (hasEditorDraft() ? '草稿已保留' : '');
    status.hidden = !status.textContent;
    status.dataset.tone = runtime.draftStorageError ? 'attention' : 'quiet';
  }
  const button = document.querySelector<HTMLButtonElement>('#draftsButton');
  if (button) {
    const count = Object.keys(runtime.eventDrafts).length;
    button.hidden = count === 0;
    button.textContent = `${count} 份草稿 · 继续编辑`;
  }
}

export function discardEditorDraft(id) {
  if (id === runtime.editorId) runtime.editorReady = false;
  delete runtime.eventDrafts[id];
  runtime.draftRevision += 1;
  persistEditorDrafts();
}

/** 接收退出后要执行的回调。存在草稿时先让用户选择保存、放弃或继续编辑，只有允许退出时才调用回调。 */
export function requestEditorExit(proceed) {
  captureEditorDraft();
  if (!hasEditorDraft()) {
    proceed();
    return;
  }
  let dialog = document.querySelector<HTMLDialogElement>('#draftExitDialog');
  if (dialog?.open) return;
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'draftExitDialog';
    dialog.className = 'sync-dialog editor-dialog';
    dialog.setAttribute('aria-labelledby', 'draftExitTitle');
    dialog.innerHTML = `<div class="sync-card"><h2 id="draftExitTitle">保存这次修改？</h2><p>修改已暂存，保存后会更新日历。</p><div class="draft-dialog-actions"><button type="button" data-choice="continue">继续编辑</button><button type="button" data-choice="discard">放弃修改</button><button type="button" data-choice="save">保存修改</button></div></div>`;
    document.body.append(dialog);
  }
  dialog.onclick = (event) => {
    event.stopPropagation();
    const choice = (event.target as Element).closest<HTMLElement>('[data-choice]')?.dataset.choice;
    if (!choice) return;
    if (choice === 'save') {
      if (runtime.eventFormCompositionActive || runtime.suppressImeEventFormSubmit) return;
      // 先关闭确认对话框，再显示底层表单的校验错误，确保用户能定位并修改字段。
      dialog.close();
      if (!runtime.els.eventForm.reportValidity()) return;
      if (!saveEvent({ preventDefault() {} })) return;
    } else {
      if (choice === 'discard') discardEditorDraft(runtime.editorId);
      dialog.close();
    }
    if (choice !== 'continue') proceed();
  };
  dialog.querySelector<HTMLElement>('p').textContent = runtime.draftStorageError
    ? '修改还未保存，请先保存或复制内容。'
    : '修改已暂存，保存后会更新日历。';
  dialog.showModal();
}

export function openDraftsDialog() {
  captureEditorDraft();
  let dialog = document.querySelector<HTMLDialogElement>('#draftListDialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'draftListDialog';
    dialog.className = 'sync-dialog editor-dialog';
    document.body.append(dialog);
  }
  dialog.innerHTML =
    '<div class="sync-card"><h2>未完成的编辑</h2><button type="button" data-close>关闭</button><div class="draft-list"></div></div>';
  dialog.querySelector<HTMLElement>('[data-close]').onclick = () => dialog.close();
  for (const [id, draft] of Object.entries(runtime.eventDrafts).sort((a, b) =>
    b[1].updatedAt.localeCompare(a[1].updatedAt),
  )) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${draft.values.titleInput || '未命名日程'} · ${draft.values.dateInput} · 继续编辑`;
    button.onclick = () => {
      dialog.close();
      if (runtime.state.activeEventId === id) {
        runtime.els.titleInput.focus();
        return;
      }
      requestEditorExit(() => {
        if (!runtime.state.events.some((event) => event.id === id)) {
          // 已删除或被导入替换的日程用新标识恢复，避免复用旧远端身份。
          const newId = crypto.randomUUID();
          const sourceId = runtime.state.sources.some(
            (source) => source.id === draft.original.sourceId,
          )
            ? draft.original.sourceId
            : runtime.state.selectedSourceId;
          runtime.state.events.push({ ...draft.original, sourceId, id: newId });
          runtime.eventDrafts[newId] = {
            ...draft,
            values: { ...draft.values, sourceInput: sourceId },
          };
          delete runtime.eventDrafts[id];
          persistEditorDrafts();
          saveAndRender({ preserveScroll: true });
          openEventForm(newId);
        } else openEventForm(id);
      });
    };
    dialog.querySelector<HTMLElement>('.draft-list').append(button);
  }
  dialog.showModal();
}
