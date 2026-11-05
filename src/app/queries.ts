/**
 * 文件用途：界面数据查询。
 * 从当前状态筛选可见日程、生成跨天片段并查询列表和标签；标签辅助方法也负责补齐缺失标签。
 */
import { normalizeItemType, isEventCompleted, isEventAbandoned } from '../domain/events.js';
import {
  absoluteMinuteToDateTime,
  dateTimeToAbsoluteMinute,
  getTodayKey,
  isValidDateKey,
  minuteToTime,
  toDateKey,
} from '../domain/date-time.js';
import { runtime } from './runtime.js';
import { sortEvents } from '../domain/event-time.js';
import { getTimelineWeekDays } from '../ui/timeline-geometry.js';
import { eventCoversDate, getEventAbsoluteRange, isAllDayEvent } from '../domain/events.js';
import { TOTAL_MINUTES } from './config.js';
import { getEventTags, normalizeTagKey, normalizeTags } from '../domain/tags.js';
import { getAutoTagColor } from '../ui/themes.js';

export function getSelectedEvents() {
  return getEventsForDate(
    isValidDateKey(runtime.state.selectedDate) ? runtime.state.selectedDate : getTodayKey(),
  ).sort(sortEvents);
}

export function getWeekEvents() {
  const events = new Map();
  for (const day of getTimelineWeekDays()) {
    for (const event of runtime.searchIndex.forDate(
      runtime.state,
      toDateKey(day),
      getSearchQuery(),
      getSelectedTagKeys(),
    ))
      events.set(event.id, event);
  }
  return [...events.values()].sort(sortEvents);
}

export function getEventsForDate(dateKey) {
  return runtime.searchIndex
    .forDate(runtime.state, dateKey, getSearchQuery(), getSelectedTagKeys())
    .map((event) => createEventSegment(event, dateKey))
    .filter(Boolean);
}

export function createEventSegment(event, dateKey) {
  if (isAllDayEvent(event)) {
    if (!eventCoversDate(event, dateKey)) return null;
    return { ...event, segmentDate: dateKey };
  }
  const eventRange = getEventAbsoluteRange(event);
  const dayStartAbs = dateTimeToAbsoluteMinute(dateKey, 0);
  const dayEndAbs = dayStartAbs + TOTAL_MINUTES;
  const segmentStartAbs = Math.max(eventRange.startAbs, dayStartAbs);
  const segmentEndAbs = Math.min(eventRange.endAbs, dayEndAbs);
  if (segmentEndAbs <= segmentStartAbs) return null;
  const segmentStart = absoluteMinuteToDateTime(segmentStartAbs);
  const segmentEnd = absoluteMinuteToDateTime(segmentEndAbs);
  const endsAtDayBoundary = segmentEndAbs === dayEndAbs;
  return {
    ...event,
    segmentDate: dateKey,
    originalStart: event.start,
    originalEnd: event.end,
    start: minuteToTime(segmentStart.minute),
    end: endsAtDayBoundary ? '24:00' : minuteToTime(segmentEnd.minute),
  };
}

export function getTimelineEvents() {
  return runtime.searchIndex.query(runtime.state, getSearchQuery(), getSelectedTagKeys());
}

export function getVisibleEvents() {
  return runtime.searchIndex.query(runtime.state, '', []);
}

export function eventMatchesSearch(event, query = getSearchQuery()) {
  if (!eventMatchesSelectedTags(event)) return false;
  if (!query) return true;
  const tagQuery = getTagQuery(query);
  if (tagQuery) return getEventTags(event).some((tag) => normalizeTagKey(tag).includes(tagQuery));
  const source = getSource(event.sourceId);
  return [
    event.title,
    event.notes,
    event.date,
    event.start,
    event.end,
    source?.name,
    ...getEventTags(event).map((tag) => `#${tag}`),
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

export function getSearchQuery() {
  return String(runtime.state.searchQuery || '')
    .trim()
    .toLowerCase();
}

export function getSelectedTagKeys() {
  return Array.isArray(runtime.state.selectedTagKeys)
    ? [...new Set(runtime.state.selectedTagKeys.map(normalizeTagKey).filter(Boolean))]
    : [];
}

export function eventMatchesSelectedTags(event) {
  const selected = getSelectedTagKeys();
  if (!selected.length) return true;
  const eventTags = new Set(getEventTags(event).map(normalizeTagKey));
  return selected.every((key) => eventTags.has(key));
}

export function getTagQuery(query) {
  const value = String(query || '')
    .trim()
    .toLowerCase();
  return value.startsWith('#') ? normalizeTagKey(value.slice(1)) : '';
}

export function getKnownTags() {
  const tagMap = new Map();
  const usedColors = new Set();
  (runtime.state.tags || []).forEach((tag) => {
    const name = String(tag?.name || tag || '')
      .trim()
      .replace(/^#+/, '');
    const key = normalizeTagKey(name);
    if (!key) return;
    const color = tag?.color || getAutoTagColor(name, runtime.state.theme, usedColors);
    usedColors.add(color.toLowerCase());
    tagMap.set(key, { key, name, color, archived: tag?.archived === true });
  });
  runtime.state.events.forEach((event) =>
    getEventTags(event).forEach((name) => {
      const key = normalizeTagKey(name);
      if (key && !tagMap.has(key)) {
        const color = getAutoTagColor(name, runtime.state.theme, usedColors);
        usedColors.add(color.toLowerCase());
        tagMap.set(key, { key, name, color, archived: false });
      }
    }),
  );
  return [...tagMap.values()];
}

export function getTagMeta(name) {
  return (
    getKnownTags().find((tag) => tag.key === normalizeTagKey(name)) || {
      name,
      color: getAutoTagColor(name),
    }
  );
}

export function ensureTagsExist(tags) {
  const existing = new Set((runtime.state.tags || []).map((tag) => normalizeTagKey(tag.name)));
  const usedColors = new Set(getKnownTags().map((tag) => tag.color.toLowerCase()));
  normalizeTags(tags).forEach((name) => {
    const key = normalizeTagKey(name);
    if (!key || existing.has(key)) return;
    const color = getAutoTagColor(name, runtime.state.theme, usedColors);
    usedColors.add(color.toLowerCase());
    runtime.state.tags.push({ name, color, archived: false });
    existing.add(key);
  });
}

export function getUniqueTagName(baseName) {
  const existing = new Set(getKnownTags().map((tag) => tag.key));
  let name = baseName;
  let index = 2;
  while (existing.has(normalizeTagKey(name))) {
    name = `${baseName}${index}`;
    index += 1;
  }
  return name;
}

export function getSource(id) {
  return runtime.state.sources.find((source) => source.id === id) || runtime.state.sources[0];
}

export function getEventType(event) {
  return normalizeItemType(event.type, getSource(event.sourceId)?.type || 'todo');
}

export function isEventIncompleteTodo(event) {
  return getEventType(event) === 'todo' && !isEventCompleted(event) && !isEventAbandoned(event);
}
