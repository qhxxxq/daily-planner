/**
 * 文件用途：本地存储适配器。
 * 封装 JSON 读取、写入、限量备份和草稿结构筛选；读取异常回退默认值，写入异常交给调用方处理。
 */
import type { EditorDraft } from '../types/model.js';
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
interface Backup {
  createdAt: string;
  text: string;
}

/** 偏好与草稿按独立存储键保存，避免为一次界面变化序列化整份日程文档。 */
export function create(storage: StoragePort) {
  function read<T>(key: string, fallback: T): T {
    try {
      return JSON.parse(storage.getItem(key) || 'null') ?? fallback;
    } catch {
      return fallback;
    }
  }
  function write(key: string, value: unknown): void {
    storage.setItem(key, JSON.stringify(value));
  }
  function backup(key: string, text: string, limit = 10): void {
    const previous = read<Backup[]>(key, []);
    if (!Array.isArray(previous)) throw new Error('备份列表损坏，请先导出当前日程');
    write(key, [{ createdAt: new Date().toISOString(), text }, ...previous].slice(0, limit));
  }
  function drafts(key: string): Record<string, EditorDraft> {
    const value = read<unknown>(key, {});
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, EditorDraft] => {
        const draft: unknown = entry[1];
        return (
          !!draft &&
          typeof draft === 'object' &&
          'values' in draft &&
          !!draft.values &&
          'base' in draft &&
          !!draft.base &&
          'original' in draft &&
          !!draft.original
        );
      }),
    );
  }
  return { read, write, backup, drafts };
}
