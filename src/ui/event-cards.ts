/**
 * 文件用途：时间轴日程卡片生成。
 * 将布局记录转换为卡片 DOM，展示时间、标签、状态与嵌套内容；设置定位和配色并连接卡片交互。
 */
import { isWrapperEvent } from '../domain/events.js';
import { normalizeTime, timeToMinute } from '../domain/date-time.js';
import { EVENT_GUTTER_PX, START_HOUR } from '../app/config.js';
import {
  formatEventTimeMeta,
  formatTravelTime,
  getEventTravelMinutes,
  isEventAbandoned,
  isEventCompleted,
  normalizeItemType,
} from '../domain/events.js';
import { getEventType } from '../app/queries.js';
import { minuteToY, minutesToHeight } from './timeline-geometry.js';
import { getSource } from '../app/queries.js';
import { runtime } from '../app/runtime.js';
import {
  darkenHex,
  getCompletedPalette,
  hexToRgb,
  hexToRgba,
  kebabCase,
} from '../domain/colors.js';
import { layoutOverlappingEvents } from '../domain/event-layout.js';
import { normalizeTags } from '../domain/tags.js';
import {
  startEventPointerInteraction,
  toggleEventSelection,
  updateEventResizeCursor,
} from './event-drag.js';
import { toggleEventDone } from './event-save.js';
import { openEventForm } from './editor.js';
import { openEventCardContextMenu } from './clipboard.js';

export function createPositionedEventCard(event) {
  if (isWrapperEvent(event)) return createWrapperEventCard(event);
  const card = createEventCard(event);
  const start = timeToMinute(event.start);
  const visualStart = Math.max(START_HOUR * 60, start - getEventTravelMinutes(event));
  const end = Math.max(timeToMinute(event.end), start + 15);
  const duration = end - start;
  const travelOffset = Math.max(0, minuteToY(start) - minuteToY(visualStart));
  card.classList.add('positioned-event');
  card.classList.add(`is-${event.layoutMode || 'normal'}`);
  if (event.hasNestedLabelCollision) card.classList.add('has-nested-label-collision');
  if (event.parentEventId) card.dataset.parentEventId = event.parentEventId;
  if (duration < 60) card.classList.add('is-short-event');
  if (duration <= 15 && !travelOffset) card.classList.add('is-tiny-event');
  if (travelOffset) card.classList.add('has-travel-time');
  card.style.top = `${minuteToY(visualStart)}px`;
  card.style.height = `${Math.max(minuteToY(end) - minuteToY(visualStart), minutesToHeight(15))}px`;
  const leftPx = event.layoutLeftPx ?? EVENT_GUTTER_PX;
  const widthPx = event.layoutWidthPx ?? -(EVENT_GUTTER_PX * 2);
  card.style.left = `calc(${event.layoutLeftPercent ?? 0}% + ${leftPx}px)`;
  card.style.width = `calc(${event.layoutWidthPercent ?? 100}% + ${widthPx}px)`;
  card.style.right = 'auto';
  card.style.setProperty('--travel-offset', `${travelOffset}px`);
  return card;
}

export function createWrapperEventCard(event) {
  const source = getSource(event.sourceId) || runtime.state.sources[0];
  const start = timeToMinute(event.start);
  const end = Math.max(timeToMinute(event.end), start + 15);
  const wrapper = document.createElement('div');
  wrapper.className = 'positioned-event event-wrapper';
  wrapper.dataset.eventId = event.id;
  wrapper.style.setProperty('--event-color', source.color);
  wrapper.style.setProperty('--event-bg', hexToRgba(source.color, 0.08));
  wrapper.style.setProperty('--event-border', hexToRgba(source.color, 0.22));
  wrapper.style.top = `${minuteToY(start)}px`;
  wrapper.style.height = `${Math.max(minuteToY(end) - minuteToY(start), minutesToHeight(15))}px`;
  wrapper.style.left = `${EVENT_GUTTER_PX}px`;
  wrapper.style.width = `calc(100% - ${EVENT_GUTTER_PX * 2}px)`;

  const label = document.createElement('div');
  label.className = 'event-wrapper-label';
  label.textContent = event.title || '';
  wrapper.append(label);

  layoutOverlappingEvents(normalizeWrapperChildren(event)).forEach((child) => {
    const childCard = createEventCard(child);
    const childStart = timeToMinute(child.start);
    const childEnd = Math.max(timeToMinute(child.end), childStart + 15);
    childCard.classList.add('positioned-event', 'event-wrapper-child');
    childCard.style.top = `${minutesToHeight(childStart - start)}px`;
    childCard.style.height = `${Math.max(minutesToHeight(childEnd - childStart), minutesToHeight(15))}px`;
    childCard.style.left = `calc(${child.layoutLeftPercent ?? 0}% + ${EVENT_GUTTER_PX}px)`;
    childCard.style.width = `calc(${child.layoutWidthPercent ?? 100}% - ${EVENT_GUTTER_PX * 2}px)`;
    childCard.style.right = 'auto';
    wrapper.append(childCard);
  });

  return wrapper;
}

export function normalizeWrapperChildren(event) {
  return event.children.map((child, index) => ({
    ...child,
    id: child.id || `${event.id}-child-${index}`,
    title: child.title || '未命名日程',
    date: event.date,
    endDate: event.endDate || event.date,
    start: normalizeTime(child.start || event.start),
    end: normalizeTime(child.end || event.end),
    sourceId: child.sourceId || event.sourceId,
    type: normalizeItemType(child.type, getEventType(event)),
    status: child.status || 'open',
    completed: child.completed === true,
    tags: normalizeTags(child.tags),
    notes: child.notes || '',
    allDay: false,
    travelTime: 0,
  }));
}

export function createEventCard(event) {
  const source = getSource(event.sourceId) || runtime.state.sources[0];
  const sourceRgb = hexToRgb(source.color);
  const normalTitleColor = darkenHex(source.color);
  const normalMetaColor = normalTitleColor;
  const completedPalette = getCompletedPalette(source.color, normalTitleColor, normalMetaColor);
  const isTodo = getEventType(event) === 'todo';
  const completed = isEventCompleted(event);
  const abandoned = isEventAbandoned(event);
  const travelMinutes = getEventTravelMinutes(event);
  const showTravelLabel = travelMinutes >= 30;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'event-card';
  button.dataset.eventId = event.id;
  button.title = `${event.title}\n${formatEventTimeMeta(event)}`;
  button.setAttribute('aria-label', `${event.title}，${formatEventTimeMeta(event)}`);
  button.style.setProperty('--event-color', source.color);
  button.style.setProperty('--event-rgb', `${sourceRgb.r}, ${sourceRgb.g}, ${sourceRgb.b}`);
  button.style.setProperty(
    '--event-bg',
    hexToRgba(source.color, runtime.state.theme === 'coral' ? 0.14 : 0.09),
  );
  button.style.setProperty('--event-border', hexToRgba(source.color, 0.36));
  button.style.setProperty('--event-line', hexToRgba(source.color, 0.65));
  button.style.setProperty('--event-category-text', normalTitleColor);
  button.style.setProperty(
    '--event-selected-bg',
    hexToRgba(source.color, runtime.state.theme === 'coral' ? 0.34 : 0.16),
  );
  button.style.setProperty('--event-selected-border', hexToRgba(source.color, 0.62));
  button.style.setProperty('--event-selected-text', normalTitleColor);
  Object.entries(completedPalette).forEach(([name, value]) =>
    button.style.setProperty(`--event-${kebabCase(name)}`, value),
  );
  if (isTodo && completed) button.classList.add('is-completed');
  if (isTodo && abandoned) button.classList.add('is-abandoned');
  if (!isTodo) button.classList.add('is-schedule-event');
  if (runtime.selectedEventIds.has(event.id)) button.classList.add('is-selected-event');
  button.innerHTML = `
    <span class="resize-handle resize-handle-top" data-resize-edge="top" title="拖动调整开始时间" aria-hidden="true"></span>
    <span class="resize-handle resize-handle-bottom" data-resize-edge="bottom" title="拖动调整结束时间" aria-hidden="true"></span>
    ${travelMinutes ? `<span class="event-travel${showTravelLabel ? '' : ' is-compact'}">${showTravelLabel ? `<span>行程时间 ${formatTravelTime(travelMinutes)}</span>` : ''}</span>` : ''}
    <span class="event-main">
      ${isTodo ? `<span class="complete-toggle" title="切换完成状态">${completed ? '✓' : abandoned ? '×' : ''}</span>` : ''}
      <span class="event-text"><span class="event-title"></span><span class="event-meta">${formatEventTimeMeta(event)}</span></span>
    </span>
    <span class="event-source"></span>
  `;
  button.querySelector<HTMLElement>('.event-title').textContent = event.title;
  button.querySelector<HTMLElement>('.event-source').textContent = source.name;
  button.addEventListener('pointerdown', (pointerEvent) =>
    startEventPointerInteraction(pointerEvent, event, button),
  );
  button.addEventListener('pointermove', (pointerEvent) =>
    updateEventResizeCursor(pointerEvent, event, button),
  );
  button.addEventListener('pointerleave', () => {
    if (button.classList.contains('is-event-resizing')) return;
    button.classList.remove('is-resize-edge-hover');
    delete button.dataset.resizeEdgeHover;
  });
  button.addEventListener('click', (clickEvent) => {
    clickEvent.stopPropagation();
    if (runtime.suppressEventClickId === event.id) {
      runtime.suppressEventClickId = null;
      return;
    }
    if ((clickEvent.target as Element).closest('.complete-toggle')) {
      toggleEventDone(event.id);
      return;
    }
    if (clickEvent.metaKey || clickEvent.ctrlKey || clickEvent.shiftKey) {
      toggleEventSelection(event.id);
      return;
    }
    openEventForm(event.id, button.getBoundingClientRect());
  });
  button.addEventListener('contextmenu', (contextEvent) =>
    openEventCardContextMenu(contextEvent, event.id),
  );
  return button;
}
