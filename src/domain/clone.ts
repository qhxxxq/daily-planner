/**
 * 文件用途：数据深拷贝工具。
 * 优先使用 structuredClone 深拷贝，旧环境回退到 JSON 序列化；回退分支只适用于可 JSON 序列化的数据。
 */
export function structuredCloneSafe<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
