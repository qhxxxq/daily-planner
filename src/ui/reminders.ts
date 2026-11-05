/**
 * 文件用途：提醒字段展示与文本说明。
 * 把相对、绝对及全天提醒转换为中文说明；根据事件类型和全天状态调整表单提醒选项。
 */
import { runtime } from '../app/runtime.js';
import { getSource } from '../app/queries.js';
import * as PlannerAppleSync from '../sync/apple-sync.js';
import { hasNativeFileBridge } from '../platform/files.js';

export function describeReminders(reminders) {
  if (!reminders?.length) return '不提醒';
  return reminders
    .map((r) =>
      r.kind === 'relative'
        ? r.offset === 0
          ? '开始时'
          : `${r.offset < 0 ? '提前' : '开始后'} ${Math.abs(r.offset) / 60} 分钟`
        : r.kind === 'day'
          ? `${r.dayOffset === 0 ? '当天' : r.dayOffset === -1 ? '前一天' : `相隔 ${r.dayOffset} 天`} ${r.time}`
          : r.kind === 'absolute'
            ? new Date(r.timestamp * 1000).toLocaleString()
            : '特殊提醒（请在 Apple 日历编辑）',
    )
    .join('；');
}

export function renderReminderFields() {
  const active = runtime.state.events.find((item) => item.id === runtime.state.activeEventId);
  if (!active) return;
  const source = getSource(runtime.els.sourceInput.value);
  const special = (active.reminders || []).some((r) => r.kind === 'unsupported');
  runtime.els.reminderInput.disabled = special;
  document.querySelector<HTMLElement>('#reminderTimeField').hidden = ![
    'day',
    'previousDay',
  ].includes(runtime.els.reminderInput.value);
  const baseline = runtime.state.appleSync?.baseline?.[active.id];
  const confirmed =
    baseline &&
    PlannerAppleSync.equal(active, baseline.local) &&
    PlannerAppleSync.equal(active, baseline.remote) &&
    !runtime.state.appleSync?.conflicts?.some((c) => c.id === active.id);
  document.querySelector<HTMLElement>('#reminderStatus').textContent = !hasNativeFileBridge()
    ? '未同步'
    : source?.archived || source?.appleSyncEnabled === false
      ? '未启用同步'
      : confirmed
        ? '已同步到本机日历'
        : '待同步';
}
