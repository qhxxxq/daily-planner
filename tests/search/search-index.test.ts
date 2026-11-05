/**
 * 文件用途：搜索索引回归。
 * 检查关键词、标签和日期过滤及索引更新行为，确保搜索结果随数据变化。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as search from '../../src/search/planner-search.js';
const e = (id, date, endDate, start = '09:00', end = '10:00') => ({
  id,
  title: id,
  date,
  endDate,
  start,
  end,
  sourceId: 's',
  tags: [],
});
const data = (events) => ({ events, sources: [{ id: 's', name: '课程', visible: true }] });
test('index is reused across queries and date columns until a document change', () => {
  const index = search.create(),
    state = data([e('a', '2026-09-26', '2026-09-26')]);
  index.query(state, 'a');
  index.query(state, '课程');
  index.forDate(state, '2026-09-26');
  assert.equal(index.builds, 1);
  state.events[0].title = 'new';
  index.invalidate();
  assert.equal(index.query(state, 'new')[0].id, 'a');
  assert.equal(index.builds, 2);
});
test('date candidates and mini-calendar bounds correctly handle midnight, all-day and overnight events', () => {
  const index = search.create(),
    state = data([
      e('midnight', '2026-09-26', '2026-09-27', '23:00', '00:00'),
      e('overnight', '2026-09-26', '2026-09-26', '23:00', '01:00'),
      { ...e('all', '2026-09-26', '2026-09-27'), allDay: true },
    ]);
  assert.deepEqual(
    index.forDate(state, '2026-09-27').map((e) => e.id),
    ['overnight', 'all'],
  );
  assert.deepEqual([...index.dates(state, '2026-09-27', '2026-09-28')], ['2026-09-27']);
});
test('hidden source changes invalidate cached results, tags use intersection and # prefix', () => {
  const index = search.create(),
    state = data([
      { ...e('a', '2026-09-26', '2026-09-26'), tags: ['重要', '作业'] },
      e('b', '2026-09-26', '2026-09-26'),
    ]);
  assert.deepEqual(
    index.query(state, '#重', ['作业']).map((e) => e.id),
    ['a'],
  );
  state.sources[0].visible = false;
  assert.equal(index.query(state, '#重', ['作业']).length, 0);
});
test('a many-year event only enumerates the requested mini-calendar interval', () => {
  const index = search.create(),
    state = data([{ ...e('long', '2000-01-01', '2100-01-01'), allDay: true }]);
  assert.equal(index.dates(state, '2026-09-01', '2026-10-12').size, 42);
});
