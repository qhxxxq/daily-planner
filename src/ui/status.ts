/**
 * 文件用途：保存与同步状态汇总。
 * 汇总文件保存和 Apple 同步提示，将底层错误转为中文原因；保存有限数量的诊断记录并按需写入原生诊断文件。
 */
import { runtime } from '../app/runtime.js';
import { callNativeFile, hasNativeFileBridge } from '../platform/files.js';

/** 按文件错误、同步冲突和同步错误的优先级生成摘要；普通保存状态仅在没有更紧急问题时显示。 */
export function refreshStatusSummary() {
  const summary = document.querySelector<HTMLElement>('#statusSummary');
  const details = document.querySelector<HTMLElement>('#statusDetails');
  if (!summary || !details) return;
  const syncStatus = document.querySelector<HTMLElement>('#appleSyncStatus');
  const conflicts = runtime.state.appleSync?.conflicts?.length || 0;
  const fileNeedsHelp = runtime.els.fileStatus?.dataset.tone === 'attention';
  const syncNeedsHelp = syncStatus?.dataset.tone === 'attention';
  details.dataset.tone = fileNeedsHelp || syncNeedsHelp || conflicts ? 'attention' : 'ready';
  summary.textContent = fileNeedsHelp
    ? '保存需要处理'
    : conflicts
      ? `${conflicts} 项更新待确认`
      : syncNeedsHelp
        ? '同步需要处理'
        : syncStatus?.dataset.summary ||
          (runtime.els.fileStatus?.dataset.tone === 'busy' ? '正在保存…' : '此设备上的日程');
  const recovery = document.querySelector<HTMLButtonElement>('#recoveryButton');
  if (recovery) recovery.textContent = conflicts ? `查看待确认更新 (${conflicts})` : '备份与恢复';
}

export function syncFailureReason(error) {
  const message = String(error?.message || error || '');
  if (/权限|permission|notallowed/i.test(message))
    return '未获得日历访问权限。请在系统设置的“隐私与安全性 → 日历”中允许日程访问。';
  if (/期间发生变化/.test(message)) return 'Apple 日历刚刚有更新，本次已暂停写入，稍后会自动重试。';
  if (/写入结果尚未确认/.test(message))
    return 'Apple 日历写入后的内容与预期不一致，尚未确认同步完成。请查看错误记录。';
  if (/账户|日历暂不可用|calendarUnavailable/i.test(message))
    return '日历账户或目标日历不可用。请打开 Apple 日历确认账户已启用且日历可编辑。';
  if (/超时|timeout/i.test(message))
    return '系统日历响应超时。请检查是否有待处理的授权窗口，再点击立即同步。';
  if (/quota|空间|磁盘已满/i.test(message))
    return '可用空间不足，已停止同步。请先导出备份并清理空间。';
  if (/本地保存|基线保存|备份/.test(message))
    return '本地保存或备份未完成，已暂停同步以保护日程。请检查保存位置和磁盘空间。';
  if (/格式|JSON|parse/i.test(message))
    return '日程日期或数据格式异常，未能完成同步。请查看错误记录。';
  return `系统日历返回错误：${message.slice(0, 240) || '未提供原因'}。请稍后重试。`;
}

/** 记录时间、同步阶段和底层错误，本地最多保留 100 条；诊断写入失败只输出警告，不覆盖原始同步错误。 */
export function recordSyncFailure(error, phase) {
  const entry = {
    time: new Date().toISOString(),
    phase,
    reason: syncFailureReason(error),
    message: String(error?.message || error).slice(0, 2000),
    code: error?.code || '',
  };
  try {
    const entries = JSON.parse(localStorage.getItem('daily-planner-sync-errors') || '[]');
    localStorage.setItem(
      'daily-planner-sync-errors',
      JSON.stringify([entry, ...entries].slice(0, 100)),
    );
  } catch (failure) {
    console.warn('同步错误记录保存失败', failure);
  }
  if (hasNativeFileBridge())
    callNativeFile('recordSyncError', { entry }).catch((failure) =>
      console.warn('同步诊断文件保存失败', failure),
    );
}

export function userErrorMessage(error, fallback = '操作暂未完成，请稍后重试') {
  if (error?.code === 'ICS_IMPORT') return error.message;
  const message = String(error?.message || error || '');
  console.warn(message);
  if (/权限|permission|notallowed/i.test(message)) return '请允许访问日历或文件后重试';
  if (/quota|空间|磁盘已满/i.test(message)) return '可用空间不足，请先备份日程并清理空间';
  if (/JSON|格式|parse|syntax/i.test(message)) return '无法读取这份文件，请选择之前保存的日程备份';
  if (/账户|calendarUnavailable/i.test(message)) return '请检查系统日历中的账户是否可用';
  return fallback;
}
