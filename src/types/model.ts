/**
 * 文件用途：共享业务数据类型。
 * 定义日程、列表、标签、提醒、草稿及 Apple 同步元数据；区别业务文档、完整应用状态和临时渲染选项。
 */
// 日程日期与时间保留本地日历字符串；不要把它们直接当作 UTC 时间戳。
export type ItemType = 'todo' | 'schedule';
export type TodoStatus = 'open' | 'completed' | 'abandoned';
/** 提醒按 kind 区分相对开始时间、绝对时刻、全天指定时刻和不可编辑的特殊提醒；unsupported 只保存原生身份。 */
export type Reminder =
  | { kind: 'relative'; offset: number }
  | { kind: 'absolute'; timestamp: number }
  | { kind: 'day'; dayOffset: number; time: string }
  | { kind: 'unsupported'; identity: string };
/** 正式日程记录。sourceId 关联所属列表；recurrenceGroupId 与 recurrenceIndex 保持重复系列身份和顺序。 */
export interface PlannerEvent {
  id: string;
  title: string;
  date: string;
  endDate?: string;
  start: string;
  end: string;
  notes?: string;
  allDay?: boolean;
  travelTime?: number;
  travelTimeMinutes?: number;
  tags?: string[];
  sourceId: string;
  type?: ItemType;
  status?: TodoStatus;
  completed?: boolean;
  reminders?: Reminder[];
  children?: PlannerEvent[];
  recurrenceGroupId?: string;
  recurrenceIndex?: number | null;
}
export interface PlannerSource {
  id: string;
  name: string;
  color?: string;
  type?: ItemType;
  locked?: boolean;
  archived?: boolean;
  visible?: boolean;
  appleSyncEnabled?: boolean;
  url?: string;
}
export interface PlannerTag {
  name: string;
  color: string;
  archived?: boolean;
}
/** 日程、列表和标签组成业务文档，供编辑与撤销等核心模块使用。 */
export interface PlannerDocument {
  events: PlannerEvent[];
  sources: PlannerSource[];
  tags: PlannerTag[];
}
export type Collection = keyof PlannerDocument;
export type DocumentItem = PlannerEvent | PlannerSource | PlannerTag;
export type AppleFields = Pick<
  PlannerEvent,
  'title' | 'date' | 'endDate' | 'start' | 'end' | 'allDay' | 'notes' | 'sourceId' | 'reminders'
>;
export interface AppleEvent extends AppleFields {
  plannerId: string;
  remoteId?: string;
}
export interface AppleSnapshot {
  events: AppleEvent[];
  unsupportedIds?: string[];
  duplicateIds?: string[];
  token?: string;
}
/** 同一记录上次确认的两端可同步字段；appMetadata 额外跟踪标签等应用字段，辅助判断远端删除是否冲突。 */
export interface AppleBaseline {
  local: AppleFields | null;
  remote: AppleFields | null;
  remoteId?: string;
  appMetadata?: string | null;
}
export interface AppleConflict {
  id: string;
  local: PlannerEvent | null;
  remote: AppleEvent | null;
  detectedAt: string;
}
export interface AppleTrash {
  id: string;
  event: PlannerEvent;
  deletedAt: string;
  reason: string;
}
export interface AppleMetadata {
  baseline: Record<string, AppleBaseline>;
  conflicts: AppleConflict[];
  trash: AppleTrash[];
  sourceSignature?: string;
}
export type AppleOperation =
  | { kind: 'save'; plannerId: string; remoteId?: string; fields: AppleFields }
  | { kind: 'delete'; plannerId: string; remoteId?: string };
/** 完整应用状态在业务文档之外增加视图偏好、选择状态和 Apple 同步元数据。 */
export interface PlannerState extends PlannerDocument {
  selectedDate: string;
  visibleWeekStart: string;
  miniMonth: string;
  viewMode: string;
  theme: string;
  searchQuery: string;
  selectedTagKeys: string[];
  archivedOpen: boolean;
  archivedTagsOpen: boolean;
  sidebarWidth: number;
  detailPanelCollapsed?: boolean;
  selectedSourceId: string;
  activeEventId: string | null;
  dataUpdatedAt?: string;
  dataFileIdentity?: string;
  appleSync?: AppleMetadata;
}
export type EditorFields = Record<string, string | boolean>;
/** base 是打开编辑器时的字段，values 是当前输入，original 用于恢复原始日程；草稿与正式文档分开保存。 */
export interface EditorDraft {
  base: EditorFields;
  values: EditorFields;
  original: PlannerEvent;
  updatedAt: string;
}
export interface RenderOptions {
  preserveScroll?: boolean;
  scrollToEventId?: string;
  scrollToCurrentTime?: boolean;
  preserveEditor?: boolean;
}
