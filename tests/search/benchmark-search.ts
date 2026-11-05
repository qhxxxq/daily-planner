/**
 * 文件用途：搜索性能基准。
 * 生成测试日程并测量索引和查询耗时；用于本地性能观察，不代表所有设备的响应时间。
 */
// Synthetic, deterministic data only. Measures filtering work, not native UI latency.
import { performance } from 'node:perf_hooks';
import { create } from '../../src/search/planner-search.js';
const state = {
  sources: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, name: `课程 ${i}` })),
  events: Array.from({ length: 10000 }, (_, i) => ({
    id: `e${i}`,
    sourceId: `s${i % 20}`,
    title: `学习计划 ${i}`,
    notes: `阅读材料 ${i % 31}`,
    date: '2026-09-26',
    endDate: '2026-09-26',
    start: '09:00',
    end: '10:00',
    tags: ['课程', `标签${i % 7}`],
  })),
};
const queries = Array.from({ length: 30 }, (_, i) => `学习计划 ${i}`);
function previous(query) {
  const visible = new Set(
    state.sources.filter((s) => s.visible !== false && !s.archived).map((s) => s.id),
  );
  return state.events
    .filter((e) => visible.has(e.sourceId))
    .filter((e) =>
      [
        e.title,
        e.notes,
        e.date,
        e.start,
        e.end,
        state.sources.find((s) => s.id === e.sourceId)?.name,
        ...e.tags.map((t) => `#${t}`),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
}
const index = create(),
  start = performance.now();
index.query(state, '');
const buildMs = performance.now() - start;
for (const q of queries) {
  if (previous(q).length !== index.query(state, q).length) throw Error('result mismatch');
}
function measure(work) {
  const times = [];
  for (let r = 0; r < 5; r++) {
    const start = performance.now();
    for (const q of queries) work(q);
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[2];
}
const oldMs = measure(previous),
  cachedMs = measure((q) => index.query(state, q));
console.log(
  JSON.stringify(
    {
      events: 10000,
      queries: 30,
      indexBuildMs: +buildMs.toFixed(2),
      oldScanMedianMs: +oldMs.toFixed(2),
      cachedQueryMedianMs: +cachedMs.toFixed(2),
      indexBuilds: index.builds,
      note: 'Median of 5 rounds; cached repeated queries after warm-up; synthetic algorithm benchmark, not full UI latency',
    },
    null,
    2,
  ),
);
