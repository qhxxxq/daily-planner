/**
 * 文件用途：新建日程与拖动创建。
 * 根据日期、指针位置和当前列表生成事件；维护拖动创建过程中的预览，在交互结束时提交日程。
 */
import type { PlannerEvent } from '../types/model.js';
import { getSource } from '../app/queries.js';
import { runtime } from '../app/runtime.js';
import { clamp } from '../domain/math.js';
import { TOTAL_MINUTES } from '../app/config.js';
import {
  absoluteMinuteToDateTime,
  dateTimeToAbsoluteMinute,
  getDateKeysBetween,
  minuteToTime,
} from '../domain/date-time.js';
import { pushUndoSnapshot } from './undo.js';
import { saveAndRender } from '../app/persistence.js';
import {
  getTimelineColumnByDate,
  getTimelineColumnFromPoint,
  minuteFromColumnPoint,
  minuteToY,
  minutesToHeight,
  snapMinute,
} from './timeline-geometry.js';
import { darkenHex, hexToRgba } from '../domain/colors.js';

export function createTimedEvent(dateKey, minute) {
  const source = getSource(runtime.state.selectedSourceId) || runtime.state.sources[0];
  const start = clamp(minute, 0, TOTAL_MINUTES - 15);
  const end = Math.min(start + 30, TOTAL_MINUTES);
  const event: PlannerEvent = {
    id: crypto.randomUUID(),
    title: '新日程',
    date: dateKey,
    endDate: dateKey,
    start: minuteToTime(start),
    end: minuteToTime(end),
    notes: '',
    allDay: false,
    travelTime: 0,
    tags: [],
    sourceId: source.id,
    type: source.type || 'todo',
    status: 'open',
    completed: false,
  };
  pushUndoSnapshot();
  runtime.state.events.push(event);
  runtime.state.activeEventId = event.id;
  saveAndRender({ preserveScroll: true });
}

export function startDragCreate(event, column) {
  if (event.button !== 0 || (event.target as Element).closest<HTMLElement>('.event-card')) return;
  const source = getSource(runtime.state.selectedSourceId) || runtime.state.sources[0];
  const startMinute = snapMinute(minuteFromColumnPoint(column, event.clientY));
  runtime.dragCreateState = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startDate: column.dataset.date,
    startMinute,
    currentDate: column.dataset.date,
    currentMinute: Math.min(startMinute + 15, TOTAL_MINUTES),
    sourceColor: source.color,
    previews: [],
    moved: false,
  };
  try {
    column.setPointerCapture?.(event.pointerId);
  } catch {
    // Synthetic pointer events used in tests may not have an active capture target.
  }
  event.preventDefault();
  updateDragCreatePreview();
}

export function handleDragCreateMove(event) {
  if (!runtime.dragCreateState || event.pointerId !== runtime.dragCreateState.pointerId) return;
  updateDragCreateFromPointer(event);
}

export function finishDragCreate(event) {
  if (!runtime.dragCreateState || event.pointerId !== runtime.dragCreateState.pointerId) return;
  updateDragCreateFromPointer(event);
  const range = getDragCreateRange();
  const moved = runtime.dragCreateState.moved;
  clearDragCreate();
  if (!moved) return;
  createTimedEventRange(range.start.date, range.start.minute, range.end.date, range.end.minute);
}

export function clearDragCreate() {
  if (!runtime.dragCreateState) return;
  clearDragCreatePreviews();
  runtime.dragCreateState = null;
}

export function updateDragCreatePreview() {
  if (!runtime.dragCreateState) return;
  clearDragCreatePreviews();
  const range = getDragCreateRange();
  const label = `${minuteToTime(range.start.minute)} - ${minuteToTime(range.end.minute === TOTAL_MINUTES ? 0 : range.end.minute)}`;
  getDateKeysBetween(range.start.date, range.end.date).forEach((dateKey) => {
    const column = getTimelineColumnByDate(dateKey);
    if (!column) return;
    const segmentStart = dateKey === range.start.date ? range.start.minute : 0;
    const segmentEnd = dateKey === range.end.date ? range.end.minute : TOTAL_MINUTES;
    if (segmentEnd <= segmentStart) return;
    column.classList.add('is-dragging');
    const preview = document.createElement('div');
    preview.className = 'drag-preview';
    preview.style.setProperty('--event-color', runtime.dragCreateState.sourceColor);
    preview.style.setProperty('--event-bg', hexToRgba(runtime.dragCreateState.sourceColor, 0.14));
    preview.style.setProperty(
      '--event-border',
      hexToRgba(runtime.dragCreateState.sourceColor, 0.36),
    );
    preview.style.setProperty(
      '--event-category-text',
      darkenHex(runtime.dragCreateState.sourceColor),
    );
    preview.style.top = `${minuteToY(segmentStart)}px`;
    preview.style.height = `${Math.max(minuteToY(segmentEnd) - minuteToY(segmentStart), minutesToHeight(15))}px`;
    preview.textContent = label;
    column.append(preview);
    runtime.dragCreateState.previews.push(preview);
  });
}

export function clearDragCreatePreviews() {
  runtime.dragCreateState?.previews.forEach((preview) => {
    const column = preview.parentElement;
    column?.classList.remove('is-dragging');
    preview.remove();
  });
  if (runtime.dragCreateState) runtime.dragCreateState.previews = [];
}

export function updateDragCreateFromPointer(event) {
  if (!runtime.dragCreateState) return;
  const column =
    getTimelineColumnFromPoint(event.clientX) ||
    getTimelineColumnByDate(runtime.dragCreateState.currentDate);
  if (!column) return;
  const distance = Math.hypot(
    event.clientX - runtime.dragCreateState.startClientX,
    event.clientY - runtime.dragCreateState.startClientY,
  );
  runtime.dragCreateState.currentDate = column.dataset.date;
  runtime.dragCreateState.currentMinute = snapMinute(minuteFromColumnPoint(column, event.clientY));
  runtime.dragCreateState.moved = distance >= 4;
  updateDragCreatePreview();
}

export function getDragCreateRange() {
  const startAbs = dateTimeToAbsoluteMinute(
    runtime.dragCreateState.startDate,
    runtime.dragCreateState.startMinute,
  );
  let endAbs = dateTimeToAbsoluteMinute(
    runtime.dragCreateState.currentDate,
    runtime.dragCreateState.currentMinute,
  );
  if (endAbs === startAbs) endAbs = startAbs + 15;
  const minAbs = Math.min(startAbs, endAbs);
  const maxAbs = Math.max(startAbs, endAbs);
  return {
    start: absoluteMinuteToDateTime(minAbs),
    end: absoluteMinuteToDateTime(Math.max(maxAbs, minAbs + 15)),
  };
}

export function createTimedEventRange(startDate, startMinute, endDate, endMinute) {
  const source = getSource(runtime.state.selectedSourceId) || runtime.state.sources[0];
  const event: PlannerEvent = {
    id: crypto.randomUUID(),
    title: '新日程',
    date: startDate,
    endDate,
    start: minuteToTime(startMinute),
    end: minuteToTime(endMinute === TOTAL_MINUTES ? 0 : endMinute),
    notes: '',
    allDay: false,
    travelTime: 0,
    tags: [],
    sourceId: source.id,
    type: source.type || 'todo',
    status: 'open',
    completed: false,
  };
  pushUndoSnapshot();
  runtime.state.events.push(event);
  runtime.state.activeEventId = event.id;
  saveAndRender({ preserveScroll: true });
}

export function createAllDayEvent(dateKey) {
  const source = getSource(runtime.state.selectedSourceId) || runtime.state.sources[0];
  const event: PlannerEvent = {
    id: crypto.randomUUID(),
    title: '全天日程',
    date: dateKey,
    endDate: dateKey,
    start: '00:00',
    end: '00:15',
    notes: '',
    allDay: true,
    travelTime: 0,
    tags: [],
    sourceId: source.id,
    type: source.type || 'todo',
    status: 'open',
    completed: false,
  };
  pushUndoSnapshot();
  runtime.state.events.push(event);
  runtime.state.activeEventId = event.id;
  saveAndRender({ preserveScroll: true });
}
