/**
 * 文件用途：时间轴坐标换算。
 * 计算指针命中的日期、分钟和时间轴范围；为创建、拖动及粘贴提供共用坐标规则。
 */
import { runtime } from '../app/runtime.js';
import { addDays, getWeekStartDate, parseDateKey, toDateKey } from '../domain/date-time.js';
import { END_HOUR, HOUR_HEIGHT, START_HOUR, TOTAL_MINUTES } from '../app/config.js';
import { clamp } from '../domain/math.js';

export function getTimelineColumnByDate(dateKey) {
  return runtime.els.calendarView.querySelector<HTMLElement>(
    `.timeline-column[data-date="${CSS.escape(dateKey)}"]`,
  );
}

export function getTimelineColumnFromPoint(clientX) {
  return [...runtime.els.calendarView.querySelectorAll<HTMLElement>('.timeline-column')].find(
    (column) => {
      const rect = column.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right;
    },
  );
}

export function getTimelinePointTarget(clientX, clientY) {
  const column = [
    ...runtime.els.calendarView.querySelectorAll<HTMLElement>('.timeline-column'),
  ].find((item) => {
    const rect = item.getBoundingClientRect();
    return (
      clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    );
  });
  if (!column) return null;
  return {
    date: column.dataset.date,
    minute: snapMinute(minuteFromColumnPoint(column, clientY)),
    clientX,
    clientY,
  };
}

export function getTimelineWeekDays() {
  const start = parseDateKey(
    runtime.state.visibleWeekStart || toDateKey(getWeekStartDate(new Date())),
  );
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function minuteFromColumnPoint(column, clientY) {
  const rect = column.getBoundingClientRect();
  return clampMinute(START_HOUR * 60 + ((clientY - rect.top) / HOUR_HEIGHT) * 60);
}

export function snapMinute(minute) {
  return Math.round(minute / 15) * 15;
}

export function minuteToY(minute) {
  return ((clampMinute(minute) - START_HOUR * 60) / 60) * HOUR_HEIGHT;
}

export function getCurrentMinuteOfDay() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export function isMinuteInTimeline(minute) {
  return minute >= START_HOUR * 60 && minute <= END_HOUR * 60;
}

export function minutesToHeight(minutes) {
  return (Math.max(0, minutes) / 60) * HOUR_HEIGHT;
}

export function TOTAL_MINUTES_TO_PX() {
  return (TOTAL_MINUTES / 60) * HOUR_HEIGHT;
}

export function clampMinute(minute) {
  return clamp(Math.round(Number(minute) || 0), START_HOUR * 60, END_HOUR * 60);
}
