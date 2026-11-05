/**
 * 文件用途：浮动菜单公共管理。
 * 统一关闭和定位界面菜单，并处理全局点击、焦点返回和选择清理；避免不同功能的浮层互相遮挡。
 */
import { runtime } from '../app/runtime.js';
import { renderSearchUi } from './search.js';
import { closeForm } from './editor.js';
import { updateTimelinePointerTarget } from './clipboard.js';
import { hasOpenFloatingMenus } from './shortcuts.js';
import { clamp } from '../domain/math.js';

export function stopFloatingMenuPropagation(event) {
  event.stopPropagation();
}

export function handleDocumentClick(event) {
  if (runtime.suppressNextDocumentClick) {
    runtime.suppressNextDocumentClick = false;
    return;
  }
  const target = event.target;
  if (target.closest('dialog, .search-shell, .persistence-status')) return;
  if (!target.closest('.search-shell')) {
    runtime.searchResultsOpen = false;
    renderSearchUi();
  }
  if (runtime.pointerDownStartedInDetailPanel && !target.closest('.detail-panel')) {
    runtime.pointerDownStartedInDetailPanel = false;
    return;
  }
  const isFloatingClick = isFloatingUiTarget(target);
  const isFormClick = !!target.closest('.detail-panel');
  const isEventClick = !!target.closest('.event-card');
  if (isFormClick || isEventClick || isFloatingClick) return;
  closeFloatingMenus();
  if (runtime.state.activeEventId) {
    closeForm();
    return;
  }
  clearEventSelection();
}

export function clearEventSelection() {
  if (!runtime.selectedEventIds.size) return;
  runtime.selectedEventIds.clear();
  document
    .querySelectorAll<HTMLElement>('.event-card.is-selected-event')
    .forEach((card) => card.classList.remove('is-selected-event'));
}

export function handleGlobalPointerDown(event) {
  runtime.pointerDownStartedInDetailPanel = !!event.target.closest?.('.detail-panel');
  updateTimelinePointerTarget(event);
  if (isFloatingUiTarget(event.target)) return;
  if (hasOpenFloatingMenus()) {
    closeFloatingMenus();
  }
}

export function clearDetailPanelPointerOriginSoon() {
  window.setTimeout(() => {
    runtime.pointerDownStartedInDetailPanel = false;
  }, 0);
}

export function isFloatingUiTarget(target) {
  return !!target?.closest?.(
    '.context-menu, .form-picker, .url-import-form, .theme-menu, #sourceSelectButton, #tagPickerButton, #importButton, #filePanelButton, #settingsButton',
  );
}

export function closePasteMenuForOtherAction(event) {
  if (event.target?.closest?.('#eventContextMenu.is-paste-menu')) return;
  if (
    !runtime.els.eventContextMenu.hidden &&
    runtime.els.eventContextMenu.classList.contains('is-paste-menu')
  ) {
    runtime.els.eventContextMenu.hidden = true;
    runtime.els.eventContextMenu.classList.remove('is-paste-menu');
  }
}

export function closeFloatingMenus() {
  const themeHadFocus = runtime.els.themeMenu?.contains(document.activeElement);
  runtime.els.settingsButton?.setAttribute('aria-expanded', 'false');
  runtime.tagPickerCreateOpen = false;
  runtime.els.tagPickerMenu?.classList.remove('is-creating');
  getFloatingMenus().forEach((el) => {
    if (el) el.hidden = true;
  });
  runtime.els.eventContextMenu.classList.remove('is-paste-menu');
  if (themeHadFocus) runtime.els.settingsButton?.focus();
}

export function getFloatingMenus() {
  return [
    runtime.els.sourcePickerMenu,
    runtime.els.tagPickerMenu,
    runtime.els.datePicker,
    runtime.els.timePicker,
    runtime.els.themeMenu,
    runtime.els.calendarContextMenu,
    runtime.els.calendarColorMenu,
    runtime.els.fileContextMenu,
    runtime.els.eventContextMenu,
    runtime.els.urlImportForm,
  ];
}

export function positionViewportMenu(menu, left, top) {
  const width = menu.offsetWidth || 200;
  const height = menu.offsetHeight || 240;
  const margin = 12;
  menu.style.left = `${clamp(left, margin, Math.max(margin, window.innerWidth - width - margin))}px`;
  menu.style.top = `${clamp(top, margin, Math.max(margin, window.innerHeight - height - margin))}px`;
}
