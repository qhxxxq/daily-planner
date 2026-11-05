/**
 * 文件用途：时间轴重叠布局。
 * 为日程分配列、可扩展宽度和单层嵌套关系；为布局记录补充定位字段，供卡片渲染使用。
 */
import { isWrapperEvent } from './events.js';
import {
  EVENT_GUTTER_PX,
  NESTED_CHILD_LEFT_INDENT_PX,
  NESTED_CHILD_RIGHT_GAP_PX,
  START_HOUR,
} from '../app/config.js';
import { timeToMinute } from './date-time.js';
import { getEventTravelMinutes } from './events.js';

/** 先识别可嵌套事件，再对重叠时间段分组和分列；入口先复制事件生成布局记录，再返回带定位字段的结果。 */
export function layoutOverlappingEvents(events) {
  const wrappers = events.filter(isWrapperEvent).map((event, index) => ({
    ...event,
    startMin: Math.max(START_HOUR * 60, timeToMinute(event.start)),
    endMin: Math.max(timeToMinute(event.end), timeToMinute(event.start) + 15),
    layoutLeftPercent: 0,
    layoutWidthPercent: 100,
    laneIndex: 0,
    span: 1,
    totalCols: 1,
    originalOrder: index,
  }));
  const normalEvents = events.filter((event) => !isWrapperEvent(event));
  const normalized = normalEvents
    .map((event, index) => {
      const startMin = Math.max(
        START_HOUR * 60,
        timeToMinute(event.start) - getEventTravelMinutes(event),
      );
      const rawEnd = timeToMinute(event.end);
      const endMin = Math.max(rawEnd, timeToMinute(event.start) + 15, startMin + 15);
      return {
        ...event,
        startMin,
        endMin,
        durationMin: endMin - startMin,
        eventStartMin: timeToMinute(event.start),
        eventEndMin: Math.max(rawEnd, timeToMinute(event.start) + 15),
        originalOrder: index,
      };
    })
    .sort(
      (a, b) =>
        a.startMin - b.startMin ||
        b.durationMin - a.durationMin ||
        a.originalOrder - b.originalOrder,
    );

  const { rootEvents, childrenByParent } = assignNestedEventRelationships(normalized);
  const groups = [];
  let group = null;
  rootEvents.forEach((event) => {
    if (!group || event.startMin >= group.maxEnd) {
      group = { events: [], maxEnd: event.endMin };
      groups.push(group);
    }
    group.events.push(event);
    group.maxEnd = Math.max(group.maxEnd, event.endMin);
  });

  const laidOut = [];
  groups.forEach((overlapGroup) => laidOut.push(...layoutOverlapGroup(overlapGroup.events)));
  const rootLayoutsById = new Map(laidOut.map((event) => [event.id, event]));
  const nestedLayouts = [];
  childrenByParent.forEach((children, parentId) => {
    const parent = rootLayoutsById.get(parentId);
    if (!parent) return;
    parent.layoutMode = 'nested-parent';
    parent.parentEventId = null;
    parent.nestedChildren = children.map((child) => child.id);
    parent.hasNestedLabelCollision = children.some(
      (child) => child.startMin - parent.startMin < 60,
    );
    const childLayouts = layoutOverlapGroup(children);
    childLayouts.forEach((child) => nestedLayouts.push(applyNestedChildLayout(child, parent)));
  });
  laidOut.forEach((event) => {
    if (!event.layoutMode) event.layoutMode = 'normal';
  });
  return [...wrappers, ...laidOut, ...nestedLayouts].sort(
    (a, b) => a.startMin - b.startMin || a.originalOrder - b.originalOrder,
  );
}

export function assignNestedEventRelationships(events) {
  const eligibleParentsByChild = new Map();
  events.forEach((child) => {
    const parents = events
      .filter((parent) => parent.id !== child.id && shouldNestEvent(parent, child))
      .sort((a, b) => {
        const durationDifference = getOfficialEventDuration(a) - getOfficialEventDuration(b);
        return (
          durationDifference ||
          a.eventStartMin - b.eventStartMin ||
          a.originalOrder - b.originalOrder
        );
      });
    if (parents.length) eligibleParentsByChild.set(child.id, parents);
  });

  // A parent remains a root. This deliberately prevents a second nesting level.
  const candidateParents = events.filter((parent) =>
    events.some((child) => child.id !== parent.id && shouldNestEvent(parent, child)),
  );
  const parentIds = new Set(
    candidateParents
      // If a candidate is itself nestable, keep the outer candidate as the root
      // and flatten its eligible descendants into that root (one nesting level).
      .filter(
        (candidate) =>
          !candidateParents.some(
            (outer) => outer.id !== candidate.id && shouldNestEvent(outer, candidate),
          ),
      )
      .map((parent) => parent.id),
  );

  const parentByChild = new Map();
  events.forEach((child) => {
    if (parentIds.has(child.id)) return;
    const parent = eligibleParentsByChild
      .get(child.id)
      ?.find((candidate) => parentIds.has(candidate.id));
    if (parent) parentByChild.set(child.id, parent.id);
  });

  const childrenByParent = new Map();
  parentByChild.forEach((parentId, childId) => {
    const child = events.find((event) => event.id === childId);
    if (!child) return;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(child);
  });
  childrenByParent.forEach((children) =>
    children.sort((a, b) => a.startMin - b.startMin || b.durationMin - a.durationMin),
  );
  return {
    rootEvents: events.filter((event) => !parentByChild.has(event.id)),
    childrenByParent,
  };
}

export function shouldNestEvent(parent, child) {
  const parentDuration = getOfficialEventDuration(parent);
  const childDuration = getOfficialEventDuration(child);
  const sameInterval =
    parent.eventStartMin === child.eventStartMin && parent.eventEndMin === child.eventEndMin;
  const isFullyContained =
    parent.eventStartMin <= child.eventStartMin &&
    parent.eventEndMin >= child.eventEndMin &&
    !sameInterval;
  const maxChildDuration = parentDuration / 3;
  return parentDuration > 180 && childDuration <= maxChildDuration && isFullyContained;
}

export function getOfficialEventDuration(event) {
  return event.eventEndMin - event.eventStartMin;
}

export function applyNestedChildLayout(child, parent) {
  const columnRatio = child.laneIndex / child.totalCols;
  const widthRatio = child.span / child.totalCols;
  const parentLeftPercent = parent.layoutLeftPercent ?? 0;
  const parentWidthPercent = parent.layoutWidthPercent ?? 100;
  const parentHorizontalGap =
    EVENT_GUTTER_PX * 2 + NESTED_CHILD_LEFT_INDENT_PX + NESTED_CHILD_RIGHT_GAP_PX;
  return {
    ...child,
    layoutMode: 'nested-child',
    parentEventId: parent.id,
    nestedChildren: [],
    nestedColumn: child.laneIndex,
    nestedColumnCount: child.totalCols,
    layoutLeftPercent: parentLeftPercent + columnRatio * parentWidthPercent,
    layoutWidthPercent: widthRatio * parentWidthPercent,
    layoutLeftPx: EVENT_GUTTER_PX + NESTED_CHILD_LEFT_INDENT_PX - columnRatio * parentHorizontalGap,
    layoutWidthPx: -widthRatio * parentHorizontalGap,
  };
}

export function layoutOverlapGroup(events) {
  const lanes = [];
  const assigned = events.map((event) => {
    let laneIndex = lanes.findIndex((lane) => lane[lane.length - 1].endMin <= event.startMin);
    if (laneIndex === -1) {
      laneIndex = lanes.length;
      lanes.push([]);
    }
    const laidOut = { ...event, laneIndex };
    lanes[laneIndex].push(laidOut);
    return laidOut;
  });

  const totalCols = Math.max(1, lanes.length);
  assigned.forEach((event) => {
    event.totalCols = totalCols;
    event.span = getExpandableSpan(event, lanes, totalCols);
    event.layoutLeftPercent = (event.laneIndex / totalCols) * 100;
    event.layoutWidthPercent = (event.span / totalCols) * 100;
  });
  return assigned;
}

/** 从当前列向右检查其他列，遇到时间重叠即停止扩展；返回可安全占用的列跨度。 */
export function getExpandableSpan(event, lanes, totalCols) {
  let span = 1;
  for (let laneIndex = event.laneIndex + 1; laneIndex < totalCols; laneIndex += 1) {
    if (lanes[laneIndex].some((other) => eventsOverlap(event, other))) break;
    span += 1;
  }
  return span;
}

export function eventsOverlap(a, b) {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}
