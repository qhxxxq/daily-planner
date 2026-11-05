/**
 * 文件用途：日程语义与时间范围。
 * 统一待办状态、全天判断、行程时间和跨天范围计算；为编辑、查询和时间轴布局提供一致规则。
 */
import type { PlannerEvent, PlannerSource, ItemType } from '../types/model.js';
import {
  absoluteMinuteToDateTime,
  addDays,
  dateTimeToAbsoluteMinute,
  getDateKeysBetween,
  parseDateKey,
  timeToMinute,
  toDateKey,
} from './date-time.js';
import { TOTAL_MINUTES } from '../app/config.js';

export function getSourceType(sources: PlannerSource[], sourceId: string) {
  return sources.find((source) => source.id === sourceId)?.type || 'todo';
}

export function normalizeItemType(type: unknown, fallback: ItemType = 'todo'): ItemType {
  // 单条事项的明确类型优先；只有缺失或非法值才继承日历（或父事项）的默认类型。
  if (type === 'todo' || type === 'schedule') return type;
  return fallback === 'schedule' ? 'schedule' : 'todo';
}

export function isEventCompleted(event: PlannerEvent) {
  return normalizeTodoStatus(event) === 'completed';
}

export function isEventAbandoned(event: PlannerEvent) {
  return normalizeTodoStatus(event) === 'abandoned';
}

export function normalizeTodoStatus(event: PlannerEvent) {
  if (event.status === 'abandoned') return 'abandoned';
  if (event.status === 'completed' || event.completed === true) return 'completed';
  return 'open';
}

export function isAllDayEvent(event: PlannerEvent) {
  return event.allDay === true;
}

export function getEventTravelMinutes(event: PlannerEvent) {
  return isAllDayEvent(event) ? 0 : normalizeTravelMinutes(event.travelTime);
}

export function formatEventTimeMeta(
  event: PlannerEvent & { originalStart?: string; originalEnd?: string },
) {
  return isAllDayEvent(event)
    ? '全天'
    : `${event.originalStart || event.start} - ${event.originalEnd || event.end}`;
}

export function formatTravelTime(minutes: number) {
  const value = normalizeTravelMinutes(minutes);
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  if (hours && mins) return `${hours}小时${mins}分钟`;
  if (hours) return `${hours}小时`;
  return `${mins}分钟`;
}

export function parseTravelTime(value: string) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const hour = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:小时|h)/i)?.[1] || 0);
  const minute = Number(text.match(/(\d+)\s*(?:分钟|分|m)/i)?.[1] || 0);
  if (hour || minute) return normalizeTravelMinutes(Math.round(hour * 60 + minute));
  return normalizeTravelMinutes(Number(text.match(/\d+/)?.[0] || 0));
}

export function normalizeTravelMinutes(value: unknown) {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0;
}

export function eventCoversDate(event: PlannerEvent, dateKey: string) {
  if (isAllDayEvent(event)) return getEventDateRange(event).includes(dateKey);
  const range = getEventAbsoluteRange(event);
  const dayStartAbs = dateTimeToAbsoluteMinute(dateKey, 0);
  const dayEndAbs = dayStartAbs + TOTAL_MINUTES;
  return range.startAbs < dayEndAbs && dayStartAbs < range.endAbs;
}

export function getEventDateRange(event: PlannerEvent) {
  if (!isAllDayEvent(event)) {
    const range = getEventAbsoluteRange(event);
    const firstDay = absoluteMinuteToDateTime(range.startAbs).date;
    const lastVisibleAbs = Math.max(range.startAbs, range.endAbs - 1);
    const lastDay = absoluteMinuteToDateTime(lastVisibleAbs).date;
    return getDateKeysBetween(firstDay, lastDay);
  }
  const start = parseDateKey(event.date);
  const end = parseDateKey(event.endDate || event.date);
  const days = [];
  for (let day = new Date(start); day <= end; day = addDays(day, 1)) days.push(toDateKey(day));
  return days;
}

export function getEventAbsoluteRange(event: PlannerEvent) {
  const startAbs = dateTimeToAbsoluteMinute(event.date, timeToMinute(event.start));
  let endAbs = dateTimeToAbsoluteMinute(event.endDate || event.date, timeToMinute(event.end));
  if (endAbs <= startAbs) endAbs += TOTAL_MINUTES;
  return { startAbs, endAbs };
}

export function getEventDurationMinutes(event: PlannerEvent) {
  const range = getEventAbsoluteRange(event);
  return range.endAbs - range.startAbs;
}

export function isWrapperEvent(event: PlannerEvent) {
  return Array.isArray(event.children) && event.children.length > 0;
}
