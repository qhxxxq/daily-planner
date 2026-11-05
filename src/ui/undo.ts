/**
 * 文件用途：撤销模型的界面适配。
 * 在操作前后捕获文档差异并维护撤销栈；应用结果后保存刷新，冲突时保留当前数据。
 */
import { runtime } from '../app/runtime.js';
import * as PlannerUndo from '../editor/undo.js';
import { captureEditorDraft } from './drafts.js';
import { normalizeState, persistLocalState, saveAndRender } from '../app/persistence.js';

export function pushUndoSnapshot() {
  runtime.undoStack.push({ before: PlannerUndo.capture(runtime.state), operation: null });
  if (runtime.undoStack.length > 60) runtime.undoStack.shift();
}

export function finishUndoOperation() {
  const entry = runtime.undoStack.at(-1);
  if (!entry || entry.operation) return;
  entry.operation = PlannerUndo.operation(entry.before, PlannerUndo.capture(runtime.state));
  delete entry.before;
  if (!entry.operation.changes.length) runtime.undoStack.pop();
}

export function undoLastChange() {
  const entry = runtime.undoStack.at(-1);
  if (!entry?.operation) return;
  captureEditorDraft();
  const before = runtime.state;
  try {
    runtime.state = normalizeState(
      PlannerUndo.apply(runtime.state, entry.operation, [
        ...Object.keys(runtime.eventDrafts),
        ...(runtime.state.appleSync?.conflicts || []).map((item) => item.id),
      ]),
    );
  } catch (error) {
    alert(error.message);
    return;
  }
  if (!persistLocalState()) {
    runtime.state = before;
    alert('撤销未能保存，原有日程已保留，请稍后重试。');
    return;
  }
  runtime.undoStack.pop();
  runtime.selectedEventIds = new Set(
    [...runtime.selectedEventIds].filter((id) =>
      runtime.state.events.some((event) => event.id === id),
    ),
  );
  if (!runtime.state.events.some((event) => event.id === runtime.state.activeEventId))
    runtime.state.activeEventId = null;
  saveAndRender({ preserveScroll: true });
}
