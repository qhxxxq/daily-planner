/**
 * 文件用途：日程移动、缩放与框选。
 * 把指针位移转换为时间或日期变化，维护拖动预览与选择集合；交互结束后记录撤销并保存变更。
 */
import { getEventDurationMinutes, getEventTravelMinutes, isAllDayEvent } from '../domain/events.js';
import { runtime } from '../app/runtime.js';
import {
  absoluteMinuteToDateTime,
  dateTimeToAbsoluteMinute,
  minuteToTime,
  parseDateKey,
  timeToMinute,
  toMonthKey,
} from '../domain/date-time.js';
import {
  getTimelineColumnByDate,
  getTimelineColumnFromPoint,
  minuteFromColumnPoint,
  minuteToY,
  minutesToHeight,
  snapMinute,
} from './timeline-geometry.js';
import { closeFloatingMenus } from './menus.js';
import { pushUndoSnapshot } from './undo.js';
import { TOTAL_MINUTES } from '../app/config.js';
import { saveAndRender } from '../app/persistence.js';
import { showTimelinePasteMenu } from './clipboard.js';

/** 区分完成按钮、边缘缩放、右键选择和普通移动；创建包含原始位置的交互状态，后续指针事件以此计算位移。 */
export function startEventPointerInteraction(pointerEvent, event, card) {
  if (pointerEvent.target.closest('.complete-toggle')) return;

  const resizeEdge = getEventResizeEdgeFromPointer(pointerEvent, card);
  if (resizeEdge && pointerEvent.button === 0 && !isAllDayEvent(event)) {
    startEventResizeInteraction(pointerEvent, event, card, resizeEdge);
    return;
  }

  if (pointerEvent.button === 2) {
    startRightPressSelection(pointerEvent, event.id, card);
    return;
  }

  if (pointerEvent.button !== 0 || isAllDayEvent(event)) return;
  const sourceEvent = runtime.state.events.find((item) => item.id === event.id);
  if (!sourceEvent) return;
  const dragIds =
    runtime.selectedEventIds.has(event.id) && runtime.selectedEventIds.size > 1
      ? [...runtime.selectedEventIds]
      : [event.id];
  const draggedEvents = dragIds
    .map((id) => runtime.state.events.find((item) => item.id === id))
    .filter((item) => item && !isAllDayEvent(item));
  if (!draggedEvents.length) return;
  const startAbs = dateTimeToAbsoluteMinute(sourceEvent.date, timeToMinute(sourceEvent.start));
  const duration = Math.max(15, getEventDurationMinutes(sourceEvent));
  const startPointerColumn =
    getTimelineColumnFromPoint(pointerEvent.clientX) || card.closest('.timeline-column');
  if (!startPointerColumn) return;
  const draggedIds = draggedEvents.map((item) => item.id);

  runtime.eventDragState = {
    pointerId: pointerEvent.pointerId,
    eventId: event.id,
    card,
    cards: draggedIds
      .map((id) =>
        document.querySelector<HTMLElement>(`.event-card[data-event-id="${CSS.escape(id)}"]`),
      )
      .filter(Boolean),
    draggedIds,
    eventSnapshots: draggedEvents.map((item) => ({
      id: item.id,
      startAbs: dateTimeToAbsoluteMinute(item.date, timeToMinute(item.start)),
      duration: Math.max(15, getEventDurationMinutes(item)),
    })),
    startClientX: pointerEvent.clientX,
    startClientY: pointerEvent.clientY,
    startPointerAbs: dateTimeToAbsoluteMinute(
      startPointerColumn.dataset.date,
      minuteFromColumnPoint(startPointerColumn, pointerEvent.clientY),
    ),
    eventStartAbs: startAbs,
    duration,
    moved: false,
  };
  runtime.selectedEventIds = new Set(draggedIds);
  renderCurrentSelectionClasses();
  try {
    card.setPointerCapture?.(pointerEvent.pointerId);
  } catch {
    // 测试或合成指针事件可能没有可捕获目标，此时仍允许其余交互逻辑继续。
  }
  pointerEvent.preventDefault();
  pointerEvent.stopPropagation();
}

export function getEventResizeEdgeFromPointer(pointerEvent, card) {
  if (pointerEvent.target.closest('.complete-toggle')) return '';
  const handle = pointerEvent.target.closest('.resize-handle');
  if (handle?.closest('.event-card') === card) return handle.dataset.resizeEdge || '';
  const rect = card.getBoundingClientRect();
  if (pointerEvent.clientY < rect.top || pointerEvent.clientY > rect.bottom) return '';
  // 整条边缘留出稳定的命中区；中央手柄另有更大的热区，左右中部仍用于移动。
  const edgeHitSize = Math.min(10, rect.height / 4);
  if (pointerEvent.clientY - rect.top <= edgeHitSize) return 'top';
  if (rect.bottom - pointerEvent.clientY <= edgeHitSize) return 'bottom';
  return '';
}

export function updateEventResizeCursor(pointerEvent, event, card) {
  if (runtime.eventDragState?.mode === 'resize' && runtime.eventDragState.card === card) return;
  const edge = isAllDayEvent(event) ? '' : getEventResizeEdgeFromPointer(pointerEvent, card);
  card.classList.toggle('is-resize-edge-hover', !!edge);
  card.dataset.resizeEdgeHover = edge;
}

export function startEventResizeInteraction(pointerEvent, event, card, edge) {
  const sourceEvent = runtime.state.events.find((item) => item.id === event.id);
  if (!sourceEvent) return;
  const column =
    getTimelineColumnFromPoint(pointerEvent.clientX) || card.closest('.timeline-column');
  if (!column) return;
  const startAbs = dateTimeToAbsoluteMinute(sourceEvent.date, timeToMinute(sourceEvent.start));
  const endAbs = startAbs + Math.max(15, getEventDurationMinutes(sourceEvent));
  const travelMinutes = getEventTravelMinutes(sourceEvent);
  const visualStartAbs = startAbs - travelMinutes;

  runtime.eventDragState = {
    mode: 'resize',
    edge,
    pointerId: pointerEvent.pointerId,
    eventId: event.id,
    card,
    cards: [card],
    startClientX: pointerEvent.clientX,
    startClientY: pointerEvent.clientY,
    startPointerAbs: dateTimeToAbsoluteMinute(
      column.dataset.date,
      minuteFromColumnPoint(column, pointerEvent.clientY),
    ),
    sourceStartAbs: startAbs,
    sourceEndAbs: endAbs,
    sourceVisualStartAbs: visualStartAbs,
    travelMinutes,
    originalTop: card.style.top,
    originalHeight: card.style.height,
    moved: false,
  };
  runtime.selectedEventIds = new Set([event.id]);
  runtime.state.activeEventId = null;
  renderCurrentSelectionClasses();
  card.classList.add('is-event-resizing');
  card.dataset.resizeEdgeHover = edge;
  try {
    card.setPointerCapture?.(pointerEvent.pointerId);
  } catch {
    // Synthetic pointer events used in tests may not have an active capture target.
  }
  pointerEvent.preventDefault();
  pointerEvent.stopPropagation();
}

export function startRightPressSelection(pointerEvent, eventId, card) {
  clearRightPressSelection();
  runtime.rightSelectState = {
    pointerId: pointerEvent.pointerId,
    eventId,
    card,
    startX: pointerEvent.clientX,
    startY: pointerEvent.clientY,
    currentX: pointerEvent.clientX,
    currentY: pointerEvent.clientY,
    rect: null,
    baseSelection: new Set(runtime.selectedEventIds),
    activated: false,
    timer: window.setTimeout(() => {
      if (
        !runtime.rightSelectState ||
        runtime.rightSelectState.pointerId !== pointerEvent.pointerId
      )
        return;
      activateRightSelection(pointerEvent.clientX, pointerEvent.clientY);
    }, 420),
  };
  try {
    card.setPointerCapture?.(pointerEvent.pointerId);
  } catch {
    // Some secondary-button pointer events cannot be captured in synthetic tests.
  }
  pointerEvent.stopPropagation();
}

export function handleEventPointerMove(pointerEvent) {
  if (runtime.rightSelectState && pointerEvent.pointerId === runtime.rightSelectState.pointerId) {
    const distance = Math.hypot(
      pointerEvent.clientX - runtime.rightSelectState.startX,
      pointerEvent.clientY - runtime.rightSelectState.startY,
    );
    if (!runtime.rightSelectState.activated && distance > 6)
      activateRightSelection(pointerEvent.clientX, pointerEvent.clientY);
    if (runtime.rightSelectState.activated) {
      updateRightSelectionRect(pointerEvent.clientX, pointerEvent.clientY);
      pointerEvent.preventDefault();
      return;
    }
  }

  if (!runtime.eventDragState || pointerEvent.pointerId !== runtime.eventDragState.pointerId)
    return;
  if (runtime.eventDragState.mode === 'resize') {
    updateEventResizePreview(pointerEvent);
    pointerEvent.preventDefault();
    return;
  }
  const distance = Math.hypot(
    pointerEvent.clientX - runtime.eventDragState.startClientX,
    pointerEvent.clientY - runtime.eventDragState.startClientY,
  );
  if (distance < 4) return;
  runtime.eventDragState.moved = true;
  runtime.eventDragState.cards.forEach((card) => {
    card.classList.add('is-event-dragging');
    card.style.transform = `translate(${pointerEvent.clientX - runtime.eventDragState.startClientX}px, ${pointerEvent.clientY - runtime.eventDragState.startClientY}px)`;
  });
  pointerEvent.preventDefault();
}

export function activateRightSelection(clientX, clientY) {
  if (!runtime.rightSelectState || runtime.rightSelectState.activated) return;
  runtime.rightSelectState.activated = true;
  closeFloatingMenus();
  if (runtime.rightSelectState.eventId)
    runtime.rightSelectState.baseSelection.add(runtime.rightSelectState.eventId);
  runtime.selectedEventIds = new Set<string>(runtime.rightSelectState.baseSelection);
  runtime.state.activeEventId = null;
  runtime.rightSelectState.rect = createSelectionRect();
  updateRightSelectionRect(clientX, clientY);
  renderCurrentSelectionClasses();
  if (runtime.rightSelectState.eventId)
    runtime.suppressEventClickId = runtime.rightSelectState.eventId;
}

/** 在指针结束时把有效移动应用到选中的日程并保存；随后清理捕获与预览状态，避免拖动结束后的点击再次打开卡片。 */
export function finishEventPointerInteraction(pointerEvent) {
  finishRightPressSelection(pointerEvent);
  if (!runtime.eventDragState || pointerEvent.pointerId !== runtime.eventDragState.pointerId)
    return;
  const drag = runtime.eventDragState;
  if (drag.mode === 'resize') {
    finishEventResize(pointerEvent);
    return;
  }
  clearEventDragVisuals();
  if (!drag.moved) {
    runtime.eventDragState = null;
    return;
  }

  const column =
    getTimelineColumnFromPoint(pointerEvent.clientX) ||
    getTimelineColumnByDate(runtime.state.events.find((event) => event.id === drag.eventId)?.date);
  if (!column) {
    runtime.eventDragState = null;
    return;
  }

  const endPointerAbs = dateTimeToAbsoluteMinute(
    column.dataset.date,
    minuteFromColumnPoint(column, pointerEvent.clientY),
  );
  const delta = snapMinute(endPointerAbs - drag.startPointerAbs);
  const primarySnapshot =
    drag.eventSnapshots.find((item) => item.id === drag.eventId) || drag.eventSnapshots[0];
  const primaryStart = absoluteMinuteToDateTime(primarySnapshot.startAbs + delta);

  pushUndoSnapshot();
  drag.eventSnapshots.forEach((snapshot) => {
    const sourceEvent = runtime.state.events.find((event) => event.id === snapshot.id);
    if (!sourceEvent) return;
    const nextStart = absoluteMinuteToDateTime(snapshot.startAbs + delta);
    const nextEnd = absoluteMinuteToDateTime(snapshot.startAbs + delta + snapshot.duration);
    sourceEvent.date = nextStart.date;
    sourceEvent.endDate = nextEnd.date;
    sourceEvent.start = minuteToTime(nextStart.minute);
    sourceEvent.end = minuteToTime(nextEnd.minute === TOTAL_MINUTES ? 0 : nextEnd.minute);
  });
  runtime.state.selectedDate = primaryStart.date;
  runtime.state.miniMonth = toMonthKey(parseDateKey(primaryStart.date));
  runtime.state.activeEventId = null;
  runtime.selectedEventIds = new Set(drag.draggedIds);
  runtime.suppressEventClickId = drag.eventId;
  runtime.eventDragState = null;
  saveAndRender({ preserveScroll: true });
}

export function clearEventPointerInteraction(pointerEvent) {
  if (
    runtime.rightSelectState &&
    (!pointerEvent || pointerEvent.pointerId === runtime.rightSelectState.pointerId)
  )
    clearRightPressSelection();
  if (
    runtime.eventDragState &&
    (!pointerEvent || pointerEvent.pointerId === runtime.eventDragState.pointerId)
  ) {
    clearEventDragVisuals();
    clearEventResizeVisuals();
    runtime.eventDragState = null;
  }
}

export function clearEventDragVisuals() {
  if (!runtime.eventDragState?.cards?.length) return;
  runtime.eventDragState.cards.forEach((card) => {
    card.classList.remove('is-event-dragging');
    card.style.transform = '';
  });
}

export function updateEventResizePreview(pointerEvent) {
  const resize = runtime.eventDragState;
  if (!resize.moved && Math.abs(pointerEvent.clientY - resize.startClientY) < 4) return;
  const bounds = getResizeBoundsFromPointer(pointerEvent);
  if (!bounds) return;
  resize.moved = true;
  const startMinute = absoluteMinuteToDateTime(bounds.visualStartAbs).minute;
  const endMinute = absoluteMinuteToDateTime(bounds.endAbs).minute || TOTAL_MINUTES;
  resize.card.style.top = `${minuteToY(startMinute)}px`;
  resize.card.style.height = `${Math.max(minutesToHeight(bounds.endAbs - bounds.visualStartAbs), minutesToHeight(15))}px`;
}

export function finishEventResize(pointerEvent) {
  const resize = runtime.eventDragState;
  const bounds = getResizeBoundsFromPointer(pointerEvent);
  clearEventResizeVisuals();
  runtime.eventDragState = null;
  if (!bounds || !resize.moved) return;
  runtime.suppressEventClickId = resize.eventId;
  if (bounds.startAbs === resize.sourceStartAbs && bounds.endAbs === resize.sourceEndAbs) return;
  const sourceEvent = runtime.state.events.find((event) => event.id === resize.eventId);
  if (!sourceEvent) return;
  pushUndoSnapshot();
  const nextStart = absoluteMinuteToDateTime(bounds.startAbs);
  const nextEnd = absoluteMinuteToDateTime(bounds.endAbs);
  sourceEvent.date = nextStart.date;
  sourceEvent.start = minuteToTime(nextStart.minute);
  sourceEvent.endDate = nextEnd.date;
  sourceEvent.end = minuteToTime(nextEnd.minute === TOTAL_MINUTES ? 0 : nextEnd.minute);
  runtime.state.selectedDate = sourceEvent.date;
  runtime.state.miniMonth = toMonthKey(parseDateKey(sourceEvent.date));
  runtime.selectedEventIds = new Set([sourceEvent.id]);
  runtime.suppressEventClickId = sourceEvent.id;
  saveAndRender({ preserveScroll: true });
}

/** 将指针位置转换为缩放边界，同时考虑行程时间、吸附刻度和最短时长，返回预览与最终提交共用的时间范围。 */
export function getResizeBoundsFromPointer(pointerEvent) {
  const resize = runtime.eventDragState;
  if (!resize) return null;
  const column =
    getTimelineColumnFromPoint(pointerEvent.clientX) ||
    getTimelineColumnByDate(absoluteMinuteToDateTime(resize.sourceStartAbs).date);
  if (!column) return null;
  const pointerAbs = dateTimeToAbsoluteMinute(
    column.dataset.date,
    minuteFromColumnPoint(column, pointerEvent.clientY),
  );
  const delta = snapMinute(pointerAbs - resize.startPointerAbs);
  let startAbs = resize.sourceStartAbs;
  let endAbs = resize.sourceEndAbs;
  if (resize.edge === 'top') {
    const maxVisualStartAbs = resize.sourceEndAbs - resize.travelMinutes - 15;
    const visualStartAbs = Math.min(resize.sourceVisualStartAbs + delta, maxVisualStartAbs);
    startAbs = visualStartAbs + resize.travelMinutes;
  } else {
    endAbs = Math.max(resize.sourceEndAbs + delta, resize.sourceStartAbs + 15);
  }
  if (endAbs <= startAbs) endAbs = startAbs + 15;
  return { startAbs, endAbs, visualStartAbs: startAbs - resize.travelMinutes };
}

export function clearEventResizeVisuals() {
  if (!runtime.eventDragState?.card) return;
  runtime.eventDragState.card.classList.remove('is-event-resizing');
  runtime.eventDragState.card.classList.remove('is-resize-edge-hover');
  delete runtime.eventDragState.card.dataset.resizeEdgeHover;
  if (runtime.eventDragState.originalTop != null)
    runtime.eventDragState.card.style.top = runtime.eventDragState.originalTop;
  if (runtime.eventDragState.originalHeight != null)
    runtime.eventDragState.card.style.height = runtime.eventDragState.originalHeight;
}

export function finishRightPressSelection(pointerEvent) {
  if (!runtime.rightSelectState || pointerEvent.pointerId !== runtime.rightSelectState.pointerId)
    return;
  const activated = runtime.rightSelectState.activated;
  const eventId = runtime.rightSelectState.eventId;
  if (activated) updateRightSelectionRect(pointerEvent.clientX, pointerEvent.clientY);
  clearRightPressSelection();
  if (activated && eventId) runtime.suppressEventClickId = eventId;
  if (activated) runtime.suppressTimelinePasteMenuUntil = performance.now() + 800;
  if (activated && !eventId) runtime.suppressTimelineContextMenu = true;
  if (!activated && !eventId) {
    const column = getTimelineColumnFromPoint(pointerEvent.clientX);
    if (column) showTimelinePasteMenu(pointerEvent.clientX, pointerEvent.clientY, column);
  }
}

export function shouldSuppressTimelinePasteMenu() {
  return (
    !!runtime.rightSelectState?.activated ||
    performance.now() < runtime.suppressTimelinePasteMenuUntil
  );
}

export function clearRightPressSelection() {
  if (runtime.rightSelectState?.timer) window.clearTimeout(runtime.rightSelectState.timer);
  runtime.rightSelectState?.rect?.remove();
  runtime.rightSelectState = null;
}

export function toggleEventSelection(eventId) {
  if (runtime.selectedEventIds.has(eventId)) runtime.selectedEventIds.delete(eventId);
  else runtime.selectedEventIds.add(eventId);
  runtime.state.activeEventId = null;
  saveAndRender({ preserveScroll: true });
}

export function addEventSelectionAtPoint(clientX, clientY) {
  const selectionBox = {
    left: clientX,
    right: clientX,
    top: clientY,
    bottom: clientY,
    width: 1,
    height: 1,
  };
  updateSelectionFromBox(selectionBox);
}

export function createSelectionRect() {
  const rect = document.createElement('div');
  rect.className = 'selection-rect';
  document.body.append(rect);
  return rect;
}

export function updateRightSelectionRect(clientX, clientY) {
  if (!runtime.rightSelectState?.rect) return;
  runtime.rightSelectState.currentX = clientX;
  runtime.rightSelectState.currentY = clientY;
  const selectionBox = getRightSelectionBox();
  runtime.rightSelectState.rect.style.left = `${selectionBox.left}px`;
  runtime.rightSelectState.rect.style.top = `${selectionBox.top}px`;
  runtime.rightSelectState.rect.style.width = `${selectionBox.width}px`;
  runtime.rightSelectState.rect.style.height = `${selectionBox.height}px`;
  updateSelectionFromBox(selectionBox);
}

export function getRightSelectionBox() {
  const left = Math.min(runtime.rightSelectState.startX, runtime.rightSelectState.currentX);
  const top = Math.min(runtime.rightSelectState.startY, runtime.rightSelectState.currentY);
  const right = Math.max(runtime.rightSelectState.startX, runtime.rightSelectState.currentX);
  const bottom = Math.max(runtime.rightSelectState.startY, runtime.rightSelectState.currentY);
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

export function updateSelectionFromBox(selectionBox) {
  const next = new Set<string>(runtime.rightSelectState?.baseSelection || runtime.selectedEventIds);
  document.querySelectorAll<HTMLElement>('.event-card[data-event-id]').forEach((card) => {
    if (rectsIntersect(selectionBox, card.getBoundingClientRect())) next.add(card.dataset.eventId);
  });
  runtime.selectedEventIds = next;
  runtime.state.activeEventId = null;
  renderCurrentSelectionClasses();
}

export function renderCurrentSelectionClasses() {
  document.querySelectorAll<HTMLElement>('.event-card[data-event-id]').forEach((card) => {
    card.classList.toggle('is-selected-event', runtime.selectedEventIds.has(card.dataset.eventId));
  });
}

export function rectsIntersect(first, second) {
  return (
    first.left <= second.right &&
    first.right >= second.left &&
    first.top <= second.bottom &&
    first.bottom >= second.top
  );
}
