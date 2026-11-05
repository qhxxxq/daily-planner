/**
 * 文件用途：日程编辑面板展示。
 * 把选中日程和草稿回填表单，联动全天、状态及列表选项；处理输入法提交保护、面板定位与收起展开。
 */
import { runtime } from '../app/runtime.js';
import { escapeHtml } from '../domain/html.js';
import { describeReminders, renderReminderFields } from './reminders.js';
import { getSource } from '../app/queries.js';
import { palette } from '../app/config.js';
import {
  captureEditorDraft,
  readEditorFields,
  renderDraftStatus,
  requestEditorExit,
  writeEditorFields,
} from './drafts.js';
import { renderDailyTodoPanel } from './daily-todos.js';
import { formatTravelTime, isAllDayEvent, normalizeTodoStatus } from '../domain/events.js';
import { getEventType } from '../app/queries.js';
import { getEventTags } from '../domain/tags.js';
import { structuredCloneSafe } from '../domain/clone.js';
import { renderFormTagPills } from './tag-picker.js';
import { renderRecurrenceFieldState } from './event-save.js';
import { persistLocalState, saveUiPrefs } from '../app/persistence.js';
import { render } from './render.js';
import { closeFloatingMenus } from './menus.js';
import { scheduleAppleCalendarSync } from './apple-sync.js';
import { clamp } from '../domain/math.js';

export function renderSourceOptions() {
  runtime.els.sourceInput.innerHTML = runtime.state.sources
    .map((source) => `<option value="${source.id}">${escapeHtml(source.name)}</option>`)
    .join('');
  if (!runtime.els.sourceInput.value)
    runtime.els.sourceInput.value =
      runtime.state.selectedSourceId || runtime.state.sources[0]?.id || '';
  renderSourceSelectButton();
}

export function renderSourceSelectButton() {
  renderReminderFields();
  const source =
    getSource(runtime.els.sourceInput.value) ||
    getSource(runtime.state.selectedSourceId) ||
    runtime.state.sources[0];
  runtime.els.sourceSelectButton
    .querySelector<HTMLElement>('.source-select-dot')
    ?.style.setProperty('--source-color', source?.color || palette[0]);
  const name = runtime.els.sourceSelectButton.querySelector<HTMLElement>('.source-select-name');
  if (name) name.textContent = source?.name || '';
}

/** 选中日程写入表单后再叠加其草稿，保留用户尚未提交的修改；没有选中项时切换为空态或每日待办面板。 */
export function renderFormState() {
  const active = runtime.state.events.find((event) => event.id === runtime.state.activeEventId);
  // 即使此前收起了待办侧栏，新建或切换到另一条日程也要展开编辑区域。
  if (active && runtime.editorId !== active.id) runtime.state.detailPanelCollapsed = false;
  runtime.els.eventForm.hidden = !active;
  if (!active) {
    runtime.editorReady = false;
    runtime.editorId = null;
    renderDraftStatus();
    runtime.els.emptyDetail.hidden = runtime.state.viewMode !== 'day';
    if (runtime.state.viewMode === 'day') renderDailyTodoPanel();
    runtime.detailPanelAnchorRect = null;
    resetDetailPanelPosition();
    return;
  }
  runtime.els.emptyDetail.hidden = true;
  runtime.els.formTitle.textContent = '编辑日程';
  runtime.els.titleInput.value = active.title;
  runtime.els.dateInput.value = active.date;
  runtime.els.endDateInput.value = active.endDate || active.date;
  runtime.els.startInput.value = active.start;
  runtime.els.endInput.value = active.end;
  runtime.els.travelInput.value = active.travelTime ? formatTravelTime(active.travelTime) : '';
  runtime.els.allDayInput.checked = isAllDayEvent(active);
  runtime.els.sourceInput.value = active.sourceId;
  runtime.els.eventTypeInput.value = getEventType(active);
  runtime.els.statusInput.value = normalizeTodoStatus(active);
  runtime.els.notesInput.value = active.notes || '';
  const reminders = active.reminders || [];
  const reminder = reminders.length === 1 ? reminders[0] : null;
  let reminderChoice = reminders.length ? 'keep' : 'none';
  if (
    reminder?.kind === 'relative' &&
    [0, -300, -900, -1800, -3600, -86400].includes(reminder.offset)
  )
    reminderChoice = String(reminder.offset);
  if (active.allDay && reminder?.kind === 'day' && [0, -1].includes(reminder.dayOffset))
    reminderChoice = reminder.dayOffset === 0 ? 'day' : 'previousDay';
  runtime.els.reminderInput.value = reminderChoice;
  runtime.els.reminderTimeInput.value = reminder?.kind === 'day' ? reminder.time : '09:00';
  runtime.els.reminderInput.querySelector<HTMLElement>('[value="keep"]').textContent =
    reminders.length ? `已有提醒：${describeReminders(reminders)}` : '保留已有提醒';
  runtime.els.tagsInput.value = getEventTags(active).join(' ');
  runtime.recurrenceFormEventId = active.id;
  runtime.els.recurrenceInput.value = 'none';
  runtime.els.recurrenceCountInput.value = '6';
  runtime.els.seriesScopeInput.value = 'this';
  runtime.els.eventSaveError.hidden = true;
  const draft = runtime.eventDrafts[active.id];
  runtime.editorBase = draft?.base || readEditorFields();
  if (draft) writeEditorFields(draft.values);
  runtime.editorId = active.id;
  runtime.editorOriginal = draft?.original || structuredCloneSafe(active);
  runtime.editorReady = true;
  renderDraftStatus();
  renderFormTagPills();
  renderSourceSelectButton();
  renderAllDayFieldState();
  renderTodoStatusFieldState();
  renderRecurrenceFieldState();
  positionDetailPanel();
}

export function openEventForm(eventId, anchorRect = null) {
  const open = () => {
    runtime.stateRevision += 1;
    runtime.state.activeEventId = eventId;
    runtime.state.detailPanelCollapsed = false;
    runtime.selectedEventIds = new Set([eventId]);
    runtime.detailPanelAnchorRect = anchorRect;
    persistLocalState();
    render({ preserveScroll: true });
  };
  if (runtime.state.activeEventId !== eventId) requestEditorExit(open);
  else open();
}

export function closeForm() {
  requestEditorExit(() => {
    runtime.stateRevision += 1;
    closeFloatingMenus();
    runtime.state.activeEventId = null;
    runtime.selectedEventIds.clear();
    runtime.detailPanelAnchorRect = null;
    runtime.recurrenceFormEventId = null;
    runtime.editorReady = false;
    resetDetailPanelPosition();
    persistLocalState();
    render({ preserveScroll: true });
    scheduleAppleCalendarSync();
  });
}

export function handleEventFormKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey)
    return;
  if (isImeCompositionEvent(event) || runtime.eventFormCompositionActive) {
    // 某些浏览器在 Enter 确认输入法候选词后仍触发表单隐式提交。
    // 保留正常组词行为，只在当前事件循环内抑制这次额外提交。
    runtime.suppressImeEventFormSubmit = true;
    window.setTimeout(() => {
      runtime.suppressImeEventFormSubmit = false;
    }, 0);
    return;
  }
  if ((event.target as Element).closest<HTMLElement>('textarea, button')) return;
  event.preventDefault();
  runtime.els.eventForm.requestSubmit();
}

export function isImeCompositionEvent(event) {
  // 旧 Safari/WebView 在输入法组词时可能错误返回 isComposing=false，
  // 因此同时用 keyCode 229 兼容这些环境。
  return event.isComposing || event.keyCode === 229;
}

export function positionDetailPanel() {
  if (!runtime.state.activeEventId || runtime.els.eventForm.hidden || !runtime.els.detailPanel)
    return;
  if (runtime.state.viewMode === 'day') {
    resetDetailPanelPosition();
    return;
  }
  const anchor =
    runtime.detailPanelAnchorRect ||
    document
      .querySelector<HTMLElement>(
        `:is(.event-card, .month-event)[data-event-id="${CSS.escape(runtime.state.activeEventId)}"]`,
      )
      ?.getBoundingClientRect();
  if (!anchor) return;

  const panel = runtime.els.detailPanel;
  panel.style.position = 'fixed';
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  panel.style.display = 'block';
  panel.style.visibility = 'hidden';
  panel.style.removeProperty('--editor-available-height');
  const panelWidth = panel.offsetWidth || 300;
  const panelHeight = panel.offsetHeight || 520;
  const gap = 10;
  const margin = 12;
  const preferRight = anchor.right + gap + panelWidth <= window.innerWidth - margin;
  const left = clamp(
    preferRight ? anchor.right + gap : anchor.left - panelWidth - gap,
    margin,
    Math.max(margin, window.innerWidth - panelWidth - margin),
  );
  // 面板整体优先留在视口内，不能为了避开表头把保存栏推到屏幕外。
  const top = clamp(
    anchor.top,
    margin,
    Math.max(margin, window.innerHeight - panelHeight - margin),
  );
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.setProperty('--editor-available-height', `${window.innerHeight - top - margin}px`);
  panel.style.visibility = '';
}

export function resetDetailPanelPosition() {
  if (!runtime.els.detailPanel) return;
  runtime.els.detailPanel.style.removeProperty('--editor-available-height');
  runtime.els.detailPanel.style.position = '';
  runtime.els.detailPanel.style.left = '';
  runtime.els.detailPanel.style.top = '';
  runtime.els.detailPanel.style.right = '';
  runtime.els.detailPanel.style.bottom = '';
  runtime.els.detailPanel.style.display = '';
  runtime.els.detailPanel.style.visibility = '';
}

export function renderAllDayFieldState() {
  renderReminderFields();
  const isAllDay = runtime.els.allDayInput.checked;
  runtime.els.eventForm.classList.toggle('is-all-day-form', isAllDay);
  runtime.els.startInput.disabled = isAllDay;
  runtime.els.endInput.disabled = isAllDay;
  runtime.els.travelInput.disabled = isAllDay;
}

export function renderTodoStatusFieldState() {
  const isTodo = runtime.els.eventTypeInput.value === 'todo';
  runtime.els.statusInput.closest<HTMLElement>('.todo-status-row').hidden = !isTodo;
  syncStatusSegment();
}

export function syncStatusSegment() {
  runtime.els.statusSegment
    .querySelectorAll<HTMLElement>('button[data-status]')
    .forEach((button) => {
      const selected = button.dataset.status === runtime.els.statusInput.value;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-checked', String(selected));
    });
}

export function handleStatusSegmentClick(event) {
  const button = (event.target as Element).closest<HTMLElement>('button[data-status]');
  if (!button) return;
  runtime.els.statusInput.value = button.dataset.status;
  syncStatusSegment();
  captureEditorDraft();
}

export function renderDetailPanelVisibility() {
  const collapsed = runtime.state.viewMode === 'day' && runtime.state.detailPanelCollapsed === true;
  runtime.els.appShell.classList.toggle('is-detail-collapsed', collapsed);
  const button = document.querySelector<HTMLButtonElement>('#detailToggleButton');
  if (!button) return;
  button.hidden = runtime.state.viewMode !== 'day';
  button.setAttribute('aria-expanded', String(!collapsed));
  button.textContent = collapsed ? '展开右栏' : '收起右栏';
}

export function toggleDetailPanel(event: Event) {
  event.stopPropagation();
  captureEditorDraft();
  closeFloatingMenus();
  runtime.state.detailPanelCollapsed = !runtime.state.detailPanelCollapsed;
  renderDetailPanelVisibility();
  saveUiPrefs();
}
