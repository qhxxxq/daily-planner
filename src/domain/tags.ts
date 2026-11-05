/**
 * 文件用途：标签标准化。
 * 清理标签前缀和空白、去重并生成统一匹配键；保留显示名称与比较键的职责区分。
 */
export function normalizeTags(value: unknown) {
  if (Array.isArray(value))
    return [
      ...new Set(
        value
          .map((tag) =>
            String(tag || '')
              .trim()
              .replace(/^#+/, ''),
          )
          .filter(Boolean),
      ),
    ];
  return [
    ...new Set(
      String(value || '')
        .split(/[\s,，]+/)
        .map((tag) => tag.trim().replace(/^#+/, ''))
        .filter(Boolean),
    ),
  ];
}

export function normalizeTagKey(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/^#+/, '')
    .toLowerCase();
}

export function getEventTags(event: { tags?: string[] }) {
  return normalizeTags(event.tags);
}
