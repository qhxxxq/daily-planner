/**
 * 文件用途：编辑表单提交与重复日程保存。
 * 校验日期、时间、提醒和系列范围，阻止覆盖其他草稿；本地写入成功后清理草稿并调度后续刷新与同步。
 */
import { runtime } from '../app/runtime.js';
import { normalizeTags } from '../domain/tags.js';
import {
  addDays,
  dateTimeToAbsoluteMinute,
  getTodayKey,
  isValidDateKey,
  normalizeDateInput,
  normalizeTime,
  parseDateKey,
  timeToMinute,
  toDateKey,
} from '../domain/date-time.js';
import { isEventCompleted, normalizeTodoStatus, parseTravelTime } from '../domain/events.js';
import { getEventType } from '../app/queries.js';
import { structuredCloneSafe } from '../domain/clone.js';
import { pushUndoSnapshot } from './undo.js';
import { ensureTagsExist } from '../app/queries.js';
import { persistLocalState, saveAndRender } from '../app/persistence.js';
import { discardEditorDraft } from './drafts.js';
import { resetDetailPanelPosition } from './editor.js';
import { clamp } from '../domain/math.js';

export function getSeriesTargets(events, active, scope = 'this') {
  return runtime.editorModel.getSeriesTargets(events, active, scope);
}

/** 委托系列模型生成按 ID 索引的修改映射，不在此处更新 runtime.state；便于调用方先检查其他日程的未保存草稿。 */
export function buildSeriesUpdates(events, active, next, scope) {
  return runtime.editorModel.buildSeriesUpdates(events, active, next, scope);
}

/** 处理表单提交并返回是否成功：先校验字段和系列影响范围，再写入本地；失败保留草稿，成功才关闭编辑器并调度同步。 */
export function saveEvent(event) {
  event.preventDefault();
  if (runtime.eventFormCompositionActive || runtime.suppressImeEventFormSubmit) return false;
  const active = runtime.state.events.find((item) => item.id === runtime.state.activeEventId);
  if (!active) return false;
  const showError = (message) => {
    runtime.els.eventSaveError.textContent = message;
    runtime.els.eventSaveError.hidden = false;
    return false;
  };
  runtime.els.eventSaveError.hidden = true;
  const tags = normalizeTags(runtime.els.tagsInput.value);
  const nextDate = normalizeDateInput(runtime.els.dateInput.value);
  const nextEndDate = normalizeDateInput(runtime.els.endDateInput.value);
  if (
    ![nextDate, nextEndDate].every(
      (date) => isValidDateKey(date) && toDateKey(parseDateKey(date)) === date,
    )
  )
    return showError('请填写有效的开始和结束日期。');
  const next = {
    ...active,
    title: runtime.els.titleInput.value.trim() || '未命名日程',
    date: nextDate,
    endDate: nextEndDate,
    start: runtime.els.allDayInput.checked ? '00:00' : normalizeTime(runtime.els.startInput.value),
    end: runtime.els.allDayInput.checked ? '00:00' : normalizeTime(runtime.els.endInput.value),
    travelTime: runtime.els.allDayInput.checked
      ? 0
      : parseTravelTime(runtime.els.travelInput.value),
    allDay: runtime.els.allDayInput.checked,
    sourceId: runtime.els.sourceInput.value || runtime.state.sources[0]?.id,
    type: runtime.els.eventTypeInput.value,
    status: runtime.els.eventTypeInput.value === 'todo' ? runtime.els.statusInput.value : 'open',
    completed:
      runtime.els.eventTypeInput.value === 'todo' && runtime.els.statusInput.value === 'completed',
    notes: runtime.els.notesInput.value,
    tags,
  };
  const reminderChoice = runtime.els.reminderInput.value;
  const reminderChanged =
    reminderChoice !== runtime.editorBase?.reminderInput ||
    (['day', 'previousDay'].includes(reminderChoice) &&
      runtime.els.reminderTimeInput.value !== runtime.editorBase?.reminderTimeInput);
  if (reminderChoice !== 'keep' && reminderChanged) {
    if ((active.reminders || []).some((r) => r.kind === 'unsupported'))
      return showError('此日程包含特殊提醒，请在 Apple 日历中修改提醒。其他字段仍可保存。');
    if (['day', 'previousDay'].includes(reminderChoice)) {
      if (!next.allDay || !/^\d{2}:\d{2}$/.test(runtime.els.reminderTimeInput.value))
        return showError('指定提醒时刻需要选择全天事项并填写有效时间。');
      next.reminders = [
        {
          kind: 'day',
          dayOffset: reminderChoice === 'previousDay' ? -1 : 0,
          time: runtime.els.reminderTimeInput.value,
        },
      ];
    } else
      next.reminders =
        reminderChoice === 'none' ? [] : [{ kind: 'relative', offset: Number(reminderChoice) }];
  }
  // 先确认完整结束日期和时间有效，再计算系列日程的相对移动量。
  const start = dateTimeToAbsoluteMinute(next.date, timeToMinute(next.start));
  const end = dateTimeToAbsoluteMinute(next.endDate, timeToMinute(next.end));
  if (next.allDay ? next.endDate < next.date : end <= start)
    return showError('结束时间需要晚于开始时间；跨天日程请同时修改结束日期。');
  const scope = active.recurrenceGroupId ? runtime.els.seriesScopeInput.value : 'this';
  let updates;
  try {
    updates = buildSeriesUpdates(runtime.state.events, active, next, scope);
  } catch (error) {
    return showError(error.message);
  }
  if (next.type === 'todo' && next.status !== 'open' && normalizeTodoStatus(active) !== next.status)
    updates.get(active.id).reminders = [];
  const otherDrafts = [...updates.keys()].filter(
    (id) => id !== active.id && runtime.eventDrafts[id],
  );
  if (otherDrafts.length)
    return showError(`另有 ${otherDrafts.length} 次日程正在编辑，请先保存或放弃它们的草稿。`);
  const beforeSave = structuredCloneSafe(runtime.state);
  pushUndoSnapshot();
  ensureTagsExist(tags);
  runtime.state.events = runtime.state.events.map((item) => updates.get(item.id) || item);
  const saved = runtime.state.events.find((item) => item.id === active.id);
  // 已有系列只修改成员，不再按频率选择器复制出另一组重复日程。
  const recurrenceDays = active.recurrenceGroupId ? 0 : getRecurrenceIntervalDays();
  const recurrenceCount = recurrenceDays ? getRecurrenceCount() : 1;
  if (recurrenceCount > 1) {
    const groupId = crypto.randomUUID();
    saved.recurrenceGroupId = groupId;
    saved.recurrenceIndex = 0;
    for (let index = 1; index < recurrenceCount; index += 1) {
      runtime.state.events.push({
        ...structuredCloneSafe(saved),
        id: crypto.randomUUID(),
        date: toDateKey(addDays(parseDateKey(saved.date), recurrenceDays * index)),
        endDate: toDateKey(addDays(parseDateKey(saved.endDate), recurrenceDays * index)),
        recurrenceGroupId: groupId,
        recurrenceIndex: index,
      });
    }
  }
  if (!persistLocalState()) {
    runtime.state = beforeSave;
    runtime.undoStack.pop();
    return showError('暂时未能保存，修改和草稿已保留，请稍后重试。');
  }
  discardEditorDraft(active.id);
  runtime.state.selectedSourceId = saved.sourceId;
  runtime.state.activeEventId = null;
  runtime.recurrenceFormEventId = null;
  runtime.detailPanelAnchorRect = null;
  resetDetailPanelPosition();
  saveAndRender({ preserveScroll: true });
  return true;
}

export function getRecurrenceIntervalDays() {
  if (runtime.els.recurrenceInput.value === 'weekly') return 7;
  if (runtime.els.recurrenceInput.value === 'biweekly') return 14;
  return 0;
}

export function getRecurrenceCount() {
  return clamp(Math.round(Number(runtime.els.recurrenceCountInput.value) || 2), 2, 52);
}

export function renderRecurrenceFieldState() {
  const active = runtime.state.events.find((item) => item.id === runtime.state.activeEventId);
  const existingSeries = !!active?.recurrenceGroupId;
  runtime.els.recurrenceCreateControls.hidden = existingSeries;
  runtime.els.seriesScopeField.hidden = !existingSeries;
  if (existingSeries) {
    const scope = runtime.els.seriesScopeInput.value || 'this';
    const count = getSeriesTargets(runtime.state.events, active, scope).length;
    runtime.els.recurrenceCountField.hidden = true;
    runtime.els.recurrenceSummary.hidden = false;
    runtime.els.recurrenceSummary.textContent =
      scope === 'this'
        ? '其他课程保持不变。'
        : `将修改 ${count} 次日程。时间按本次改动一起平移，完成状态仅影响本次。`;
    runtime.els.saveEventButton.textContent = count > 1 ? `保存 ${count} 次修改` : '保存';
    return;
  }
  const intervalDays = getRecurrenceIntervalDays();
  const repeats = intervalDays > 0;
  runtime.els.recurrenceCountField.hidden = !repeats;
  runtime.els.recurrenceSummary.hidden = !repeats;
  runtime.els.saveEventButton.textContent = repeats
    ? `创建 ${getRecurrenceCount()} 个日程`
    : '保存';
  if (!repeats) return;
  const count = getRecurrenceCount();
  const startKey = normalizeDateInput(runtime.els.dateInput.value) || getTodayKey();
  const lastDate = toDateKey(addDays(parseDateKey(startKey), intervalDays * (count - 1)));
  runtime.els.recurrenceSummary.textContent = `共 ${count} 次，最后一次为 ${lastDate}`;
}

export function deleteActiveEvent() {
  if (!runtime.state.activeEventId) return;
  pushUndoSnapshot();
  runtime.state.events = runtime.state.events.filter(
    (event) => event.id !== runtime.state.activeEventId,
  );
  runtime.state.activeEventId = null;
  runtime.selectedEventIds.clear();
  runtime.detailPanelAnchorRect = null;
  resetDetailPanelPosition();
  saveAndRender({ preserveScroll: true });
}

export function toggleEventDone(eventId) {
  const event = runtime.state.events.find((item) => item.id === eventId);
  if (!event || getEventType(event) !== 'todo') return;
  setEventStatus(eventId, isEventCompleted(event) ? 'open' : 'completed');
}

export function setEventStatus(eventId, status) {
  const event = runtime.state.events.find((item) => item.id === eventId);
  if (!event || getEventType(event) !== 'todo') return;
  const nextStatus = status === 'completed' || status === 'abandoned' ? status : 'open';
  if (normalizeTodoStatus(event) === nextStatus) return;
  pushUndoSnapshot();
  if (nextStatus !== 'open') event.reminders = [];
  event.status = nextStatus;
  event.completed = nextStatus === 'completed';
  saveAndRender({ preserveScroll: true });
}
