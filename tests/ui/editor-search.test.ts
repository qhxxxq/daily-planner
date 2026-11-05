/**
 * 文件用途：编辑器与界面交互回归。
 * 在模拟 DOM 中覆盖编辑、搜索、快捷键、草稿和系列操作，验证状态与界面行为。
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
const root = path.join(__dirname, '../..');
const storageKey = 'daily-planner-state-v1';
const draftKey = 'daily-planner-editor-drafts-v1';
const event = (id, title, date = '2026-09-18') => ({
  id,
  title,
  date,
  endDate: date,
  start: '09:00',
  end: '10:00',
  sourceId: 's',
  notes: '',
  tags: [],
  allDay: false,
  type: 'todo',
  status: 'open',
});
async function boot(t, options = {}) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error.message));
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
    url: 'http://localhost',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: console,
  });
  const w = dom.window;
  w.CSS ||= {};
  w.CSS.escape = (value) => value.replace(/[^a-z0-9-]/gi, '\\$&');
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  w.setInterval = () => 0;
  w.alert = (message) => errors.push(message);
  w.localStorage.setItem(
    storageKey,
    JSON.stringify({
      selectedDate: '2026-09-18',
      viewMode: 'day',
      activeEventId: options.active === undefined ? 'a' : options.active,
      sources: [{ id: 's', name: '课程', color: '#6d5ff5', type: 'todo' }],
      events: options.events || [event('a', '课程 A'), event('b', '课程 B', '2026-12-01')],
    }),
  );
  if (options.drafts) w.localStorage.setItem(draftKey, options.drafts);
  options.setup?.(w);
  w.eval(fs.readFileSync(path.join(root, 'build/test-browser.js'), 'utf8'));
  await new Promise(setImmediate);
  t.after(() => {
    w.close();
    assert.deepEqual(errors, []);
  });
  const q = (selector) => w.document.querySelector(selector);
  const input = (selector, value) => {
    const field = q(selector);
    field.value = value;
    field.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const state = () => JSON.parse(JSON.stringify(w.__testState()));
  return { w, q, input, state };
}
test('typing saves a separate local draft without changing the event', async (t) => {
  const { w, input, q, state } = await boot(t);
  input('#titleInput', '未保存标题');
  assert.equal(state().events[0].title, '课程 A');
  assert.equal(JSON.parse(w.localStorage.getItem(draftKey)).a.values.titleInput, '未保存标题');
  assert.match(q('#draftStatus').textContent, /草稿已保留/);
});
test('full render preserves draft values and cursor', async (t) => {
  const { w, input, q } = await boot(t);
  input('#titleInput', '未保存标题');
  q('#titleInput').focus();
  q('#titleInput').setSelectionRange(2, 3);
  w.eval('render({ preserveScroll: true })');
  assert.equal(q('#titleInput').value, '未保存标题');
  assert.equal(q('#titleInput').selectionStart, 2);
});
test('draft recovers after a new app session', async (t) => {
  const first = await boot(t);
  first.input('#notesInput', '重启后仍在');
  const next = await boot(t, { drafts: first.w.localStorage.getItem(draftKey) });
  assert.equal(next.q('#notesInput').value, '重启后仍在');
  assert.equal(next.state().events[0].notes, '');
});
test('closing a dirty editor offers continue, discard and save', async (t) => {
  const { q, input, state } = await boot(t);
  input('#titleInput', '草稿');
  q('#closeFormButton').click();
  assert.equal(q('#draftExitDialog').open, true);
  q('[data-choice="continue"]').click();
  assert.equal(state().activeEventId, 'a');
  assert.equal(q('#titleInput').value, '草稿');
  q('#closeFormButton').click();
  q('[data-choice="discard"]').click();
  assert.equal(state().activeEventId, null);
  assert.equal(state().events[0].title, '课程 A');
});
test('save from the exit dialog commits the draft and closes the editor', async (t) => {
  const { w, q, input, state } = await boot(t);
  input('#titleInput', '已保存标题');
  q('#closeFormButton').click();
  q('[data-choice="save"]').click();
  assert.equal(state().events[0].title, '已保存标题');
  assert.equal(state().activeEventId, null);
  assert.equal(JSON.parse(w.localStorage.getItem(draftKey)).a, undefined);
});
test('restoring the original field value removes the draft', async (t) => {
  const { w, input } = await boot(t);
  input('#titleInput', '草稿');
  input('#titleInput', '课程 A');
  assert.deepEqual(JSON.parse(w.localStorage.getItem(draftKey)), {});
});
test('programmatic status changes are captured as drafts', async (t) => {
  const { w, q, state } = await boot(t);
  q('#statusSegment [data-status="completed"]').click();
  assert.equal(JSON.parse(w.localStorage.getItem(draftKey)).a.values.statusInput, 'completed');
  assert.equal(state().events[0].status, 'open');
});
test('discarded recurrence options do not reappear on reopening', async (t) => {
  const { w, q } = await boot(t);
  q('#recurrenceInput').value = 'weekly';
  q('#recurrenceInput').dispatchEvent(new w.Event('change', { bubbles: true }));
  q('#closeFormButton').click();
  q('[data-choice="discard"]').click();
  w.openEventForm('a');
  assert.equal(q('#recurrenceInput').value, 'none');
});
test('compact search opens on hover, keeps focus through results and closes without clearing the query', async (t) => {
  const { w, q, input, state } = await boot(t, { active: null });
  q('#searchToggleButton').dispatchEvent(new w.Event('pointerenter'));
  assert.equal(w.document.activeElement, q('#searchInput'));
  assert.equal(q('#searchToggleButton').getAttribute('aria-expanded'), 'true');
  input('#searchInput', '课程');
  q('#searchInput').dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
  );
  await new Promise(setImmediate);
  assert.equal(w.document.activeElement.dataset.searchEventId, 'a');
  assert.equal(q('.search-shell').classList.contains('is-search-open'), true);
  w.document.activeElement.dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  assert.equal(q('.search-shell').classList.contains('is-search-open'), false);
  assert.equal(q('#searchResults').hidden, true);
  assert.equal(state().searchQuery, '课程');
  assert.equal(w.document.activeElement, q('#searchToggleButton'));
  q('#searchToggleButton').click();
  assert.equal(w.document.activeElement, q('#searchInput'));
  assert.equal(q('#searchResults').hidden, false);
  q('#todayButton').dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
  assert.equal(q('.search-shell').classList.contains('is-search-open'), false);
  assert.equal(state().searchQuery, '课程');
});

test('search shortcut reveals the collapsed field and tabbing outside dismisses it', async (t) => {
  const { w, q } = await boot(t, { active: null });
  w.document.dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true }),
  );
  assert.equal(q('.search-shell').classList.contains('is-search-open'), true);
  assert.equal(w.document.activeElement, q('#searchInput'));
  q('#todayButton').focus();
  await new Promise(setImmediate);
  assert.equal(q('#searchToggleButton').getAttribute('aria-expanded'), 'false');
  assert.equal(q('.search-shell').classList.contains('is-search-open'), false);
});

test('search spans dates and jumps to the chosen event', async (t) => {
  const { input, q, state } = await boot(t, { active: null });
  input('#searchInput', '课程');
  assert.equal(q('#searchResults').hidden, false);
  assert.equal(q('#searchResults').querySelectorAll('[data-search-event-id]').length, 2);
  assert.match(q('#searchResults').textContent, /2026-12-01/);
  q('[data-search-event-id="b"]').click();
  assert.equal(state().selectedDate, '2026-12-01');
  assert.equal(state().activeEventId, 'b');
  assert.equal(q('#titleInput').value, '课程 B');
});
test('search does not trigger business save or erase the current draft', async (t) => {
  const { w, input, q } = await boot(t);
  input('#titleInput', '草稿保留');
  w.eval('scheduleAutoSaveDataFile = () => { throw new Error("unexpected file save") }');
  input('#searchInput', '课程');
  assert.equal(q('#titleInput').value, '草稿保留');
  q('[data-search-event-id="b"]').click();
  assert.equal(q('#draftExitDialog').open, true);
  q('[data-choice="continue"]').click();
  assert.equal(q('#titleInput').value, '草稿保留');
});
test('search has empty state, keyboard navigation, escape and safe text rendering', async (t) => {
  const { w, input, q, state } = await boot(t, {
    active: null,
    events: [event('a', '<img src=x onerror=alert(1)>课程')],
  });
  input('#searchInput', '无匹配');
  assert.match(q('#searchResults').textContent, /没有找到日程/);
  input('#searchInput', '课程');
  assert.equal(q('#searchResults img'), null);
  q('#searchInput').focus();
  q('#searchInput').dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
  );
  assert.equal(w.document.activeElement.dataset.searchEventId, 'a');
  w.document.activeElement.dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  assert.equal(q('#searchResults').hidden, true);
  assert.equal(state().searchQuery, '课程');
});
test('search results respect hidden calendars and paginate without losing items', async (t) => {
  const events = Array.from({ length: 60 }, (_, i) => event(`e${i}`, `课程 ${i}`));
  const { w, input, q } = await boot(t, { active: null, events });
  input('#searchInput', '课程');
  assert.equal(q('#searchResults').querySelectorAll('[data-search-event-id]').length, 50);
  q('[data-search-more]').click();
  assert.equal(q('#searchResults').querySelectorAll('[data-search-event-id]').length, 60);
  w.__testState().sources[0].visible = false;
  w.renderSearchUi();
  assert.match(q('#searchResults').textContent, /没有找到日程/);
});

test('switching to another event retains the draft until a decision is made', async (t) => {
  const { w, q, input, state } = await boot(t);
  input('#titleInput', '编辑中的 A');
  w.openEventForm('b');
  assert.equal(state().activeEventId, 'a');
  assert.equal(q('#draftExitDialog').open, true);
  q('[data-choice="save"]').click();
  assert.equal(state().events.find((e) => e.id === 'a').title, '编辑中的 A');
  assert.equal(state().activeEventId, 'b');
  assert.equal(q('#titleInput').value, '课程 B');
});
test('a failed main save keeps the draft and rolls back repeated copies', async (t) => {
  const { w, q, input, state } = await boot(t);
  input('#titleInput', '不能丢失');
  q('#recurrenceInput').value = 'weekly';
  q('#recurrenceInput').dispatchEvent(new w.Event('change', { bubbles: true }));
  const originalSet = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = function (key, value) {
    if (key === storageKey) throw new Error('QuotaExceeded');
    return originalSet.call(this, key, value);
  };
  assert.equal(w.saveEvent({ preventDefault() {} }), false);
  assert.equal(state().events.length, 2);
  assert.equal(state().events[0].title, '课程 A');
  assert.equal(q('#titleInput').value, '不能丢失');
  assert.equal(q('#eventForm').hidden, false);
  assert.ok(JSON.parse(w.localStorage.getItem(draftKey)).a);
});
test('IME confirmation does not submit or navigate search results', async (t) => {
  const { w, q, input, state } = await boot(t);
  input('#titleInput', '中文草稿');
  q('#titleInput').dispatchEvent(new w.CompositionEvent('compositionstart', { bubbles: true }));
  q('#titleInput').dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
  );
  assert.equal(state().events[0].title, '课程 A');
  assert.equal(state().activeEventId, 'a');
  input('#searchInput', '课程');
  q('#searchInput').dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
  );
  assert.equal(q('#draftExitDialog'), null);
});
test('saving date via the picker is captured without a native input event', async (t) => {
  const { w, q } = await boot(t);
  w.openDatePicker(q('#dateInput'));
  q('#datePicker [data-date="2026-09-20"]').click();
  assert.equal(JSON.parse(w.localStorage.getItem(draftKey)).a.values.dateInput, '2026-09-20');
});
test('background sync updates another event while leaving the draft and caret intact', async (t) => {
  const { w, q, input, state } = await boot(t);
  const current = w.__testState();
  const remotes = current.events.map((e) => ({
    ...w.PlannerAppleSync.fields(e),
    plannerId: e.id,
    remoteId: `r-${e.id}`,
  }));
  current.appleSync = w.PlannerAppleSync.reconcile(current, { events: remotes }).state.appleSync;
  current.appleSync.sourceSignature = JSON.stringify(
    current.sources.map((s) => [s.id, s.name, s.color]),
  );
  input('#titleInput', '本地草稿');
  q('#titleInput').focus();
  q('#titleInput').setSelectionRange(1, 2);
  w.webkit = {
    messageHandlers: {
      plannerFile: {
        postMessage({ id, action }) {
          assert.ok(['readAppleChanges', 'backup'].includes(action));
          w.__plannerFileBridgeResolve(id, {
            ok: true,
            events: remotes.map((e) => ({
              ...e,
              title: e.plannerId === 'a' ? '手机 A' : '手机 B',
            })),
          });
        },
      },
    },
  };
  await w.runAppleCalendarSync();
  assert.equal(state().events.find((e) => e.id === 'b').title, '手机 B');
  assert.equal(q('#titleInput').value, '本地草稿');
  assert.equal(q('#titleInput').selectionStart, 1);
  assert.match(q('#appleSyncStatus').textContent, /1 份草稿将在保存后同步/);
});

const lessons = () =>
  ['2026-09-18', '2026-09-25', '2026-10-02', '2026-10-09'].map((date, i) => ({
    ...event(['a', 'b', 'c', 'd'][i], '每周课程', date),
    recurrenceGroupId: 'course',
    recurrenceIndex: i,
    notes: `第${i + 1}节备注`,
    tags: [`tag${i}`],
    status: i === 0 ? 'completed' : 'open',
    completed: i === 0,
  }));
function chooseScope(h, scope) {
  h.q('#seriesScopeInput').value = scope;
  h.q('#seriesScopeInput').dispatchEvent(new h.w.Event('change', { bubbles: true }));
}
function changeTime(h, start, end) {
  h.input('#startInput', start);
  h.input('#endInput', end);
}
function save(h) {
  return h.w.saveEvent({ preventDefault() {} });
}

test('existing series displays three scopes and defaults to this occurrence', async (t) => {
  const h = await boot(t, { events: lessons(), active: 'b' });
  assert.equal(h.q('#seriesScopeField').hidden, false);
  assert.equal(h.q('#seriesScopeInput').value, 'this');
  assert.equal(h.q('#seriesScopeInput').options.length, 3);
  assert.equal(h.q('#recurrenceCreateControls').hidden, true);
  changeTime(h, '11:00', '12:00');
  assert.equal(save(h), true);
  assert.deepEqual(
    h.state().events.map((e) => e.start),
    ['09:00', '11:00', '09:00', '09:00'],
  );
});
test('future edits shift later lessons without flattening dates or overwriting private fields', async (t) => {
  const events = lessons();
  events[2].start = '11:00';
  events[2].end = '12:00';
  const h = await boot(t, { events, active: 'b' });
  chooseScope(h, 'future');
  changeTime(h, '10:00', '11:00');
  assert.match(h.q('#recurrenceSummary').textContent, /3 次/);
  assert.equal(save(h), true);
  const result = h.state().events;
  assert.deepEqual(
    result.map((e) => e.start),
    ['09:00', '10:00', '12:00', '10:00'],
  );
  assert.deepEqual(
    result.map((e) => e.date),
    events.map((e) => e.date),
  );
  assert.deepEqual(
    result.map((e) => e.notes),
    events.map((e) => e.notes),
  );
  assert.deepEqual(
    result.map((e) => e.tags),
    events.map((e) => e.tags),
  );
  assert.equal(result[0].status, 'completed');
});
test('future scope follows original series order after individual date moves', async (t) => {
  const events = lessons();
  events[1].date = events[1].endDate = '2026-09-10';
  events[2].date = events[2].endDate = '2026-09-08';
  const h = await boot(t, { events, active: 'b' });
  chooseScope(h, 'future');
  changeTime(h, '10:00', '11:00');
  save(h);
  assert.deepEqual(
    h.state().events.map((e) => e.start),
    ['09:00', '10:00', '10:00', '10:00'],
  );
});
test('entire series can move to the next weekday while retaining intervals and identities', async (t) => {
  const events = lessons();
  const h = await boot(t, { events, active: 'b' });
  chooseScope(h, 'all');
  h.input('#dateInput', '2026-09-26');
  h.input('#endDateInput', '2026-09-26');
  assert.equal(save(h), true);
  const result = h.state().events;
  assert.deepEqual(
    result.map((e) => e.date),
    ['2026-09-19', '2026-09-26', '2026-10-03', '2026-10-10'],
  );
  assert.deepEqual(
    result.map((e) => [e.id, e.recurrenceGroupId, e.recurrenceIndex]),
    events.map((e) => [e.id, e.recurrenceGroupId, e.recurrenceIndex]),
  );
  h.w.undoLastChange();
  assert.deepEqual(
    h.state().events.map((e) => e.date),
    events.map((e) => e.date),
  );
});
test('batch edit changes only the edited common fields, and status only on the active lesson', async (t) => {
  const events = lessons();
  events.push({ ...event('other', '无关课程'), recurrenceGroupId: 'other', recurrenceIndex: 0 });
  const h = await boot(t, { events, active: 'b' });
  chooseScope(h, 'all');
  h.input('#titleInput', '新版课程名');
  h.q('#statusSegment [data-status="completed"]').click();
  assert.equal(save(h), true);
  const result = h.state().events;
  assert.deepEqual(
    result.map((e) => e.title),
    ['新版课程名', '新版课程名', '新版课程名', '新版课程名', '无关课程'],
  );
  assert.deepEqual(
    result.slice(0, 4).map((e) => e.status),
    ['completed', 'completed', 'open', 'open'],
  );
  assert.deepEqual(
    result.map((e) => e.notes),
    events.map((e) => e.notes),
  );
});
test('editing an existing series never appends duplicate occurrences', async (t) => {
  const h = await boot(t, { events: lessons() });
  chooseScope(h, 'all');
  h.q('#recurrenceInput').value = 'weekly';
  changeTime(h, '10:00', '11:00');
  save(h);
  assert.equal(h.state().events.length, 4);
});
test('batch save refuses to overwrite another lesson with a draft', async (t) => {
  const h = await boot(t, { events: lessons(), active: 'c' });
  h.input('#titleInput', '另一节课的草稿');
  const drafts = h.w.localStorage.getItem(draftKey);
  const next = await boot(t, { events: lessons(), active: 'b', drafts });
  chooseScope(next, 'all');
  changeTime(next, '10:00', '11:00');
  assert.equal(save(next), false);
  assert.match(next.q('#eventSaveError').textContent, /正在编辑/);
  assert.deepEqual(
    next.state().events.map((e) => e.start),
    ['09:00', '09:00', '09:00', '09:00'],
  );
});
test('series scope and edits survive restart as a draft', async (t) => {
  const h = await boot(t, { events: lessons(), active: 'b' });
  chooseScope(h, 'future');
  changeTime(h, '10:00', '11:00');
  const next = await boot(t, {
    events: lessons(),
    active: 'b',
    drafts: h.w.localStorage.getItem(draftKey),
  });
  assert.equal(next.q('#seriesScopeInput').value, 'future');
  assert.match(next.q('#saveEventButton').textContent, /3/);
  assert.equal(save(next), true);
  assert.equal(next.state().events[0].start, '09:00');
  assert.equal(next.state().events[3].start, '10:00');
});
test('one invalid affected lesson prevents the whole batch from changing', async (t) => {
  const events = lessons();
  events[2].end = '09:30';
  const h = await boot(t, { events, active: 'b' });
  chooseScope(h, 'all');
  h.input('#startInput', '09:45');
  assert.equal(save(h), false);
  assert.match(h.q('#eventSaveError').textContent, /部分日程/);
  assert.deepEqual(
    h.state().events.map((e) => e.start),
    events.map((e) => e.start),
  );
});
test('all-day series shifts by dates, and a timed exception keeps its time', async (t) => {
  const events = lessons().map((e) => ({ ...e, allDay: true, start: '00:00', end: '00:00' }));
  events[2].allDay = false;
  events[2].start = '11:00';
  events[2].end = '12:00';
  const h = await boot(t, { events, active: 'b' });
  chooseScope(h, 'all');
  h.input('#dateInput', '2026-09-26');
  h.input('#endDateInput', '2026-09-26');
  assert.equal(save(h), true);
  assert.equal(h.state().events[2].date, '2026-10-03');
  assert.equal(h.state().events[2].allDay, false);
  assert.equal(h.state().events[2].start, '11:00');
});
test('overnight series preserves its cross-day duration and rolls dates correctly', async (t) => {
  const events = lessons().map((e) => ({
    ...e,
    start: '23:00',
    end: '01:00',
    endDate:
      e.date === '2026-09-18'
        ? '2026-09-19'
        : e.date === '2026-09-25'
          ? '2026-09-26'
          : e.date === '2026-10-02'
            ? '2026-10-03'
            : '2026-10-10',
  }));
  const h = await boot(t, { events, active: 'b' });
  chooseScope(h, 'all');
  h.input('#dateInput', '2026-09-26');
  changeTime(h, '00:00', '02:00');
  assert.equal(save(h), true);
  assert.deepEqual(
    h.state().events.map((e) => e.date),
    ['2026-09-19', '2026-09-26', '2026-10-03', '2026-10-10'],
  );
  assert.ok(
    h.state().events.every((e) => e.date === e.endDate && e.start === '00:00' && e.end === '02:00'),
  );
});
test('quota failure rolls back the complete series, retains its scope and draft', async (t) => {
  const h = await boot(t, { events: lessons(), active: 'b' });
  chooseScope(h, 'all');
  changeTime(h, '10:00', '11:00');
  const originalSet = h.w.Storage.prototype.setItem;
  h.w.Storage.prototype.setItem = function (key, value) {
    if (key === storageKey) throw new Error('QuotaExceeded');
    return originalSet.call(this, key, value);
  };
  assert.equal(save(h), false);
  assert.ok(h.state().events.every((e) => e.start === '09:00'));
  assert.equal(h.q('#seriesScopeInput').value, 'all');
  assert.equal(h.q('#startInput').value, '10:00');
});

test('date and time popovers attach to the input and flip above near the bottom', async (t) => {
  const { w, q } = await boot(t);
  const field = q('#startInput');
  const picker = q('#timePicker');
  Object.defineProperty(picker, 'offsetWidth', { value: 156 });
  Object.defineProperty(picker, 'offsetHeight', { value: 200 });
  field.getBoundingClientRect = () => ({ left: 300, right: 370, top: 100, bottom: 130 });
  w.showPickerNear(field, picker);
  assert.equal(picker.style.left, '300px');
  assert.equal(picker.style.top, '134px');
  field.getBoundingClientRect = () => ({ left: 980, right: 1020, top: 700, bottom: 730 });
  w.positionInputPicker(field, picker);
  assert.equal(picker.style.left, '856px');
  assert.equal(picker.style.top, '496px');
  assert.equal(picker.hidden, false);
});

test('open picker follows its input when the editor scrolls', async (t) => {
  const { w, q } = await boot(t);
  const field = q('#dateInput');
  const picker = q('#datePicker');
  let top = 100;
  field.getBoundingClientRect = () => ({ left: 300, right: 440, top, bottom: top + 30 });
  field.click();
  assert.equal(picker.hidden, false);
  assert.equal(picker.style.top, '134px');
  top = 160;
  q('.detail-panel').dispatchEvent(new w.Event('scroll'));
  assert.equal(picker.style.top, '194px');
});

test('sync failures explain the cause and retain a readable error history', async (t) => {
  const { w, q } = await boot(t);
  const failure = Object.assign(new Error('Apple 日历写入结果尚未确认，请重试'), {
    code: 'test:42',
  });
  w.recordSyncFailure(failure, '核对写入结果');
  w.renderAppleSyncStatus(`Apple 同步未完成：${failure.message}（稍后重试）`);
  assert.match(q('#appleSyncStatus').textContent, /与预期不一致/);
  w.openRecoveryDialog();
  assert.match(q('#recoveryDialog').textContent, /核对写入结果/);
  assert.match(q('#recoveryDialog').textContent, /test:42/);
  assert.equal(JSON.parse(w.localStorage.getItem('daily-planner-sync-errors')).length, 1);
  assert.match(w.syncFailureReason(new Error('系统操作超时')), /响应超时/);
  assert.match(w.syncFailureReason(new Error('Apple 日历在同步期间发生变化')), /暂停写入/);
});

test('UI undo only reverts the saved operation after an unrelated phone update', async (t) => {
  const h = await boot(t);
  h.input('#titleInput', '电脑 A');
  h.w.document
    .querySelector('#eventForm')
    .dispatchEvent(new h.w.Event('submit', { bubbles: true, cancelable: true }));
  h.w.__testState().events.find((e) => e.id === 'b').title = '手机 B';
  h.w.render({ preserveScroll: true });
  h.w.undoLastChange();
  assert.equal(h.state().events.find((e) => e.id === 'a').title, '课程 A');
  assert.equal(h.state().events.find((e) => e.id === 'b').title, '手机 B');
});

test('ICS import preview can cancel without modifying or saving the document', async (t) => {
  const h = await boot(t, { active: null });
  const before = h.state();
  let preview;
  h.w.confirm = (message) => {
    preview = message;
    return false;
  };
  const result = h.w.importIcsEvents(
    'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:test\nDTSTART:20260926T090000\nDTEND:20260926T100000\nRRULE:FREQ=WEEKLY\nEND:VEVENT\nEND:VCALENDAR',
  );
  assert.equal(result, null);
  assert.match(preview, /两年/);
  assert.deepEqual(h.state(), before);
});
test('ICS import and undo preserve a phone event received after importing', async (t) => {
  const h = await boot(t, { active: null });
  h.w.confirm = () => true;
  const count = h.w.importIcsEvents(
    'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:test\nDTSTART;TZID=America/New_York:20260926T090000\nDTEND;TZID=America/New_York:20260926T100000\nRRULE:FREQ=WEEKLY;COUNT=3\nEND:VEVENT\nEND:VCALENDAR',
  );
  assert.equal(count, 3);
  assert.equal(h.state().events.length, 5);
  h.w.__testState().events.push(event('phone', '手机新增'));
  h.w.undoLastChange();
  assert.deepEqual(
    h.state().events.map((e) => e.id),
    ['a', 'b', 'phone'],
  );
  assert.equal(h.state().sources.length, 1);
});
test('unsupported ICS input leaves the whole document intact and exposes its specific reason', async (t) => {
  const h = await boot(t, { active: null });
  const before = h.state();
  let failure;
  try {
    h.w.importIcsEvents(
      'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:test\nDTSTART;TZID=Unknown/Zone:20260926T090000\nEND:VEVENT\nEND:VCALENDAR',
    );
  } catch (error) {
    failure = error;
  }
  assert.match(h.w.userErrorMessage(failure), /无法识别时区/);
  assert.deepEqual(h.state(), before);
});

test('failed undo persistence keeps the operation retryable and original data intact', async (t) => {
  const h = await boot(t);
  h.input('#titleInput', '电脑 A');
  h.q('#eventForm').dispatchEvent(new h.w.Event('submit', { bubbles: true, cancelable: true }));
  const original = h.w.Storage.prototype.setItem;
  const alerts = [];
  h.w.alert = (message) => alerts.push(message);
  h.w.Storage.prototype.setItem = () => {
    throw new Error('quota');
  };
  h.w.undoLastChange();
  assert.equal(h.state().events[0].title, '电脑 A');
  assert.match(alerts[0], /撤销未能保存/);
  h.w.Storage.prototype.setItem = original;
  h.w.undoLastChange();
  assert.equal(h.state().events[0].title, '课程 A');
});
test('opening another document clears undo operations from the previous document', async (t) => {
  const h = await boot(t);
  h.input('#titleInput', '电脑 A');
  h.q('#eventForm').dispatchEvent(new h.w.Event('submit', { bubbles: true, cancelable: true }));
  const next = h.state();
  next.events = [event('new', '另一个文件')];
  await h.w.loadDataFileText(JSON.stringify(next));
  h.w.undoLastChange();
  assert.deepEqual(
    h.state().events.map((e) => e.title),
    ['另一个文件'],
  );
});
test('Cmd-Z inside a text input remains a native text undo', async (t) => {
  const h = await boot(t);
  const input = h.q('#titleInput');
  input.focus();
  const key = new h.w.KeyboardEvent('keydown', {
    key: 'z',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(key);
  assert.equal(key.defaultPrevented, false);
});
test('failed ICS persistence never reports success or leaves imported events in memory', async (t) => {
  const h = await boot(t, { active: null });
  const before = h.state();
  h.w.confirm = () => true;
  h.w.Storage.prototype.setItem = () => {
    throw new Error('quota');
  };
  assert.throws(
    () =>
      h.w.importIcsEvents(
        'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:test\nDTSTART:20260926T090000\nDTEND:20260926T100000\nEND:VEVENT\nEND:VCALENDAR',
      ),
    /本地保存失败/,
  );
  assert.deepEqual(h.state(), before);
});

test('search typing only persists small preferences and preserves sidebar/editor DOM nodes', async (t) => {
  const h = await boot(t);
  const source = h.q('#sourceList').firstElementChild,
    editor = h.q('#titleInput');
  h.input('#titleInput', '未保存草稿');
  editor.focus();
  editor.setSelectionRange(2, 3);
  const writes = [],
    original = h.w.Storage.prototype.setItem;
  h.w.Storage.prototype.setItem = function (key, value) {
    writes.push([key, value.length]);
    return original.call(this, key, value);
  };
  h.input('#searchInput', '课程');
  assert.equal(h.q('#sourceList').firstElementChild, source);
  assert.equal(h.q('#titleInput'), editor);
  assert.equal(editor.value, '未保存草稿');
  assert.equal(editor.selectionStart, 2);
  assert.deepEqual(
    writes.map((item) => item[0]),
    ['daily-planner-ui-prefs-v1'],
  );
  assert.ok(writes[0][1] < 1024);
});

test('reminder edits survive drafts, save and undo; completed todo cancels reminders', async (t) => {
  const h = await boot(t);
  h.input('#reminderInput', '-900');
  assert.equal(JSON.parse(h.w.localStorage.getItem(draftKey)).a.values.reminderInput, '-900');
  save(h);
  assert.deepEqual(h.state().events[0].reminders, [{ kind: 'relative', offset: -900 }]);
  h.w.setEventStatus('a', 'completed');
  assert.deepEqual(h.state().events[0].reminders, []);
  h.w.undoLastChange();
  assert.deepEqual(h.state().events[0].reminders, [{ kind: 'relative', offset: -900 }]);
});
test('editing title preserves multiple phone reminders and absolute dates', async (t) => {
  const reminders = [
    { kind: 'relative', offset: -900 },
    { kind: 'absolute', timestamp: 1800000000 },
  ];
  const h = await boot(t, { events: [{ ...event('a', '课程'), reminders }] });
  h.input('#titleInput', '新标题');
  save(h);
  assert.deepEqual(h.state().events[0].reminders, reminders);
});
test('special Apple reminder is read-only but other fields remain editable', async (t) => {
  const reminders = [{ kind: 'unsupported', identity: 'location' }];
  const h = await boot(t, { events: [{ ...event('a', '课程'), reminders }] });
  assert.equal(h.q('#reminderInput').disabled, true);
  h.input('#notesInput', '保留提醒');
  save(h);
  assert.deepEqual(h.state().events[0].reminders, reminders);
});
test('all-day reminder stores a wall-clock time and series edits update each occurrence', async (t) => {
  const events = ['a', 'b'].map((id, i) => ({
    ...event(id, '课程', `2026-10-0${4 + i}`),
    allDay: true,
    start: '00:00',
    end: '00:00',
    recurrenceGroupId: 'series',
    recurrenceIndex: i,
  }));
  const h = await boot(t, { events });
  h.input('#reminderInput', 'day');
  h.input('#reminderTimeInput', '09:00');
  h.input('#seriesScopeInput', 'all');
  save(h);
  for (const item of h.state().events)
    assert.deepEqual(item.reminders, [{ kind: 'day', dayOffset: 0, time: '09:00' }]);
});
test('completing one lesson in series does not cancel other lessons reminders', async (t) => {
  const events = ['a', 'b'].map((id, i) => ({
    ...event(id, '课程'),
    recurrenceGroupId: 'g',
    recurrenceIndex: i,
    reminders: [{ kind: 'relative', offset: -900 }],
  }));
  const h = await boot(t, { events });
  h.input('#statusInput', 'completed');
  h.input('#seriesScopeInput', 'all');
  save(h);
  assert.deepEqual(h.state().events[0].reminders, []);
  assert.equal(h.state().events[1].reminders[0].offset, -900);
});
test('bulk reminder replacement stops if another occurrence has a special Apple alarm', async (t) => {
  const events = ['a', 'b'].map((id, i) => ({
    ...event(id, '课程'),
    recurrenceGroupId: 'g',
    recurrenceIndex: i,
    reminders: i ? [{ kind: 'unsupported', identity: 'location' }] : [],
  }));
  const h = await boot(t, { events });
  h.input('#reminderInput', '-900');
  h.input('#seriesScopeInput', 'all');
  assert.equal(save(h), false);
  assert.match(h.q('#eventSaveError').textContent, /特殊提醒/);
  assert.equal(h.state().events[1].reminders[0].identity, 'location');
});
test('native editor distinguishes pending from acknowledged reminders and disabled source', async (t) => {
  const h = await boot(t);
  h.w.webkit = { messageHandlers: { plannerFile: { postMessage() {} } } };
  h.w.eval('renderReminderFields()');
  assert.match(h.q('#reminderStatus').textContent, /待同步/);
  const live = h.w.__testState();
  live.appleSync = {
    baseline: {
      a: {
        local: h.w.PlannerAppleSync.fields(live.events[0]),
        remote: h.w.PlannerAppleSync.fields(live.events[0]),
      },
    },
    conflicts: [],
  };
  h.w.renderReminderFields();
  assert.match(h.q('#reminderStatus').textContent, /已同步到本机/);
  live.sources[0].appleSyncEnabled = false;
  h.w.renderReminderFields();
  assert.match(h.q('#reminderStatus').textContent, /未启用/);
});

test('right rail collapse preserves an unsaved editor and only stores a UI preference', async (t) => {
  const { w, q, input, state } = await boot(t);
  input('#titleInput', '收起后继续编辑');
  const before = w.localStorage.getItem(storageKey);
  q('#detailToggleButton').click();
  assert.equal(q('#detailToggleButton').getAttribute('aria-expanded'), 'false');
  assert.equal(q('.app-shell').classList.contains('is-detail-collapsed'), true);
  assert.equal(q('#draftExitDialog')?.open ?? false, false);
  assert.equal(w.localStorage.getItem(storageKey), before);
  assert.equal(state().events[0].title, '课程 A');
  assert.equal(
    JSON.parse(w.localStorage.getItem('daily-planner-ui-prefs-v1')).detailPanelCollapsed,
    true,
  );
  q('#detailToggleButton').click();
  assert.equal(q('#titleInput').value, '收起后继续编辑');
  assert.equal(q('#detailToggleButton').getAttribute('aria-expanded'), 'true');
});

test('right rail preference survives reload, while opening an event reveals its editor', async (t) => {
  const prefs = JSON.stringify({ detailPanelCollapsed: true });
  const { w, q } = await boot(t, {
    active: null,
    setup: (w) => w.localStorage.setItem('daily-planner-ui-prefs-v1', prefs),
  });
  assert.equal(q('.app-shell').classList.contains('is-detail-collapsed'), true);
  w.openEventForm('a');
  assert.equal(q('.app-shell').classList.contains('is-detail-collapsed'), false);
  assert.equal(q('#eventForm').hidden, false);
  w.setViewMode('week');
  assert.equal(q('#detailToggleButton').hidden, true);
  assert.equal(q('.app-shell').classList.contains('is-detail-collapsed'), false);
});

test('settings switches themes without committing editor drafts and remembers the choice', async (t) => {
  const { w, q, input, state } = await boot(t);
  input('#titleInput', '主题切换后保留草稿');
  const before = w.localStorage.getItem(storageKey);
  q('#settingsButton').click();
  assert.equal(q('#themeMenu').hidden, false);
  assert.equal(q('#settingsButton').getAttribute('aria-expanded'), 'true');
  assert.equal(q('#syncDialog'), null);
  q('#themeOptions [data-theme="coral"]').click();
  assert.equal(w.document.body.dataset.theme, 'coral');
  assert.equal(q('#titleInput').value, '主题切换后保留草稿');
  assert.equal(state().events[0].title, '课程 A');
  assert.equal(w.localStorage.getItem(storageKey), before);
  assert.equal(q('#themeMenu').hidden, true);
  const prefs = w.localStorage.getItem('daily-planner-ui-prefs-v1');
  const next = await boot(t, {
    setup: (w) => w.localStorage.setItem('daily-planner-ui-prefs-v1', prefs),
  });
  assert.equal(next.w.document.body.dataset.theme, 'coral');
  next.q('#settingsButton').click();
  assert.equal(next.q('#themeOptions [data-theme="coral"]').getAttribute('aria-pressed'), 'true');
  next.q('#themeOptions [data-theme="mono"]').click();
  assert.equal(next.w.document.body.dataset.theme, 'mono');
});

test('browser settings stay local and native settings retain Apple calendar checks', async (t) => {
  const { q } = await boot(t, { active: null });
  q('#settingsButton').click();
  assert.equal(q('#themeMenu').hidden, false);
  assert.equal(q('#settingsAppleSyncButton').hidden, true);
  assert.equal(q('#syncDialog'), null);

  const native = await boot(t, {
    active: null,
    setup: (w) => {
      w.webkit = { messageHandlers: { plannerFile: { postMessage() {} } } };
    },
  });
  let nativeCalls = 0;
  native.w.__syncPlannerToAppleCalendar = () => {
    nativeCalls += 1;
  };
  native.q('#settingsButton').click();
  assert.equal(native.q('#settingsAppleSyncButton').hidden, false);
  native.q('#settingsAppleSyncButton').click();
  assert.equal(nativeCalls, 1);
  assert.equal(native.q('#themeMenu').hidden, true);
});

test('legacy cloud metadata stays inert while local events save and undo normally', async (t) => {
  const { w, q, input, state } = await boot(t, {
    setup: (w) => {
      const previous = JSON.parse(w.localStorage.getItem(storageKey));
      previous.cloudSync = {
        accountId: 'legacy-account',
        conflicts: [{ collection: 'events', id: 'a', local: previous.events[0], remote: null }],
      };
      w.localStorage.setItem(storageKey, JSON.stringify(previous));
      w.PLANNER_SUPABASE = { url: 'https://unused.supabase.co', anonKey: 'legacy-config' };
      w.supabase = {
        createClient() {
          throw new Error('retired cloud client must not start');
        },
      };
    },
  });
  assert.equal(state().events[0].title, '课程 A');
  input('#titleInput', '本地修改');
  q('#eventForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(JSON.parse(w.localStorage.getItem(storageKey)).events[0].title, '本地修改');
  w.undoLastChange();
  assert.equal(state().events[0].title, '课程 A');
  const exported = JSON.parse(w.serializeDataFile());
  assert.equal(exported.events.length, 2);
  assert.equal(exported.cloudSync.accountId, 'legacy-account');
  assert.equal(q('#syncEmailInput'), null);
});

test('dark theme preserves drafts and records a local preference that survives reload', async (t) => {
  const { w, q, input, state } = await boot(t);
  input('#titleInput', '深色主题下保留草稿');
  const before = w.localStorage.getItem(storageKey);
  const sourceColor = state().sources[0].color;
  const nativeCalls = [];
  w.webkit = {
    messageHandlers: { plannerWindow: { postMessage: (message) => nativeCalls.push(message) } },
  };
  q('#settingsButton').click();
  q('#themeOptions [data-theme="dark"]').click();
  assert.equal(w.document.body.dataset.theme, 'dark');
  assert.equal(q('#titleInput').value, '深色主题下保留草稿');
  assert.equal(state().sources[0].color, sourceColor);
  assert.equal(w.localStorage.getItem(storageKey), before);
  assert.equal(nativeCalls.at(-1).action, 'setAppearance');
  assert.equal(nativeCalls.at(-1).dark, true);
  const prefs = w.localStorage.getItem('daily-planner-ui-prefs-v1');
  const next = await boot(t, {
    setup: (w) => w.localStorage.setItem('daily-planner-ui-prefs-v1', prefs),
  });
  assert.equal(next.w.document.body.dataset.theme, 'dark');
  next.q('#settingsButton').click();
  assert.equal(next.q('#themeOptions [data-theme="dark"]').getAttribute('aria-pressed'), 'true');
  q('#settingsButton').click();
  q('#themeOptions [data-theme="coral"]').click();
  assert.equal(nativeCalls.at(-1).dark, false);
});

test('settings menu toggles closed with its button and Escape', async (t) => {
  const { w, q } = await boot(t, { active: null });
  q('#settingsButton').click();
  q('#settingsButton').click();
  assert.equal(q('#themeMenu').hidden, true);
  q('#settingsButton').click();
  q('#themeOptions button').dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  assert.equal(q('#themeMenu').hidden, true);
  assert.equal(q('#settingsButton').getAttribute('aria-expanded'), 'false');
});

test('native fullscreen settings follows system state and preserves editor drafts', async (t) => {
  const calls = [];
  const { w, q, input, state } = await boot(t, {
    setup(w) {
      w.ResizeObserver = class {
        observe() {}
      };
      w.webkit = {
        messageHandlers: { plannerWindow: { postMessage: (message) => calls.push(message) } },
      };
    },
  });
  assert.equal(q('#settingsFullScreenButton').hidden, false);
  assert.ok(calls.some((message) => message.action === 'getState'));
  input('#titleInput', '切换全屏保留草稿');
  q('#settingsButton').click();
  q('#settingsFullScreenButton').click();
  assert.equal(calls.at(-1).action, 'toggleFullScreen');
  assert.equal(q('#themeMenu').hidden, true);
  w.dispatchEvent(new w.CustomEvent('planner-window-state', { detail: { fullScreen: true } }));
  assert.equal(q('#settingsFullScreenButton').textContent, '退出全屏');
  assert.equal(q('#settingsFullScreenButton').getAttribute('aria-pressed'), 'true');
  assert.equal(w.document.body.classList.contains('macos-fullscreen'), true);
  assert.equal(q('#titleInput').value, '切换全屏保留草稿');
  assert.equal(state().events[0].title, '课程 A');
  w.dispatchEvent(new w.CustomEvent('planner-window-state', { detail: { fullScreen: false } }));
  assert.equal(q('#settingsFullScreenButton').textContent, '进入全屏');
});

test('window drag regions track toolbar layout, controls, menus and modal backdrop', async (t) => {
  const { w, q } = await boot(t, { active: null });
  const calls = [];
  w.webkit = {
    messageHandlers: { plannerWindow: { postMessage: (message) => calls.push(message) } },
  };
  const rect = (x, y, width, height) => ({ left: x, top: y, width, height });
  q('.planner-header').getBoundingClientRect = () => rect(250, 10, 1000, 60);
  q('.window-toolbar').getBoundingClientRect = () => rect(10, 42, 220, 36);
  q('#todayButton').getBoundingClientRect = () => rect(1000, 25, 50, 30);
  q('#searchInput').getBoundingClientRect = () => rect(700, 25, 220, 30);
  q('#themeMenu').getBoundingClientRect = () => rect(80, 20, 200, 170);
  w.updateWindowDragRegions();
  let report = calls.at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(report.regions[0])), {
    x: 0,
    y: 0,
    width: w.innerWidth,
    height: 70,
  });
  assert.ok(report.blocked.some((r) => r.x === 1000 && r.width === 50));
  assert.ok(report.blocked.some((r) => r.x === 700 && r.width === 220));
  assert.ok(!report.blocked.some((r) => r.width === 200 && r.height === 170));
  q('#themeMenu').hidden = false;
  w.updateWindowDragRegions();
  assert.ok(calls.at(-1).blocked.some((r) => r.width === 200 && r.height === 170));
  w.openRecoveryDialog();
  w.updateWindowDragRegions();
  assert.ok(
    calls.at(-1).blocked.some((r) => r.width === w.innerWidth && r.height === w.innerHeight),
  );
  q('#recoveryDialog').close();
  q('.planner-header').getBoundingClientRect = () => rect(250, 10, 1000, 100);
  w.updateWindowDragRegions();
  assert.equal(calls.at(-1).regions[0].height, 110);
});

test('browser fullscreen settings enters and exits, unsupported browsers hide the action', async (t) => {
  const { w, q } = await boot(t, { active: null });
  assert.equal(q('#settingsFullScreenButton').hidden, true);
  Object.defineProperty(w.document, 'fullscreenEnabled', { value: true });
  let enters = 0,
    exits = 0;
  w.document.documentElement.requestFullscreen = async () => {
    enters += 1;
  };
  w.document.exitFullscreen = async () => {
    exits += 1;
  };
  w.document.dispatchEvent(new w.Event('fullscreenchange'));
  assert.equal(q('#settingsFullScreenButton').hidden, false);
  q('#settingsFullScreenButton').click();
  assert.equal(enters, 1);
  Object.defineProperty(w.document, 'fullscreenElement', { value: w.document.documentElement });
  w.document.dispatchEvent(new w.Event('fullscreenchange'));
  assert.equal(q('#settingsFullScreenButton').textContent, '退出全屏');
  q('#settingsFullScreenButton').click();
  assert.equal(exits, 1);
});

test('floating editor stays inside viewport and repositions after window resize', async (t) => {
  const { w, q } = await boot(t);
  w.setViewMode('week');
  const panel = q('#detailPanel');
  Object.defineProperty(panel, 'offsetWidth', { configurable: true, value: 292 });
  Object.defineProperty(panel, 'offsetHeight', { configurable: true, value: 500 });
  Object.defineProperty(w, 'innerWidth', { configurable: true, value: 800 });
  Object.defineProperty(w, 'innerHeight', { configurable: true, value: 600 });
  w.openEventForm('a', { left: 780, right: 810, top: 560, bottom: 575 });
  assert.equal(panel.style.top, '88px');
  assert.ok(parseFloat(panel.style.left) + 292 <= 788);
  Object.defineProperty(w, 'innerHeight', { configurable: true, value: 530 });
  w.dispatchEvent(new w.Event('resize'));
  assert.equal(panel.style.top, '18px');
  assert.equal(panel.style.bottom, 'auto');
  assert.equal(q('#saveEventButton').closest('.event-form-body'), null);
  assert.ok(q('#notesInput').closest('.event-form-body'));
  w.setViewMode('day');
  assert.equal(panel.style.bottom, '');
});

test('short cards keep a central move region and resize only at their edges', async (t) => {
  const { w, q } = await boot(t);
  const card = q('.event-card[data-event-id="a"]');
  for (const nested of [false, true]) {
    card.classList.toggle('is-nested-child', nested);
    for (const height of [12, 15, 24, 48]) {
      card.getBoundingClientRect = () => ({ top: 100, bottom: 100 + height, height });
      const edge = (y) => w.getEventResizeEdgeFromPointer({ target: card, clientY: y }, card);
      assert.equal(edge(100 + height / 2), '');
      assert.equal(edge(101), 'top');
      assert.equal(edge(99 + height), 'bottom');
    }
  }
});

test('resize grips are reachable inside short cards without taking the body or completion control', async (t) => {
  const { w, q } = await boot(t, { active: null });
  const card = q('.event-card[data-event-id="a"]');
  card.getBoundingClientRect = () => ({ top: 100, bottom: 112, height: 12 });
  const pointer = (target, clientY) => ({ target, clientY });
  const top = card.querySelector('.resize-handle-top');
  const bottom = card.querySelector('.resize-handle-bottom');
  assert.equal(w.getEventResizeEdgeFromPointer(pointer(top, 105), card), 'top');
  assert.equal(w.getEventResizeEdgeFromPointer(pointer(bottom, 107), card), 'bottom');
  assert.equal(
    w.getEventResizeEdgeFromPointer(pointer(card.querySelector('.event-title'), 106), card),
    '',
  );
  assert.equal(w.getEventResizeEdgeFromPointer(pointer(card, 99), card), '');
  w.updateEventResizeCursor(pointer(top, 105), event('a', '课程 A'), card);
  assert.equal(card.dataset.resizeEdgeHover, 'top');
  w.updateEventResizeCursor(
    pointer(card.querySelector('.complete-toggle'), 101),
    event('a', '课程 A'),
    card,
  );
  assert.equal(card.classList.contains('is-resize-edge-hover'), false);
});

test('resizing uses displacement from the grab point, preserves the opposite edge and supports undo', async (t) => {
  for (const edge of ['top', 'bottom']) {
    for (const travelTime of [0, 30]) {
      await t.test(`${edge}, travel ${travelTime}`, async (t) => {
        const item = { ...event('a', '拖动边缘'), travelTime };
        const { w, q, state } = await boot(t, { events: [item], active: null });
        const card = q('.event-card[data-event-id="a"]');
        const column = card.closest('.timeline-column');
        column.getBoundingClientRect = () => ({ left: 0, right: 200, top: 0 });
        const top = w.minuteToY(540 - travelTime);
        const bottom = w.minuteToY(600);
        card.getBoundingClientRect = () => ({ top, bottom, height: bottom - top });
        const pointer = {
          target: card.querySelector(`.resize-handle-${edge}`),
          pointerId: 1,
          button: 0,
          clientX: 100,
          clientY: edge === 'top' ? top + 10 : bottom - 10,
          preventDefault() {},
          stopPropagation() {},
        };
        w.startEventPointerInteraction(pointer, item, card);
        const moved = { ...pointer, clientY: pointer.clientY + w.minutesToHeight(30) };
        w.handleEventPointerMove(moved);
        w.finishEventPointerInteraction(moved);
        assert.equal(state().events[0].start, edge === 'top' ? '09:30' : '09:00');
        assert.equal(state().events[0].end, edge === 'bottom' ? '10:30' : '10:00');
        assert.equal(state().events[0].travelTime, travelTime);
        w.undoLastChange();
        assert.equal(state().events[0].start, '09:00');
        assert.equal(state().events[0].end, '10:00');
      });
    }
  }
});

test('edge click jitter does not change or persist an event', async (t) => {
  const item = event('a', '轻点边缘');
  const { w, q, state } = await boot(t, { events: [item], active: null });
  const saved = w.localStorage.getItem(storageKey);
  const card = q('.event-card[data-event-id="a"]');
  const column = card.closest('.timeline-column');
  column.getBoundingClientRect = () => ({ left: 0, right: 200, top: 0 });
  const pointer = {
    target: card.querySelector('.resize-handle-bottom'),
    pointerId: 1,
    button: 0,
    clientX: 100,
    clientY: w.minuteToY(600) - 10,
    preventDefault() {},
    stopPropagation() {},
  };
  w.startEventPointerInteraction(pointer, item, card);
  const jitter = { ...pointer, clientY: pointer.clientY + 1 };
  w.handleEventPointerMove(jitter);
  w.finishEventPointerInteraction(jitter);
  assert.equal(state().events[0].start, '09:00');
  assert.equal(state().events[0].end, '10:00');
  assert.equal(card.classList.contains('is-event-resizing'), false);
  assert.equal(w.localStorage.getItem(storageKey), saved);
});

test('moving a 15 minute event changes both times equally and supports undo', async (t) => {
  const short = { ...event('a', '短日程'), end: '09:15' };
  const { w, q, state } = await boot(t, { events: [short], active: null });
  const card = q('.event-card[data-event-id="a"]');
  const column = card.closest('.timeline-column');
  const top = w.minuteToY(540);
  column.getBoundingClientRect = () => ({ left: 0, right: 200, top: 0 });
  card.getBoundingClientRect = () => ({ top, bottom: top + 12, height: 12 });
  const pointer = {
    target: card,
    pointerId: 1,
    button: 0,
    clientX: 100,
    clientY: top + 6,
    preventDefault() {},
    stopPropagation() {},
  };
  w.startEventPointerInteraction(pointer, short, card);
  const moved = { ...pointer, clientY: pointer.clientY + w.minutesToHeight(30) };
  w.handleEventPointerMove(moved);
  w.finishEventPointerInteraction(moved);
  assert.equal(state().events[0].start, '09:30');
  assert.equal(state().events[0].end, '09:45');
  w.undoLastChange();
  assert.equal(state().events[0].start, '09:00');
  assert.equal(state().events[0].end, '09:15');
});

test('schedule source allows a single event to become a todo and survive reload', async (t) => {
  const schedule = { ...event('a', '可切换事项'), type: 'schedule' };
  const h = await boot(t, {
    events: [schedule],
    setup(w) {
      const saved = JSON.parse(w.localStorage.getItem(storageKey));
      saved.sources[0].type = 'schedule';
      w.localStorage.setItem(storageKey, JSON.stringify(saved));
    },
  });
  h.q('#eventTypeInput').value = 'todo';
  h.q('#eventTypeInput').dispatchEvent(new h.w.Event('change', { bubbles: true }));
  assert.equal(h.q('.todo-status-row').hidden, false);
  assert.equal(h.w.saveEvent({ preventDefault() {} }), true);
  assert.equal(h.state().events[0].type, 'todo');
  assert.equal(h.state().sources[0].type, 'schedule');
  assert.ok(h.q('.event-card[data-event-id="a"] .complete-toggle'));
  h.w.openEventForm('a');
  assert.equal(h.q('#eventTypeInput').value, 'todo');
  const saved = h.w.localStorage.getItem(storageKey);
  const reloaded = await boot(t, {
    setup(w) {
      w.localStorage.setItem(storageKey, saved);
    },
  });
  assert.equal(reloaded.state().events[0].type, 'todo');
  assert.equal(reloaded.q('#eventTypeInput').value, 'todo');
  reloaded.q('#eventTypeInput').value = 'schedule';
  assert.equal(reloaded.w.saveEvent({ preventDefault() {} }), true);
  assert.equal(reloaded.state().events[0].type, 'schedule');
  assert.equal(reloaded.q('.event-card[data-event-id="a"] .complete-toggle'), null);
});

test('month navigation crosses years and today restores the current month', async (t) => {
  const { w, q, state } = await boot(t, { active: null });
  Object.assign(w.__testState(), { selectedDate: '2026-12-31', miniMonth: '2026-12' });
  q('#monthViewButton').click();
  assert.equal(q('#monthViewButton').getAttribute('aria-pressed'), 'true');
  assert.equal(q('#selectedDateLabel').textContent, '2026年12月');
  assert.equal(q('#nextDayButton').getAttribute('aria-label'), '下一月');
  q('#nextDayButton').click();
  assert.equal(state().miniMonth, '2027-01');
  assert.equal(state().selectedDate, '2027-01-01');
  q('#prevDayButton').click();
  assert.equal(state().miniMonth, '2026-12');
  q('#todayButton').click();
  assert.equal(state().miniMonth, w.getTodayKey().slice(0, 7));
  assert.equal(
    q('.month-date[aria-current="date"]').closest('.month-day').dataset.date,
    w.getTodayKey(),
  );
});

test('month grid supports leap days, all themes and opening a chosen date', async (t) => {
  const { w, q, state } = await boot(t, { active: null });
  Object.assign(w.__testState(), { miniMonth: '2028-02' });
  for (const theme of ['dark', 'coral', 'mono']) {
    w.__testState().theme = theme;
    w.setViewMode('month');
    assert.equal(w.document.body.dataset.theme, theme);
    assert.equal(w.document.querySelectorAll('.month-week').length, 6);
    assert.equal(w.document.querySelectorAll('.month-day').length, 42);
    assert.equal(q('.month-day').dataset.date, '2028-01-31');
    assert.ok(q('.month-day[data-date="2028-02-29"]'));
    assert.equal(w.document.querySelectorAll('.timeline-column').length, 0);
  }
  q('.month-day[data-date="2028-02-29"] .month-date').click();
  assert.equal(state().viewMode, 'day');
  assert.equal(state().selectedDate, '2028-02-29');
  assert.ok(q('.timeline-column[data-date="2028-02-29"]'));
});

test('month all-day bars split across weeks without overlap and timed rows open the editor', async (t) => {
  const events = [
    { ...event('trip', '跨周旅行', '2026-10-03'), endDate: '2026-10-07', allDay: true },
    { ...event('holiday', '假期', '2026-10-05'), endDate: '2026-10-06', allDay: true },
    event('late', '午后课程', '2026-10-05'),
    { ...event('early', '早晨课程', '2026-10-05'), start: '08:00' },
  ];
  const { w, q, state } = await boot(t, { active: null, events });
  w.__testState().miniMonth = '2026-10';
  w.setViewMode('month');
  const bars = [...w.document.querySelectorAll('.month-all-day-bars [data-event-id="trip"]')];
  assert.equal(bars.length, 2);
  assert.equal(bars[0].style.gridColumn, '6 / 8');
  assert.equal(bars[1].style.gridColumn, '1 / 4');
  assert.equal(bars[0].classList.contains('continues-after'), true);
  assert.equal(bars[1].classList.contains('continues-before'), true);
  assert.notEqual(bars[1].style.gridRow, q('[data-event-id="holiday"]').style.gridRow);
  const day = q('.month-day[data-date="2026-10-05"]');
  assert.deepEqual(
    [...day.querySelectorAll('.month-event')].map((card) => card.dataset.eventId),
    ['early', 'late'],
  );
  day.querySelector('[data-event-id="late"]').click();
  assert.equal(state().activeEventId, 'late');
  assert.equal(q('#titleInput').value, '午后课程');
});

test('month view honors calendar visibility and search and creates on the clicked date', async (t) => {
  const { w, q, state } = await boot(t, {
    active: null,
    events: [event('a', '课程 A', '2026-10-05'), event('b', '讨论 B', '2026-10-05')],
  });
  w.__testState().miniMonth = '2026-10';
  w.__testState().searchQuery = '讨论';
  w.setViewMode('month');
  assert.equal(w.document.querySelectorAll('.month-event').length, 1);
  assert.equal(q('.month-event').dataset.eventId, 'b');
  w.__testState().sources[0].visible = false;
  w.render();
  assert.equal(w.document.querySelectorAll('.month-event').length, 0);
  w.__testState().sources[0].visible = true;
  w.__testState().searchQuery = '';
  w.render();
  q('.month-day[data-date="2026-10-12"] .month-day-events').dispatchEvent(
    new w.MouseEvent('dblclick', { bubbles: true }),
  );
  const created = state().events.find((item) => item.id === state().activeEventId);
  assert.equal(created.date, '2026-10-12');
  assert.equal(created.start, '09:00');
  assert.equal(q('#eventForm').hidden, false);
});
