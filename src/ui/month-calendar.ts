/** 月历：固定六周网格、跨天全天横条及按时间排序的紧凑日程。 */
import type { PlannerEvent } from '../types/model.js';
import { runtime } from '../app/runtime.js';
import { getEventsForDate, getSource } from '../app/queries.js';
import {
  addDays,
  fromMonthKey,
  getTodayKey,
  getWeekStartDate,
  startOfCalendarGrid,
  toDateKey,
  toMonthKey,
} from '../domain/date-time.js';
import {
  formatEventTimeMeta,
  isAllDayEvent,
  isEventAbandoned,
  isEventCompleted,
} from '../domain/events.js';
import { openEventForm } from './editor.js';
import { createTimedEvent } from './event-create.js';
import { saveAndRender } from '../app/persistence.js';

const lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
  month: 'long',
  day: 'numeric',
});
const lunarDays = [
  '初一',
  '初二',
  '初三',
  '初四',
  '初五',
  '初六',
  '初七',
  '初八',
  '初九',
  '初十',
  '十一',
  '十二',
  '十三',
  '十四',
  '十五',
  '十六',
  '十七',
  '十八',
  '十九',
  '二十',
  '廿一',
  '廿二',
  '廿三',
  '廿四',
  '廿五',
  '廿六',
  '廿七',
  '廿八',
  '廿九',
  '三十',
];

export function getMonthEvents(): PlannerEvent[] {
  const first = fromMonthKey(runtime.state.miniMonth);
  const events = new Map<string, PlannerEvent>();
  for (let day = first; day.getMonth() === first.getMonth(); day = addDays(day, 1)) {
    getEventsForDate(toDateKey(day)).forEach((event) => events.set(event.id, event));
  }
  return [...events.values()];
}

function createMonthEvent(event: PlannerEvent, dateKey: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'month-event';
  button.dataset.eventId = event.id;
  button.style.setProperty('--event-color', getSource(event.sourceId)?.color || '#7b7ff4');
  button.classList.toggle('is-all-day', isAllDayEvent(event));
  button.classList.toggle('is-completed', isEventCompleted(event));
  button.classList.toggle('is-abandoned', isEventAbandoned(event));
  button.classList.toggle('is-selected', runtime.state.activeEventId === event.id);
  button.title = `${event.title}\n${event.date}${event.endDate && event.endDate !== event.date ? ` – ${event.endDate}` : ''}\n${formatEventTimeMeta(event)}`;
  button.setAttribute('aria-label', `${event.title}，${formatEventTimeMeta(event)}`);
  const title = document.createElement('span');
  title.className = 'month-event-title';
  title.textContent = event.title;
  button.append(title);
  if (!isAllDayEvent(event)) {
    const time = document.createElement('span');
    time.className = 'month-event-time';
    time.textContent = event.date < dateKey ? '续' : event.start;
    button.append(time);
  }
  button.addEventListener('click', (click) => {
    click.stopPropagation();
    openEventForm(event.id, button.getBoundingClientRect());
  });
  return button;
}

function openDate(day: Date) {
  runtime.state.selectedDate = toDateKey(day);
  runtime.state.visibleWeekStart = toDateKey(getWeekStartDate(day));
  runtime.state.miniMonth = toMonthKey(day);
  runtime.state.viewMode = 'day';
  runtime.hasAutoScrolledCalendar = false;
  saveAndRender();
}

export function renderMonth() {
  const month = fromMonthKey(runtime.state.miniMonth);
  const start = startOfCalendarGrid(month.getFullYear(), month.getMonth());
  const view = runtime.els.calendarView;
  view.className = 'calendar-view month-view';
  view.replaceChildren();
  const header = document.createElement('div');
  header.className = 'month-weekdays';
  ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].forEach((name, index) => {
    const label = document.createElement('span');
    label.textContent = name;
    if (index > 4) label.className = 'is-weekend';
    header.append(label);
  });
  view.append(header);
  const grid = document.createElement('div');
  grid.className = 'month-grid';
  for (let weekIndex = 0; weekIndex < 6; weekIndex++) {
    const week = document.createElement('div');
    week.className = 'month-week';
    const dates = Array.from({ length: 7 }, (_, index) => addDays(start, weekIndex * 7 + index));
    const keys = dates.map(toDateKey);
    const eventsByDate = keys.map(getEventsForDate);
    // 同一周内对全天事件去重并分配横条轨道，避免跨天横条互相覆盖。
    const allDayEvents = new Map<string, PlannerEvent>();
    eventsByDate
      .flat()
      .filter(isAllDayEvent)
      .forEach((event) => allDayEvents.set(event.id, event));
    const laneEnds: number[] = [];
    const bars = document.createElement('div');
    bars.className = 'month-all-day-bars';
    [...allDayEvents.values()]
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          (b.endDate || b.date).localeCompare(a.endDate || a.date) ||
          a.id.localeCompare(b.id),
      )
      .forEach((event) => {
        const from = eventsByDate.findIndex((events) =>
          events.some((item) => item.id === event.id),
        );
        let to = from;
        while (to < 6 && eventsByDate[to + 1].some((item) => item.id === event.id)) to++;
        let lane = laneEnds.findIndex((end) => end < from);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = to;
        const bar = createMonthEvent(event, keys[from]);
        bar.style.gridColumn = `${from + 1} / ${to + 2}`;
        bar.style.gridRow = String(lane + 1);
        if (event.date < keys[0]) bar.classList.add('continues-before');
        if ((event.endDate || event.date) > keys[6]) bar.classList.add('continues-after');
        bars.append(bar);
      });
    const visibleLanes = Math.min(laneEnds.length, 3);
    week.style.setProperty('--all-day-rows', String(visibleLanes));
    dates.forEach((day, index) => {
      const key = keys[index];
      const cell = document.createElement('section');
      cell.className = 'month-day';
      cell.dataset.date = key;
      cell.setAttribute(
        'aria-label',
        day.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }),
      );
      if (index > 4) cell.classList.add('is-weekend');
      if (day.getMonth() !== month.getMonth()) cell.classList.add('is-outside-month');
      if (key === getTodayKey()) cell.classList.add('is-today');
      const heading = document.createElement('div');
      heading.className = 'month-day-heading';
      const lunar = document.createElement('span');
      lunar.className = 'month-lunar';
      const parts = lunarFormatter.formatToParts(day);
      const lunarDay = Number(parts.find((part) => part.type === 'day')?.value);
      lunar.textContent =
        lunarDay === 1
          ? parts.find((part) => part.type === 'month')?.value
          : lunarDays[lunarDay - 1] || '';
      const dateButton = document.createElement('button');
      dateButton.type = 'button';
      dateButton.className = 'month-date';
      dateButton.textContent =
        day.getDate() === 1 ? `${day.getMonth() + 1}月1日` : String(day.getDate());
      dateButton.title = `查看 ${key} 的日视图`;
      dateButton.setAttribute('aria-label', dateButton.title);
      if (key === getTodayKey()) dateButton.setAttribute('aria-current', 'date');
      dateButton.addEventListener('click', () => openDate(day));
      heading.append(lunar, dateButton);
      cell.append(heading);
      const events = document.createElement('div');
      events.className = 'month-day-events';
      events.tabIndex = 0;
      events.setAttribute('aria-label', `${key} 日程列表，可滚动`);
      eventsByDate[index]
        .filter((event) => !isAllDayEvent(event))
        .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
        .forEach((event) => events.append(createMonthEvent(event, key)));
      cell.append(events);
      cell.addEventListener('dblclick', (click) => {
        if ((click.target as Element).closest('button')) return;
        runtime.state.selectedDate = key;
        createTimedEvent(key, 9 * 60);
      });
      week.append(cell);
    });
    if (laneEnds.length) week.append(bars);
    grid.append(week);
  }
  view.append(grid);
}
