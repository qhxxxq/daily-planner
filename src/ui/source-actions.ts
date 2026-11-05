/**
 * 文件用途：日历列表增删与归档操作。
 * 处理列表创建、重命名、归档和删除；同步维护关联日程及选中列表，通过统一保存入口刷新结果。
 */
import type { PlannerSource } from '../types/model.js';
import { getSource } from '../app/queries.js';
import { runtime } from '../app/runtime.js';
import { pushUndoSnapshot } from './undo.js';
import { saveAndRender } from '../app/persistence.js';
import { getThemeCalendarColors } from './themes.js';
import { closeFloatingMenus } from './menus.js';
import { renderSources } from './sidebar.js';

export function mergeSourceInto(sourceId, targetSourceId) {
  if (!sourceId || !targetSourceId || sourceId === targetSourceId) return;
  const source = getSource(sourceId);
  const target = getSource(targetSourceId);
  if (!source || !target) return;
  const eventCount = runtime.state.events.filter((event) => event.sourceId === source.id).length;
  const message = eventCount
    ? `将日历「${source.name}」的 ${eventCount} 个日程合并到「${target.name}」？\n\n合并后「${source.name}」会被移除。`
    : `将空日历「${source.name}」合并到「${target.name}」？\n\n合并后「${source.name}」会被移除。`;
  if (!confirm(message)) return;
  pushUndoSnapshot();
  runtime.state.events.forEach((event) => {
    if (event.sourceId === source.id) event.sourceId = target.id;
  });
  runtime.state.sources = runtime.state.sources.filter((item) => item.id !== source.id);
  if (runtime.state.selectedSourceId === source.id) runtime.state.selectedSourceId = target.id;
  runtime.contextSourceId = null;
  saveAndRender({ preserveScroll: true });
}

export function createSourceFromPrompt() {
  const name = String(prompt('日历名称', getUniqueSourceName('新日历')) || '').trim();
  if (!name) return;
  pushUndoSnapshot();
  const source: PlannerSource = {
    id: `manual-${crypto.randomUUID()}`,
    name,
    color: getThemeCalendarColors()[runtime.state.sources.length % getThemeCalendarColors().length],
    visible: true,
    type: 'todo',
    archived: false,
    appleSyncEnabled: true,
  };
  runtime.state.sources.push(source);
  runtime.state.selectedSourceId = source.id;
  saveAndRender({ preserveScroll: true });
}

export function startInlineSourceRename(sourceId) {
  if (!sourceId || !getSource(sourceId)) return;
  runtime.inlineRenamingSourceId = sourceId;
  closeFloatingMenus();
  renderSources();
}

export function commitInlineSourceRename(sourceId, value) {
  if (runtime.inlineRenamingSourceId !== sourceId) return;
  const source = getSource(sourceId);
  const name = String(value || '').trim();
  runtime.inlineRenamingSourceId = null;
  if (!source || !name || name === source.name) {
    renderSources();
    return;
  }
  pushUndoSnapshot();
  source.name = name;
  saveAndRender({ preserveScroll: true });
}

export function cancelInlineSourceRename() {
  if (!runtime.inlineRenamingSourceId) return;
  runtime.inlineRenamingSourceId = null;
  renderSources();
}

export function updateSourceType(sourceId, type) {
  if (!sourceId) return;
  const source = getSource(sourceId);
  if (!source || source.type === type) return;
  pushUndoSnapshot();
  source.type = type;
  runtime.state.events
    .filter((event) => event.sourceId === source.id)
    .forEach((event) => {
      event.type = type;
      if (type === 'schedule') {
        event.status = 'open';
        event.completed = false;
      }
    });
  saveAndRender({ preserveScroll: true });
}

export function toggleSourceAppleSync(sourceId) {
  if (!sourceId) return;
  const source = getSource(sourceId);
  if (!source || source.archived) return;
  pushUndoSnapshot();
  source.appleSyncEnabled = source.appleSyncEnabled === false;
  saveAndRender({ preserveScroll: true });
}

export function archiveSource(sourceId) {
  if (!sourceId) return;
  const source = getSource(sourceId);
  if (!source || source.archived) return;
  if (runtime.state.sources.filter((item) => !item.archived).length <= 1) return;
  pushUndoSnapshot();
  source.archived = true;
  source.visible = false;
  if (runtime.state.selectedSourceId === source.id) {
    runtime.state.selectedSourceId =
      runtime.state.sources.find((item) => !item.archived && item.id !== source.id)?.id ||
      source.id;
  }
  runtime.state.archivedOpen = false;
  saveAndRender({ preserveScroll: true });
}

export function unarchiveSource(sourceId) {
  if (!sourceId) return;
  const source = getSource(sourceId);
  if (!source || !source.archived) return;
  pushUndoSnapshot();
  source.archived = false;
  source.visible = true;
  runtime.state.selectedSourceId = source.id;
  saveAndRender({ preserveScroll: true });
}

export function deleteSource(sourceId) {
  if (!sourceId) return;
  const source = runtime.state.sources.find((item) => item.id === sourceId);
  if (!source) return;
  const activeSources = runtime.state.sources.filter((item) => !item.archived);
  if (runtime.state.sources.length <= 1 || (!source.archived && activeSources.length <= 1)) return;
  const eventCount = runtime.state.events.filter((event) => event.sourceId === source.id).length;
  const message = eventCount
    ? `删除日历「${source.name}」？其中的 ${eventCount} 个日程也会被删除。`
    : `删除日历「${source.name}」？`;
  if (!confirm(message)) return;
  pushUndoSnapshot();
  runtime.state.sources = runtime.state.sources.filter((item) => item.id !== source.id);
  const removedEventIds = new Set(
    runtime.state.events.filter((event) => event.sourceId === source.id).map((event) => event.id),
  );
  runtime.state.events = runtime.state.events.filter((event) => event.sourceId !== source.id);
  if (removedEventIds.has(runtime.state.activeEventId)) runtime.state.activeEventId = null;
  runtime.selectedEventIds = new Set(
    [...runtime.selectedEventIds].filter((id) => !removedEventIds.has(id)),
  );
  if (runtime.state.selectedSourceId === source.id) {
    runtime.state.selectedSourceId =
      runtime.state.sources.find((item) => !item.archived)?.id ||
      runtime.state.sources[0]?.id ||
      '';
  }
  runtime.contextSourceId = null;
  saveAndRender({ preserveScroll: true });
}

export function getUniqueSourceName(baseName) {
  const existing = new Set(runtime.state.sources.map((source) => source.name));
  let name = baseName;
  let index = 2;
  while (existing.has(name)) {
    name = `${baseName}${index}`;
    index += 1;
  }
  return name;
}
