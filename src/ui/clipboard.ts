/**
 * 文件用途：日程右键菜单与内部剪贴板。
 * 记录时间轴粘贴位置，处理复制、粘贴、删除和状态切换；变更通过撤销记录和统一保存入口提交。
 */
import type { PlannerEvent } from '../types/model.js';
import {
  getTimelineColumnByDate,
  getTimelinePointTarget,
  minuteFromColumnPoint,
  snapMinute,
} from './timeline-geometry.js';
import { runtime } from '../app/runtime.js';
import { getEventDurationMinutes, isAllDayEvent, normalizeTodoStatus } from '../domain/events.js';
import { getEventType } from '../app/queries.js';
import { getShortcutDateKey } from './shortcuts.js';
import {
  absoluteMinuteToDateTime,
  dateTimeToAbsoluteMinute,
  minuteToTime,
  timeToMinute,
} from '../domain/date-time.js';
import { closeFloatingMenus, positionViewportMenu } from './menus.js';
import { pushUndoSnapshot } from './undo.js';
import { saveAndRender } from '../app/persistence.js';
import { setEventStatus } from './event-save.js';
import { TOTAL_MINUTES } from '../app/config.js';

export function updateTimelinePointerTarget(event) {
  const target = getTimelinePointTarget(event.clientX, event.clientY);
  if (target) runtime.lastTimelinePointerTarget = target;
}

export function getCurrentPointerPasteTarget() {
  if (!runtime.lastTimelinePointerTarget) return null;
  const column = getTimelineColumnByDate(runtime.lastTimelinePointerTarget.date);
  if (!column) return null;
  const rect = column.getBoundingClientRect();
  if (
    runtime.lastTimelinePointerTarget.clientX < rect.left ||
    runtime.lastTimelinePointerTarget.clientX > rect.right
  )
    return null;
  if (
    runtime.lastTimelinePointerTarget.clientY < rect.top ||
    runtime.lastTimelinePointerTarget.clientY > rect.bottom
  )
    return null;
  return {
    date: runtime.lastTimelinePointerTarget.date,
    minute: runtime.lastTimelinePointerTarget.minute,
  };
}

export function getPasteTargetForClipboard() {
  if (!runtime.clipboardEvent) return null;
  if (isAllDayEvent(runtime.clipboardEvent)) {
    return runtime.timelinePasteTarget || { date: getShortcutDateKey(), minute: 0 };
  }
  return (
    getCurrentPointerPasteTarget() ||
    runtime.timelinePasteTarget || {
      date: getShortcutDateKey(),
      minute: timeToMinute(runtime.clipboardEvent.start),
    }
  );
}

export function openEventCardContextMenu(event, eventId) {
  if (runtime.rightSelectState?.activated || runtime.suppressEventClickId === eventId) {
    event.preventDefault();
    event.stopPropagation();
    runtime.suppressEventClickId = null;
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  runtime.contextEventId = eventId;
  runtime.timelinePasteTarget = null;
  closeFloatingMenus();
  runtime.els.eventContextMenu.classList.remove('is-paste-menu');
  const eventItem = runtime.state.events.find((item) => item.id === eventId);
  const isTodo = eventItem && getEventType(eventItem) === 'todo';
  const status = eventItem ? normalizeTodoStatus(eventItem) : 'open';
  runtime.els.eventContextMenu.innerHTML = `
    <button type="button" data-action="event-copy">复制日程</button>
    ${
      isTodo
        ? `
      <span class="context-divider" aria-hidden="true"></span>
      <button type="button" data-action="event-status-open" ${status === 'open' ? 'disabled' : ''}>标记未完成</button>
      <button type="button" data-action="event-status-completed" ${status === 'completed' ? 'disabled' : ''}>标记已完成</button>
      <button type="button" data-action="event-status-abandoned" ${status === 'abandoned' ? 'disabled' : ''}>标记已放弃</button>
    `
        : ''
    }
    <span class="context-divider" aria-hidden="true"></span>
    <button class="is-danger" type="button" data-action="event-delete">删除日程</button>
  `;
  runtime.els.eventContextMenu.hidden = false;
  runtime.suppressNextDocumentClick = true;
  positionViewportMenu(runtime.els.eventContextMenu, event.clientX, event.clientY);
}

export function openTimelineContextMenu(event, column) {
  if (runtime.rightSelectState?.activated || runtime.suppressTimelineContextMenu) {
    event.preventDefault();
    event.stopPropagation();
    runtime.suppressTimelineContextMenu = false;
    return;
  }
  if ((event.target as Element).closest<HTMLElement>('.event-card')) return;
  event.preventDefault();
  event.stopPropagation();
  showTimelinePasteMenu(event.clientX, event.clientY, column);
}

export function showTimelinePasteMenu(clientX, clientY, column) {
  runtime.contextEventId = null;
  runtime.lastTimelinePointerTarget = getTimelinePointTarget(clientX, clientY) || {
    date: column.dataset.date,
    minute: snapMinute(minuteFromColumnPoint(column, clientY)),
    clientX,
    clientY,
  };
  runtime.timelinePasteTarget = {
    date: runtime.lastTimelinePointerTarget.date,
    minute: runtime.lastTimelinePointerTarget.minute,
  };
  closeFloatingMenus();
  runtime.els.eventContextMenu.innerHTML = `
    <button type="button" data-action="event-paste" ${runtime.clipboardEvent ? '' : 'disabled'}>粘贴日程</button>
  `;
  runtime.els.eventContextMenu.classList.add('is-paste-menu');
  runtime.els.eventContextMenu.hidden = false;
  runtime.suppressNextDocumentClick = true;
  positionViewportMenu(runtime.els.eventContextMenu, clientX, clientY);
}

export function handleEventContextClick(event) {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'event-copy') copyContextEvent();
  if (action === 'event-delete') deleteContextEvent();
  if (action === 'event-paste') pasteClipboardEvent();
  if (action === 'event-status-open') setContextEventStatus('open');
  if (action === 'event-status-completed') setContextEventStatus('completed');
  if (action === 'event-status-abandoned') setContextEventStatus('abandoned');
  closeFloatingMenus();
}

export function copyContextEvent() {
  const event = runtime.state.events.find((item) => item.id === runtime.contextEventId);
  if (!event) return;
  runtime.clipboardEvent = structuredClone
    ? structuredClone(event)
    : JSON.parse(JSON.stringify(event));
}

export function deleteContextEvent() {
  if (!runtime.contextEventId) return;
  pushUndoSnapshot();
  runtime.state.events = runtime.state.events.filter(
    (event) => event.id !== runtime.contextEventId,
  );
  if (runtime.state.activeEventId === runtime.contextEventId) runtime.state.activeEventId = null;
  runtime.selectedEventIds.delete(runtime.contextEventId);
  saveAndRender({ preserveScroll: true });
}

export function setContextEventStatus(status) {
  if (!runtime.contextEventId) return;
  setEventStatus(runtime.contextEventId, status);
}

export function pasteClipboardEvent() {
  if (!runtime.clipboardEvent) return;
  const pasteTarget = getPasteTargetForClipboard();
  if (!pasteTarget) return;
  const duration = Math.max(15, getEventDurationMinutes(runtime.clipboardEvent));
  const startAbs = dateTimeToAbsoluteMinute(pasteTarget.date, pasteTarget.minute);
  const endAbs = startAbs + duration;
  const start = absoluteMinuteToDateTime(startAbs);
  const end = absoluteMinuteToDateTime(endAbs);
  const next: PlannerEvent = {
    ...runtime.clipboardEvent,
    recurrenceGroupId: '',
    recurrenceIndex: null,
    id: crypto.randomUUID(),
    date: start.date,
    endDate: end.date,
    start: minuteToTime(start.minute),
    end: minuteToTime(end.minute === TOTAL_MINUTES ? 0 : end.minute),
    completed: false,
    status: getEventType(runtime.clipboardEvent) === 'todo' ? 'open' : 'open',
  };
  pushUndoSnapshot();
  runtime.state.events.push(next);
  runtime.state.activeEventId = next.id;
  runtime.selectedEventIds = new Set([next.id]);
  saveAndRender({ preserveScroll: true });
}
