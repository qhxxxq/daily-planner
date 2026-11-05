/**
 * 文件用途：列表上下文菜单与选择器。
 * 展示列表操作菜单、内联重命名及表单来源选项；把用户选择交给列表操作和配色模块。
 */
import { runtime } from '../app/runtime.js';
import { closeFloatingMenus, positionViewportMenu } from './menus.js';
import { getKnownTags, getSource } from '../app/queries.js';
import {
  archiveSource,
  createSourceFromPrompt,
  deleteSource,
  mergeSourceInto,
  startInlineSourceRename,
  toggleSourceAppleSync,
  unarchiveSource,
  updateSourceType,
} from './source-actions.js';
import { openSourceColorMenu, openTagColorMenu } from './color-menu.js';
import {
  archiveTag,
  createTagFromPrompt,
  deleteTag,
  deleteTagFromPrompt,
  renameTagFromPrompt,
  unarchiveTag,
} from './tag-actions.js';
import { escapeHtml } from '../domain/html.js';
import { renderSourceSelectButton, renderTodoStatusFieldState } from './editor.js';
import { captureEditorDraft } from './drafts.js';

export function openTagContextMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  const item = (event.target as Element).closest<HTMLElement>('.tag-item');
  runtime.contextTagKey = item?.dataset.tagKey || null;
  runtime.contextSourceId = null;
  closeFloatingMenus();
  const tag = runtime.contextTagKey
    ? getKnownTags().find((item) => item.key === runtime.contextTagKey)
    : null;
  runtime.els.calendarContextMenu.innerHTML = runtime.contextTagKey
    ? tag?.archived
      ? `
      <button type="button" data-action="tag-unarchive">恢复标签</button>
      <button type="button" data-action="tag-rename">重命名</button>
      <button type="button" data-action="tag-color">修改颜色</button>
    `
      : `
      <button type="button" data-action="tag-rename">重命名</button>
      <button type="button" data-action="tag-color">修改颜色</button>
      <span class="context-divider" aria-hidden="true"></span>
      <button type="button" data-action="tag-archive">归档标签</button>
      <span class="context-divider" aria-hidden="true"></span>
      <button class="is-danger" type="button" data-action="tag-delete">删除标签</button>
    `
    : `
      <button type="button" data-action="tag-new">新建标签</button>
      <button class="is-danger" type="button" data-action="tag-delete-prompt" ${getKnownTags().length ? '' : 'disabled'}>删除标签...</button>
    `;
  runtime.els.calendarContextMenu.hidden = false;
  positionViewportMenu(runtime.els.calendarContextMenu, event.clientX, event.clientY);
}

export function handleCalendarContextClick(event) {
  event.stopPropagation();
  const button = (event.target as Element).closest<HTMLElement>('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'source-new') createSourceFromPrompt();
  if (action === 'source-rename') startInlineSourceRename(runtime.contextSourceId);
  if (action === 'source-color') openSourceColorMenu(runtime.contextSourceId);
  if (action === 'source-merge-picker') openSourceMergePicker(runtime.contextSourceId);
  if (action === 'source-merge')
    mergeSourceInto(runtime.contextSourceId, button.dataset.targetSourceId);
  if (action === 'source-type-todo') updateSourceType(runtime.contextSourceId, 'todo');
  if (action === 'source-type-schedule') updateSourceType(runtime.contextSourceId, 'schedule');
  if (action === 'source-apple-sync-toggle') toggleSourceAppleSync(runtime.contextSourceId);
  if (action === 'source-archive') archiveSource(runtime.contextSourceId);
  if (action === 'source-unarchive') unarchiveSource(runtime.contextSourceId);
  if (action === 'source-delete') deleteSource(runtime.contextSourceId);
  if (action === 'tag-new') createTagFromPrompt();
  if (action === 'tag-rename') renameTagFromPrompt(runtime.contextTagKey);
  if (action === 'tag-color') openTagColorMenu(runtime.contextTagKey);
  if (action === 'tag-archive') archiveTag(runtime.contextTagKey);
  if (action === 'tag-unarchive') unarchiveTag(runtime.contextTagKey);
  if (action === 'tag-delete') deleteTag(runtime.contextTagKey);
  if (action === 'tag-delete-prompt') deleteTagFromPrompt();
  if (action !== 'tag-color' && action !== 'source-color' && action !== 'source-merge-picker')
    closeFloatingMenus();
}

export function openSourceContextMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  const item = (event.target as Element).closest<HTMLElement>('.source-item');
  runtime.contextSourceId = item?.dataset.sourceId || null;
  runtime.contextTagKey = null;
  closeFloatingMenus();
  const source = runtime.contextSourceId ? getSource(runtime.contextSourceId) : null;
  const canArchive =
    source && !source.archived && runtime.state.sources.filter((item) => !item.archived).length > 1;
  const canDelete =
    source &&
    runtime.state.sources.length > 1 &&
    (source.archived || runtime.state.sources.filter((item) => !item.archived).length > 1);
  runtime.els.calendarContextMenu.innerHTML = source
    ? source.archived
      ? `
      <button type="button" data-action="source-unarchive">恢复日历</button>
      <button type="button" data-action="source-rename">重命名</button>
      <button type="button" data-action="source-color">修改颜色</button>
      <button type="button" data-action="source-merge-picker">合并到...</button>
      <span class="context-divider" aria-hidden="true"></span>
      <button class="is-danger" type="button" data-action="source-delete" ${canDelete ? '' : 'disabled'}>删除日历</button>
    `
      : `
      <button type="button" data-action="source-rename">重命名</button>
      <button type="button" data-action="source-color">修改颜色</button>
      <button type="button" data-action="source-merge-picker">合并到...</button>
      <span class="context-divider" aria-hidden="true"></span>
      <button type="button" data-action="source-type-todo" ${source.type === 'todo' ? 'disabled' : ''}>设为待办</button>
      <button type="button" data-action="source-type-schedule" ${source.type === 'schedule' ? 'disabled' : ''}>设为日程</button>
      <span class="context-divider" aria-hidden="true"></span>
      <button type="button" data-action="source-apple-sync-toggle">${source.appleSyncEnabled !== false ? '停止同步到 Apple 日历' : '同步到 Apple 日历'}</button>
      <span class="context-divider" aria-hidden="true"></span>
      <button type="button" data-action="source-archive" ${canArchive ? '' : 'disabled'}>归档日历</button>
      <button class="is-danger" type="button" data-action="source-delete" ${canDelete ? '' : 'disabled'}>删除日历</button>
    `
    : `<button type="button" data-action="source-new">新建日历</button>`;
  runtime.els.calendarContextMenu.hidden = false;
  positionViewportMenu(runtime.els.calendarContextMenu, event.clientX, event.clientY);
}

export function openSourceMergePicker(sourceId) {
  const source = getSource(sourceId);
  if (!source) return;
  const targets = runtime.state.sources.filter((item) => item.id !== source.id);
  runtime.els.calendarContextMenu.innerHTML = `
    <div class="context-menu-heading">将「${escapeHtml(source.name)}」合并到</div>
    ${targets
      .map(
        (target) => `
      <button type="button" data-action="source-merge" data-target-source-id="${escapeHtml(target.id)}">
        <span class="context-source-dot" style="background:${target.color}" aria-hidden="true"></span>
        <span>${escapeHtml(target.name)}${target.archived ? '（已归档）' : ''}</span>
      </button>
    `,
      )
      .join('')}
  `;
  runtime.els.calendarContextMenu.hidden = false;
}

export function toggleSourcePickerMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  closeFloatingMenus();
  runtime.els.sourcePickerMenu.innerHTML = runtime.state.sources
    .map(
      (source) => `
    <button type="button" data-source-id="${source.id}" style="--source-color:${source.color}">
      <span class="source-picker-check">${source.id === runtime.els.sourceInput.value ? '✓' : ''}</span>
      <span class="source-picker-dot" aria-hidden="true"></span>
      <span class="source-picker-name">${escapeHtml(source.name)}</span>
    </button>
  `,
    )
    .join('');
  runtime.els.sourcePickerMenu.hidden = false;
  const rect = runtime.els.sourceSelectButton.getBoundingClientRect();
  positionViewportMenu(runtime.els.sourcePickerMenu, rect.left, rect.bottom + 6);
}

export function handleSourcePickerClick(event) {
  const button = (event.target as Element).closest<HTMLElement>('button[data-source-id]');
  if (!button) return;
  runtime.els.sourceInput.value = button.dataset.sourceId;
  runtime.els.eventTypeInput.value = getSource(button.dataset.sourceId)?.type || 'todo';
  renderSourceSelectButton();
  renderTodoStatusFieldState();
  closeFloatingMenus();
  captureEditorDraft();
}
