/**
 * 文件用途：键盘快捷键与批量操作。
 * 识别当前输入焦点和按键组合，处理日程选择、删除、复制与撤销等操作；避免编辑输入与全局快捷键冲突。
 */
import type { PlannerEvent } from '../types/model.js';
import { closeFloatingMenus, getFloatingMenus } from './menus.js';
import { runtime } from '../app/runtime.js';
import { closeForm } from './editor.js';
import { getSearchQuery } from '../app/queries.js';
import { clearSearch, focusSearch } from './search.js';
import { pushUndoSnapshot, undoLastChange } from './undo.js';
import { saveDataFile } from '../platform/files.js';
import { toggleEventDone } from './event-save.js';
import { goToday, setViewMode, shiftDay, shiftWeek } from './navigation.js';
import { createTimedEvent } from './event-create.js';
import { getTodayKey, isValidDateKey } from '../domain/date-time.js';
import { HOUR_HEIGHT, START_HOUR, TOTAL_MINUTES } from '../app/config.js';
import { snapMinute } from './timeline-geometry.js';
import { clamp } from '../domain/math.js';
import { getPasteTargetForClipboard, pasteClipboardEvent } from './clipboard.js';
import { isAllDayEvent } from '../domain/events.js';
import { getEventType } from '../app/queries.js';
import { saveAndRender } from '../app/persistence.js';

export function handleKeyboardShortcuts(event) {
  if (event.target.closest?.('dialog')) return;
  const key = event.key.toLowerCase();
  const command = event.metaKey || event.ctrlKey;
  const editingText = isTextEditingTarget(event.target);

  if (key === 'escape') {
    event.preventDefault();
    if (hasOpenFloatingMenus()) closeFloatingMenus();
    else if (runtime.state.activeEventId) closeForm();
    else if (getSearchQuery()) clearSearch();
    return;
  }

  if (command && (key === 'delete' || key === 'backspace')) {
    if (!runtime.state.activeEventId && !runtime.selectedEventIds.size) return;
    event.preventDefault();
    deleteSelectedEvents();
    return;
  }

  if (command && key === 'z') {
    if (editingText) return;
    event.preventDefault();
    undoLastChange();
    return;
  }

  if (command && key === 's') {
    event.preventDefault();
    if (runtime.state.activeEventId && !runtime.els.eventForm.hidden)
      runtime.els.eventForm.requestSubmit();
    else saveDataFile();
    return;
  }

  if (command && key === 'f') {
    event.preventDefault();
    focusSearch();
    runtime.els.searchInput.select();
    return;
  }

  if (command && key === 'n') {
    event.preventDefault();
    createShortcutEvent();
    return;
  }

  if (command && key === 'c' && !editingText) {
    event.preventDefault();
    copySelectedEventToClipboard();
    return;
  }

  if (command && key === 'v' && !editingText) {
    event.preventDefault();
    pasteClipboardToSelectedDate();
    return;
  }

  if (editingText || command || event.altKey) return;

  if (key === 'delete' || key === 'backspace') {
    if (!runtime.state.activeEventId && !runtime.selectedEventIds.size) return;
    event.preventDefault();
    deleteSelectedEvents();
    return;
  }

  if (key === ' ' || key === 'spacebar') {
    if (!runtime.state.activeEventId) return;
    event.preventDefault();
    toggleEventDone(runtime.state.activeEventId);
    return;
  }

  if (key === 't') {
    event.preventDefault();
    goToday();
    return;
  }

  if (key === 'd') {
    event.preventDefault();
    setViewMode('day');
    return;
  }

  if (key === 'w') {
    event.preventDefault();
    setViewMode('week');
    return;
  }

  if (key === 'arrowleft') {
    event.preventDefault();
    if (event.shiftKey) shiftWeek(-1);
    else shiftDay(-1);
    return;
  }

  if (key === 'arrowright') {
    event.preventDefault();
    if (event.shiftKey) shiftWeek(1);
    else shiftDay(1);
  }
}

export function isTextEditingTarget(target) {
  return !!target?.closest?.("input, textarea, select, [contenteditable='true']");
}

export function hasOpenFloatingMenus() {
  return getFloatingMenus().some((element) => element && !element.hidden);
}

export function createShortcutEvent() {
  const dateKey = getShortcutDateKey();
  createTimedEvent(dateKey, getDefaultShortcutMinute());
}

export function getShortcutDateKey() {
  if (runtime.state.viewMode === 'day')
    return isValidDateKey(runtime.state.selectedDate) ? runtime.state.selectedDate : getTodayKey();
  return isValidDateKey(runtime.state.selectedDate)
    ? runtime.state.selectedDate
    : runtime.state.visibleWeekStart;
}

export function getDefaultShortcutMinute() {
  if (runtime.state.viewMode === 'month') return 9 * 60;
  const visibleMinute = START_HOUR * 60 + (runtime.els.calendarView.scrollTop / HOUR_HEIGHT) * 60;
  return snapMinute(clamp(visibleMinute, 0, TOTAL_MINUTES - 30));
}

export function copySelectedEventToClipboard() {
  const id = runtime.state.activeEventId || [...runtime.selectedEventIds][0];
  const event = runtime.state.events.find((item) => item.id === id);
  if (!event) return;
  runtime.clipboardEvent =
    typeof structuredClone === 'function'
      ? structuredClone(event)
      : JSON.parse(JSON.stringify(event));
}

export function pasteClipboardToSelectedDate() {
  if (!runtime.clipboardEvent) return;
  runtime.timelinePasteTarget = getPasteTargetForClipboard();
  if (!runtime.timelinePasteTarget) return;
  if (isAllDayEvent(runtime.clipboardEvent)) {
    const next: PlannerEvent = {
      ...runtime.clipboardEvent,
      recurrenceGroupId: '',
      recurrenceIndex: null,
      id: crypto.randomUUID(),
      date: runtime.timelinePasteTarget.date,
      endDate: runtime.timelinePasteTarget.date,
      completed: false,
      status: getEventType(runtime.clipboardEvent) === 'todo' ? 'open' : 'open',
    };
    pushUndoSnapshot();
    runtime.state.events.push(next);
    runtime.state.activeEventId = next.id;
    runtime.selectedEventIds = new Set([next.id]);
    saveAndRender({ preserveScroll: true });
    return;
  }
  pasteClipboardEvent();
}

export function deleteSelectedEvents() {
  const ids = new Set(runtime.selectedEventIds);
  if (runtime.state.activeEventId) ids.add(runtime.state.activeEventId);
  if (!ids.size) return;
  pushUndoSnapshot();
  runtime.state.events = runtime.state.events.filter((event) => !ids.has(event.id));
  runtime.state.activeEventId = null;
  runtime.selectedEventIds.clear();
  saveAndRender({ preserveScroll: true });
}
