/**
 * 文件用途：当前时间指示线。
 * 定时更新日历中的当前时间位置；日期变化时按选项触发重新渲染，保持今日标记与时间轴一致。
 */
import { runtime } from '../app/runtime.js';
import { NOW_LINE_UPDATE_INTERVAL_MS } from '../app/config.js';
import { getTodayKey, minuteToTime } from '../domain/date-time.js';
import { saveAndRender } from '../app/persistence.js';
import { getCurrentMinuteOfDay, isMinuteInTimeline, minuteToY } from './timeline-geometry.js';

export function startNowLineUpdates() {
  window.clearInterval(runtime.nowLineTimer);
  updateNowLine({ rerenderOnDateChange: false });
  runtime.nowLineTimer = window.setInterval(updateNowLine, NOW_LINE_UPDATE_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateNowLine();
  });
  window.addEventListener('focus', () => updateNowLine());
}

export function updateNowLine(options: { rerenderOnDateChange?: boolean } = {}) {
  const { rerenderOnDateChange = true } = options;
  const todayKey = getTodayKey();
  if (rerenderOnDateChange && todayKey !== runtime.lastNowLineDateKey) {
    runtime.lastNowLineDateKey = todayKey;
    saveAndRender({ preserveScroll: true });
    return;
  }
  runtime.lastNowLineDateKey = todayKey;

  const nowMinute = getCurrentMinuteOfDay();
  const inTimeline = isMinuteInTimeline(nowMinute);
  document.querySelectorAll<HTMLElement>('.now-line').forEach((line) => {
    line.hidden = !inTimeline;
    if (inTimeline) line.style.top = `${minuteToY(nowMinute)}px`;
  });
  document.querySelectorAll<HTMLElement>('.now-time-label').forEach((label) => {
    label.hidden = !inTimeline;
    if (inTimeline) {
      label.style.top = `${minuteToY(nowMinute)}px`;
      label.textContent = minuteToTime(nowMinute);
    }
  });
}
