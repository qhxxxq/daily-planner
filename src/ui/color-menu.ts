/**
 * 文件用途：列表与标签颜色编辑。
 * 打开对应颜色菜单，处理色板选择和自定义颜色输入；将颜色更新到状态后保存并刷新相关界面。
 */
import { getKnownTags, getSource } from '../app/queries.js';
import { runtime } from '../app/runtime.js';
import { getThemeCalendarColors } from './themes.js';
import { getRgbText } from '../domain/colors.js';
import { closeFloatingMenus, positionViewportMenu } from './menus.js';
import { normalizeTagKey } from '../domain/tags.js';
import { pushUndoSnapshot } from './undo.js';
import { saveAndRender } from '../app/persistence.js';

export function openTagColorMenu(tagKey) {
  const tag = getKnownTags().find((item) => item.key === tagKey);
  if (!tag) return;
  runtime.els.calendarColorMenu.dataset.kind = 'tag';
  runtime.els.calendarColorMenu.dataset.tagKey = tag.key;
  runtime.els.calendarColorMenu.innerHTML = `
    <div class="color-menu-title">修改标签颜色</div>
    <div class="calendar-color-grid">
      ${getThemeCalendarColors()
        .map(
          (color) => `
        <button class="calendar-color-swatch ${color.toLowerCase() === tag.color.toLowerCase() ? 'is-active' : ''}" type="button" data-color="${color}" style="background:${color};--swatch-rgb:${getRgbText(color)}" aria-label="选择颜色 ${color}"></button>
      `,
        )
        .join('')}
    </div>
    <label class="calendar-color-custom">
      自定义
      <input type="color" value="${tag.color}" style="--swatch-rgb:${getRgbText(tag.color)}" aria-label="自定义标签颜色" />
    </label>
  `;
  runtime.els.calendarContextMenu.hidden = true;
  runtime.els.calendarColorMenu.hidden = false;
  const rect = document
    .querySelector<HTMLElement>(`.tag-item[data-tag-key="${CSS.escape(tag.key)}"]`)
    ?.getBoundingClientRect();
  positionViewportMenu(runtime.els.calendarColorMenu, rect?.left || 14, (rect?.bottom || 120) + 6);
}

export function openSourceColorMenu(sourceId) {
  if (!sourceId) return;
  const source = getSource(sourceId);
  if (!source) return;
  runtime.els.calendarColorMenu.dataset.kind = 'source';
  runtime.els.calendarColorMenu.dataset.sourceId = source.id;
  runtime.els.calendarColorMenu.innerHTML = `
    <div class="color-menu-title">修改日历颜色</div>
    <div class="calendar-color-grid">
      ${getThemeCalendarColors()
        .map(
          (color) => `
        <button class="calendar-color-swatch ${color.toLowerCase() === source.color.toLowerCase() ? 'is-active' : ''}" type="button" data-color="${color}" style="background:${color};--swatch-rgb:${getRgbText(color)}" aria-label="选择颜色 ${color}"></button>
      `,
        )
        .join('')}
    </div>
    <label class="calendar-color-custom">
      自定义
      <input type="color" value="${source.color}" style="--swatch-rgb:${getRgbText(source.color)}" aria-label="自定义日历颜色" />
    </label>
  `;
  runtime.els.calendarContextMenu.hidden = true;
  runtime.els.calendarColorMenu.hidden = false;
  const rect = document
    .querySelector<HTMLElement>(`.source-item[data-source-id="${CSS.escape(source.id)}"]`)
    ?.getBoundingClientRect();
  positionViewportMenu(runtime.els.calendarColorMenu, rect?.left || 14, (rect?.bottom || 120) + 6);
}

export function handleCalendarColorClick(event) {
  const button = (event.target as Element).closest<HTMLElement>('button[data-color]');
  if (!button) return;
  if (runtime.els.calendarColorMenu.dataset.kind === 'tag')
    updateTagColor(runtime.els.calendarColorMenu.dataset.tagKey, button.dataset.color);
  if (runtime.els.calendarColorMenu.dataset.kind === 'source')
    updateSourceColor(runtime.els.calendarColorMenu.dataset.sourceId, button.dataset.color);
  closeFloatingMenus();
}

export function handleCalendarColorInput(event) {
  if (event.target.type !== 'color') return;
  if (runtime.els.calendarColorMenu.dataset.kind === 'tag')
    updateTagColor(runtime.els.calendarColorMenu.dataset.tagKey, event.target.value);
  if (runtime.els.calendarColorMenu.dataset.kind === 'source')
    updateSourceColor(runtime.els.calendarColorMenu.dataset.sourceId, event.target.value);
}

export function updateTagColor(tagKey, color) {
  const key = normalizeTagKey(tagKey);
  const stored = runtime.state.tags.find((item) => normalizeTagKey(item.name) === key);
  const known = getKnownTags().find((item) => item.key === key);
  if (!known) return;
  if (stored && stored.color === color) return;
  pushUndoSnapshot();
  if (stored) stored.color = color;
  else runtime.state.tags.push({ name: known.name, color, archived: known.archived === true });
  saveAndRender({ preserveScroll: true });
}

export function updateSourceColor(sourceId, color) {
  if (!sourceId) return;
  const source = getSource(sourceId);
  if (!source || source.color === color) return;
  pushUndoSnapshot();
  source.color = color;
  runtime.state.selectedSourceId = source.id;
  saveAndRender({ preserveScroll: true });
}
