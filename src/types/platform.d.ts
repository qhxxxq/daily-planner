/**
 * 文件用途：平台桥接类型声明。
 * 描述原生回执和 Window 上的文件、Apple 同步及图标接口；仅提供编译期约束，不创建运行时桥接实现。
 */
import type { AppleSnapshot } from './model.js';
export interface NativeResponse extends Partial<AppleSnapshot> {
  ok?: boolean;
  error?: string;
  errorCode?: string;
  text?: string;
  name?: string;
  path?: string;
}
declare global {
  interface Window {
    lucide?: { createIcons(): void };
    webkit?: {
      messageHandlers?: {
        plannerWindow?: {
          postMessage(message: { action: string; [key: string]: unknown }): void;
        };
        plannerFile?: {
          postMessage(message: { id: string; action: string; [key: string]: unknown }): void;
        };
      };
    };
    __plannerFileBridgeResolve: (id: string, response?: NativeResponse) => void;
    __syncPlannerToAppleCalendar: () => Promise<void>;
  }
}
