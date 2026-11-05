/**
 * 文件用途：日期与时间选择浮层。
 * 生成月份网格和时间选项，将选择结果回填输入框；负责浮层定位及滚动时的位置维护。
 */
import { runtime } from '../app/runtime.js';
import {
  addDays,
  fromMonthKey,
  getTodayKey,
  minuteToTime,
  normalizeDateInput,
  normalizeTime,
  parseDateKey,
  startOfCalendarGrid,
  toDateKey,
  toMonthKey,
} from '../domain/date-time.js';
import { renderRecurrenceFieldState } from './event-save.js';
import { closeFloatingMenus } from './menus.js';
import { captureEditorDraft } from './drafts.js';
import { TOTAL_MINUTES } from '../app/config.js';
import { clamp } from '../domain/math.js';

export function openDatePicker(input) {
  runtime.activePickerInput = input;
  const base = normalizeDateInput(input.value) || getTodayKey();
  renderDatePicker(base, toMonthKey(parseDateKey(base)));
  runtime.els.datePicker.onclick = handleDatePickerClick;
  showPickerNear(input, runtime.els.datePicker);
}

export function renderDatePicker(selectedDate, monthKey) {
  const monthDate = fromMonthKey(monthKey);
  const start = startOfCalendarGrid(monthDate.getFullYear(), monthDate.getMonth());
  const today = getTodayKey();
  const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日'];
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = addDays(start, index);
    const key = toDateKey(day);
    const classes = ['date-picker-day'];
    if (day.getMonth() !== monthDate.getMonth()) classes.push('is-muted');
    if (key === today) classes.push('is-today');
    if (key === selectedDate) classes.push('is-selected');
    return `<button type="button" data-date="${key}" class="${classes.join(' ')}">${day.getDate()}</button>`;
  }).join('');
  runtime.els.datePicker.innerHTML = `
    <div class="form-picker-head">
      <button type="button" data-month="-1" aria-label="上个月">‹</button>
      <strong>${monthDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })}</strong>
      <button type="button" data-month="1" aria-label="下个月">›</button>
    </div>
    <div class="date-picker-weekdays">${weekdayLabels.map((label) => `<span>${label}</span>`).join('')}</div>
    <div class="date-picker-grid">${days}</div>
  `;
  runtime.els.datePicker.dataset.month = monthKey;
}

export function handleDatePickerClick(event) {
  event.stopPropagation();
  const monthButton = (event.target as Element).closest<HTMLElement>('button[data-month]');
  if (monthButton) {
    const nextMonth = toMonthKey(
      addMonths(
        fromMonthKey(runtime.els.datePicker.dataset.month),
        Number(monthButton.dataset.month),
      ),
    );
    renderDatePicker(
      normalizeDateInput(runtime.activePickerInput?.value) || getTodayKey(),
      nextMonth,
    );
    return;
  }
  const button = (event.target as Element).closest<HTMLElement>('button[data-date]');
  if (!button || !runtime.activePickerInput) return;
  runtime.activePickerInput.value = button.dataset.date;
  if (runtime.activePickerInput === runtime.els.dateInput) renderRecurrenceFieldState();
  closeFloatingMenus();
  captureEditorDraft();
}

export function addMonths(date, amount) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount);
  return next;
}

export function openLegacyDatePicker(input) {
  runtime.activePickerInput = input;
  const base = normalizeDateInput(input.value) || getTodayKey();
  const date = parseDateKey(base);
  const start = startOfCalendarGrid(date.getFullYear(), date.getMonth());
  runtime.els.datePicker.innerHTML = Array.from({ length: 42 }, (_, index) => {
    const day = addDays(start, index);
    const key = toDateKey(day);
    return `<button type="button" data-date="${key}" class="${key === base ? 'is-selected' : ''}">${day.getDate()}</button>`;
  }).join('');
  runtime.els.datePicker.onclick = (event) => {
    const button = (event.target as Element).closest<HTMLElement>('button[data-date]');
    if (!button) return;
    runtime.activePickerInput.value = button.dataset.date;
    if (runtime.activePickerInput === runtime.els.dateInput) renderRecurrenceFieldState();
    closeFloatingMenus();
  };
  showPickerNear(input, runtime.els.datePicker);
}

export function openTimePicker(input) {
  runtime.activePickerInput = input;
  const times = [];
  for (let minute = 0; minute < TOTAL_MINUTES; minute += 15) times.push(minuteToTime(minute));
  const selected = normalizeTime(input.value);
  const midday = Math.ceil(times.length / 2);
  const renderColumn = (items) => `
    <div class="time-picker-column">
      ${items.map((time) => `<button type="button" data-time="${time}" class="${time === selected ? 'is-selected' : ''}">${time}</button>`).join('')}
    </div>
  `;
  runtime.els.timePicker.innerHTML = `<div class="time-picker-columns">${renderColumn(times.slice(0, midday))}${renderColumn(times.slice(midday))}</div>`;
  runtime.els.timePicker.onclick = handleTimePickerClick;
  showPickerNear(input, runtime.els.timePicker);
  requestAnimationFrame(() => {
    runtime.els.timePicker
      .querySelector<HTMLElement>('button.is-selected')
      ?.scrollIntoView({ block: 'center' });
  });
}

export function handleTimePickerClick(event) {
  event.stopPropagation();
  const button = (event.target as Element).closest<HTMLElement>('button[data-time]');
  if (!button || !runtime.activePickerInput) return;
  runtime.activePickerInput.value = button.dataset.time;
  closeFloatingMenus();
  captureEditorDraft();
}

export function showPickerNear(input, picker) {
  closeFloatingMenus();
  picker.hidden = false;
  positionInputPicker(input, picker);
}

export function positionInputPicker(input, picker) {
  const rect = input.getBoundingClientRect();
  const margin = 12;
  const gap = 4;
  picker.style.maxHeight = `${Math.max(0, window.innerHeight - margin * 2)}px`;
  const width = picker.offsetWidth || (picker === runtime.els.timePicker ? 156 : 232);
  const height = picker.offsetHeight || 240;
  const below = window.innerHeight - rect.bottom - margin - gap;
  const above = rect.top - margin - gap;
  const placeBelow = below >= height || below >= above;
  const available = Math.max(0, placeBelow ? below : above);
  picker.style.maxHeight = `${available}px`;
  const visibleHeight = Math.min(height, available);
  const left = clamp(rect.left, margin, Math.max(margin, window.innerWidth - width - margin));
  picker.style.left = `${left}px`;
  picker.style.top = `${placeBelow ? rect.bottom + gap : rect.top - gap - visibleHeight}px`;
  picker.style.transformOrigin = placeBelow ? 'top left' : 'bottom left';
}

export function repositionInputPicker(event) {
  if (!runtime.activePickerInput) return;
  // 在选择器内部滚动时不重定位浮层，否则会改变锚点或重置列表滚动位置。
  if (event?.target?.closest?.('.form-picker')) return;
  for (const picker of [runtime.els.datePicker, runtime.els.timePicker]) {
    if (!picker.hidden) positionInputPicker(runtime.activePickerInput, picker);
  }
}
