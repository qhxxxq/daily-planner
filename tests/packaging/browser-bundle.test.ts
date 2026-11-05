/**
 * 文件用途：生产浏览器包启动回归。
 * 在模拟 DOM 环境加载构建产物，验证生产入口能够启动且测试接口未泄漏。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

test('production bundle boots the real page without test globals or legacy script loading', async (t) => {
  const errors: string[] = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error.message));
  const root = new URL('../../', import.meta.url);
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const bundle = readFileSync(new URL('build/app.js', root), 'utf8');
  assert.doesNotMatch(html, /supabase|syncEmailInput|syncDialog/i);
  assert.doesNotMatch(bundle, /supabase|save_planner_state|PLANNER_SUPABASE/i);
  const dom = new JSDOM(html, {
    url: 'http://localhost',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: console,
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.HTMLElement.prototype.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.setInterval = () => 0;
  w.eval(bundle);
  await new Promise(setImmediate);
  assert.equal(w.document.querySelectorAll('.source-item').length, 1);
  assert.match(
    w.document.querySelector('#calendarView')?.textContent || '',
    /写下今天最重要的一件事/,
  );
  assert.equal(typeof w.__plannerFileBridgeResolve, 'function');
  assert.equal(typeof w.__syncPlannerToAppleCalendar, 'function');
  assert.equal(w.__testState, undefined);
  assert.equal(w.saveEvent, undefined);
  assert.equal(w.PlannerAppleSync, undefined);
  assert.deepEqual(errors, []);
});
