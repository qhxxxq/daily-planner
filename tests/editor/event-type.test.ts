/** 文件用途：验证事项显式类型优先于来源默认值，缺失类型仍兼容旧数据。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeItemType } from '../../src/domain/events.js';

test('explicit event types override both source defaults', () => {
  for (const fallback of ['todo', 'schedule'] as const) {
    assert.equal(normalizeItemType('todo', fallback), 'todo');
    assert.equal(normalizeItemType('schedule', fallback), 'schedule');
  }
});

test('missing and invalid event types inherit the default for legacy data', () => {
  for (const type of [undefined, null, '', 'invalid', false, 0]) {
    assert.equal(normalizeItemType(type, 'schedule'), 'schedule');
    assert.equal(normalizeItemType(type, 'todo'), 'todo');
    assert.equal(normalizeItemType(type), 'todo');
  }
});
