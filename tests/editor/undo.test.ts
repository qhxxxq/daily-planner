/**
 * 文件用途：撤销模型。
 * 覆盖记录增删改、批量操作及目标被后续修改时的冲突保护。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as undo from '../../src/editor/undo.js';
import * as sync from '../../src/sync/apple-sync.js';
const event = (id, title) => ({
  id,
  title,
  sourceId: 's',
  date: '2026-09-26',
  endDate: '2026-09-26',
  start: '09:00',
  end: '10:00',
  notes: '',
  allDay: false,
  tags: [],
});
const remote = (e) => ({ ...e, plannerId: e.id, remoteId: `r-${e.id}` });
const initial = () => ({
  sources: [{ id: 's', name: '日历' }],
  events: [event('a', 'A'), event('b', 'B')],
  tags: [],
});
const command = (before, after) => undo.operation(undo.capture(before), undo.capture(after));
test('undo local A preserves phone B and does not send an obsolete B back to Apple', () => {
  const state = initial();
  const before = sync.reconcile(state, { events: state.events.map(remote) }).state;
  const after = structuredClone(before);
  after.events[0].title = '电脑 A';
  const phone = [remote(event('a', 'A')), remote(event('b', '手机 B'))];
  const current = sync.reconcile(after, { events: phone }).state;
  const restored = undo.apply(current, command(before, after));
  assert.equal(restored.events[0].title, 'A');
  assert.equal(restored.events[1].title, '手机 B');
  assert.deepEqual(restored.appleSync, current.appleSync);
  assert.equal(sync.reconcile(restored, { events: phone }).operations.length, 0);
});
test('a changed target blocks the whole batch and leaves original data intact', () => {
  const before = initial(),
    after = structuredClone(before);
  after.events.forEach((e) => (e.title += ' local'));
  const current = structuredClone(after);
  current.events[1].title = 'phone';
  assert.throws(() => undo.apply(current, command(before, after)), /安全撤销/);
  assert.equal(current.events[0].title, 'A local');
  assert.equal(current.events[1].title, 'phone');
});
test('undo creation preserves a later phone addition', () => {
  const before = initial(),
    after = structuredClone(before);
  after.events.push(event('c', 'local'));
  const current = structuredClone(after);
  current.events.push(event('d', 'phone'));
  assert.deepEqual(
    undo.apply(current, command(before, after)).events.map((e) => e.id),
    ['a', 'b', 'd'],
  );
});
test('undo deletion restores position without deleting incoming events', () => {
  const before = initial(),
    after = structuredClone(before);
  after.events.shift();
  const current = structuredClone(after);
  current.events.push(event('d', 'phone'));
  assert.deepEqual(
    undo.apply(current, command(before, after)).events.map((e) => e.id),
    ['a', 'b', 'd'],
  );
});
test('undo does not overwrite a reused deleted ID or remove an edited new event', () => {
  const before = initial(),
    after = structuredClone(before);
  after.events.shift();
  const current = structuredClone(after);
  current.events.push(event('a', 'replacement'));
  assert.throws(() => undo.apply(current, command(before, after)), /安全撤销/);
  assert.throws(() => undo.apply(current, command(after, before)), /安全撤销/);
});
test('undo protects drafts and unresolved conflicts', () => {
  const before = initial(),
    after = structuredClone(before);
  after.events[0].title = 'local';
  assert.throws(() => undo.apply(after, command(before, after), ['a']), /安全撤销/);
});
test('undo source creation cannot orphan a subsequently imported phone event', () => {
  const before = initial(),
    after = structuredClone(before);
  after.sources.push({ id: 'new' });
  const current = structuredClone(after);
  current.events.push({ ...event('phone', 'new'), sourceId: 'new' });
  assert.throws(() => undo.apply(current, command(before, after)), /安全撤销/);
});
test('list reorder is reversible and unrelated UI state is retained', () => {
  const before = initial();
  before.sources.push({ id: 't' });
  const after = structuredClone(before);
  after.sources.reverse();
  const current = { ...after, searchQuery: 'phone', dataFileIdentity: '/current.json' };
  const restored = undo.apply(current, command(before, after));
  assert.deepEqual(restored.sources, before.sources);
  assert.equal(restored.searchQuery, 'phone');
  assert.equal(restored.dataFileIdentity, '/current.json');
});
