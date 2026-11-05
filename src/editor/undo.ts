/**
 * 文件用途：可冲突检测的撤销模型。
 * 记录日程、列表和标签的前后差异；撤销前校验目标当前值，避免覆盖后续同步或其他修改。
 */
import type {
  Collection,
  DocumentItem,
  PlannerDocument,
  PlannerEvent,
  PlannerSource,
  PlannerTag,
} from '../types/model.js';
export interface UndoRecord {
  id: string;
  before?: DocumentItem;
  after?: DocumentItem;
}
export interface UndoChange {
  name: Collection;
  records: UndoRecord[];
  beforeOrder: string[];
  afterOrder: string[];
  reordered: boolean;
}
export interface UndoOperation {
  changes: UndoChange[];
}
/* Operation-scoped undo. Never restore a whole document over incoming sync data. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const key = (collection: Collection, item: DocumentItem): string =>
  collection === 'tags'
    ? String((item as PlannerTag).name)
        .trim()
        .toLowerCase()
    : (item as PlannerEvent | PlannerSource).id;
const collections: Collection[] = ['events', 'sources', 'tags'];
const capture = (state: Partial<PlannerDocument>): PlannerDocument => ({
  events: clone(state.events || []),
  sources: clone(state.sources || []),
  tags: clone(state.tags || []),
});
/** 比较操作前后的文档，只记录新增、删除和实际变化的条目，同时保留位置用于恢复原顺序。 */
function operation(before: PlannerDocument, after: PlannerDocument): UndoOperation {
  const changes: UndoChange[] = [];
  for (const name of collections) {
    const oldItems = new Map(before[name].map((item) => [key(name, item), item] as const));
    const newItems = new Map(after[name].map((item) => [key(name, item), item] as const));
    const records: UndoRecord[] = [];
    for (const id of new Set([...oldItems.keys(), ...newItems.keys()])) {
      const oldValue = oldItems.get(id),
        newValue = newItems.get(id);
      if (!equal(oldValue, newValue)) records.push({ id, before: oldValue, after: newValue });
    }
    const beforeOrder = [...oldItems.keys()],
      afterOrder = [...newItems.keys()];
    const common = new Set(beforeOrder.filter((id) => newItems.has(id)));
    const reordered = !equal(
      beforeOrder.filter((id) => common.has(id)),
      afterOrder.filter((id) => common.has(id)),
    );
    if (records.length || reordered)
      changes.push({ name, records, beforeOrder, afterOrder, reordered });
  }
  return { changes };
}
/** 先验证整批条目仍符合操作的预期状态，在副本上应用撤销；任一目标已变化就拒绝整批操作，避免部分成功。 */
function apply<T extends PlannerDocument>(
  state: T,
  op: UndoOperation,
  protectedIds: string[] = [],
): T {
  const next = clone(state),
    protectedSet = new Set(protectedIds);
  const fail = () => {
    throw new Error('这次操作涉及的日程或列表已有新修改，暂不能安全撤销。请先处理草稿或同步更新。');
  };
  for (const change of op.changes) {
    const { name, records, beforeOrder, afterOrder, reordered } = change;
    const current = new Map((next[name] || []).map((item) => [key(name, item), item] as const));
    for (const record of records) {
      if (name === 'events' && protectedSet.has(record.id)) fail();
      // 任一目标已被后续修改，都阻止整批撤销；临时副本不会返回给调用方。
      if (!equal(current.get(record.id), record.after)) fail();
      if (record.before === undefined) current.delete(record.id);
      else current.set(record.id, clone(record.before));
    }
    if (reordered) {
      const ids = new Set(afterOrder);
      if (
        !equal(
          (state[name] || []).map((item) => key(name, item)).filter((id) => ids.has(id)),
          afterOrder,
        )
      )
        fail();
    }
    let order = (next[name] || []).map((item) => key(name, item)).filter((id) => current.has(id));
    if (reordered)
      order = [
        ...beforeOrder.filter((id) => current.has(id)),
        ...order.filter((id) => !beforeOrder.includes(id)),
      ];
    // 恢复删除的条目时，尽量插回原有邻居旁边，保持用户原先的顺序。
    for (let index = 0; index < beforeOrder.length; index++) {
      const id = beforeOrder[index];
      if (!current.has(id) || order.includes(id)) continue;
      const following = beforeOrder.slice(index + 1).find((candidate) => order.includes(candidate));
      order.splice(following === undefined ? order.length : order.indexOf(following), 0, id);
    }
    (next as Record<Collection, DocumentItem[]>)[name] = order.map((id) => current.get(id)!);
  }
  const removedSources = new Set(
    (state.sources || []).filter((s) => !next.sources.some((n) => n.id === s.id)).map((s) => s.id),
  );
  if (next.events.some((event) => removedSources.has(event.sourceId))) fail();
  const removedTags = new Set(
    (state.tags || [])
      .filter((t) => !next.tags.some((n) => key('tags', n) === key('tags', t)))
      .map((t) => key('tags', t)),
  );
  if (
    next.events.some((event) =>
      (event.tags || []).some((tag) => removedTags.has(String(tag).trim().toLowerCase())),
    )
  )
    fail();
  return next;
}
export { capture, operation, apply };
