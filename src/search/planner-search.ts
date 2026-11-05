/**
 * 文件用途：内存日程搜索索引。
 * 建立文本、标签与日期检索数据，复用索引进行过滤；与界面渲染和持久化分离，供搜索面板调用。
 */
import type { PlannerDocument, PlannerEvent, PlannerSource } from '../types/model.js';
type SearchDocument = Pick<PlannerDocument, 'events' | 'sources'>;
interface SearchRow {
  event: PlannerEvent;
  first: number;
  last: number;
  tags: Set<string>;
  visible: boolean;
  text: string[];
}
/* 文档失效后重建搜索文本与日期边界；连续查询复用已有索引。 */
const tagKey = (value: unknown) =>
  String(value || '')
    .trim()
    .replace(/^#+/, '')
    .toLowerCase();
const dayNumber = (key: string) => Date.parse(`${key}T00:00:00Z`) / 86400000;
const minute = (value: string) => {
  const [h, m] = String(value || '00:00')
    .split(':')
    .map(Number);
  return h * 60 + m;
};
/** 创建独立的搜索索引和查询缓存；数据失效或来源可见性等条件改变时重建，查询复用标准化后的文本和日期范围。 */
function create() {
  let dirty = true,
    builds = 0,
    sourceSignature = '';
  let rows: SearchRow[] = [];
  let sources = new Map<string, PlannerSource>();
  let cache = new Map<string, SearchRow[]>();
  function ensure(state: SearchDocument) {
    const signature = JSON.stringify(
      state.sources.map((s) => [s.id, s.name, s.visible, s.archived]),
    );
    if (signature !== sourceSignature) {
      dirty = true;
      sourceSignature = signature;
    }
    if (!dirty) return;
    sources = new Map(state.sources.map((source) => [source.id, source]));
    rows = state.events.map((event) => {
      const source = sources.get(event.sourceId);
      const tags = (
        Array.isArray(event.tags) ? event.tags : String(event.tags || '').split(/[\s,，]+/)
      )
        .map(tagKey)
        .filter(Boolean);
      const first = dayNumber(event.date);
      let last = dayNumber(event.endDate || event.date);
      if (!event.allDay) {
        const start = first * 1440 + minute(event.start);
        let end = last * 1440 + minute(event.end);
        if (end <= start) end += 1440;
        last = Math.floor(Math.max(start, end - 1) / 1440);
      }
      return {
        event,
        first,
        last,
        tags: new Set(tags),
        visible: !!source && source.visible !== false && !source.archived,
        text: [
          event.title,
          event.notes,
          event.date,
          event.start,
          event.end,
          source?.name,
          ...tags.map((tag) => `#${tag}`),
        ].map((value) => String(value || '').toLowerCase()),
      };
    });
    cache = new Map();
    dirty = false;
    builds++;
  }
  function matched(state: SearchDocument, query = '', selected: string[] = []) {
    ensure(state);
    query = String(query).trim().toLowerCase();
    selected = selected.map(tagKey);
    const id = JSON.stringify([query, selected]);
    if (!cache.has(id)) {
      const tag = query.startsWith('#') ? tagKey(query.slice(1)) : '';
      cache.set(
        id,
        rows.filter(
          (row) =>
            row.visible &&
            selected.every((key) => row.tags.has(key)) &&
            (!query ||
              (tag
                ? [...row.tags].some((key) => key.includes(tag))
                : row.text.some((text) => text.includes(query)))),
        ),
      );
      if (cache.size > 32) cache.delete(cache.keys().next().value!);
    }
    return cache.get(id)!;
  }
  return {
    invalidate() {
      dirty = true;
    },
    query(state: SearchDocument, query = '', tags: string[] = []) {
      return matched(state, query, tags).map((row) => row.event);
    },
    source(state: SearchDocument, id: string) {
      ensure(state);
      return sources.get(id) || state.sources[0];
    },
    forDate(state: SearchDocument, date: string, query = '', tags: string[] = []) {
      const day = dayNumber(date);
      return matched(state, query, tags)
        .filter((row) => row.first <= day && row.last >= day)
        .map((row) => row.event);
    },
    dates(state: SearchDocument, first: string, last: string, query = '', tags: string[] = []) {
      const start = dayNumber(first),
        end = dayNumber(last),
        dates = new Set<string>();
      for (const row of matched(state, query, tags)) {
        for (let day = Math.max(start, row.first); day <= Math.min(end, row.last); day++)
          dates.add(new Date(day * 86400000).toISOString().slice(0, 10));
      }
      return dates;
    },
    get builds() {
      return builds;
    },
  };
}
export { create };
