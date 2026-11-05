/**
 * 文件用途：编辑器标签选择与新建。
 * 渲染已选标签和候选菜单，处理选择、移除及新建标签；将表单变化交给草稿管理保存。
 */
import { normalizeTagKey, normalizeTags } from '../domain/tags.js';
import { runtime } from '../app/runtime.js';
import { ensureTagsExist, getTagMeta } from '../app/queries.js';
import { applyTagCssVars } from '../domain/colors.js';
import { escapeHtml } from '../domain/html.js';
import { captureEditorDraft } from './drafts.js';
import { closeFloatingMenus, positionViewportMenu } from './menus.js';
import { getTagSummaries } from './sidebar.js';

export function renderFormTagPills() {
  const tags = normalizeTags(runtime.els.tagsInput.value);
  runtime.els.formTagPills.innerHTML = '';
  tags.forEach((tag) => {
    const meta = getTagMeta(tag);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'form-tag-pill tag-chip';
    chip.dataset.tag = tag;
    applyTagCssVars(chip, meta.color);
    chip.innerHTML = `<span class="form-tag-name">${escapeHtml(tag)}</span><span class="tag-chip-remove" aria-hidden="true">×</span>`;
    runtime.els.formTagPills.append(chip);
  });
}

export function handleFormTagPillClick(event) {
  const chip = (event.target as Element).closest<HTMLElement>('.form-tag-pill');
  if (!chip) return;
  const key = normalizeTagKey(chip.dataset.tag);
  runtime.els.tagsInput.value = normalizeTags(runtime.els.tagsInput.value)
    .filter((tag) => normalizeTagKey(tag) !== key)
    .join(' ');
  renderFormTagPills();
  captureEditorDraft();
}

export function toggleTagPickerMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  closeFloatingMenus();
  runtime.tagPickerCreateOpen = false;
  renderTagPickerMenu();
  runtime.els.tagPickerMenu.hidden = false;
  const rect = runtime.els.tagPickerButton.getBoundingClientRect();
  positionViewportMenu(runtime.els.tagPickerMenu, rect.left, rect.bottom + 6);
}

export function renderTagPickerMenu() {
  const selected = new Set(normalizeTags(runtime.els.tagsInput.value).map(normalizeTagKey));
  const summaries = getTagSummaries().filter((tag) => !tag.archived);
  runtime.els.tagPickerMenu.innerHTML = '';
  runtime.els.tagPickerMenu.classList.toggle('is-creating', runtime.tagPickerCreateOpen);
  const list = document.createElement('div');
  list.className = 'tag-picker-list tag-list';
  if (summaries.length) {
    summaries.forEach((tag) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'tag-item tag-picker-item';
      item.dataset.tag = tag.name;
      item.dataset.tagKey = tag.key;
      item.setAttribute('aria-pressed', String(selected.has(tag.key)));
      applyTagCssVars(item, tag.color);
      if (selected.has(tag.key)) item.classList.add('is-selected');
      item.innerHTML = `
        <span class="tag-name"></span>
        <span class="tag-count ${tag.count === 0 ? 'is-empty' : ''}">${tag.count}</span>
      `;
      item.querySelector<HTMLElement>('.tag-name').textContent = tag.name;
      list.append(item);
    });
  } else {
    const empty = document.createElement('div');
    empty.className = 'tag-picker-empty';
    empty.textContent = '没有标签';
    list.append(empty);
  }
  if (runtime.tagPickerCreateOpen) {
    const form = document.createElement('form');
    form.className = 'tag-picker-create';
    form.innerHTML = `
      <input class="tag-picker-create-input" name="tagName" type="text" autocomplete="off" aria-label="标签名称" placeholder="标签名称" />
      <div class="tag-picker-create-actions">
        <button class="tag-picker-create-cancel" type="button" data-action="cancel-new-tag">取消</button>
        <button class="tag-picker-create-submit" type="submit">添加</button>
      </div>
    `;
    runtime.els.tagPickerMenu.append(list, form);
    requestAnimationFrame(() =>
      form.querySelector<HTMLElement>('.tag-picker-create-input')?.focus(),
    );
    return;
  }
  const newButton = document.createElement('button');
  newButton.className = 'tag-picker-new';
  newButton.type = 'button';
  newButton.dataset.action = 'new-tag';
  newButton.textContent = '新建标签';
  runtime.els.tagPickerMenu.append(list, newButton);
}

export function handleTagPickerClick(event: MouseEvent) {
  event.stopPropagation();
  const action = (event.target as Element).closest<HTMLElement>('button[data-action]');
  if (action) {
    if (action.dataset.action === 'new-tag') runtime.tagPickerCreateOpen = true;
    if (action.dataset.action === 'cancel-new-tag') runtime.tagPickerCreateOpen = false;
    renderTagPickerMenu();
    return;
  }
  const button = (event.target as Element).closest<HTMLElement>('.tag-picker-item[data-tag]');
  if (!button) return;
  const current = normalizeTags(runtime.els.tagsInput.value);
  const key = button.dataset.tagKey || normalizeTagKey(button.dataset.tag);
  const name =
    button.dataset.tag || button.querySelector<HTMLElement>('.tag-name')?.textContent || '';
  runtime.els.tagsInput.value = current.some((tag) => normalizeTagKey(tag) === key)
    ? current.filter((tag) => normalizeTagKey(tag) !== key).join(' ')
    : [...current, name].join(' ');
  renderFormTagPills();
  renderTagPickerMenu();
  captureEditorDraft();
}

export function handleTagPickerSubmit(event: SubmitEvent) {
  if (!(event.target as Element).closest<HTMLElement>('.tag-picker-create')) return;
  event.preventDefault();
  event.stopPropagation();
  const input = (event.target as HTMLFormElement).querySelector<HTMLInputElement>(
    '.tag-picker-create-input',
  );
  const name = String(input?.value || '')
    .trim()
    .replace(/^#+/, '');
  if (!name) {
    input?.focus();
    return;
  }
  ensureTagsExist([name]);
  const current = normalizeTags(runtime.els.tagsInput.value);
  if (!current.some((tag) => normalizeTagKey(tag) === normalizeTagKey(name))) {
    runtime.els.tagsInput.value = [...current, name].join(' ');
  }
  runtime.tagPickerCreateOpen = false;
  renderFormTagPills();
  renderTagPickerMenu();
  captureEditorDraft();
}
