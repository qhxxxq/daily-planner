/**
 * 文件用途：全局界面渲染协调。
 * 应用主题与布局状态，依次刷新侧栏、日历和编辑面板等区域；调用各模块保持共享状态与显示一致。
 */
import { getMonthEvents } from './month-calendar.js';
import { runtime } from '../app/runtime.js';
import { captureEditorDraft } from './drafts.js';
import { clamp } from '../domain/math.js';
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from '../app/config.js';
import { renderSources, renderTags } from './sidebar.js';
import { renderCalendar } from './calendar.js';
import { renderSearchUi } from './search.js';
import { renderFormState, renderSourceOptions, renderDetailPanelVisibility } from './editor.js';
import { renderThemeOptions } from './themes.js';
import { refreshStatusSummary } from './status.js';
import {
  addDays,
  formatDateLong,
  formatMonthDay,
  formatWeekday,
  fromMonthKey,
  getTodayKey,
  getWeekStartDate,
  isValidDateKey,
  parseDateKey,
  startOfCalendarGrid,
  toDateKey,
  toMonthKey,
} from '../domain/date-time.js';
import {
  getSearchQuery,
  getSelectedEvents,
  getSelectedTagKeys,
  getWeekEvents,
} from '../app/queries.js';
import { isEventCompleted } from '../domain/events.js';
import { getEventType, isEventIncompleteTodo } from '../app/queries.js';
import { saveAndRender } from '../app/persistence.js';

export function render(options = {}) {
  runtime.searchIndex.invalidate();
  captureEditorDraft();
  const editingElement = document.activeElement as HTMLInputElement | HTMLTextAreaElement;
  const caret =
    runtime.editorReady &&
    runtime.state.activeEventId === runtime.editorId &&
    runtime.editorFieldNames.some((name) => runtime.els[name] === editingElement)
      ? {
          element: editingElement,
          start: editingElement.selectionStart,
          end: editingElement.selectionEnd,
        }
      : null;
  document.body.dataset.theme = runtime.state.theme || 'mono';
  runtime.els.appShell.classList.toggle('is-day-mode', runtime.state.viewMode === 'day');
  runtime.els.appShell.classList.toggle('is-week-mode', runtime.state.viewMode === 'week');
  runtime.els.appShell.classList.toggle('is-month-mode', runtime.state.viewMode === 'month');
  runtime.els.appShell.style.setProperty(
    '--sidebar-width',
    `${clamp(runtime.state.sidebarWidth || 228, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)}px`,
  );
  renderMiniCalendar();
  renderSources();
  renderTags();
  renderRangeHeading();
  renderStats();
  renderCalendar(options);
  renderSearchUi();
  renderSourceOptions();
  renderFormState();
  renderDetailPanelVisibility();
  renderThemeOptions();
  refreshStatusSummary();
  if (caret && !runtime.els.eventForm.hidden && caret.start !== null) {
    caret.element.setSelectionRange?.(caret.start, caret.end);
  }
  if (window.lucide) window.lucide.createIcons();
}

export function renderRangeHeading() {
  const today = getTodayKey();
  if (runtime.state.viewMode === 'month') {
    runtime.els.selectedWeekday.textContent = '月视图';
    runtime.els.selectedDateLabel.textContent = fromMonthKey(
      runtime.state.miniMonth,
    ).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
  } else if (runtime.state.viewMode === 'week') {
    const start = parseDateKey(runtime.state.visibleWeekStart);
    const end = addDays(start, 6);
    runtime.els.selectedWeekday.textContent = '周视图';
    runtime.els.selectedDateLabel.textContent = `${formatMonthDay(start)} - ${formatMonthDay(end)}`;
  } else {
    const date = parseDateKey(
      isValidDateKey(runtime.state.selectedDate) ? runtime.state.selectedDate : today,
    );
    runtime.els.selectedWeekday.textContent = formatWeekday(date);
    runtime.els.selectedDateLabel.textContent = formatDateLong(date);
  }
  runtime.els.monthViewButton.setAttribute(
    'aria-pressed',
    String(runtime.state.viewMode === 'month'),
  );
  for (const [button, label] of [
    [runtime.els.prevDayButton, runtime.state.viewMode === 'month' ? '上一月' : '前一天'],
    [runtime.els.nextDayButton, runtime.state.viewMode === 'month' ? '下一月' : '后一天'],
  ] as const) {
    button.title = label;
    button.setAttribute('aria-label', label);
  }
  runtime.els.dayViewButton.setAttribute('aria-pressed', String(runtime.state.viewMode === 'day'));
  runtime.els.weekViewButton.setAttribute(
    'aria-pressed',
    String(runtime.state.viewMode === 'week'),
  );
}

export function renderStats() {
  const events =
    runtime.state.viewMode === 'month'
      ? getMonthEvents()
      : runtime.state.viewMode === 'week'
        ? getWeekEvents()
        : getSelectedEvents();
  const todos = events.filter((event) => getEventType(event) === 'todo');
  runtime.els.totalCount.textContent = String(todos.length);
  runtime.els.doneCount.textContent = String(todos.filter(isEventCompleted).length);
  runtime.els.remainingCount.textContent = String(todos.filter(isEventIncompleteTodo).length);
}

export function renderMiniCalendar() {
  const monthDate = fromMonthKey(runtime.state.miniMonth);
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const todayKey = toDateKey(new Date());
  const start = startOfCalendarGrid(year, month);
  const days = Array.from({ length: 42 }, (_, index) => addDays(start, index));
  const first = toDateKey(days[0]),
    last = toDateKey(days.at(-1));
  const eventDates = runtime.searchIndex.dates(runtime.state, first, last);
  const searchDates =
    getSearchQuery() || getSelectedTagKeys().length
      ? runtime.searchIndex.dates(
          runtime.state,
          first,
          last,
          getSearchQuery(),
          getSelectedTagKeys(),
        )
      : new Set();
  runtime.els.miniMonthLabel.textContent = monthDate.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
  });
  runtime.els.miniCalendar.innerHTML = '';
  days.forEach((day) => {
    const key = toDateKey(day);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mini-day';
    button.textContent = String(day.getDate());
    if (day.getMonth() !== month) button.classList.add('is-muted');
    if (key === todayKey) button.classList.add('is-today', 'is-selected');
    if (eventDates.has(key)) button.classList.add('has-events');
    if (searchDates.has(key)) button.classList.add('has-search-match');
    button.addEventListener('click', () => {
      if (runtime.state.viewMode === 'month') runtime.state.selectedDate = key;
      runtime.state.visibleWeekStart = toDateKey(getWeekStartDate(day));
      runtime.state.miniMonth = toMonthKey(day);
      saveAndRender();
    });
    runtime.els.miniCalendar.append(button);
  });
}
