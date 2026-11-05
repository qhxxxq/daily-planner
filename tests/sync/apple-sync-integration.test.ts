/**
 * 文件用途：Apple 同步界面集成回归。
 * 在模拟浏览器与原生桥中检查调度、草稿和冲突处理，不能替代真实 iCloud 双设备验收。
 */
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import * as PlannerAppleSync from '../../src/sync/apple-sync.js';
import * as PlannerStorage from '../../src/storage/planner-storage.js';
// Compile the real coordinator functions into an isolated set of test ports.
// This preserves the existing race/failure scenarios without loading a DOM.
const targets = {
  'src/ui/apple-sync.ts': ['runAppleCalendarSync'],
  'src/ui/recovery.ts': ['chooseAppleConflict'],
  'src/app/persistence.ts': ['persistLocalState'],
  'src/platform/files.ts': ['flushAutoSaveDataFile'],
};
const functions = Object.entries(targets)
  .flatMap(([file, names]) => {
    const source = fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
    return parsed.statements
      .filter(
        (statement) => ts.isFunctionDeclaration(statement) && names.includes(statement.name.text),
      )
      .map(
        (statement) =>
          ts.transpileModule(statement.getText(parsed).replace(/^export /, ''), {
            compilerOptions: { target: ts.ScriptTarget.ES2022 },
          }).outputText,
      );
  })
  .join('\n');
const event = {
  id: 'a',
  sourceId: 's',
  title: '原始',
  date: '2026-09-18',
  endDate: '2026-09-18',
  start: '09:00',
  end: '10:00',
  notes: '',
  allDay: false,
};
const remote = (changes) => ({ ...event, plannerId: 'a', remoteId: 'r', ...changes });
function harness() {
  const context = {
    state: PlannerAppleSync.reconcile(
      { events: [event], sources: [{ id: 's' }] },
      { events: [remote()] },
    ).state,
    recordSyncFailure: () => {},
    captureEditorDraft: () => {},
    draftRevision: 0,
    eventDrafts: {},
    eventFormCompositionActive: false,
    PlannerAppleSync,
    console,
    stateRevision: 0,
    appleSyncInFlight: false,
    appleSyncReady: true,
    isLoadingDataFile: false,
    eventDragState: null,
    dragCreateState: null,
    rightSelectState: null,
    STORAGE_KEY: 'test',
    persistenceError: '',
    lastAppleSyncSignature: '',
    hasNativeFileBridge: () => true,
    scheduleAutoSaveDataFile: () => {},
    render: () => {},
    createSafetyBackup: async () => {},
    serializeDataFile: () => JSON.stringify(context.state),
    renderAppleSyncStatus: (text) => (context.status = text),
    renderFileConnectionStatus: (text) => (context.fileStatus = text || context.persistenceError),
    localStorage: { setItem: () => {} },
    window: { setTimeout: () => 1 },
    hasConnectedDataFile: () => true,
    autoSaveInFlight: false,
    pendingAutoSave: false,
    autoSaveTimer: null,
  };
  context.plannerStorage = PlannerStorage.create(context.localStorage);
  context.runtime = context;
  vm.createContext(context);
  vm.runInContext(functions, context);
  return context;
}
test('viewing an event still applies incoming Apple updates', async () => {
  const c = harness();
  c.state.activeEventId = 'a';
  c.callNativeFile = async () => ({ events: [remote({ title: '手机修改' })], token: 'x' });
  await c.runAppleCalendarSync();
  assert.equal(c.state.events[0].title, '手机修改');
  assert.match(c.status, /本机 Apple 日历已检查/);
  assert.match(c.status, /iCloud/);
});
test('dirty event is deferred while another event syncs', async () => {
  const c = harness();
  c.state.activeEventId = 'a';
  c.eventDrafts.a = { values: { titleInput: '草稿' } };
  c.callNativeFile = async () => ({
    events: [
      remote({ title: '手机' }),
      remote({ plannerId: 'b', remoteId: 'rb', title: '另一个' }),
    ],
    token: 'x',
  });
  await c.runAppleCalendarSync();
  assert.equal(c.state.events.find((e) => e.id === 'a').title, '原始');
  assert.equal(c.state.events.find((e) => e.id === 'b').title, '另一个');
  assert.match(c.status, /1 项草稿暂缓/);
});
test('draft changed while reading prevents application of stale result', async () => {
  const c = harness();
  c.callNativeFile = async () => {
    c.draftRevision++;
    return { events: [remote({ title: '手机' })] };
  };
  await c.runAppleCalendarSync();
  assert.equal(c.state.events[0].title, '原始');
});
test('local edits while reading prevent replacement with an older snapshot', async () => {
  const c = harness();
  c.callNativeFile = async () => {
    c.stateRevision++;
    c.state.events[0].title = '刚改';
    return { events: [remote({ title: '手机' })] };
  };
  await c.runAppleCalendarSync();
  assert.equal(c.state.events[0].title, '刚改');
});
test('backup failure stops remote writes and leaves local state unchanged', async () => {
  const c = harness();
  const original = JSON.stringify(c.state);
  let calls = 0;
  c.callNativeFile = async () => {
    calls++;
    return { events: [remote({ title: '手机' })] };
  };
  c.createSafetyBackup = async () => {
    throw Error('磁盘已满');
  };
  await c.runAppleCalendarSync();
  assert.equal(JSON.stringify(c.state), original);
  assert.equal(calls, 1);
  assert.match(c.status, /磁盘已满/);
});
test('storage quota failure stops outbound Apple writes', async () => {
  const c = harness();
  c.state.events[0].title = '电脑';
  let calls = 0;
  c.callNativeFile = async () => {
    calls++;
    return { events: [remote()] };
  };
  c.localStorage.setItem = () => {
    throw Error('QuotaExceeded');
  };
  await c.runAppleCalendarSync();
  assert.equal(calls, 1);
  assert.match(c.status, /本地保存失败/);
});
test('native precondition failure leaves local edits and original baseline recoverable', async () => {
  const c = harness();
  c.state.events[0].title = '电脑';
  c.callNativeFile = async (action) => {
    if (action === 'readAppleChanges') return { events: [remote()], token: 'x' };
    throw Error('日历在同步期间发生变化');
  };
  await c.runAppleCalendarSync();
  assert.equal(c.state.events[0].title, '电脑');
  assert.equal(c.state.appleSync.baseline.a.remote.title, '原始');
  assert.match(c.status, /发生变化/);
  assert.equal(c.appleSyncInFlight, false);
});
test('write completes without erasing an edit made during its await', async () => {
  const c = harness();
  c.state.events[0].title = 'first';
  c.callNativeFile = async (action) => {
    if (action === 'readAppleChanges') return { events: [remote()], token: 'x' };
    c.state.events[0].title = 'second';
    c.stateRevision++;
    return { events: [remote({ title: 'first' })] };
  };
  await c.runAppleCalendarSync();
  assert.equal(c.state.events[0].title, 'second');
  assert.equal(c.state.appleSync.baseline.a.local.title, 'first');
});
test('automatic file save errors remain visible and schedule a retry', async () => {
  const c = harness();
  c.saveDataFile = async () => {
    throw Error('没有权限');
  };
  await c.flushAutoSaveDataFile();
  assert.match(c.fileStatus, /保存失败.*没有权限/);
  assert.equal(c.autoSaveTimer, 1);
  assert.equal(c.autoSaveInFlight, false);
});

test('unconfirmed native deletion reports failure and retains the baseline for retry', async () => {
  const c = harness();
  c.state.events = [];
  const before = JSON.stringify(c.state.appleSync.baseline);
  c.callNativeFile = async () => ({ events: [remote()], token: 'x' });
  await c.runAppleCalendarSync();
  assert.match(c.status, /删除结果尚未确认/);
  assert.equal(JSON.stringify(c.state.appleSync.baseline), before);
  assert.equal(c.state.events.length, 0);
});

function conflictHarness() {
  const c = harness();
  c.state.events[0].title = 'local';
  c.state = PlannerAppleSync.reconcile(c.state, { events: [remote({ title: 'phone' })] }).state;
  c.saveAndRender = () => {
    c.saved = true;
  };
  c.openRecoveryDialog = () => {
    c.refreshed = true;
  };
  return c;
}
test('Apple conflict choice backs up and keeps the latest saved local value', async () => {
  const c = conflictHarness();
  c.state.events = [{ ...c.state.events[0], title: 'latest' }];
  await c.chooseAppleConflict(c.state.appleSync.conflicts[0], 'local');
  assert.equal(c.state.events[0].title, 'latest');
  assert.equal(c.saved, true);
});
test('Apple conflict choice cancels when data, draft, document or conflict changes during backup', async () => {
  for (const mutate of [
    (c) => {
      c.state.events[0] = { ...c.state.events[0], title: 'new' };
      c.stateRevision++;
    },
    (c) => {
      c.draftRevision++;
    },
    (c) => {
      c.state = structuredClone(c.state);
    },
    (c) => {
      c.state.appleSync.conflicts[0].remote.title = 'new remote';
    },
    (c) => {
      c.appleSyncInFlight = true;
    },
  ]) {
    const c = conflictHarness();
    c.createSafetyBackup = async () => mutate(c);
    await assert.rejects(
      c.chooseAppleConflict(c.state.appleSync.conflicts[0], 'remote'),
      /重新选择/,
    );
    assert.notEqual(c.state.events[0].title, 'phone');
    assert.equal(c.state.appleSync.conflicts.length, 1);
    assert.equal(c.saved, undefined);
    assert.equal(c.refreshed, true);
  }
});
test('Apple conflict choice rejects unsaved drafts and a stale displayed conflict', async () => {
  const c = conflictHarness();
  const conflict = structuredClone(c.state.appleSync.conflicts[0]);
  c.eventDrafts.a = {};
  await assert.rejects(c.chooseAppleConflict(conflict, 'local'), /草稿/);
  delete c.eventDrafts.a;
  c.state.appleSync.conflicts[0].remote.title = 'new phone';
  await assert.rejects(c.chooseAppleConflict(conflict, 'remote'), /重新选择/);
  assert.equal(c.state.appleSync.conflicts.length, 1);
});

test('Apple coordinator reports duplicate identities and writes only unrelated events', async () => {
  const c = harness();
  c.state.events[0].title = 'local';
  c.state.events.push({ ...event, id: 'b', title: 'new' });
  const duplicates = [remote(), remote({ remoteId: 'copy' })];
  c.callNativeFile = async (action, body) => {
    if (action === 'readAppleChanges') return { events: duplicates, token: 'x' };
    assert.deepEqual(
      Array.from(body.operations, (op) => op.plannerId),
      ['b'],
    );
    return { events: [...duplicates, remote({ plannerId: 'b', remoteId: 'rb', title: 'new' })] };
  };
  await c.runAppleCalendarSync();
  assert.match(c.status, /1 项重复日程待处理/);
  assert.equal(c.state.appleSync.baseline.a.local.title, '原始');
  assert.equal(c.state.appleSync.baseline.b.local.title, 'new');
});
