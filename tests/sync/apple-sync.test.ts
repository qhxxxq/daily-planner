/**
 * 文件用途：Apple 合并核心回归。
 * 通过本地状态和远端快照样本覆盖增删改、冲突及回执确认，不连接真实系统日历。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sync from '../../src/sync/apple-sync.js';
const event = {
  id: 'a',
  title: '课程',
  date: '2026-09-18',
  endDate: '2026-09-18',
  start: '09:00',
  end: '10:00',
  allDay: false,
  notes: '原备注',
  sourceId: 's',
  tags: ['重要'],
  status: 'completed',
  type: 'todo',
  travelTime: 15,
};
const remote = (changes = {}) => ({
  ...sync.fields(event),
  plannerId: 'a',
  remoteId: 'r',
  ...changes,
});
const initial = () => ({ events: [{ ...event }], sources: [{ id: 's', name: '课程' }] });
const established = () => sync.reconcile(initial(), { events: [remote()] }).state;
const run = (state, events) => sync.reconcile(state, { events }, () => 'trash-id');
test('first matching sync establishes a baseline without writes', () => {
  const result = run(initial(), [remote()]);
  assert.equal(result.operations.length, 0);
  assert.ok(result.state.appleSync.baseline.a);
});
test('phone changes shared fields while preserving private App metadata', () => {
  const result = run(established(), [
    remote({ title: '改名', notes: '手机备注', start: '11:00', end: '12:00' }),
  ]);
  assert.equal(result.state.events[0].title, '改名');
  assert.deepEqual(result.state.events[0].tags, ['重要']);
  assert.equal(result.state.events[0].status, 'completed');
  assert.equal(result.state.events[0].travelTime, 15);
  assert.equal(result.operations.length, 0);
});
test('local edits produce one update and successful acknowledgment is idempotent', () => {
  const state = established();
  state.events[0].title = '电脑改名';
  const result = run(state, [remote()]);
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].remoteId, 'r');
  sync.acknowledge(result.state, result.operations, { events: [remote({ title: '电脑改名' })] });
  assert.equal(run(result.state, [remote({ title: '电脑改名' })]).operations.length, 0);
});
test('concurrent edits retain both versions without writing either', () => {
  const state = established();
  state.events[0].title = '电脑';
  const result = run(state, [remote({ title: '手机' })]);
  assert.equal(result.operations.length, 0);
  assert.equal(result.state.appleSync.conflicts[0].local.title, '电脑');
  assert.equal(result.state.appleSync.conflicts[0].remote.title, '手机');
  assert.deepEqual(run(result.state, [remote({ title: '手机' })]).state, result.state);
});
test('phone deletion goes to recoverable trash', () => {
  const result = run(established(), []);
  assert.equal(result.state.events.length, 0);
  assert.equal(result.state.appleSync.trash[0].event.id, 'a');
  assert.equal(result.operations.length, 0);
});
test('phone deletion versus local edit is a conflict', () => {
  const state = established();
  state.events[0].notes = '新备注';
  const result = run(state, []);
  assert.equal(result.state.events.length, 1);
  assert.equal(result.state.appleSync.conflicts.length, 1);
});
test('phone deletion versus changed todo status is also a conflict', () => {
  const state = established();
  state.events[0].status = 'open';
  assert.equal(run(state, []).state.appleSync.conflicts.length, 1);
});
test('local deletion is sent only when the remote version is unchanged', () => {
  const state = established();
  state.events = [];
  assert.equal(run(state, [remote()]).operations[0].kind, 'delete');
  assert.equal(run(state, [remote({ title: '手机' })]).state.appleSync.conflicts.length, 1);
});
test('new phone event imports once', () => {
  const state = initial();
  state.events = [];
  const result = run(state, [remote({ plannerId: 'new' })]);
  assert.equal(result.state.events[0].id, 'new');
  assert.equal(run(result.state, [remote({ plannerId: 'new' })]).state.events.length, 1);
});
test('disabled and archived sources neither delete nor write', () => {
  for (const props of [{ appleSyncEnabled: false }, { archived: true }]) {
    const state = established();
    Object.assign(state.sources[0], props);
    const result = run(state, []);
    assert.equal(result.operations.length, 0);
    assert.equal(result.state.events.length, 1);
  }
});
test('choosing local resolves a conflict and schedules a checked write', () => {
  const state = established();
  state.events[0].title = '电脑';
  const result = run(state, [remote({ title: '手机' })]);
  sync.resolve(result.state, 'a', 'local');
  assert.equal(result.state.appleSync.conflicts.length, 0);
  assert.equal(result.state.appleSync.trash.length, 2);
  assert.equal(run(result.state, [remote({ title: '手机' })]).operations[0].fields.title, '电脑');
});
test('choosing remote preserves tags and requires no outbound write', () => {
  const state = established();
  state.events[0].title = '电脑';
  const result = run(state, [remote({ title: '手机' })]);
  sync.resolve(result.state, 'a', 'remote');
  assert.equal(result.state.events[0].title, '手机');
  assert.deepEqual(result.state.events[0].tags, ['重要']);
  assert.equal(run(result.state, [remote({ title: '手机' })]).operations.length, 0);
});
test('first upgrade disagreement becomes a conflict, never an overwrite', () => {
  const result = run(initial(), [remote({ title: '此前在手机上改过' })]);
  assert.equal(result.operations.length, 0);
  assert.equal(result.state.appleSync.conflicts.length, 1);
});
test('all-day and midnight boundaries normalize consistently', () => {
  assert.equal(sync.fields({ ...event, allDay: true }).start, '00:00');
  assert.equal(sync.fields({ ...event, end: '24:00' }).endDate, '2026-09-19');
  assert.equal(sync.fields({ ...event, start: '23:00', end: '01:00' }).endDate, '2026-09-19');
});
test('unsupported recurrence or moved event is left untouched', () => {
  const result = sync.reconcile(established(), { events: [], unsupportedIds: ['a'] });
  assert.equal(result.state.events.length, 1);
  assert.equal(result.operations.length, 0);
});
test('acknowledgment preserves a local edit made during the native write', () => {
  const state = established();
  state.events[0].title = 'first';
  const result = run(state, [remote()]);
  result.state.events[0].title = 'second';
  sync.acknowledge(result.state, result.operations, { events: [remote({ title: 'first' })] });
  assert.equal(result.state.events[0].title, 'second');
  assert.equal(
    run(result.state, [remote({ title: 'first' })]).operations[0].fields.title,
    'second',
  );
});
test('failed write acknowledgment leaves the baseline unchanged', () => {
  const state = established();
  const before = structuredClone(state.appleSync.baseline);
  assert.throws(() =>
    sync.acknowledge(
      state,
      [{ kind: 'save', plannerId: 'a', fields: { ...event, title: 'changed' } }],
      { events: [remote()] },
    ),
  );
  assert.deepEqual(state.appleSync.baseline, before);
});

test('failed batch acknowledgement never partially advances baselines', () => {
  const state = established();
  const before = JSON.stringify(state.appleSync.baseline);
  const updated = { ...event, title: '修改后' };
  assert.throws(
    () =>
      sync.acknowledge(
        state,
        [
          { kind: 'save', plannerId: 'a', fields: sync.fields(updated) },
          { kind: 'save', plannerId: 'b', fields: sync.fields(event) },
        ],
        { events: [remote({ title: '修改后' })] },
      ),
    /尚未确认/,
  );
  assert.equal(JSON.stringify(state.appleSync.baseline), before);
});

test('delete acknowledgement requires absence and preserves baseline for retry', () => {
  const state = established();
  state.events = [];
  const op = { kind: 'delete', plannerId: 'a', remoteId: 'r' };
  const before = structuredClone(state.appleSync.baseline);
  assert.throws(() => sync.acknowledge(state, [op], { events: [remote()] }), /删除结果尚未确认/);
  assert.deepEqual(state.appleSync.baseline, before);
  assert.equal(run(state, [remote()]).operations[0].kind, 'delete');
  sync.acknowledge(state, [op], { events: [] });
  assert.equal(state.appleSync.baseline.a, undefined);
  assert.equal(run(state, []).operations.length, 0);
});
test('a failed delete never partially acknowledges a preceding successful save', () => {
  const state = established();
  const before = structuredClone(state.appleSync.baseline);
  const ops = [
    { kind: 'save', plannerId: 'b', fields: { ...event, title: 'new' } },
    { kind: 'delete', plannerId: 'a', remoteId: 'r' },
  ];
  assert.throws(
    () =>
      sync.acknowledge(state, ops, {
        events: [remote(), remote({ plannerId: 'b', remoteId: 'rb', title: 'new' })],
      }),
    /尚未确认/,
  );
  assert.deepEqual(state.appleSync.baseline, before);
});
test('delete acknowledgement rejects an aliased remote ID and unsupported targets', () => {
  for (const snapshot of [
    { events: [remote({ plannerId: 'alias' })] },
    { events: [], unsupportedIds: ['a'] },
  ]) {
    const state = established(),
      before = structuredClone(state.appleSync.baseline);
    assert.throws(
      () => sync.acknowledge(state, [{ kind: 'delete', plannerId: 'a' }], snapshot),
      /尚未确认/,
    );
    assert.deepEqual(state.appleSync.baseline, before);
  }
});
test('phone adds multiple reminders, cancellation and old baseline migration are lossless', () => {
  const reminders = [
    { kind: 'relative', offset: -900 },
    { kind: 'relative', offset: -3600 },
  ];
  const state = established();
  delete state.appleSync.baseline.a.local.reminders;
  delete state.appleSync.baseline.a.remote.reminders;
  const changed = run(state, [remote({ reminders })]);
  assert.equal(changed.operations.length, 0);
  assert.equal(changed.state.events[0].reminders.length, 2);
  const cancelled = run(changed.state, [remote({ reminders: [] })]);
  assert.deepEqual(cancelled.state.events[0].reminders, []);
});
test('concurrent reminder edits conflict and acknowledgment checks reminder content', () => {
  const state = established();
  state.events[0].reminders = [{ kind: 'relative', offset: -900 }];
  const result = run(state, [remote({ reminders: [{ kind: 'relative', offset: -300 }] })]);
  assert.equal(result.state.appleSync.conflicts.length, 1);
  assert.equal(result.operations.length, 0);
  const write = run(state, [remote()]);
  assert.throws(
    () => sync.acknowledge(write.state, write.operations, { events: [remote()] }),
    /尚未确认/,
  );
});
test('reminder ordering and object key order do not create changes', () => {
  assert.ok(
    sync.equal(
      {
        ...event,
        reminders: [
          { kind: 'relative', offset: -300 },
          { kind: 'absolute', timestamp: 1800000000 },
        ],
      },
      {
        ...event,
        reminders: [
          { timestamp: 1800000000, kind: 'absolute' },
          { offset: -300, kind: 'relative' },
        ],
      },
    ),
  );
});

test('keep local uses the latest saved edit or deletion after conflict detection', () => {
  for (const deleted of [false, true]) {
    const state = established();
    state.events[0].title = 'first';
    const conflict = run(state, [remote({ title: 'phone' })]).state;
    conflict.events = deleted ? [] : [{ ...conflict.events[0], title: 'second' }];
    sync.resolve(conflict, 'a', 'local');
    assert.equal(conflict.events[0]?.title, deleted ? undefined : 'second');
    const next = run(conflict, [remote({ title: 'phone' })]);
    assert.equal(next.operations[0].kind, deleted ? 'delete' : 'save');
    if (!deleted) assert.equal(next.operations[0].fields.title, 'second');
  }
});

test('duplicate Apple identities block edits, deletions and imports while other events sync', () => {
  for (const mode of ['edit', 'delete', 'import']) {
    const state = mode === 'import' ? initial() : established();
    state.events = mode === 'edit' ? [{ ...event, title: 'local' }] : [];
    const baseline = structuredClone(state.appleSync?.baseline || {});
    const duplicates = [remote(), remote({ remoteId: 'copy' })];
    for (const events of [duplicates, [...duplicates].reverse()]) {
      const result = run(state, [...events, remote({ plannerId: 'b', remoteId: 'rb' })]);
      assert.deepEqual(result.duplicateIds, ['a']);
      assert.equal(result.operations.length, 0);
      assert.deepEqual(result.state.appleSync.baseline, {
        ...baseline,
        b: result.state.appleSync.baseline.b,
      });
      assert.equal(
        result.state.events.find((e) => e.id === 'a')?.title,
        mode === 'edit' ? 'local' : undefined,
      );
      assert.ok(result.state.events.some((e) => e.id === 'b'));
      assert.equal(result.state.appleSync.trash.length, 0);
    }
  }
});
test('duplicate write acknowledgments reject the whole batch without advancing baselines', () => {
  const state = established();
  const before = structuredClone(state.appleSync.baseline);
  const operations = [
    { kind: 'save', plannerId: 'b', fields: sync.fields(event) },
    { kind: 'save', plannerId: 'a', fields: sync.fields(event) },
  ];
  assert.throws(
    () =>
      sync.acknowledge(state, operations, {
        events: [
          remote({ plannerId: 'b', remoteId: 'rb' }),
          remote(),
          remote({ remoteId: 'copy' }),
        ],
      }),
    /尚未确认/,
  );
  assert.deepEqual(state.appleSync.baseline, before);
});
test('Apple sync resumes after the duplicate identity is removed', () => {
  const state = established();
  state.events[0].title = 'local';
  const held = run(state, [remote(), remote({ remoteId: 'copy' })]);
  const resumed = run(held.state, [remote()]);
  assert.equal(resumed.operations.length, 1);
  assert.equal(resumed.operations[0].remoteId, 'r');
  assert.equal(resumed.operations[0].fields.title, 'local');
});
