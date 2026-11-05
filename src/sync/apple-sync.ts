/**
 * 文件用途：Apple 日历三方合并核心。
 * 对比本地、远端快照与同步基线，产出新状态和待执行操作；重复标识与冲突会阻止相关记录自动推进，不直接调用 EventKit。
 */
import type {
  AppleEvent,
  AppleFields,
  AppleMetadata,
  AppleOperation,
  AppleSnapshot,
  PlannerDocument,
  PlannerEvent,
} from '../types/model.js';
/* 此模块只处理数据合并；EventKit 调用、存储写入和界面刷新交给外层。 */
function fields(event: AppleFields): AppleFields;
function fields(event: AppleFields | null | undefined): AppleFields | null;
function fields(event: AppleFields | null | undefined): AppleFields | null {
  if (!event) return null;
  const result: AppleFields = {
    title: String(event.title ?? ''),
    date: String(event.date ?? ''),
    endDate: String(event.endDate ?? event.date),
    start: String(event.start ?? ''),
    end: String(event.end ?? ''),
    allDay: event.allDay === true,
    notes: String(event.notes ?? ''),
    sourceId: String(event.sourceId ?? ''),
  } satisfies AppleFields;
  const nextDay = (date: string) => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  if (result.allDay) result.start = result.end = '00:00';
  else {
    if (result.start === '24:00') {
      result.date = nextDay(result.date);
      result.start = '00:00';
    }
    if (result.end === '24:00') {
      result.endDate = nextDay(result.endDate!);
      result.end = '00:00';
    }
    if (`${result.endDate}T${result.end}` <= `${result.date}T${result.start}`)
      result.endDate = nextDay(result.endDate!);
  }
  result.reminders = (event.reminders || [])
    .map((reminder) => {
      let r = JSON.parse(JSON.stringify(reminder));
      const start = new Date(`${result.date}T${result.start}:00`);
      if (r.kind === 'day' && !result.allDay) {
        const target = new Date(`${result.date}T${r.time}:00`);
        target.setDate(target.getDate() + r.dayOffset);
        r = { kind: 'relative', offset: (target.getTime() - start.getTime()) / 1000 };
      } else if (r.kind === 'relative' && result.allDay) {
        const target = new Date(start.getTime() + r.offset * 1000);
        const pad = (n: number) => String(n).padStart(2, '0');
        r = {
          kind: 'day',
          dayOffset: Math.round(
            (Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) -
              Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
              86400000,
          ),
          time: `${pad(target.getHours())}:${pad(target.getMinutes())}`,
        };
      }
      return r.kind === 'relative'
        ? { kind: r.kind, offset: r.offset }
        : r.kind === 'absolute'
          ? { kind: r.kind, timestamp: r.timestamp }
          : r.kind === 'day'
            ? { kind: r.kind, dayOffset: r.dayOffset, time: r.time }
            : r;
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  return result;
}
const equal = (a: AppleFields | null | undefined, b: AppleFields | null | undefined) =>
  JSON.stringify(fields(a)) === JSON.stringify(fields(b));
const metadata = (e: PlannerEvent | null | undefined) =>
  e
    ? JSON.stringify([
        e.tags || [],
        e.type || 'schedule',
        e.status || 'open',
        e.travelTime || 0,
        e.children || [],
      ])
    : null;
/** 合并原生报告与快照中重复出现的 plannerId；这些记录不能被 Map 的最后一项静默覆盖后继续写回。 */
function duplicatePlannerIds(snapshot: AppleSnapshot): string[] {
  const seen = new Set<string>();
  const duplicates = new Set(snapshot.duplicateIds || []);
  for (const event of snapshot.events) {
    if (seen.has(event.plannerId)) duplicates.add(event.plannerId);
    seen.add(event.plannerId);
  }
  return [...duplicates];
}
/** 输入本地文档和原生快照，先克隆文档，再按共同基线判断哪端改变。返回新状态、待写操作与重复标识，实际日历写入由调用方执行。 */
function reconcile<T extends PlannerDocument & { appleSync?: AppleMetadata }>(
  input: T,
  snapshot: AppleSnapshot,
  uuid: () => string = () => crypto.randomUUID(),
) {
  const state: T = JSON.parse(JSON.stringify(input));
  state.appleSync = state.appleSync || { baseline: {}, conflicts: [], trash: [] };
  const sync = state.appleSync;
  sync.baseline ||= {};
  sync.conflicts ||= [];
  sync.trash ||= [];
  const enabled = new Set(
    state.sources.filter((s) => !s.archived && s.appleSyncEnabled !== false).map((s) => s.id),
  );
  const remote = new Map(
    snapshot.events.filter((e) => enabled.has(e.sourceId)).map((e) => [e.plannerId, e]),
  );
  const local = new Map(state.events.map((e) => [e.id, e]));
  const duplicateIds = duplicatePlannerIds(snapshot);
  const blocked = new Set([...(snapshot.unsupportedIds || []), ...duplicateIds]);
  const operations: AppleOperation[] = [];
  const now = new Date().toISOString();
  const remember = (id: string, event: PlannerEvent, r: AppleEvent | undefined) => {
    sync.baseline[id] = {
      local: fields(event),
      remote: fields(r),
      remoteId: r?.remoteId || '',
      appMetadata: metadata(event),
    };
  };
  const conflict = (id: string, l: PlannerEvent | undefined, r: AppleEvent | undefined) => {
    const item = { id, local: l || null, remote: r || null, detectedAt: now };
    const index = sync.conflicts.findIndex((c) => c.id === id);
    if (index < 0) sync.conflicts.push(item);
    else sync.conflicts[index] = { ...item, detectedAt: sync.conflicts[index].detectedAt };
  };
  for (const id of new Set([...local.keys(), ...remote.keys(), ...Object.keys(sync.baseline)])) {
    const l = local.get(id),
      r = remote.get(id),
      base = sync.baseline[id];
    const sourceId = l?.sourceId || r?.sourceId || base?.local?.sourceId;
    if (!enabled.has(sourceId!) || (r && !enabled.has(r.sourceId)) || blocked.has(id)) continue;
    if (sync.conflicts.some((c) => c.id === id)) {
      conflict(id, l, r);
      continue;
    }
    if (!base) {
      if (l && r) {
        if (equal(l, r)) remember(id, l, r);
        else conflict(id, l, r);
      } else if (r) {
        const event: PlannerEvent = {
          ...fields(r),
          id,
          type: 'schedule',
          status: 'open',
          completed: false,
          tags: [],
          travelTime: 0,
        };
        state.events.push(event);
        remember(id, event, r);
      } else if (l) {
        operations.push({ kind: 'save', plannerId: id, fields: fields(l) });
      }
      continue;
    }
    const localChanged =
        !equal(l, base.local) || (!r && l && base.appMetadata && metadata(l) !== base.appMetadata),
      remoteChanged = !equal(r, base.remote);
    if (equal(l, r)) {
      if (l) remember(id, l, r);
      else delete sync.baseline[id];
      continue;
    }
    if (localChanged && remoteChanged) {
      conflict(id, l, r);
      continue;
    }
    if (remoteChanged) {
      if (!r) {
        sync.trash.push({ id: uuid(), event: l!, deletedAt: now, reason: 'Apple 日历删除' });
        state.events = state.events.filter((e) => e.id !== id);
        delete sync.baseline[id];
      } else {
        const event = { ...l, ...fields(r), id };
        if (l)
          Object.assign(
            state.events.find((e) => e.id === id)!,
            event,
          );
        else state.events.push(event);
        remember(id, event, r);
      }
    } else if (localChanged) {
      operations.push(
        l
          ? { kind: 'save', plannerId: id, remoteId: r?.remoteId, fields: fields(l) }
          : { kind: 'delete', plannerId: id, remoteId: r?.remoteId },
      );
    }
  }
  return { state, operations, duplicateIds };
}
/** 用写入后的快照核验所有保存和删除操作；整批核验通过后才修改同步基线，不能把未确认写入当成已同步。 */
function acknowledge<T extends PlannerDocument & { appleSync?: AppleMetadata }>(
  state: T,
  operations: AppleOperation[],
  snapshot: AppleSnapshot,
) {
  const remote = new Map(snapshot.events.map((e) => [e.plannerId, e]));
  const remoteIds = new Set(snapshot.events.map((e) => e.remoteId).filter(Boolean));
  const unsupported = new Set([
    ...(snapshot.unsupportedIds || []),
    ...duplicatePlannerIds(snapshot),
  ]);
  // 先核验整批操作；任一保存或删除结果未确认时，不推进任何记录的基线。
  for (const op of operations) {
    if (unsupported.has(op.plannerId)) throw new Error('Apple 日历写入结果尚未确认，请重试');
    if (op.kind === 'delete') {
      const remoteId = op.remoteId || state.appleSync!.baseline[op.plannerId]?.remoteId;
      if (remote.has(op.plannerId) || (remoteId && remoteIds.has(remoteId))) {
        throw new Error('Apple 日历删除结果尚未确认，请重试');
      }
    } else {
      const r = remote.get(op.plannerId);
      if (!r || !equal(op.fields, r)) throw new Error('Apple 日历写入结果尚未确认，请重试');
    }
  }
  for (const op of operations) {
    if (op.kind === 'delete') delete state.appleSync!.baseline[op.plannerId];
    else {
      const r = remote.get(op.plannerId);
      if (!r || !equal(op.fields, r)) throw new Error('Apple 日历写入结果尚未确认，请重试');
      state.appleSync!.baseline[op.plannerId] = {
        local: fields(op.fields),
        remote: fields(r),
        remoteId: r.remoteId,
        appMetadata: metadata(state.events.find((e) => e.id === op.plannerId)),
      };
    }
  }
  return state;
}
/** 按用户选择保留当前本地值或冲突中的远端值，保存可恢复副本并移除冲突。此函数直接修改传入状态，调用方须先备份并验证选择仍有效。 */
function resolve(
  state: PlannerDocument & { appleSync?: AppleMetadata },
  id: string,
  choice: 'local' | 'remote',
) {
  const index = state.appleSync!.conflicts.findIndex((c) => c.id === id);
  if (index < 0) throw new Error('这项冲突已更新，请重新选择版本');
  const c = state.appleSync!.conflicts[index];
  const current = state.events.find((e) => e.id === id);
  // 用户选择本地版本时，以冲突发现之后最新保存的编辑或删除为准。
  const selected = choice === 'local' ? current : c.remote;
  if (current)
    state.appleSync!.trash.push({
      id: crypto.randomUUID(),
      event: { ...current },
      deletedAt: new Date().toISOString(),
      reason: '冲突处理前版本',
    });
  if (c.remote && choice === 'local')
    state.appleSync!.trash.push({
      id: crypto.randomUUID(),
      event: { ...current, ...fields(c.remote), id },
      deletedAt: new Date().toISOString(),
      reason: '冲突中的 Apple 版本',
    });
  state.events = state.events.filter((e) => e.id !== id);
  if (selected)
    state.events.push({ tags: [], type: 'schedule', status: 'open', ...current, ...selected, id });
  state.appleSync!.baseline[id] = {
    local: fields(c.remote),
    remote: fields(c.remote),
    remoteId: c.remote?.remoteId || '',
  };
  state.appleSync!.conflicts.splice(index, 1);
}
export { fields, equal, reconcile, acknowledge, resolve };
