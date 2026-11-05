/**
 * 文件用途：编辑字段、草稿与重复系列模型。
 * 读取和回填表单字段，比较草稿与编辑基线；按系列范围计算批量更新，时间计算依赖显式传入的辅助函数。
 */
import type { EditorDraft, EditorFields, PlannerEvent } from '../types/model.js';
interface SeriesHelpers {
  getEventStartAbs(event: PlannerEvent): number;
  getEventAbsoluteRange(event: PlannerEvent): { startAbs: number; endAbs: number };
  dateKeyToDayNumber(key: string): number;
  structuredCloneSafe<T>(value: T): T;
  absoluteMinuteToDateTime(value: number): { date: string; minute: number };
  minuteToTime(value: number): string;
  toDateKey(value: Date): string;
  addDays(date: Date, days: number): Date;
  parseDateKey(key: string): Date;
  dateTimeToAbsoluteMinute(key: string, minute: number): number;
  timeToMinute(value: string): number;
}
/* Editor model: draft comparison and repeat-series updates, independent of DOM state. */
function readFields<K extends string>(
  els: Record<K, HTMLElement>,
  names: readonly K[],
): EditorFields {
  return Object.fromEntries(
    names.map((name) => [
      name,
      name === 'allDayInput'
        ? (els[name] as HTMLInputElement).checked
        : (els[name] as HTMLInputElement).value,
    ]),
  );
}
function writeFields<K extends string>(
  els: Record<K, HTMLElement>,
  names: readonly K[],
  values: EditorFields,
) {
  for (const name of names) {
    if (!(name in values)) continue;
    if (name === 'allDayInput') (els[name] as HTMLInputElement).checked = Boolean(values[name]);
    else (els[name] as HTMLInputElement).value = String(values[name]);
  }
}
/** 比较当前字段与编辑基线：恢复原值时删除草稿，有变化时保存原始日程和时间戳。返回草稿集合是否发生变化。 */
function updateDraft(
  drafts: Record<string, EditorDraft>,
  id: string,
  base: EditorFields,
  values: EditorFields,
  original: PlannerEvent,
) {
  if (JSON.stringify(values) === JSON.stringify(base)) {
    if (!drafts[id]) return false;
    delete drafts[id];
  } else {
    if (JSON.stringify(drafts[id]?.values) === JSON.stringify(values)) return false;
    drafts[id] = { base, values, original, updatedAt: new Date().toISOString() };
  }
  return true;
}
/** 注入日期计算与克隆方法，返回系列选取和更新函数。系列修改先生成更新映射，由界面完成校验后统一应用。 */
function createSeriesModel(helpers: SeriesHelpers) {
  const {
    getEventStartAbs,
    getEventAbsoluteRange,
    dateKeyToDayNumber,
    structuredCloneSafe,
    absoluteMinuteToDateTime,
    minuteToTime,
    toDateKey,
    addDays,
    parseDateKey,
    dateTimeToAbsoluteMinute,
    timeToMinute,
  } = helpers;
  function getSeriesTargets(events: PlannerEvent[], active: PlannerEvent, scope = 'this') {
    if (!active.recurrenceGroupId || scope === 'this') return [active];
    const series = events.filter((item) => item.recurrenceGroupId === active.recurrenceGroupId);
    if (scope === 'all') return series;
    if (scope !== 'future') return [active];
    // 单次课程改期后仍沿用系列序号，不能只按日期重新判断先后关系。
    const indexed =
      series.every((item) => Number.isInteger(item.recurrenceIndex)) &&
      new Set(series.map((item) => item.recurrenceIndex)).size === series.length;
    return series.filter((item) =>
      indexed
        ? item.recurrenceIndex! >= active.recurrenceIndex!
        : getEventStartAbs(item) >= getEventStartAbs(active),
    );
  }

  function buildSeriesUpdates(
    events: PlannerEvent[],
    active: PlannerEvent,
    next: PlannerEvent,
    scope: string,
  ) {
    const targets = getSeriesTargets(events, active, scope);
    const commonKeys = [
      'title',
      'notes',
      'tags',
      'sourceId',
      'type',
      'travelTime',
      'reminders',
    ] as const;
    const changed = commonKeys.filter(
      (key) => JSON.stringify(active[key]) !== JSON.stringify(next[key]),
    );
    if (
      changed.includes('reminders') &&
      targets.some((target) => (target.reminders || []).some((r) => r.kind === 'unsupported'))
    ) {
      throw new Error('部分课次包含特殊提醒，请在 Apple 日历修改这些提醒，或仅修改本次。');
    }
    const timeKeys = ['date', 'endDate', 'start', 'end', 'allDay'] as const;
    const timeChanged = timeKeys.some((key) => active[key] !== next[key]);
    const beforeRange = getEventAbsoluteRange(active);
    const nextRange = getEventAbsoluteRange(next);
    const dayShift = dateKeyToDayNumber(next.date) - dateKeyToDayNumber(active.date);
    const endDayShift =
      dateKeyToDayNumber(next.endDate || next.date) -
      dateKeyToDayNumber(active.endDate || active.date);
    const updates = new Map<string, PlannerEvent>();
    for (const target of targets) {
      const updated = { ...target };
      if (target.id === active.id) Object.assign(updated, next);
      else {
        for (const key of changed)
          Object.assign(updated, { [key]: structuredCloneSafe(next[key]) });
        if (changed.includes('type') && next.type === 'schedule') {
          updated.status = 'open';
          updated.completed = false;
        }
        if (timeChanged) {
          if (!active.allDay && !next.allDay && !target.allDay) {
            const range = getEventAbsoluteRange(target);
            const start = absoluteMinuteToDateTime(
              range.startAbs + nextRange.startAbs - beforeRange.startAbs,
            );
            const end = absoluteMinuteToDateTime(
              range.endAbs + nextRange.endAbs - beforeRange.endAbs,
            );
            Object.assign(updated, {
              date: start.date,
              start: minuteToTime(start.minute),
              endDate: end.date,
              end: minuteToTime(end.minute),
            });
          } else if (active.allDay === next.allDay) {
            updated.date = toDateKey(addDays(parseDateKey(target.date), dayShift));
            updated.endDate = toDateKey(
              addDays(parseDateKey(target.endDate || target.date), endDayShift),
            );
          } else {
            updated.date = toDateKey(addDays(parseDateKey(target.date), dayShift));
            updated.endDate = toDateKey(
              addDays(
                parseDateKey(updated.date),
                dateKeyToDayNumber(next.endDate || next.date) - dateKeyToDayNumber(next.date),
              ),
            );
            updated.start = next.start;
            updated.end = next.end;
          }
          if (active.allDay !== next.allDay) updated.allDay = next.allDay;
          if (updated.allDay) {
            updated.start = '00:00';
            updated.end = '00:00';
            updated.travelTime = 0;
          }
        }
      }
      const start = dateTimeToAbsoluteMinute(updated.date, timeToMinute(updated.start));
      const end = dateTimeToAbsoluteMinute(
        updated.endDate || updated.date,
        timeToMinute(updated.end),
      );
      if (updated.allDay ? updated.endDate! < updated.date : end <= start) {
        throw new Error('部分日程的结束时间早于开始时间，请同时调整开始和结束时间。');
      }
      updates.set(target.id, updated);
    }
    return updates;
  }

  return { getSeriesTargets, buildSeriesUpdates };
}
export { readFields, writeFields, updateDraft, createSeriesModel };
