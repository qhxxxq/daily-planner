/**
 * 文件用途：应用状态恢复与保存。
 * 校正加载数据、分别保存界面偏好与日程状态；保存后调度文件和同步任务，并提供危险操作前的备份入口。
 */
import type { PlannerState } from '../types/model.js';
import { runtime } from './runtime.js';
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, STORAGE_KEY, UI_PREFS_KEY } from './config.js';
import { defaultState } from './default-state.js';
import { clamp } from '../domain/math.js';
import {
  getTodayKey,
  getWeekStartDate,
  isValidDateKey,
  normalizeTime,
  parseDateKey,
  toDateKey,
} from '../domain/date-time.js';
import { normalizeTagKey, normalizeTags } from '../domain/tags.js';
import { structuredCloneSafe } from '../domain/clone.js';
import {
  getSourceType,
  normalizeItemType,
  normalizeTodoStatus,
  normalizeTravelMinutes,
} from '../domain/events.js';
import { getAutoTagColor } from '../ui/themes.js';
import { themes } from './config.js';
import { finishUndoOperation } from '../ui/undo.js';
import { persistSearchPrefs } from '../ui/search.js';
import {
  callNativeFile,
  hasNativeFileBridge,
  renderFileConnectionStatus,
  scheduleAutoSaveDataFile,
  serializeDataFile,
} from '../platform/files.js';
import { scheduleAppleCalendarSync } from '../ui/apple-sync.js';
import { render } from '../ui/render.js';

export function loadState() {
  return runtime.plannerStorage.read(STORAGE_KEY, defaultState);
}

export function loadUiPrefs() {
  return runtime.plannerStorage.read<Partial<PlannerState>>(UI_PREFS_KEY, {});
}

export function applyUiPrefs(input) {
  const prefs = loadUiPrefs();
  const next = { ...(input || {}) };
  if (themes.some((theme) => theme.id === prefs.theme)) next.theme = prefs.theme;
  if (typeof prefs.searchQuery === 'string') next.searchQuery = prefs.searchQuery;
  if (Array.isArray(prefs.selectedTagKeys)) next.selectedTagKeys = prefs.selectedTagKeys;
  if (Number.isFinite(Number(prefs.sidebarWidth))) next.sidebarWidth = Number(prefs.sidebarWidth);
  if (typeof prefs.detailPanelCollapsed === 'boolean')
    next.detailPanelCollapsed = prefs.detailPanelCollapsed;
  return next;
}

export function saveUiPrefs() {
  runtime.plannerStorage.write(UI_PREFS_KEY, {
    theme: runtime.state.theme,
    detailPanelCollapsed: runtime.state.detailPanelCollapsed === true,
    searchQuery: runtime.state.searchQuery || '',
    selectedTagKeys: runtime.state.selectedTagKeys || [],
    sidebarWidth: clamp(
      Number(runtime.state.sidebarWidth) || defaultState.sidebarWidth,
      SIDEBAR_MIN_WIDTH,
      SIDEBAR_MAX_WIDTH,
    ),
  });
}

/** 将旧文件或缺省字段补齐为可供界面使用的状态。保留未知顶层字段，逐条归一化日程，并从日程标签补齐标签表。 */
export function normalizeState(input: Partial<PlannerState>): PlannerState {
  const next: PlannerState = { ...defaultState, ...(input || {}) };
  next.sources =
    Array.isArray(next.sources) && next.sources.length ? next.sources : defaultState.sources;
  next.tags = Array.isArray(next.tags) ? next.tags : [];
  next.events = Array.isArray(next.events) ? next.events : [];
  next.selectedDate = isValidDateKey(next.selectedDate) ? next.selectedDate : getTodayKey();
  next.visibleWeekStart = isValidDateKey(next.visibleWeekStart)
    ? next.visibleWeekStart
    : toDateKey(getWeekStartDate(parseDateKey(next.selectedDate)));
  next.miniMonth = /^\d{4}-\d{2}$/.test(String(next.miniMonth || ''))
    ? next.miniMonth
    : next.selectedDate.slice(0, 7);
  next.selectedTagKeys = Array.isArray(next.selectedTagKeys)
    ? [...new Set(next.selectedTagKeys.map(normalizeTagKey).filter(Boolean))]
    : [];
  next.detailPanelCollapsed = next.detailPanelCollapsed === true;
  next.archivedOpen = next.archivedOpen === true;
  next.archivedTagsOpen = next.archivedTagsOpen === true;
  next.sidebarWidth = clamp(
    Number(next.sidebarWidth) || defaultState.sidebarWidth,
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_MAX_WIDTH,
  );
  next.sources = next.sources.map((source) => ({
    ...source,
    archived: source.archived === true,
    visible: source.visible !== false,
    appleSyncEnabled: source.appleSyncEnabled !== false,
  }));
  if (!next.sources.some((source) => source.id === next.selectedSourceId && !source.archived)) {
    next.selectedSourceId =
      next.sources.find((source) => !source.archived)?.id || next.sources[0]?.id || 'manual';
  }
  next.events = next.events.map((event) => ({
    id: event.id || crypto.randomUUID(),
    title: event.title || '未命名日程',
    date: isValidDateKey(event.date) ? event.date : toDateKey(new Date()),
    endDate: isValidDateKey(event.endDate) ? event.endDate : event.date || toDateKey(new Date()),
    start: normalizeTime(event.start || '09:00'),
    end: normalizeTime(event.end || '09:30'),
    notes: event.notes || '',
    reminders: Array.isArray(event.reminders) ? structuredCloneSafe(event.reminders) : [],
    allDay: event.allDay === true,
    travelTime: normalizeTravelMinutes(event.travelTime ?? event.travelTimeMinutes ?? 0),
    tags: normalizeTags(event.tags),
    sourceId: event.sourceId || next.sources[0]?.id || 'manual',
    type: normalizeItemType(event.type, getSourceType(next.sources, event.sourceId)),
    status: normalizeTodoStatus(event),
    completed: normalizeTodoStatus(event) === 'completed',
    children: Array.isArray(event.children) ? event.children : [],
    recurrenceGroupId: event.recurrenceGroupId || '',
    recurrenceIndex: Number.isInteger(event.recurrenceIndex) ? event.recurrenceIndex : null,
  }));
  const usedTagColors = new Set();
  const tagMap = new Map(
    next.tags.map((tag) => {
      const name = String(tag?.name || tag || '')
        .trim()
        .replace(/^#+/, '');
      const color = tag?.color || getAutoTagColor(name, next.theme, usedTagColors);
      const archived = tag?.archived === true;
      usedTagColors.add(color.toLowerCase());
      return [normalizeTagKey(name), { name, color, archived }];
    }),
  );
  next.events.forEach((event) =>
    event.tags.forEach((name) => {
      const key = normalizeTagKey(name);
      if (key && !tagMap.has(key)) {
        const color = getAutoTagColor(name, next.theme, usedTagColors);
        usedTagColors.add(color.toLowerCase());
        tagMap.set(key, { name, color, archived: false });
      }
    }),
  );
  next.tags = [...tagMap.values()].filter((tag) => tag.name);
  return next;
}

/** 收尾撤销记录并增加状态修订号，先保存本地状态，再调度文件和远端任务，最后渲染。异步同步用修订号识别等待期间的新编辑。 */
export function saveAndRender(options = {}) {
  finishUndoOperation();
  persistSearchPrefs();
  runtime.stateRevision += 1;
  runtime.state.dataUpdatedAt = new Date().toISOString();
  runtime.state.dataFileIdentity = runtime.nativeDataFilePath;
  persistLocalState();
  scheduleAutoSaveDataFile();
  scheduleAppleCalendarSync();
  render(options);
}

/** 保存当前本地状态；失败时返回 false 并显示提示，由调用方决定回滚或暂停后续动作。 */
export function persistLocalState() {
  try {
    runtime.plannerStorage.write(STORAGE_KEY, runtime.state);
    return true;
  } catch (error) {
    runtime.persistenceError = `本地保存失败：${error.message}，请立即导出备份`;
    renderFileConnectionStatus();
    return false;
  }
}

/** 在覆盖或合并前备份当前序列化文档。Mac 使用原生备份文件，浏览器使用限量本地备份；失败向上传递。 */
export async function createSafetyBackup() {
  const text = serializeDataFile();
  if (hasNativeFileBridge()) await callNativeFile('backup', { text });
  else {
    const key = `${STORAGE_KEY}-backups`;
    runtime.plannerStorage.backup(key, text);
  }
}
