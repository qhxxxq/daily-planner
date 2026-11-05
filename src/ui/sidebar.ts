/**
 * 文件用途：侧栏列表、标签与迷你日历。
 * 渲染活动及归档条目、数量和月份网格；处理侧栏宽度拖动及相关列表展示状态。
 */
import { runtime } from '../app/runtime.js';
import { isEventIncompleteTodo } from '../app/queries.js';
import { isImeCompositionEvent } from './editor.js';
import {
  cancelInlineSourceRename,
  commitInlineSourceRename,
  startInlineSourceRename,
} from './source-actions.js';
import { saveAndRender, saveUiPrefs } from '../app/persistence.js';
import { jumpToSourceCount } from './navigation.js';
import { openSourceContextMenu, openTagContextMenu } from './source-menu.js';
import { applyTagCssVars } from '../domain/colors.js';
import { getKnownTags, getSelectedTagKeys, getVisibleEvents } from '../app/queries.js';
import { toggleTagFilter } from './search.js';
import { getEventTags, normalizeTagKey } from '../domain/tags.js';
import { getAutoTagColor } from './themes.js';
import { clamp } from '../domain/math.js';
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from '../app/config.js';
import { pushUndoSnapshot } from './undo.js';

export function renderSources() {
  runtime.els.sourceList.innerHTML = '';
  runtime.state.sources
    .filter((source) => !source.archived)
    .forEach((source) => {
      runtime.els.sourceList.append(createSourceListItem(source));
    });
  renderArchivedSources();
}

export function createSourceListItem(source, options: { archived?: boolean } = {}) {
  const item = document.createElement('div');
  const incompleteCount = runtime.state.events.filter(
    (event) => event.sourceId === source.id && isEventIncompleteTodo(event),
  ).length;
  const showIncompleteCount = !options.archived && source.type !== 'schedule';
  const isRenaming = runtime.inlineRenamingSourceId === source.id;
  item.role = 'button';
  item.tabIndex = 0;
  item.className = `source-item${options.archived ? ' is-archived-source' : ''}${isRenaming ? ' is-renaming-source' : ''}`;
  item.dataset.sourceId = source.id;
  if (!options.archived && source.id === runtime.state.selectedSourceId)
    item.classList.add('is-selected');
  item.innerHTML = `
    <span class="source-chip">
      <span class="source-check" style="--source-color:${source.color}" aria-hidden="true"></span>
      <span class="source-name-wrap">${isRenaming ? `<input class="source-name-input" type="text" aria-label="日历名称">` : `<span class="source-name"></span>`}</span>
    </span>
    <span class="source-tools">
      ${showIncompleteCount ? `<button class="source-count" type="button" ${incompleteCount ? '' : 'disabled'} title="${incompleteCount ? '跳转到未完成日程' : '没有未完成日程'}">${incompleteCount}</button>` : ''}
      <span class="source-type">${source.type === 'schedule' ? '日程' : '待办'}</span>
    </span>
  `;
  const nameInput = item.querySelector<HTMLInputElement>('.source-name-input');
  if (nameInput) {
    nameInput.value = source.name;
    nameInput.addEventListener('pointerdown', (event) => event.stopPropagation());
    nameInput.addEventListener('click', (event) => event.stopPropagation());
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        if (isImeCompositionEvent(event)) return;
        event.preventDefault();
        commitInlineSourceRename(source.id, nameInput.value);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelInlineSourceRename();
      }
    });
    nameInput.addEventListener('blur', () => commitInlineSourceRename(source.id, nameInput.value));
    requestAnimationFrame(() => {
      if (runtime.inlineRenamingSourceId !== source.id) return;
      nameInput.focus();
      nameInput.select();
    });
  } else {
    item.querySelector<HTMLElement>('.source-name').textContent = source.name;
  }
  if (!options.archived) {
    item.addEventListener('click', (event) => {
      if ((event.target as Element).closest<HTMLElement>('.source-name-input')) return;
      runtime.state.selectedSourceId = source.id;
      saveAndRender();
    });
    item.addEventListener('keydown', (event) => {
      if ((event.target as Element).closest<HTMLElement>('.source-name-input')) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      runtime.state.selectedSourceId = source.id;
      saveAndRender();
    });
    item.querySelector<HTMLElement>('.source-count')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      jumpToSourceCount(source.id);
    });
  }
  item.addEventListener('contextmenu', openSourceContextMenu);
  item.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
    startInlineSourceRename(source.id);
  });
  if (!options.archived) bindListReorderHandlers(item, 'source', source.id);
  return item;
}

export function renderArchivedSources() {
  const archived = runtime.state.sources.filter((source) => source.archived);
  if (!runtime.els.archivedSources || !runtime.els.archivedSourceList) return;
  runtime.els.archivedSources.hidden = archived.length === 0;
  runtime.els.archivedCount.textContent = String(archived.length);
  runtime.els.archivedToggle.setAttribute('aria-expanded', String(runtime.state.archivedOpen));
  runtime.els.archivedSourceList.hidden = !runtime.state.archivedOpen;
  runtime.els.archivedSourceList.innerHTML = '';
  archived.forEach((source) =>
    runtime.els.archivedSourceList.append(createSourceListItem(source, { archived: true })),
  );
}

export function renderTags() {
  const tags = getTagSummaries().filter((tag) => !tag.archived);
  runtime.els.tagList.innerHTML = '';
  if (!tags.length) {
    runtime.els.tagList.innerHTML = `<div class="tag-empty">暂无标签</div>`;
  } else {
    tags.forEach((tag) => {
      runtime.els.tagList.append(createTagListItem(tag));
    });
  }
  renderArchivedTags();
}

export function createTagListItem(tag, options: { archived?: boolean } = {}) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = `tag-item${options.archived ? ' is-archived-tag' : ''}`;
  item.dataset.tagKey = tag.key;
  applyTagCssVars(item, tag.color);
  if (!options.archived && getSelectedTagKeys().includes(tag.key))
    item.classList.add('is-selected');
  item.innerHTML = `
    <span class="tag-name"></span>
    <span class="tag-count ${tag.count === 0 ? 'is-empty' : ''}">${tag.count}</span>
  `;
  item.querySelector<HTMLElement>('.tag-name').textContent = tag.name;
  if (!options.archived) {
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleTagFilter(tag);
    });
    bindListReorderHandlers(item, 'tag', tag.key);
  }
  item.addEventListener('contextmenu', openTagContextMenu);
  return item;
}

export function renderArchivedTags() {
  const archived = getTagSummaries().filter((tag) => tag.archived);
  if (!runtime.els.archivedTags || !runtime.els.archivedTagList) return;
  runtime.els.archivedTags.hidden = archived.length === 0;
  runtime.els.archivedTagsCount.textContent = String(archived.length);
  runtime.els.archivedTagsToggle.setAttribute(
    'aria-expanded',
    String(runtime.state.archivedTagsOpen),
  );
  runtime.els.archivedTagList.hidden = !runtime.state.archivedTagsOpen;
  runtime.els.archivedTagList.innerHTML = '';
  archived.forEach((tag) =>
    runtime.els.archivedTagList.append(createTagListItem(tag, { archived: true })),
  );
}

export function getTagSummaries() {
  const summaries = new Map(getKnownTags().map((tag) => [tag.key, { ...tag, count: 0 }]));
  getVisibleEvents()
    .filter(isEventIncompleteTodo)
    .forEach((event) => {
      getEventTags(event).forEach((tag) => {
        const key = normalizeTagKey(tag);
        if (!key) return;
        const summary = summaries.get(key) || {
          key,
          name: tag,
          color: getAutoTagColor(tag),
          count: 0,
        };
        summary.count += 1;
        summaries.set(key, summary);
      });
    });
  return [...summaries.values()];
}

export function bindListReorderHandlers(item, type, id) {
  item.draggable = true;
  item.addEventListener('dragstart', (event) => {
    if ((event.target as Element).closest<HTMLElement>('button, input, select, textarea')) {
      event.preventDefault();
      return;
    }
    runtime.listReorderDrag = { type, id };
    item.classList.add('is-source-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  });
  item.addEventListener('dragover', (event) => {
    if (
      !runtime.listReorderDrag ||
      runtime.listReorderDrag.type !== type ||
      runtime.listReorderDrag.id === id
    )
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const after = getListDropAfter(item, event, type);
    clearListDropMarkers(type);
    item.classList.toggle('is-source-drop-before', !after);
    item.classList.toggle('is-source-drop-after', after);
  });
  item.addEventListener('dragleave', (event) => {
    if (item.contains(event.relatedTarget)) return;
    item.classList.remove('is-source-drop-before', 'is-source-drop-after');
  });
  item.addEventListener('drop', (event) => {
    if (
      !runtime.listReorderDrag ||
      runtime.listReorderDrag.type !== type ||
      runtime.listReorderDrag.id === id
    )
      return;
    event.preventDefault();
    const after = getListDropAfter(item, event, type);
    const draggedId = runtime.listReorderDrag.id;
    clearListDropMarkers(type);
    runtime.listReorderDrag = null;
    reorderListItems(type, draggedId, id, after);
  });
  item.addEventListener('dragend', () => {
    item.classList.remove('is-source-dragging');
    clearListDropMarkers(type);
    runtime.listReorderDrag = null;
  });
}

export function getListDropAfter(item, event, type) {
  const rect = item.getBoundingClientRect();
  if (type === 'tag') return event.clientX > rect.left + rect.width / 2;
  return event.clientY > rect.top + rect.height / 2;
}

export function clearListDropMarkers(type) {
  const selector = type === 'tag' ? '#tagList .tag-item' : '#sourceList .source-item';
  document
    .querySelectorAll(selector)
    .forEach((item) => item.classList.remove('is-source-drop-before', 'is-source-drop-after'));
}

export function startSidebarResize(event) {
  if (event.button !== 0) return;
  const rect = runtime.els.appShell.getBoundingClientRect();
  runtime.sidebarResizeState = {
    pointerId: event.pointerId,
    shellLeft: rect.left,
  };
  runtime.els.sidebarResizer.classList.add('is-dragging');
  document.body.classList.add('is-sidebar-resizing');
  runtime.els.sidebarResizer.setPointerCapture?.(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
}

export function handleSidebarResize(event) {
  if (!runtime.sidebarResizeState || event.pointerId !== runtime.sidebarResizeState.pointerId)
    return;
  const width = clamp(
    event.clientX - runtime.sidebarResizeState.shellLeft,
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_MAX_WIDTH,
  );
  runtime.state.sidebarWidth = width;
  runtime.els.appShell.style.setProperty('--sidebar-width', `${width}px`);
  event.preventDefault();
}

export function finishSidebarResize(event) {
  if (
    !runtime.sidebarResizeState ||
    (event?.pointerId != null && event.pointerId !== runtime.sidebarResizeState.pointerId)
  )
    return;
  runtime.sidebarResizeState = null;
  runtime.els.sidebarResizer?.classList.remove('is-dragging');
  document.body.classList.remove('is-sidebar-resizing');
  saveUiPrefs();
  saveAndRender({ preserveScroll: true });
}

export function reorderListItems(type, draggedId, targetId, after) {
  if (type === 'source') reorderSources(draggedId, targetId, after);
  if (type === 'tag') reorderTags(draggedId, targetId, after);
}

export function getMovedOrder(ids, draggedId, targetId, after) {
  if (draggedId === targetId || !ids.includes(draggedId) || !ids.includes(targetId)) return ids;
  const next = ids.filter((id) => id !== draggedId);
  const targetIndex = next.indexOf(targetId);
  next.splice(targetIndex + (after ? 1 : 0), 0, draggedId);
  return next;
}

export function reorderSources(draggedId, targetId, after) {
  const active = runtime.state.sources.filter((source) => !source.archived);
  const archived = runtime.state.sources.filter((source) => source.archived);
  const orderedIds = getMovedOrder(
    active.map((source) => source.id),
    draggedId,
    targetId,
    after,
  );
  if (orderedIds.join('\n') === active.map((source) => source.id).join('\n')) return;
  const byId = new Map(active.map((source) => [source.id, source]));
  pushUndoSnapshot();
  runtime.state.sources = [...orderedIds.map((id) => byId.get(id)).filter(Boolean), ...archived];
  saveAndRender({ preserveScroll: true });
}

export function reorderTags(draggedKey, targetKey, after) {
  const active = getKnownTags().filter((tag) => !tag.archived);
  const archived = getKnownTags().filter((tag) => tag.archived);
  const orderedKeys = getMovedOrder(
    active.map((tag) => tag.key),
    draggedKey,
    targetKey,
    after,
  );
  if (orderedKeys.join('\n') === active.map((tag) => tag.key).join('\n')) return;
  const byKey = new Map(active.map((tag) => [tag.key, tag]));
  pushUndoSnapshot();
  runtime.state.tags = [
    ...orderedKeys.map((key) => byKey.get(key)).filter(Boolean),
    ...archived,
  ].map((tag) => ({ name: tag.name, color: tag.color, archived: tag.archived === true }));
  saveAndRender({ preserveScroll: true });
}

export function toggleArchivedSources() {
  runtime.state.archivedOpen = !runtime.state.archivedOpen;
  saveAndRender({ preserveScroll: true });
}

export function toggleArchivedTags() {
  runtime.state.archivedTagsOpen = !runtime.state.archivedTagsOpen;
  saveAndRender({ preserveScroll: true });
}
