/**
 * 文件用途：界面事件绑定。
 * 将按钮、表单、键盘和指针事件连接到各功能模块；启动阶段统一注册，具体业务交给对应处理函数。
 */
import { toggleThemeMenu, handleThemeSelection } from '../ui/themes.js';
import { closeFloatingMenus } from '../ui/menus.js';
import { captureEditorDraft, openDraftsDialog } from '../ui/drafts.js';
import { runAppleCalendarSync } from '../ui/apple-sync.js';
import {
  handleDataFileInput,
  hasNativeFileBridge,
  newDataFile,
  openDataFile,
  openFileContextMenu,
  saveDataFile,
} from '../platform/files.js';
import { runtime } from './runtime.js';
import {
  clearSearch,
  bindSearchPopover,
  handleSearchInput,
  handleSearchKeydown,
  handleSearchResultClick,
  handleTagAreaClick,
  renderSearchUi,
} from '../ui/search.js';
import { openRecoveryDialog } from '../ui/recovery.js';
import { goToday, setViewMode, shiftDay, shiftMiniMonth, shiftWeek } from '../ui/navigation.js';
import { handleIcsFileInput, handleUrlImportSubmit, toggleUrlImportForm } from '../ui/import.js';
import {
  finishSidebarResize,
  handleSidebarResize,
  startSidebarResize,
  toggleArchivedSources,
  toggleArchivedTags,
} from '../ui/sidebar.js';
import { deleteActiveEvent, renderRecurrenceFieldState, saveEvent } from '../ui/event-save.js';
import {
  closeForm,
  positionDetailPanel,
  toggleDetailPanel,
  handleEventFormKeydown,
  handleStatusSegmentClick,
  renderAllDayFieldState,
  renderTodoStatusFieldState,
} from '../ui/editor.js';
import { renderReminderFields } from '../ui/reminders.js';
import {
  handleCalendarContextClick,
  handleSourcePickerClick,
  openSourceContextMenu,
  openTagContextMenu,
  toggleSourcePickerMenu,
} from '../ui/source-menu.js';
import {
  handleFormTagPillClick,
  handleTagPickerClick,
  handleTagPickerSubmit,
  toggleTagPickerMenu,
} from '../ui/tag-picker.js';
import {
  clearDetailPanelPointerOriginSoon,
  closePasteMenuForOtherAction,
  handleDocumentClick,
  handleGlobalPointerDown,
  stopFloatingMenuPropagation,
} from '../ui/menus.js';
import { handleCalendarColorClick, handleCalendarColorInput } from '../ui/color-menu.js';
import { handleEventContextClick, updateTimelinePointerTarget } from '../ui/clipboard.js';
import { handleDailyTodoPanelClick } from '../ui/daily-todos.js';
import { openDatePicker, openTimePicker, repositionInputPicker } from '../ui/date-time-picker.js';
import { clearDragCreate, finishDragCreate, handleDragCreateMove } from '../ui/event-create.js';
import {
  clearEventPointerInteraction,
  finishEventPointerInteraction,
  handleEventPointerMove,
} from '../ui/event-drag.js';
import { handleKeyboardShortcuts } from '../ui/shortcuts.js';

export function bindEvents() {
  bindSearchPopover();
  document.querySelector('#detailToggleButton')?.addEventListener('click', toggleDetailPanel);
  document
    .querySelector<HTMLButtonElement>('#draftsButton')
    ?.addEventListener('click', openDraftsDialog);
  document
    .querySelector<HTMLButtonElement>('#appleSyncNowButton')
    ?.addEventListener('click', () => runAppleCalendarSync(true));
  document.querySelector<HTMLButtonElement>('#appleSyncNowButton').hidden = !hasNativeFileBridge();
  runtime.els.eventForm.addEventListener('input', captureEditorDraft);
  runtime.els.eventForm.addEventListener('change', captureEditorDraft);
  runtime.els.searchInput.addEventListener('focus', () => {
    runtime.searchResultsOpen = true;
    renderSearchUi();
  });
  runtime.els.searchInput.addEventListener('keydown', handleSearchKeydown);
  runtime.els.searchResults.addEventListener('keydown', handleSearchKeydown);
  runtime.els.searchResults.addEventListener('click', handleSearchResultClick);
  document
    .querySelector<HTMLButtonElement>('#recoveryButton')
    ?.addEventListener('click', openRecoveryDialog);
  runtime.els.dayViewButton.addEventListener('click', () => setViewMode('day'));
  runtime.els.weekViewButton.addEventListener('click', () => setViewMode('week'));
  runtime.els.monthViewButton.addEventListener('click', () => setViewMode('month'));
  runtime.els.todayButton.addEventListener('click', goToday);
  runtime.els.prevDayButton.addEventListener('click', () => shiftDay(-1));
  runtime.els.nextDayButton.addEventListener('click', () => shiftDay(1));
  runtime.els.prevWeekButton.addEventListener('click', () => shiftWeek(-1));
  runtime.els.nextWeekButton.addEventListener('click', () => shiftWeek(1));
  runtime.els.prevMonthButton.addEventListener('click', () => shiftMiniMonth(-1));
  runtime.els.nextMonthButton.addEventListener('click', () => shiftMiniMonth(1));
  runtime.els.searchInput.addEventListener('input', handleSearchInput);
  runtime.els.clearSearchButton.addEventListener('click', clearSearch);
  runtime.els.filePanelButton.addEventListener('click', openFileContextMenu);
  runtime.els.settingsButton?.addEventListener('click', toggleThemeMenu);
  runtime.els.themeOptions?.addEventListener('click', handleThemeSelection);
  const appleSyncButton = document.querySelector<HTMLButtonElement>('#settingsAppleSyncButton');
  if (appleSyncButton) appleSyncButton.hidden = !hasNativeFileBridge();
  appleSyncButton?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeFloatingMenus();
    if (hasNativeFileBridge()) window.__syncPlannerToAppleCalendar();
  });
  runtime.els.newFileButton.addEventListener('click', newDataFile);
  runtime.els.openFileButton.addEventListener('click', openDataFile);
  runtime.els.saveFileButton.addEventListener('click', () => saveDataFile());
  runtime.els.dataFileInput.addEventListener('change', handleDataFileInput);
  runtime.els.importButton.addEventListener('click', toggleUrlImportForm);
  runtime.els.icsInput.addEventListener('change', handleIcsFileInput);
  runtime.els.urlImportForm.addEventListener('submit', handleUrlImportSubmit);
  runtime.els.archivedToggle?.addEventListener('click', toggleArchivedSources);
  runtime.els.archivedTagsToggle?.addEventListener('click', toggleArchivedTags);
  runtime.els.eventForm.addEventListener('submit', saveEvent);
  runtime.els.eventForm.addEventListener('keydown', handleEventFormKeydown);
  runtime.els.eventForm.addEventListener('compositionstart', () => {
    runtime.eventFormCompositionActive = true;
  });
  runtime.els.eventForm.addEventListener('compositionend', () => {
    runtime.eventFormCompositionActive = false;
  });
  runtime.els.cancelFormButton.addEventListener('click', closeForm);
  runtime.els.closeFormButton.addEventListener('click', closeForm);
  runtime.els.deleteButton.addEventListener('click', deleteActiveEvent);
  runtime.els.reminderInput.addEventListener('change', renderReminderFields);
  runtime.els.sourceInput.addEventListener('change', renderReminderFields);
  runtime.els.allDayInput.addEventListener('change', renderAllDayFieldState);
  runtime.els.recurrenceInput.addEventListener('change', renderRecurrenceFieldState);
  runtime.els.seriesScopeInput.addEventListener('change', renderRecurrenceFieldState);
  runtime.els.recurrenceCountInput.addEventListener('input', renderRecurrenceFieldState);
  runtime.els.eventTypeInput.addEventListener('change', renderTodoStatusFieldState);
  runtime.els.statusSegment.addEventListener('click', handleStatusSegmentClick);
  runtime.els.sourceSelectButton.addEventListener('click', toggleSourcePickerMenu);
  runtime.els.sourcePickerMenu.addEventListener('click', handleSourcePickerClick);
  runtime.els.tagPickerButton.addEventListener('click', toggleTagPickerMenu);
  runtime.els.tagPickerMenu.addEventListener('pointerdown', stopFloatingMenuPropagation);
  runtime.els.tagPickerMenu.addEventListener('click', handleTagPickerClick);
  runtime.els.tagPickerMenu.addEventListener('submit', handleTagPickerSubmit);
  runtime.els.formTagPills.addEventListener('click', handleFormTagPillClick);
  document.querySelector<HTMLElement>('.tag-sources').addEventListener('click', handleTagAreaClick);
  document
    .querySelector<HTMLElement>('.calendar-sources')
    .addEventListener('contextmenu', openSourceContextMenu);
  document
    .querySelector<HTMLElement>('.tag-sources')
    .addEventListener('contextmenu', openTagContextMenu);
  runtime.els.calendarContextMenu.addEventListener('click', handleCalendarContextClick);
  runtime.els.calendarColorMenu.addEventListener('click', handleCalendarColorClick);
  runtime.els.calendarColorMenu.addEventListener('input', handleCalendarColorInput);
  runtime.els.eventContextMenu.addEventListener('click', handleEventContextClick);
  runtime.els.sidebarResizer?.addEventListener('pointerdown', startSidebarResize);
  runtime.els.emptyDetail.addEventListener('click', handleDailyTodoPanelClick);
  [runtime.els.dateInput, runtime.els.endDateInput].forEach((input) => {
    input.addEventListener('focus', () => openDatePicker(input));
    input.addEventListener('click', () => openDatePicker(input));
  });
  runtime.els.dateInput.addEventListener('input', renderRecurrenceFieldState);
  [runtime.els.startInput, runtime.els.endInput].forEach((input) => {
    input.addEventListener('focus', () => openTimePicker(input));
    input.addEventListener('click', () => openTimePicker(input));
  });
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('scroll', repositionInputPicker, true);
  window.addEventListener('resize', (event) => {
    positionDetailPanel();
    repositionInputPicker(event);
  });
  document.addEventListener('pointerdown', handleGlobalPointerDown, true);
  document.addEventListener('wheel', closePasteMenuForOtherAction, true);
  document.addEventListener('keydown', closePasteMenuForOtherAction, true);
  document.addEventListener('pointermove', updateTimelinePointerTarget);
  document.addEventListener('pointermove', handleSidebarResize);
  document.addEventListener('pointermove', handleDragCreateMove);
  document.addEventListener('pointermove', handleEventPointerMove);
  document.addEventListener('pointerup', finishDragCreate);
  document.addEventListener('pointerup', finishSidebarResize);
  document.addEventListener('pointerup', finishEventPointerInteraction);
  document.addEventListener('pointerup', clearDetailPanelPointerOriginSoon, true);
  document.addEventListener('pointercancel', clearDragCreate);
  document.addEventListener('pointercancel', finishSidebarResize);
  document.addEventListener('pointercancel', clearEventPointerInteraction);
  document.addEventListener(
    'pointercancel',
    () => {
      runtime.pointerDownStartedInDetailPanel = false;
    },
    true,
  );
  document.addEventListener('keydown', handleKeyboardShortcuts);
}
