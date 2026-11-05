/**
 * 文件用途：HTML 文本转义。
 * 将外部文本中的特殊字符转为实体，供模板拼接使用，避免标题和备注被当作 HTML 结构解释。
 */
export function escapeHtml(value: unknown) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}
