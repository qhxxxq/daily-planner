/**
 * 文件用途：初始日程状态。
 * 提供首次打开及状态归一化使用的默认列表、日期和界面选项；由持久化模块与已保存数据合并。
 */
import { toDateKey, getWeekStartDate, toMonthKey } from '../domain/date-time.js';
import type { PlannerState } from '../types/model.js';

export const defaultState: PlannerState = {
  selectedDate: toDateKey(new Date()),
  visibleWeekStart: toDateKey(getWeekStartDate(new Date())),
  miniMonth: toMonthKey(new Date()),
  viewMode: 'day',
  theme: 'mono',
  searchQuery: '',
  selectedTagKeys: [],
  archivedOpen: false,
  archivedTagsOpen: false,
  sidebarWidth: 228,
  detailPanelCollapsed: false,
  selectedSourceId: 'manual',
  sources: [
    {
      id: 'manual',
      name: '手动日程',
      color: '#6d5ff5',
      locked: true,
      visible: true,
      type: 'todo',
      appleSyncEnabled: true,
    },
  ],
  tags: [],
  events: [
    {
      id: crypto.randomUUID(),
      title: '写下今天最重要的一件事',
      date: toDateKey(new Date()),
      endDate: toDateKey(new Date()),
      start: '09:00',
      end: '09:30',
      notes: '',
      allDay: false,
      travelTime: 0,
      tags: [],
      sourceId: 'manual',
      type: 'todo',
      status: 'open',
      completed: false,
    },
  ],
  activeEventId: null,
};
