/**
 * 文件用途：ICS 导入界面流程。
 * 接收本地文件或日历链接，调用解析器并处理导入结果；把导入列表和日程接入现有状态及保存流程。
 */
import type { PlannerSource } from '../types/model.js';
import { runtime } from '../app/runtime.js';
import { userErrorMessage } from './status.js';
import { callNativeFile, hasNativeFileBridge } from '../platform/files.js';
import * as PlannerIcsImport from '../import/ics-import.js';
import { structuredCloneSafe } from '../domain/clone.js';
import { pushUndoSnapshot } from './undo.js';
import { persistLocalState, saveAndRender } from '../app/persistence.js';
import { getUniqueSourceName } from './source-actions.js';
import { getThemeCalendarColors } from './themes.js';

export function toggleUrlImportForm() {
  runtime.els.urlImportForm.hidden = !runtime.els.urlImportForm.hidden;
  if (!runtime.els.urlImportForm.hidden) {
    runtime.els.icsUrlInput.focus();
    runtime.els.icsUrlInput.select();
  }
}

export async function handleUrlImportSubmit(event) {
  event.preventDefault();
  const url = normalizeImportUrl(runtime.els.icsUrlInput.value);
  if (!url) return;
  try {
    runtime.els.importButton.disabled = true;
    const text = await fetchIcsText(url);
    const imported = importIcsEvents(text, url);
    if (imported === null) return;
    if (!imported) {
      alert('没有找到可导入的日程。');
      return;
    }
    runtime.els.urlImportForm.hidden = true;
    runtime.els.icsUrlInput.value = '';
    alert(`已导入 ${imported} 条日程。`);
  } catch (error) {
    alert(userErrorMessage(error, '暂时无法读取这个订阅链接，请检查链接后重试'));
  } finally {
    runtime.els.importButton.disabled = false;
  }
}

export async function handleIcsFileInput(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const imported = importIcsEvents(await file.text(), file.name);
    if (imported === null) return;
    if (!imported) alert('没有找到可导入的日程。');
    else alert(`已导入 ${imported} 条日程。`);
  } catch (error) {
    alert(userErrorMessage(error, '暂时无法导入这份日历，请重新选择文件'));
  } finally {
    event.target.value = '';
  }
}

export function normalizeImportUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('webcal://')) return `https://${text.slice('webcal://'.length)}`;
  return text;
}

export async function fetchIcsText(url) {
  const errors = [];
  if (hasNativeFileBridge()) {
    try {
      const result = await callNativeFile('fetchIcs', { url });
      const text = result?.text || '';
      if (text.includes('BEGIN:VEVENT') || text.includes('BEGIN:VCALENDAR')) return text;
      throw new Error('返回内容不是日历 ICS');
    } catch (error) {
      errors.push(error.message || String(error));
    }
  }
  for (const candidate of getImportUrlCandidates(url)) {
    try {
      const response = await fetch(candidate, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (text.includes('BEGIN:VEVENT') || text.includes('BEGIN:VCALENDAR')) return text;
      throw new Error('返回内容不是日历 ICS');
    } catch (error) {
      errors.push(error.message || String(error));
    }
  }
  throw new Error(errors.at(-1) || '无法读取这个 URL');
}

export function getImportUrlCandidates(url) {
  const candidates = [url];
  if (/^https?:\/\//i.test(url)) {
    candidates.push(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
  }
  return [...new Set(candidates)];
}

export function importIcsEvents(text, url = '') {
  const source = createImportedIcsSource(text, url);
  const report = PlannerIcsImport.parse(text, source.id);
  const events = report.events;
  if (!events.length) return 0;
  const dates = events.flatMap((event) => [event.date, event.endDate]).sort();
  const preview = [
    `准备导入 ${events.length} 条日程到“${source.name}”。`,
    `日期范围：${dates[0]} 至 ${dates.at(-1)}`,
    report.timezones.length
      ? `来源时区：${report.timezones.join('、')}；定时日程将转换为此设备时间。`
      : '',
    ...report.warnings,
    '导入的是独立日程副本，不会持续订阅原日历。继续导入吗？',
  ]
    .filter(Boolean)
    .join('\n\n');
  if (!confirm(preview)) return null;
  const beforeImport = structuredCloneSafe(runtime.state);
  pushUndoSnapshot();
  runtime.state.sources.push(source);
  runtime.state.events.push(...events);
  if (!persistLocalState()) {
    runtime.state = beforeImport;
    runtime.undoStack.pop();
    throw Object.assign(
      new Error('ICS 导入未完成：本地保存失败，未导入任何日程，请先导出备份并检查可用空间。'),
      { code: 'ICS_IMPORT' },
    );
  }
  runtime.state.selectedSourceId = source.id;
  runtime.state.activeEventId = null;
  runtime.selectedEventIds.clear();
  saveAndRender({ preserveScroll: true });
  console.info(`Imported ${events.length} calendar events from ${url}`);
  return events.length;
}

export function createImportedIcsSource(text: string, url = ''): PlannerSource {
  return {
    id: `ics-${crypto.randomUUID()}`,
    name: getUniqueSourceName(getImportedIcsSourceName(text, url)),
    color: getThemeCalendarColors()[runtime.state.sources.length % getThemeCalendarColors().length],
    visible: true,
    type: 'schedule',
    archived: false,
    appleSyncEnabled: true,
  };
}

export function getImportedIcsSourceName(text, url = '') {
  const calendarName =
    getIcsCalendarField(text, 'X-WR-CALNAME') || getIcsCalendarField(text, 'NAME');
  if (calendarName) return calendarName;
  const urlName = getImportSourceNameFromUrl(url);
  return urlName || '导入日历';
}

export function getIcsCalendarField(text, fieldName) {
  const target = fieldName.toUpperCase();
  const line = unfoldIcsLines(text).find((item) => {
    const colon = item.indexOf(':');
    if (colon < 0) return false;
    return item.slice(0, colon).split(';')[0].toUpperCase() === target;
  });
  return line ? decodeIcsText(line.slice(line.indexOf(':') + 1)).trim() : '';
}

export function getImportSourceNameFromUrl(url) {
  const text = String(url || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text);
    const fileName = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).at(-1) || '');
    if (fileName && !/^[0-9a-f-]{20,}$/i.test(fileName))
      return fileName.replace(/\.ics$/i, '') || '';
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return text.replace(/\.ics$/i, '');
  }
}

export function unfoldIcsLines(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .reduce((lines, line) => {
      if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] += line.slice(1);
      else lines.push(line.trimEnd());
      return lines;
    }, []);
}

export function decodeIcsText(value) {
  return String(value || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}
