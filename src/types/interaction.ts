/**
 * 文件用途：指针交互状态类型。
 * 定义拖动创建、移动缩放、框选和时间轴目标的数据结构，供运行状态与交互处理模块共同使用。
 */
// 这些结构只用于当前指针交互；其中的 DOM 引用和计时器不写入日程文档。
export interface TimelineTarget {
  date: string;
  minute: number;
  column?: HTMLElement;
  clientX?: number;
  clientY?: number;
}
export interface DragCreateState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startDate: string;
  startMinute: number;
  currentDate: string;
  currentMinute: number;
  sourceColor: string;
  previews: HTMLElement[];
  moved: boolean;
}
export interface EventDragState {
  mode?: 'resize';
  edge?: string;
  pointerId: number;
  eventId: string;
  card: HTMLElement;
  cards: HTMLElement[];
  startClientX: number;
  startClientY: number;
  moved: boolean;
  draggedIds?: string[];
  eventSnapshots?: { id: string; startAbs: number; duration: number }[];
  startPointerAbs?: number;
  eventStartAbs?: number;
  duration?: number;
  sourceStartAbs?: number;
  sourceEndAbs?: number;
  sourceVisualStartAbs?: number;
  travelMinutes?: number;
  originalTop?: string;
  originalHeight?: string;
}
export interface RightSelectState {
  pointerId: number;
  eventId: string | null;
  card: HTMLElement;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  rect: HTMLElement | null;
  baseSelection: Set<string>;
  activated: boolean;
  timer: number;
}
