/**
 * 文件用途：日期与时间基础计算。
 * 在日期键、分钟数和 Date 之间转换，并生成日历范围及中文日期文本；绝对分钟用于日历坐标计算。
 */
import { TOTAL_MINUTES } from '../app/config.js';
import { clamp } from './math.js';

export function dateTimeToAbsoluteMinute(dateKey: string, minute: number) {
  return dateKeyToDayNumber(dateKey) * TOTAL_MINUTES + minute;
}

export function absoluteMinuteToDateTime(absMinute: number) {
  const dayStart = Math.floor(absMinute / TOTAL_MINUTES) * TOTAL_MINUTES;
  const date = dayNumberToDate(dayStart / TOTAL_MINUTES);
  return {
    date: toDateKey(date),
    minute: absMinute - dayStart,
  };
}

/** 用 UTC 日序号表示日历日期，避免本地夏令时导致一天并非 24 小时。这是日期坐标，不代表事件真实发生的 UTC 时刻。 */
export function dateKeyToDayNumber(dateKey: string) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

export function dayNumberToDate(dayNumber: number) {
  const date = new Date(Date.UTC(1970, 0, 1 + dayNumber));
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function getDateKeysBetween(startDate: string, endDate: string) {
  const keys = [];
  for (let day = parseDateKey(startDate); day <= parseDateKey(endDate); day = addDays(day, 1)) {
    keys.push(toDateKey(day));
  }
  return keys;
}

export function timeToMinute(time: string) {
  if (String(time || '').trim() === '24:00') return 24 * 60;
  const [hour, minute] = normalizeTime(time).split(':').map(Number);
  return hour * 60 + minute;
}

export function minuteToTime(minute: number) {
  const bounded = clamp(Math.round(Number(minute) || 0), 0, TOTAL_MINUTES);
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`;
}

export function normalizeTime(value: string) {
  if (String(value || '').trim() === '24:00') return '24:00';
  const match = String(value || '').match(/(\d{1,2})[:：]?(\d{2})?/);
  if (!match) return '00:00';
  const hour = clamp(Number(match[1]), 0, 23);
  const minute = clamp(Number(match[2] || 0), 0, 59);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function normalizeDateInput(value: string) {
  const text = String(value || '').trim();
  if (isValidDateKey(text)) return text;
  const match = text.match(/(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
  if (!match) return '';
  return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
}

export function isValidDateKey(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(parseDateKey(value).getTime())
  );
}

export function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseDateKey(key: string) {
  const [year, month, day] = String(key).split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function toMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function fromMonthKey(key: string) {
  const [year, month] = String(key).split('-').map(Number);
  return new Date(year, month - 1, 1);
}

/** 按本地日历日期加减天数，不直接加固定毫秒数，以保留跨夏令时日期的日历含义。 */
export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function getWeekStartDate(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function startOfCalendarGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const day = first.getDay();
  const offset = day === 0 ? 6 : day - 1;
  return addDays(first, -offset);
}

export function getTodayKey() {
  return toDateKey(new Date());
}

export function formatDateLong(date: Date) {
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatMonthDay(date: Date) {
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function formatWeekday(date: Date) {
  return date.toLocaleDateString('zh-CN', { weekday: 'long' });
}

export function formatWeekdayShort(date: Date) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
}

export function formatDaySubtitle(date: Date) {
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
