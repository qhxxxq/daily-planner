/**
 * 文件用途：主题选项与自动标签配色。
 * 渲染主题选择项，根据主题色板与已用颜色生成标签颜色；为新建标签提供稳定的配色入口。
 */
import { runtime } from '../app/runtime.js';
import { palette, tagColorPalettes, themes } from '../app/config.js';
import { escapeHtml } from '../domain/html.js';
import { stringHash } from '../domain/colors.js';
import { render } from './render.js';
import { saveUiPrefs } from '../app/persistence.js';
import { closeFloatingMenus, positionViewportMenu } from './menus.js';
import { normalizeTagKey } from '../domain/tags.js';
import { updateNativeWindowAppearance } from '../platform/window.js';

export function renderThemeOptions() {
  if (!runtime.els.themeOptions) return;
  runtime.els.themeOptions.innerHTML = themes
    .map(
      (theme) =>
        `<button class="theme-option ${theme.id === runtime.state.theme ? 'is-active' : ''}" type="button" aria-pressed="${theme.id === runtime.state.theme}" data-theme="${theme.id}"><span class="theme-swatch" aria-hidden="true">${theme.colors.map((color) => `<span style="background:${color}"></span>`).join('')}</span><span class="theme-name">${escapeHtml(theme.name)}</span><span class="theme-check" aria-hidden="true">${theme.id === runtime.state.theme ? '✓' : ''}</span></button>`,
    )
    .join('');
}

export function getThemeCalendarColors() {
  return themes.find((theme) => theme.id === runtime.state.theme)?.calendarColors || palette;
}

export function getAutoTagColor(name, themeId = runtime.state?.theme, usedColors = new Set()) {
  const colors = tagColorPalettes[themeId] || tagColorPalettes.coral;
  const start = stringHash(normalizeTagKey(name)) % colors.length;
  for (let offset = 0; offset < colors.length; offset += 1) {
    const color = colors[(start + offset) % colors.length];
    if (!usedColors.has(color.toLowerCase())) return color;
  }
  return colors[start];
}

export function toggleThemeMenu(event: Event) {
  event.preventDefault();
  event.stopPropagation();
  const opening = runtime.els.themeMenu.hidden;
  closeFloatingMenus();
  if (!opening) return;
  renderThemeOptions();
  runtime.els.themeMenu.hidden = false;
  runtime.els.settingsButton.setAttribute('aria-expanded', 'true');
  const anchor = runtime.els.settingsButton.getBoundingClientRect();
  positionViewportMenu(runtime.els.themeMenu, anchor.left, anchor.bottom + 8);
  runtime.els.themeOptions.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
}

export function handleThemeSelection(event: Event) {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-theme]');
  const theme = themes.find((item) => item.id === button?.dataset.theme);
  if (!theme) return;
  event.stopPropagation();
  runtime.state.theme = theme.id;
  updateNativeWindowAppearance(theme.id);
  saveUiPrefs();
  render({ preserveScroll: true });
  closeFloatingMenus();
  runtime.els.settingsButton.focus();
}
