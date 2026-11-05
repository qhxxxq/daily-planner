/**
 * 文件用途：本地存储回归。
 * 通过替代存储接口验证读取、写入、草稿及备份行为，不依赖真实用户的浏览器数据。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { create } from '../../src/storage/planner-storage.js';
test('storage backup retention is bounded and preserves the current serialized document', () => {
  const values = new Map(),
    storage = create({
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    });
  for (let i = 0; i < 15; i++) storage.backup('backup', String(i));
  const backups = storage.read('backup', []);
  assert.equal(backups.length, 10);
  assert.equal(backups[0].text, '14');
  assert.equal(backups[9].text, '5');
});
test('quota errors propagate and corrupt backup lists cannot be silently replaced', () => {
  const storage = create({
    getItem: () => '{"not":"a list"}',
    setItem: () => {
      throw Error('quota');
    },
  });
  assert.throws(() => storage.write('state', {}), /quota/);
  assert.throws(() => storage.backup('backup', 'data'), /备份列表损坏/);
});
