/**
 * 文件用途：日视图与周视图渲染。
 * 构建全天区域、时间刻度及日期列，插入布局后的日程卡片；根据渲染选项处理视图滚动。
 */
import { renderMonth } from './month-calendar.js';
import type { RenderOptions } from '../types/model.js';
import { runtime } from '../app/runtime.js';
import { updateNowLine } from './clock.js';
import {
  TOTAL_MINUTES_TO_PX,
  getCurrentMinuteOfDay,
  getTimelineWeekDays,
  isMinuteInTimeline,
  minuteFromColumnPoint,
  minuteToY,
  snapMinute,
} from './timeline-geometry.js';
import { DEFAULT_SCROLL_HOUR, END_HOUR, HOUR_HEIGHT, START_HOUR } from '../app/config.js';
import {
  formatDaySubtitle,
  formatWeekdayShort,
  getTodayKey,
  isValidDateKey,
  minuteToTime,
  parseDateKey,
  toDateKey,
} from '../domain/date-time.js';
import { layoutOverlappingEvents } from '../domain/event-layout.js';
import { getEventsForDate } from '../app/queries.js';
import { isAllDayEvent } from '../domain/events.js';
import { createEventCard, createPositionedEventCard } from './event-cards.js';
import { createAllDayEvent, createTimedEvent, startDragCreate } from './event-create.js';
import { shouldSuppressTimelinePasteMenu, startRightPressSelection } from './event-drag.js';
import { openTimelineContextMenu, showTimelinePasteMenu } from './clipboard.js';

export function renderCalendar(options: RenderOptions = {}) {
  if (runtime.state.viewMode === 'month') {
    renderMonth();
    runtime.els.calendarView.scrollTop = 0;
    return;
  }
  if (runtime.state.viewMode === 'week') renderWeek();
  else renderDay();
  updateNowLine({ rerenderOnDateChange: false });
  if (!options.preserveScroll && !runtime.hasAutoScrolledCalendar) {
    requestAnimationFrame(() => {
      runtime.els.calendarView.scrollTop = minuteToY(DEFAULT_SCROLL_HOUR * 60);
    });
    runtime.hasAutoScrolledCalendar = true;
  }
}

export function renderDay() {
  const day = parseDateKey(
    isValidDateKey(runtime.state.selectedDate) ? runtime.state.selectedDate : getTodayKey(),
  );
  const key = toDateKey(day);
  runtime.els.calendarView.className = 'calendar-view timeline-view day-view';
  runtime.els.calendarView.innerHTML = '';
  runtime.els.calendarView.append(createTimelineHeader([day]));
  const body = document.createElement('div');
  body.className = 'timeline-body';
  body.append(createTimeAxis());
  const columns = document.createElement('div');
  columns.className = 'timeline-columns day-columns';
  const column = createTimelineColumn(key);
  layoutOverlappingEvents(getEventsForDate(key).filter((event) => !isAllDayEvent(event))).forEach(
    (event) => column.append(createPositionedEventCard(event)),
  );
  columns.append(column);
  body.append(columns);
  runtime.els.calendarView.append(body);
}

export function renderWeek() {
  const days = getTimelineWeekDays();
  runtime.els.calendarView.className = 'calendar-view timeline-view week-view';
  runtime.els.calendarView.innerHTML = '';
  runtime.els.calendarView.append(createTimelineHeader(days));
  const body = document.createElement('div');
  body.className = 'timeline-body';
  body.append(createTimeAxis());
  const columns = document.createElement('div');
  columns.className = 'timeline-columns week-columns';
  days.forEach((day) => {
    const key = toDateKey(day);
    const column = createTimelineColumn(key);
    layoutOverlappingEvents(getEventsForDate(key).filter((event) => !isAllDayEvent(event))).forEach(
      (event) => column.append(createPositionedEventCard(event)),
    );
    columns.append(column);
  });
  body.append(columns);
  runtime.els.calendarView.append(body);
}

export function createTimelineHeader(days) {
  const header = document.createElement('div');
  header.className = 'timeline-header';
  header.style.setProperty('--day-count', days.length);
  header.innerHTML = `<div class="week-spacer"></div>`;
  const todayKey = toDateKey(new Date());
  days.forEach((day) => {
    const key = toDateKey(day);
    const head = document.createElement('div');
    head.className = 'week-day-head';
    if (key === todayKey) head.classList.add('is-today');
    head.innerHTML = `<button type="button"><span class="week-primary"><span class="week-date">${day.getDate()}</span><span class="week-name">${formatWeekdayShort(day)}</span></span><span class="week-subtitle">${formatDaySubtitle(day)}</span></button>`;
    header.append(head);
  });
  const label = document.createElement('div');
  label.className = 'all-day-label';
  label.textContent = '全天';
  header.append(label);
  days.forEach((day) => header.append(createAllDayCell(toDateKey(day))));
  return header;
}

export function createAllDayCell(dateKey) {
  const cell = document.createElement('div');
  cell.className = 'all-day-cell';
  cell.dataset.date = dateKey;
  getEventsForDate(dateKey)
    .filter(isAllDayEvent)
    .forEach((event) => {
      const card = createEventCard(event);
      card.classList.add('all-day-event');
      cell.append(card);
    });
  cell.addEventListener('click', (event) => {
    if ((event.target as Element).closest<HTMLElement>('.event-card')) return;
    event.preventDefault();
    event.stopPropagation();
    createAllDayEvent(dateKey);
  });
  return cell;
}

export function createTimeAxis() {
  const axis = document.createElement('div');
  axis.className = 'time-axis';
  axis.style.height = `${TOTAL_MINUTES_TO_PX()}px`;
  for (let hour = START_HOUR; hour <= END_HOUR; hour += 1) {
    const label = document.createElement('div');
    label.className = 'time-label';
    label.style.top = `${(hour - START_HOUR) * HOUR_HEIGHT}px`;
    label.textContent = `${String(hour % 24).padStart(2, '0')}:00`;
    axis.append(label);
  }
  const nowMinute = getCurrentMinuteOfDay();
  if (isMinuteInTimeline(nowMinute)) {
    const label = document.createElement('div');
    label.className = 'now-time-label';
    label.style.top = `${minuteToY(nowMinute)}px`;
    label.textContent = minuteToTime(nowMinute);
    axis.append(label);
  }
  return axis;
}

export function createTimelineColumn(dateKey) {
  const column = document.createElement('div');
  column.className = 'timeline-column';
  column.dataset.date = dateKey;
  column.style.height = `${TOTAL_MINUTES_TO_PX()}px`;
  if (dateKey === getTodayKey()) column.append(createNowLine());
  column.addEventListener('pointerdown', (event) => {
    if (event.button === 2 && !(event.target as Element).closest<HTMLElement>('.event-card')) {
      startRightPressSelection(event, null, column);
      return;
    }
    startDragCreate(event, column);
  });
  column.addEventListener('contextmenu', (event) => openTimelineContextMenu(event, column));
  column.addEventListener('mouseup', (event) => {
    if (event.button !== 2 || (event.target as Element).closest<HTMLElement>('.event-card')) return;
    if (shouldSuppressTimelinePasteMenu()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    showTimelinePasteMenu(event.clientX, event.clientY, column);
  });
  column.addEventListener('auxclick', (event) => {
    if (event.button !== 2 || (event.target as Element).closest<HTMLElement>('.event-card')) return;
    if (shouldSuppressTimelinePasteMenu()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    showTimelinePasteMenu(event.clientX, event.clientY, column);
  });
  column.addEventListener('dblclick', (event) => {
    if ((event.target as Element).closest<HTMLElement>('.event-card')) return;
    const minute = snapMinute(minuteFromColumnPoint(column, event.clientY));
    createTimedEvent(dateKey, minute);
  });
  return column;
}

export function createNowLine() {
  const line = document.createElement('div');
  line.className = 'now-line';
  line.style.top = `${minuteToY(getCurrentMinuteOfDay())}px`;
  line.innerHTML = '<span></span>';
  return line;
}
