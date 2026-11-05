/**
 * 文件用途：日期与视图导航。
 * 切换日视图、周视图及当前日期，处理迷你日历选择；在需要离开编辑状态时接入草稿保护。
 */
import { runtime } from '../app/runtime.js';
import {
  addDays,
  dateTimeToAbsoluteMinute,
  fromMonthKey,
  getTodayKey,
  getWeekStartDate,
  isValidDateKey,
  parseDateKey,
  toDateKey,
  toMonthKey,
} from '../domain/date-time.js';
import { saveAndRender } from '../app/persistence.js';
import {
  eventMatchesSearch,
  getSearchQuery,
  getSelectedTagKeys,
  getVisibleEvents,
} from '../app/queries.js';
import { isEventIncompleteTodo } from '../app/queries.js';
import { getEventStartAbs } from '../domain/event-time.js';

export function jumpToSourceCount(sourceId) {
  const event = getNextIncompleteSourceEvent(sourceId);
  if (!event) return;
  runtime.state.selectedSourceId = sourceId;
  runtime.state.selectedDate = event.date;
  runtime.state.visibleWeekStart = toDateKey(getWeekStartDate(parseDateKey(event.date)));
  runtime.state.miniMonth = toMonthKey(parseDateKey(event.date));
  runtime.state.activeEventId = null;
  runtime.selectedEventIds = new Set([event.id]);
  saveAndRender({ preserveScroll: true });
  requestAnimationFrame(() => scrollEventIntoView(event.id));
}

export function jumpToNearestFilteredEvent() {
  if (!getSelectedTagKeys().length && !getSearchQuery()) return;
  const event = getNearestEvent(getVisibleEvents().filter((item) => eventMatchesSearch(item)));
  if (!event) return;
  runtime.state.selectedDate = event.date;
  runtime.state.visibleWeekStart = toDateKey(getWeekStartDate(parseDateKey(event.date)));
  runtime.state.miniMonth = toMonthKey(parseDateKey(event.date));
  runtime.state.activeEventId = null;
  runtime.selectedEventIds = new Set([event.id]);
  saveAndRender({ preserveScroll: true });
  requestAnimationFrame(() => scrollEventIntoView(event.id));
}

export function getNextIncompleteSourceEvent(sourceId) {
  const todayAbs = dateTimeToAbsoluteMinute(getTodayKey(), 0);
  const events = runtime.state.events
    .filter((event) => event.sourceId === sourceId && isEventIncompleteTodo(event))
    .sort((a, b) => getEventStartAbs(a) - getEventStartAbs(b));
  return events.find((event) => getEventStartAbs(event) >= todayAbs) || events[0] || null;
}

export function getNearestEvent(events) {
  const todayAbs = dateTimeToAbsoluteMinute(getTodayKey(), 0);
  const sorted = [...events].sort((a, b) => getEventStartAbs(a) - getEventStartAbs(b));
  return sorted.find((event) => getEventStartAbs(event) >= todayAbs) || sorted[0] || null;
}

export function scrollEventIntoView(eventId) {
  document
    .querySelector<HTMLElement>(
      `:is(.event-card, .month-event)[data-event-id="${CSS.escape(eventId)}"]`,
    )
    ?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
}

export function setViewMode(mode) {
  const leavingMonth = runtime.state.viewMode === 'month' && mode !== 'month';
  runtime.state.viewMode = mode;
  if (mode === 'day') setSelectedDateToToday();
  if (leavingMonth) runtime.hasAutoScrolledCalendar = false;
  saveAndRender({ preserveScroll: !leavingMonth });
}

export function goToday() {
  setSelectedDateToToday();
  saveAndRender({ preserveScroll: true });
}

export function setSelectedDateToToday() {
  const today = new Date();
  runtime.state.selectedDate = toDateKey(today);
  runtime.state.visibleWeekStart = toDateKey(getWeekStartDate(today));
  runtime.state.miniMonth = toMonthKey(today);
}

export function shiftDay(days) {
  if (runtime.state.viewMode === 'month') {
    shiftMiniMonth(days);
    return;
  }
  if (runtime.state.viewMode === 'week') {
    const nextStart = addDays(parseDateKey(runtime.state.visibleWeekStart), days);
    runtime.state.visibleWeekStart = toDateKey(nextStart);
    runtime.state.selectedDate = runtime.state.visibleWeekStart;
    runtime.state.miniMonth = toMonthKey(nextStart);
  } else {
    const base = isValidDateKey(runtime.state.selectedDate)
      ? parseDateKey(runtime.state.selectedDate)
      : new Date();
    const nextDate = addDays(base, days);
    runtime.state.selectedDate = toDateKey(nextDate);
    runtime.state.visibleWeekStart = toDateKey(getWeekStartDate(nextDate));
    runtime.state.miniMonth = toMonthKey(nextDate);
  }
  saveAndRender({ preserveScroll: true });
}

export function shiftWeek(delta) {
  runtime.state.visibleWeekStart = toDateKey(
    addDays(parseDateKey(runtime.state.visibleWeekStart), delta * 7),
  );
  runtime.state.miniMonth = runtime.state.visibleWeekStart.slice(0, 7);
  saveAndRender({ preserveScroll: true });
}

export function shiftMiniMonth(delta) {
  const date = fromMonthKey(runtime.state.miniMonth);
  date.setMonth(date.getMonth() + delta);
  runtime.state.miniMonth = toMonthKey(date);
  if (runtime.state.viewMode === 'month') {
    runtime.state.selectedDate = toDateKey(date);
    runtime.state.visibleWeekStart = toDateKey(getWeekStartDate(date));
  }
  saveAndRender({ preserveScroll: true });
}
