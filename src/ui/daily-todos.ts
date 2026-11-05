/**
 * 文件用途：每日待办侧栏。
 * 筛选并排序当天待办、生成状态按钮和条目；通过点击处理函数完成状态切换或打开日程编辑器。
 */
import { formatWeekday, getTodayKey, isValidDateKey, parseDateKey } from '../domain/date-time.js';
import { runtime } from '../app/runtime.js';
import { getSource, getVisibleEvents } from '../app/queries.js';
import { eventCoversDate, formatEventTimeMeta, isAllDayEvent } from '../domain/events.js';
import { isEventIncompleteTodo } from '../app/queries.js';
import { getRgbText } from '../domain/colors.js';
import { escapeHtml } from '../domain/html.js';
import { setEventStatus } from './event-save.js';
import { openEventForm } from './editor.js';
import { getEventStartAbs } from '../domain/event-time.js';

export function renderDailyTodoPanel() {
  const dateKey = isValidDateKey(runtime.state.selectedDate)
    ? runtime.state.selectedDate
    : getTodayKey();
  const events = getVisibleEvents()
    .filter((event) => isEventIncompleteTodo(event) && eventCoversDate(event, dateKey))
    .sort(sortDailyTodoEvents);
  const date = parseDateKey(dateKey);
  runtime.els.emptyDetail.innerHTML = `
    <section class="daily-todo-panel" aria-label="当日未完成日程">
      <div class="daily-todo-heading">
        <span class="daily-todo-eyebrow">${formatWeekday(date)}</span>
        <h2>当日待办</h2>
        <small>${events.length} 项未完成</small>
      </div>
      <div class="daily-todo-list">
        ${events.length ? events.map(renderDailyTodoItem).join('') : `<div class="daily-todo-empty">今天没有未完成日程</div>`}
      </div>
    </section>
  `;
}

export function renderDailyTodoItem(event) {
  const source = getSource(event.sourceId) || runtime.state.sources[0];
  return `
    <button class="daily-todo-item" type="button" data-event-id="${event.id}" style="--todo-color:${source.color};--todo-rgb:${getRgbText(source.color)}">
      <span class="daily-todo-check" data-action="complete" aria-label="标记完成"></span>
      <span class="daily-todo-copy">
        <span class="daily-todo-title">${escapeHtml(event.title || '未命名日程')}</span>
        <span class="daily-todo-meta">${escapeHtml(formatEventTimeMeta(event))} · ${escapeHtml(source.name)}</span>
      </span>
    </button>
  `;
}

export function handleDailyTodoPanelClick(event) {
  const item = (event.target as Element).closest<HTMLElement>('.daily-todo-item[data-event-id]');
  if (!item) return;
  event.preventDefault();
  event.stopPropagation();
  const eventId = item.dataset.eventId;
  if ((event.target as Element).closest<HTMLElement>('[data-action="complete"]')) {
    setEventStatus(eventId, 'completed');
    return;
  }
  openEventForm(eventId, item.getBoundingClientRect());
}

export function sortDailyTodoEvents(a, b) {
  if (isAllDayEvent(a) !== isAllDayEvent(b)) return isAllDayEvent(a) ? -1 : 1;
  return getEventStartAbs(a) - getEventStartAbs(b);
}
