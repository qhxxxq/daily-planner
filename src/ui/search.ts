/**
 * 文件用途：搜索输入、结果与偏好。
 * 连接内存索引、关键词和标签筛选，渲染搜索结果及交互状态；将搜索偏好独立持久化。
 */
import {
  eventMatchesSearch,
  getSearchQuery,
  getSelectedTagKeys,
  getSource,
  getVisibleEvents,
} from '../app/queries.js';
import { runtime } from '../app/runtime.js';
import { getEventStartAbs, sortEvents } from '../domain/event-time.js';
import { renderMiniCalendar, renderStats } from './render.js';
import { renderCalendar } from './calendar.js';
import { renderDailyTodoPanel } from './daily-todos.js';
import { saveAndRender, saveUiPrefs } from '../app/persistence.js';
import { renderFileConnectionStatus } from '../platform/files.js';
import { requestEditorExit } from './drafts.js';
import {
  dateTimeToAbsoluteMinute,
  getTodayKey,
  getWeekStartDate,
  parseDateKey,
  toDateKey,
  toMonthKey,
} from '../domain/date-time.js';
import { openEventForm } from './editor.js';
import { scrollEventIntoView } from './navigation.js';
import { getEventTags, normalizeTagKey } from '../domain/tags.js';

export function focusSearch() {
  const shell = runtime.els.searchInput.closest('.search-shell');
  shell?.classList.add('is-search-open');
  document.querySelector('#searchToggleButton')?.setAttribute('aria-expanded', 'true');
  runtime.els.searchInput.focus();
}

export function closeSearchPopover(returnFocus = false) {
  const toggle = document.querySelector<HTMLButtonElement>('#searchToggleButton');
  runtime.els.searchInput.closest('.search-shell')?.classList.remove('is-search-open');
  toggle?.setAttribute('aria-expanded', 'false');
  runtime.searchResultsOpen = false;
  renderSearchUi();
  if (returnFocus && toggle && getComputedStyle(toggle).display !== 'none') toggle.focus();
}

export function bindSearchPopover() {
  const toggle = document.querySelector<HTMLButtonElement>('#searchToggleButton');
  const shell = runtime.els.searchInput.closest('.search-shell');
  toggle?.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'touch') focusSearch();
  });
  toggle?.addEventListener('click', focusSearch);
  shell?.addEventListener('focusout', () => {
    queueMicrotask(() => {
      if (!shell.contains(document.activeElement)) closeSearchPopover();
    });
  });
  document.addEventListener('pointerdown', (event) => {
    if (!shell?.contains(event.target as Node)) closeSearchPopover();
  });
}

export function getSearchResults() {
  if (!getSearchQuery()) return [];
  return runtime.searchIndex
    .query(runtime.state, getSearchQuery(), getSelectedTagKeys())
    .sort(sortEvents);
}

export function renderSearchUi() {
  if (document.activeElement !== runtime.els.searchInput)
    runtime.els.searchInput.value = runtime.state.searchQuery || '';
  runtime.els.clearSearchButton.hidden = !getSearchQuery() && !getSelectedTagKeys().length;
  const results = getSearchResults();
  runtime.els.searchResults.hidden = !runtime.searchResultsOpen || !getSearchQuery();
  runtime.els.searchInput.setAttribute('aria-expanded', String(!runtime.els.searchResults.hidden));
  runtime.els.searchResults.replaceChildren();
  if (runtime.els.searchResults.hidden) return;
  const summary = document.createElement('div');
  summary.className = 'search-result-summary';
  summary.setAttribute('role', 'status');
  summary.textContent = results.length
    ? `${results.length} 项日程`
    : '没有找到日程，换个关键词试试';
  runtime.els.searchResults.append(summary);
  for (const event of results.slice(0, runtime.searchResultLimit)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'search-result-item';
    button.dataset.searchEventId = event.id;
    const title = document.createElement('strong');
    title.className = 'search-result-title';
    title.textContent = event.title || '未命名日程';
    const meta = document.createElement('span');
    meta.className = 'search-result-meta';
    meta.textContent = `${event.date}${event.endDate && event.endDate !== event.date ? ` → ${event.endDate}` : ''} · ${event.allDay ? '全天' : `${event.start}–${event.end}`} · ${getSource(event.sourceId)?.name || '日历'}`;
    button.append(title, meta);
    runtime.els.searchResults.append(button);
  }
  if (results.length > runtime.searchResultLimit) {
    const more = document.createElement('button');
    more.type = 'button';
    more.dataset.searchMore = 'true';
    more.className = 'search-more';
    more.textContent = '显示更多';
    runtime.els.searchResults.append(more);
  }
}

export function renderSearchFilter() {
  renderSearchUi();
  renderStats();
  renderMiniCalendar();
  renderCalendar({ preserveScroll: true });
  if (!runtime.state.activeEventId) renderDailyTodoPanel();
  if (window.lucide) window.lucide.createIcons();
}

export function persistSearchPrefs() {
  try {
    saveUiPrefs();
  } catch {
    renderFileConnectionStatus('搜索偏好暂未保存，日程内容不受影响');
  }
}

export function handleSearchInput() {
  runtime.stateRevision += 1;
  runtime.state.searchQuery = runtime.els.searchInput.value;
  runtime.searchResultsOpen = true;
  runtime.searchResultLimit = 50;
  resetTagJumpState();
  persistSearchPrefs();
  renderSearchFilter();
}

export function clearSearch() {
  runtime.stateRevision += 1;
  runtime.state.searchQuery = '';
  runtime.state.selectedTagKeys = [];
  runtime.searchResultsOpen = false;
  resetTagJumpState();
  runtime.els.searchInput.value = '';
  persistSearchPrefs();
  renderSearchFilter();
  runtime.els.searchInput.focus();
}

export function handleSearchResultClick(event) {
  event.stopPropagation();
  if ((event.target as Element).closest<HTMLElement>('[data-search-more]')) {
    runtime.searchResultLimit += 50;
    renderSearchUi();
    return;
  }
  const id = (event.target as Element).closest<HTMLElement>('[data-search-event-id]')?.dataset
    .searchEventId;
  if (!id) return;
  requestEditorExit(() => {
    const selected = runtime.state.events.find((item) => item.id === id);
    if (!selected) return;
    runtime.searchResultsOpen = false;
    runtime.state.selectedDate = selected.date;
    runtime.state.visibleWeekStart = toDateKey(getWeekStartDate(parseDateKey(selected.date)));
    runtime.state.miniMonth = selected.date.slice(0, 7);
    openEventForm(id);
    requestAnimationFrame(() => {
      scrollEventIntoView(id);
      runtime.els.titleInput.focus();
    });
  });
}

export function handleSearchKeydown(event) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    runtime.els.searchInput.focus();
    closeSearchPopover(true);
    return;
  }
  const buttons = [...runtime.els.searchResults.querySelectorAll<HTMLButtonElement>('button')];
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    event.stopPropagation();
    if (runtime.els.searchResults.hidden) {
      runtime.searchResultsOpen = true;
      renderSearchUi();
      runtime.els.searchResults.querySelector<HTMLButtonElement>('button')?.focus();
      return;
    }
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[
      (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    ]?.focus();
  } else if (event.key === 'Enter' && event.target === runtime.els.searchInput && buttons.length) {
    event.preventDefault();
    event.stopPropagation();
    buttons[0].click();
  }
}

export function handleTagAreaClick(event) {
  if ((event.target as Element).closest<HTMLElement>('.tag-item, .context-menu')) return;
  if (!getSearchQuery() && !getSelectedTagKeys().length) return;
  runtime.state.searchQuery = '';
  runtime.state.selectedTagKeys = [];
  resetTagJumpState();
  saveAndRender({ preserveScroll: true });
}

export function toggleTagFilter(tag) {
  const selected = new Set(getSelectedTagKeys());
  const wasSelected = selected.has(tag.key);
  if (!wasSelected) {
    selected.add(tag.key);
    resetTagJumpState();
  }
  runtime.state.selectedTagKeys = [...selected];
  runtime.state.searchQuery = '';
  saveAndRender({ preserveScroll: true });
  requestAnimationFrame(() => jumpToNextTaggedEvent(tag.key, { advance: wasSelected }));
}

export function jumpToNextTaggedEvent(tagKey, options: { advance?: boolean } = {}) {
  const key = normalizeTagKey(tagKey);
  if (!key) return;
  const events = getVisibleEvents()
    .filter(
      (event) =>
        eventMatchesSearch(event) &&
        getEventTags(event).some((tag) => normalizeTagKey(tag) === key),
    )
    .sort((a, b) => getEventStartAbs(a) - getEventStartAbs(b));
  if (!events.length) return;
  const signature = `${key}:${events.map((event) => `${event.id}@${getEventStartAbs(event)}`).join('|')}`;
  let index = 0;
  if (
    options.advance &&
    runtime.tagJumpState.signature === signature &&
    runtime.tagJumpState.eventId
  ) {
    const currentIndex = events.findIndex((event) => event.id === runtime.tagJumpState.eventId);
    index = currentIndex >= 0 ? (currentIndex + 1) % events.length : 0;
  } else {
    const todayAbs = dateTimeToAbsoluteMinute(getTodayKey(), 0);
    index = events.findIndex((event) => getEventStartAbs(event) >= todayAbs);
    if (index < 0) index = 0;
  }
  const event = events[index];
  runtime.tagJumpState = { signature, eventId: event.id };
  jumpToEvent(event);
}

export function jumpToEvent(event) {
  runtime.state.selectedDate = event.date;
  runtime.state.visibleWeekStart = toDateKey(getWeekStartDate(parseDateKey(event.date)));
  runtime.state.miniMonth = toMonthKey(parseDateKey(event.date));
  runtime.state.activeEventId = null;
  runtime.selectedEventIds = new Set([event.id]);
  saveAndRender({ preserveScroll: true });
  requestAnimationFrame(() => scrollEventIntoView(event.id));
}

export function resetTagJumpState() {
  runtime.tagJumpState = { signature: '', eventId: null };
}
