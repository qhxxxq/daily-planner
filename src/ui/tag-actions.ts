/**
 * 文件用途：标签生命周期操作。
 * 处理标签重命名、归档、删除及相关日程标签更新；维护筛选状态并保存修改。
 */
import {
  getKnownTags,
  getSearchQuery,
  getSelectedTagKeys,
  getTagQuery,
  getUniqueTagName,
} from '../app/queries.js';
import { getEventTags, normalizeTagKey, normalizeTags } from '../domain/tags.js';
import { pushUndoSnapshot } from './undo.js';
import { runtime } from '../app/runtime.js';
import { getAutoTagColor } from './themes.js';
import { saveAndRender } from '../app/persistence.js';

export function createTagFromPrompt() {
  const name = String(prompt('标签名称', getUniqueTagName('新标签')) || '')
    .trim()
    .replace(/^#+/, '');
  if (!name || getKnownTags().some((tag) => tag.key === normalizeTagKey(name))) return;
  pushUndoSnapshot();
  runtime.state.tags.push({
    name,
    color: getAutoTagColor(
      name,
      runtime.state.theme,
      new Set(getKnownTags().map((tag) => tag.color.toLowerCase())),
    ),
    archived: false,
  });
  saveAndRender({ preserveScroll: true });
}

export function renameTagFromPrompt(tagKey) {
  const tag = getKnownTags().find((item) => item.key === tagKey);
  if (!tag) return;
  const name = String(prompt('标签名称', tag.name) || '')
    .trim()
    .replace(/^#+/, '');
  const nextKey = normalizeTagKey(name);
  if (!name || !nextKey || nextKey === tag.key) return;
  if (getKnownTags().some((item) => item.key === nextKey)) return;
  pushUndoSnapshot();
  const stored = runtime.state.tags.find((item) => normalizeTagKey(item.name) === tag.key);
  if (stored) stored.name = name;
  else runtime.state.tags.push({ name, color: tag.color, archived: tag.archived === true });
  runtime.state.events.forEach((event) => {
    event.tags = getEventTags(event).map((eventTag) =>
      normalizeTagKey(eventTag) === tag.key ? name : eventTag,
    );
  });
  runtime.state.selectedTagKeys = getSelectedTagKeys().map((key) =>
    key === tag.key ? nextKey : key,
  );
  if (getTagQuery(getSearchQuery()) === tag.key) runtime.state.searchQuery = `#${name}`;
  if (runtime.els.tagsInput?.value) {
    runtime.els.tagsInput.value = normalizeTags(runtime.els.tagsInput.value)
      .map((eventTag) => (normalizeTagKey(eventTag) === tag.key ? name : eventTag))
      .join(' ');
  }
  saveAndRender({ preserveScroll: true });
}

export function archiveTag(tagKey) {
  const tag = getKnownTags().find((item) => item.key === tagKey);
  if (!tag || tag.archived) return;
  pushUndoSnapshot();
  const stored = runtime.state.tags.find((item) => normalizeTagKey(item.name) === tag.key);
  if (stored) stored.archived = true;
  else runtime.state.tags.push({ name: tag.name, color: tag.color, archived: true });
  runtime.state.selectedTagKeys = getSelectedTagKeys().filter((key) => key !== tag.key);
  if (getTagQuery(getSearchQuery()) === tag.key) runtime.state.searchQuery = '';
  runtime.state.archivedTagsOpen = false;
  saveAndRender({ preserveScroll: true });
}

export function unarchiveTag(tagKey) {
  const tag = getKnownTags().find((item) => item.key === tagKey);
  if (!tag || !tag.archived) return;
  pushUndoSnapshot();
  const stored = runtime.state.tags.find((item) => normalizeTagKey(item.name) === tag.key);
  if (stored) stored.archived = false;
  else runtime.state.tags.push({ name: tag.name, color: tag.color, archived: false });
  saveAndRender({ preserveScroll: true });
}

export function deleteTag(tagKey) {
  const tag = getKnownTags().find((item) => item.key === tagKey);
  if (!tag) return;
  if (!confirm(`删除标签「${tag.name}」？`)) return;
  pushUndoSnapshot();
  runtime.state.tags = runtime.state.tags.filter((item) => normalizeTagKey(item.name) !== tag.key);
  runtime.state.events.forEach((event) => {
    event.tags = getEventTags(event).filter((eventTag) => normalizeTagKey(eventTag) !== tag.key);
  });
  runtime.state.selectedTagKeys = getSelectedTagKeys().filter((key) => key !== tag.key);
  if (getTagQuery(getSearchQuery()) === tag.key) runtime.state.searchQuery = '';
  saveAndRender({ preserveScroll: true });
}

export function deleteTagFromPrompt() {
  const tags = getKnownTags().sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  if (!tags.length) return;
  const name = String(
    prompt(`要删除的标签名称：\n${tags.map((tag) => tag.name).join('、')}`, tags[0].name) || '',
  )
    .trim()
    .replace(/^#+/, '');
  const key = normalizeTagKey(name);
  if (!key) return;
  const tag = tags.find((item) => item.key === key);
  if (!tag) return;
  deleteTag(tag.key);
}
