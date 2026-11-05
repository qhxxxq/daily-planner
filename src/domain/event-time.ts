/**
 * 文件用途：日程时间排序辅助。
 * 将日程起点转换为绝对分钟，全天日程按零点处理；排序同时比较日期、开始时间和中文标题。
 */
import type { PlannerEvent } from '../types/model.js';
import { dateTimeToAbsoluteMinute, timeToMinute } from './date-time.js';
import { isAllDayEvent } from './events.js';

export function getEventStartAbs(event: PlannerEvent) {
  return dateTimeToAbsoluteMinute(event.date, isAllDayEvent(event) ? 0 : timeToMinute(event.start));
}

export function sortEvents(a: PlannerEvent, b: PlannerEvent) {
  return `${a.date} ${a.start} ${a.title}`.localeCompare(
    `${b.date} ${b.start} ${b.title}`,
    'zh-CN',
  );
}
